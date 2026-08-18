// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OAUTH_IMAGE_MODEL,
  DEFAULT_OAUTH_IMAGE_QUALITY,
  OAUTH_IMAGE_MODELS,
  filterOAuthImageModels,
  parseOAuthReadyUrl,
} from './oauthImageProvider';

describe('oauth proxy helpers', () => {
  it('parses the openai-oauth ready URL without the /v1 suffix', () => {
    expect(
      parseOAuthReadyUrl(
        'OpenAI-compatible endpoint ready at http://127.0.0.1:10532/v1',
      ),
    ).toBe('http://127.0.0.1:10532');
  });

  it('keeps only image-capable ChatGPT models', () => {
    expect(
      filterOAuthImageModels([
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.3-codex-spark',
        'codex-auto-review',
      ]),
    ).toEqual(['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']);
    expect(OAUTH_IMAGE_MODELS).toContain(DEFAULT_OAUTH_IMAGE_MODEL);
    expect(DEFAULT_OAUTH_IMAGE_QUALITY).toBe('medium');
  });
});
