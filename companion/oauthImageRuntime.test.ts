// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateOAuthImageFromFiles } from './oauthImageRuntime';

const roots: string[] = [];
const spec = `Use case: photorealistic-natural
Asset type: cinematic I2V start frame
Primary request: Create one finished frame of two people before reconciliation.
Input images: Image 1 controls camera, crop, pose, placement, depth and occlusion.
Scene/backdrop: A rain-wet Korean alley at dawn.
Subject: Two people standing at a cautious distance.
Style/medium: Photorealistic cinematic still.
Composition/framing: Preserve OutputCamera composition exactly.
Lighting/mood: Cool dawn light and restrained tension.
Color palette: Cool blue-gray with warm skin tones.
Materials/textures: Wet asphalt and realistic clothing.
Constraints: Preserve pose, crop, depth, identity and assigned reference roles.
Avoid: No proxy geometry, no extra people, no text, no watermark.`;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('generateOAuthImageFromFiles', () => {
  it('sends the exact imagegen skill prompt directly to image_generation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oauth-image-runtime-'));
    roots.push(root);
    const reference = path.join(root, 'layout.png');
    await writeFile(reference, Buffer.from('fake-png'));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        `event: response.output_item.done\ndata: ${JSON.stringify({
          type: 'response.output_item.done',
          item: {
            type: 'image_generation_call',
            result: Buffer.from('image-result').toString('base64'),
            revised_prompt: 'tool revised prompt',
          },
        })}\n\n`,
        { status: 200 },
      ),
    );

    const result = await generateOAuthImageFromFiles(
      {
        baseUrl: 'http://127.0.0.1:10532',
        model: 'gpt-5.6-sol',
        quality: 'high',
        reasoningEffort: 'high',
        generationPrompt: spec,
        filePaths: [reference],
      },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = JSON.parse(
      (fetchImpl.mock.calls[0]?.[1] as { body: string }).body,
    ) as { input: Array<{ content: Array<{ type: string; text?: string }> }> };
    const imageText = request.input[0]?.content.find(
      (part) => part.type === 'input_text',
    )?.text;
    expect(imageText).toBe(spec);
    expect(result.generationSpec).toBe(spec);
    expect(result.revisedPrompt).toBe('tool revised prompt');
    await result.cleanup();
  });
});
