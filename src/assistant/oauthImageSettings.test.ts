import { describe, expect, it } from 'vitest';
import { OAUTH_IMAGE_SETTINGS_STORAGE_KEY } from '../editor/constants';
import {
  DEFAULT_OAUTH_IMAGE_SETTINGS,
  readOAuthImageSettings,
  writeOAuthImageSettings,
} from './oauthImageSettings';

describe('oauthImageSettings', () => {
  it('returns defaults when storage is empty or invalid', () => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
    } as Pick<Storage, 'getItem' | 'setItem'>;

    expect(readOAuthImageSettings(storage)).toEqual(
      DEFAULT_OAUTH_IMAGE_SETTINGS,
    );
  });

  it('persists a selected model and quality', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    writeOAuthImageSettings(storage, {
      model: 'gpt-5.4',
      quality: 'high',
    });
    expect(values.get(OAUTH_IMAGE_SETTINGS_STORAGE_KEY)).toContain('gpt-5.4');
    expect(readOAuthImageSettings(storage)).toEqual({
      model: 'gpt-5.4',
      quality: 'high',
    });
  });
});
