import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GenerationIntent } from '../shared/conversationMetadata';
import { createGenerationSpec } from './generationSpecPlanner';
import {
  generateOAuthImage,
  type OAuthImageQuality,
  type OAuthImageReference,
  type OAuthReasoningEffort,
} from './oauthImageProvider';

export interface OAuthImageProviderOptions {
  baseUrl: string;
  model: string;
  quality: OAuthImageQuality;
  size?: string;
  reasoningEffort: OAuthReasoningEffort;
}

function mimeFromPath(filePath: string): OAuthImageReference['mimeType'] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

export async function loadOAuthImageReferences(
  filePaths: string[],
): Promise<OAuthImageReference[]> {
  return Promise.all(
    filePaths.map(async (filePath) => ({
      mimeType: mimeFromPath(filePath),
      base64: (await readFile(filePath)).toString('base64'),
    })),
  );
}

export async function writeOAuthImageResult(base64: string) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'scene-helper-oauth-'),
  );
  const filePath = path.join(directory, 'result.png');
  await writeFile(filePath, Buffer.from(base64, 'base64'));
  return {
    filePath,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function generateOAuthImageFromFiles(
  options: OAuthImageProviderOptions & {
    sourcePrompt: string;
    generationIntent: GenerationIntent | null;
    filePaths: string[];
  },
  fetchImpl: typeof fetch = fetch,
) {
  const generationSpec = await createGenerationSpec(
    {
      baseUrl: options.baseUrl,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      sourcePrompt: options.sourcePrompt,
      generationIntent: options.generationIntent,
    },
    fetchImpl,
  );
  const result = await generateOAuthImage(
    {
      baseUrl: options.baseUrl,
      prompt: generationSpec,
      model: options.model,
      quality: options.quality,
      size: options.size ?? 'auto',
      reasoningEffort: options.reasoningEffort,
      references: await loadOAuthImageReferences(options.filePaths),
    },
    fetchImpl,
  );
  const saved = await writeOAuthImageResult(result.base64);
  return {
    ...result,
    generationSpec,
    ...saved,
  };
}
