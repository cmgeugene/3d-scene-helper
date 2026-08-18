// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  buildOAuthImageRequest,
  generateOAuthImage,
  parseOAuthResponsesSse,
  stripImagegenCommand,
} from './oauthImageProvider';

describe('oauthImageProvider', () => {
  it('strips the Codex $imagegen command from the user prompt', () => {
    expect(stripImagegenCommand('$imagegen\n레이아웃을 유지하세요.')).toBe(
      '레이아웃을 유지하세요.',
    );
    expect(stripImagegenCommand('레이아웃을 유지하세요.')).toBe(
      '레이아웃을 유지하세요.',
    );
  });

  it('builds the same Responses OAuth payload ima2-gen uses', () => {
    const request = buildOAuthImageRequest({
      prompt: '$imagegen\n한 장의 키프레임만 만들어 주세요.',
      model: 'gpt-5.4-mini',
      quality: 'low',
      size: '1024x1024',
      reasoningEffort: 'none',
      references: [
        {
          mimeType: 'image/png',
          base64: 'abc123',
        },
      ],
    });

    expect(request).toEqual({
      model: 'gpt-5.4-mini',
      stream: true,
      reasoning: { effort: 'none' },
      tool_choice: { type: 'image_generation' },
      tools: [
        {
          type: 'image_generation',
          quality: 'low',
          size: '1024x1024',
          moderation: 'low',
        },
      ],
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,abc123',
            },
            {
              type: 'input_text',
              text: '한 장의 키프레임만 만들어 주세요.',
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(request)).not.toContain('$imagegen');
  });

  it('reads the completed image_generation_call result from SSE', () => {
    const parsed = parseOAuthResponsesSse(`event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"image_generation_call","status":"completed","result":"ZmFrZS1pbWFnZQ==","revised_prompt":"a red square"}}

data: [DONE]
`);

    expect(parsed).toEqual({
      base64: 'ZmFrZS1pbWFnZQ==',
      revisedPrompt: 'a red square',
    });
  });

  it('posts the OAuth payload to /v1/responses and returns the image', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        `event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"bGl2ZQ==","revised_prompt":"ok"}}

`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    });

    const result = await generateOAuthImage(
      {
        baseUrl: 'http://127.0.0.1:10541',
        prompt: 'a red square',
        model: 'gpt-5.4-mini',
        quality: 'low',
        size: '1024x1024',
        reasoningEffort: 'none',
        references: [],
      },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:10541/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        }),
      }),
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body) as {
      model: string;
      tools: Array<{ quality: string }>;
    };
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.tools[0]?.quality).toBe('low');
    expect(result.base64).toBe('bGl2ZQ==');
    expect(result.revisedPrompt).toBe('ok');
  });
});
