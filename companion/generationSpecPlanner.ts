import type { GenerationIntent } from '../shared/conversationMetadata';
import type { OAuthReasoningEffort } from './oauthImageProvider';

const REQUIRED_SPEC_LABELS = [
  'Use case:',
  'Asset type:',
  'Primary request:',
  'Input images:',
  'Scene/backdrop:',
  'Subject:',
  'Style/medium:',
  'Composition/framing:',
  'Lighting/mood:',
  'Color palette:',
  'Materials/textures:',
  'Constraints:',
  'Avoid:',
] as const;

export const GENERATION_SPEC_INSTRUCTIONS = `You are the prompt planner for an I2V start-frame image generator.
Rewrite the supplied scene evidence into one concise, production-oriented English visual specification. Return only the specification, with no markdown fence, preamble, explanation, JSON, or image tool call.

Use exactly these labels in this order:
Use case:
Asset type:
Primary request:
Input images:
Scene/backdrop:
Subject:
Style/medium:
Composition/framing:
Lighting/mood:
Color palette:
Materials/textures:
Constraints:
Avoid:

Authority rules:
- The OutputCamera render and LayoutSpec are authoritative for camera, lens perspective, crop, screen placement, subject scale, pose, facing, depth order, and occlusion.
- Treat the 3D render as a spatial blueprint, never as final appearance. Replace proxy colors, primitive geometry, grids, labels, and editor artifacts with semantic objects and assigned references.
- Describe every input image by its numbered role. Character references control identity, face, body, hair, and clothing only; the 3D layout controls pose and placement. Background/style references control only their declared roles.
- Treat Semantic Scene Spec and object semanticMeaning/generationNotes as authoritative current scene meaning.
- Conversation intent is supporting evidence only when it is a completed latest exchange. Apply concrete user intent and mutually confirmed interpretation. Ignore unresolved questions, assistant speculation, stale alternatives, and anything conflicting with current structured scene evidence.
- Do not invent characters, objects, story beats, brands, text, arbitrary side placement, or visual requirements not supported by the evidence.
- Preserve a detailed source request by normalizing it rather than creatively expanding it.
- Request one finished image only, with no panels, contact sheet, captions, watermark, or reference-sheet text.`;

export interface GenerationSpecRequest {
  model: string;
  stream: true;
  reasoning: { effort: OAuthReasoningEffort };
  instructions: string;
  input: Array<{ role: 'user'; content: string }>;
}

export interface GenerationSpecInput {
  model: string;
  reasoningEffort: OAuthReasoningEffort;
  sourcePrompt: string;
  generationIntent: GenerationIntent | null;
}

function serializeGenerationIntent(intent: GenerationIntent | null) {
  if (intent === null)
    return '[Latest completed Companion conversation intent]\nNone recorded.';
  return `[Latest completed Companion conversation intent / supporting evidence]\n${JSON.stringify(
    {
      revision: intent.revision,
      sourceTurnId: intent.sourceTurnId,
      userMessage: intent.userMessage,
      assistantSummary: intent.assistantSummary,
      sceneRevision: intent.sceneRevision,
      specRevision: intent.specRevision,
    },
    null,
    2,
  )}`;
}

export function buildGenerationSpecRequest(
  input: GenerationSpecInput,
): GenerationSpecRequest {
  const sourcePrompt = input.sourcePrompt.replace(/^\$imagegen(?:\s+|$)/, '');
  return {
    model: input.model,
    stream: true,
    reasoning: { effort: input.reasoningEffort },
    instructions: GENERATION_SPEC_INSTRUCTIONS,
    input: [
      {
        role: 'user',
        content: `${serializeGenerationIntent(input.generationIntent)}\n\n[Source scene evidence]\n${sourcePrompt}`,
      },
    ],
  };
}

function cleanGenerationSpec(value: string) {
  const trimmed = value
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (trimmed.length < 200) {
    throw new Error(
      'OAuth planner가 충분한 영어 Generation Spec을 반환하지 않았습니다.',
    );
  }
  const missing = REQUIRED_SPEC_LABELS.filter(
    (label) => !trimmed.includes(label),
  );
  if (missing.length > 0) {
    throw new Error(
      `OAuth Generation Spec 필수 항목이 없습니다: ${missing.join(', ')}`,
    );
  }
  return trimmed;
}

export function parseGenerationSpecSse(streamText: string) {
  let deltaText = '';
  let finalText: string | null = null;
  const normalizedStream = streamText.replace(/\r\n?/g, '\n');
  for (const block of normalizedStream.split(/\n\n+/)) {
    const payload = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('');
    if (payload === '' || payload === '[DONE]') continue;
    try {
      const data = JSON.parse(payload) as {
        type?: string;
        delta?: string;
        text?: string;
        item?: {
          type?: string;
          content?: Array<{ type?: string; text?: string }>;
        };
        response?: {
          output?: Array<{
            type?: string;
            content?: Array<{ type?: string; text?: string }>;
          }>;
        };
      };
      if (
        data.type === 'response.output_text.delta' &&
        typeof data.delta === 'string'
      ) {
        deltaText += data.delta;
      }
      if (
        data.type === 'response.output_text.done' &&
        typeof data.text === 'string'
      ) {
        finalText = data.text;
      }
      const messages = [
        ...(data.item?.type === 'message' ? [data.item] : []),
        ...(data.response?.output ?? []).filter(
          (item) => item.type === 'message',
        ),
      ];
      for (const message of messages) {
        const text = (message.content ?? [])
          .filter(
            (part) =>
              part.type === 'output_text' && typeof part.text === 'string',
          )
          .map((part) => part.text)
          .join('\n\n');
        if (text !== '') finalText = text;
      }
    } catch {
      continue;
    }
  }
  return cleanGenerationSpec(finalText ?? deltaText);
}

export async function createGenerationSpec(
  input: GenerationSpecInput & { baseUrl: string },
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    `${input.baseUrl.replace(/\/$/, '')}/v1/responses`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(buildGenerationSpecRequest(input)),
    },
  );
  if (!response.ok) {
    throw new Error(
      `OAuth Generation Spec 요청이 실패했습니다: ${response.status}`,
    );
  }
  return parseGenerationSpecSse(await response.text());
}
