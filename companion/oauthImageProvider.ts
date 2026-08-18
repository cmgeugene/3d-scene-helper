import type { OAuthImageQuality } from '../shared/oauthImageOptions';
export type { OAuthImageQuality } from '../shared/oauthImageOptions';
export type OAuthReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export {
  DEFAULT_OAUTH_IMAGE_MODEL,
  DEFAULT_OAUTH_IMAGE_QUALITY,
  DEFAULT_OAUTH_PROXY_PORT,
  OAUTH_IMAGE_MODELS,
  OAUTH_IMAGE_QUALITIES,
  filterOAuthImageModels,
  parseOAuthReadyUrl,
} from '../shared/oauthImageOptions';

export interface OAuthImageReference {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
}

export interface OAuthImageRequestInput {
  prompt: string;
  model: string;
  quality: OAuthImageQuality;
  size: string;
  reasoningEffort: OAuthReasoningEffort;
  references: OAuthImageReference[];
  moderation?: 'low' | 'auto';
}

export interface OAuthImageRequest {
  model: string;
  stream: true;
  reasoning: { effort: OAuthReasoningEffort };
  tool_choice: { type: 'image_generation' };
  tools: Array<{
    type: 'image_generation';
    quality: OAuthImageQuality;
    size: string;
    moderation: 'low' | 'auto';
  }>;
  input: Array<{
    role: 'user';
    content:
      | string
      | Array<
          | { type: 'input_image'; image_url: string }
          | { type: 'input_text'; text: string }
        >;
  }>;
}

export interface OAuthImageResult {
  base64: string;
  revisedPrompt: string | null;
}

export function stripImagegenCommand(prompt: string) {
  return prompt.replace(/^\$imagegen\n/, '');
}

export function buildOAuthImageRequest(
  input: OAuthImageRequestInput,
): OAuthImageRequest {
  const text = stripImagegenCommand(input.prompt);
  const referenceParts = input.references.map((reference) => ({
    type: 'input_image' as const,
    image_url: `data:${reference.mimeType};base64,${reference.base64}`,
  }));

  return {
    model: input.model,
    stream: true,
    reasoning: { effort: input.reasoningEffort },
    tool_choice: { type: 'image_generation' },
    tools: [
      {
        type: 'image_generation',
        quality: input.quality,
        size: input.size,
        moderation: input.moderation ?? 'low',
      },
    ],
    input: [
      {
        role: 'user',
        content:
          referenceParts.length === 0
            ? text
            : [...referenceParts, { type: 'input_text', text }],
      },
    ],
  };
}

export function parseOAuthResponsesSse(streamText: string): OAuthImageResult {
  const blocks = streamText.split(/\n\n+/);
  let base64: string | null = null;
  let revisedPrompt: string | null = null;

  for (const block of blocks) {
    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    if (payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as {
        item?: {
          type?: string;
          result?: string;
          revised_prompt?: string;
        };
        response?: {
          output?: Array<{
            type?: string;
            result?: string;
            revised_prompt?: string;
          }>;
        };
      };
      const item =
        parsed.item ??
        parsed.response?.output?.find(
          (candidate) => candidate.type === 'image_generation_call',
        );
      if (
        item?.type === 'image_generation_call' &&
        typeof item.result === 'string' &&
        item.result.length > 0
      ) {
        base64 = item.result;
        revisedPrompt =
          typeof item.revised_prompt === 'string' ? item.revised_prompt : null;
      }
    } catch {
      continue;
    }
  }

  if (base64 === null) {
    throw new Error(
      'OAuth Responses 스트림에서 이미지 결과를 찾지 못했습니다.',
    );
  }
  return { base64, revisedPrompt };
}

export async function generateOAuthImage(
  input: OAuthImageRequestInput & { baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthImageResult> {
  const baseUrl = input.baseUrl.replace(/\/$/, '');
  const response = await fetchImpl(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(buildOAuthImageRequest(input)),
  });
  if (!response.ok) {
    throw new Error(`OAuth Responses 요청이 실패했습니다: ${response.status}`);
  }
  return parseOAuthResponsesSse(await response.text());
}
