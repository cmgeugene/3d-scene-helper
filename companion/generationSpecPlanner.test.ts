// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  buildGenerationSpecRequest,
  createGenerationSpec,
  parseGenerationSpecSse,
} from './generationSpecPlanner';

const generationIntent = {
  revision: 3,
  sourceTurnId: 'turn-intent-3',
  userMessage: '비가 막 그친 새벽이고 두 사람은 화해 직전이야.',
  assistantSummary:
    '젖은 골목의 차가운 새벽빛과 화해 직전의 조심스러운 거리감을 반영합니다.',
  sceneRevision: 12,
  specRevision: 7,
};

const englishSpec = `Use case: photorealistic-natural
Asset type: cinematic I2V start frame
Primary request: Create a single finished cinematic frame in a rain-wet alley at dawn.
Input images: Image 1 controls camera, crop, pose, screen placement, depth and occlusion; later images control only their assigned appearance roles.
Scene/backdrop: A rain-wet Korean alley immediately after a storm at dawn.
Subject: Two people standing at a cautious distance just before reconciliation.
Style/medium: Photorealistic cinematic still.
Composition/framing: Preserve the OutputCamera layout, perspective, crop, pose, scale, depth order and occlusion exactly.
Lighting/mood: Cool dawn ambient light, wet reflections, restrained emotional tension.
Color palette: Cool blue-gray ambient tones with restrained warm skin tones.
Materials/textures: Wet asphalt, realistic clothing, skin, hair, and aged walls.
Constraints: Replace primitive proxy appearance with semantic objects and assigned references; preserve identity and clothing from character references.
Avoid: No proxy colors or primitive geometry, no reference-sheet text, no extra characters, no watermark.`;

describe('generationSpecPlanner', () => {
  it('builds a skill-style English planning request with current conversation intent', () => {
    const request = buildGenerationSpecRequest({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      sourcePrompt: '$imagegen 원본 SceneDocument와 LayoutSpec',
      generationIntent,
    });

    expect(request).toMatchObject({
      model: 'gpt-5.6-sol',
      stream: true,
      reasoning: { effort: 'high' },
    });
    expect(request).not.toHaveProperty('tools');
    expect(request.instructions).toContain('Use case:');
    expect(request.instructions).toContain('Composition/framing:');
    expect(request.instructions).toContain('Do not invent');
    expect(request.input[0]?.content).toContain(
      '원본 SceneDocument와 LayoutSpec',
    );
    expect(request.input[0]?.content).toContain('비가 막 그친 새벽');
    expect(request.input[0]?.content).toContain('turn-intent-3');
    expect(request.input[0]?.content).not.toContain('$imagegen');
  });

  it('parses a completed English output_text spec from Responses SSE', () => {
    const parsed = parseGenerationSpecSse(`event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"ignored partial"}

event: response.output_text.done
data: ${JSON.stringify({ type: 'response.output_text.done', text: englishSpec })}

data: [DONE]
`);
    expect(parsed).toBe(englishSpec);
  });

  it('parses Responses SSE that uses CRLF event framing', () => {
    const stream = [
      'event: response.output_text.done',
      `data: ${JSON.stringify({ type: 'response.output_text.done', text: englishSpec })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\r\n');

    expect(parseGenerationSpecSse(stream)).toBe(englishSpec);
  });

  it('rejects an incomplete spec that omits required visual fields', () => {
    const incomplete = englishSpec.replace(
      'Materials/textures: Wet asphalt, realistic clothing, skin, hair, and aged walls.\n',
      '',
    );
    expect(() =>
      parseGenerationSpecSse(
        `data: ${JSON.stringify({
          type: 'response.output_text.done',
          text: incomplete,
        })}\n\n`,
      ),
    ).toThrow('Materials/textures:');
  });

  it('posts the planner request before image generation', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          `event: response.output_text.done\ndata: ${JSON.stringify({ type: 'response.output_text.done', text: englishSpec })}\n\n`,
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );

    await expect(
      createGenerationSpec(
        {
          baseUrl: 'http://127.0.0.1:10532',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
          sourcePrompt: '$imagegen\n원본 프롬프트',
          generationIntent,
        },
        fetchImpl,
      ),
    ).resolves.toBe(englishSpec);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:10532/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
