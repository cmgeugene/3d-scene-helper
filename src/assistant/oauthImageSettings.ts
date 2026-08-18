import { OAUTH_IMAGE_SETTINGS_STORAGE_KEY } from '../editor/constants';
import {
  DEFAULT_OAUTH_IMAGE_MODEL,
  DEFAULT_OAUTH_IMAGE_QUALITY,
  OAUTH_IMAGE_MODELS,
  OAUTH_IMAGE_QUALITIES,
  type OAuthImageQuality,
} from '../../shared/oauthImageOptions';

export interface OAuthImageSettings {
  model: string;
  quality: OAuthImageQuality;
}

export const DEFAULT_OAUTH_IMAGE_SETTINGS: OAuthImageSettings = {
  model: DEFAULT_OAUTH_IMAGE_MODEL,
  quality: DEFAULT_OAUTH_IMAGE_QUALITY,
};

function isQuality(value: unknown): value is OAuthImageQuality {
  return (
    typeof value === 'string' &&
    (OAUTH_IMAGE_QUALITIES as readonly string[]).includes(value)
  );
}

export function readOAuthImageSettings(
  storage: Pick<Storage, 'getItem'>,
): OAuthImageSettings {
  const raw = storage.getItem(OAUTH_IMAGE_SETTINGS_STORAGE_KEY);
  if (raw === null) return { ...DEFAULT_OAUTH_IMAGE_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthImageSettings>;
    const model =
      typeof parsed.model === 'string' &&
      (OAUTH_IMAGE_MODELS as readonly string[]).includes(parsed.model)
        ? parsed.model
        : DEFAULT_OAUTH_IMAGE_MODEL;
    const quality = isQuality(parsed.quality)
      ? parsed.quality
      : DEFAULT_OAUTH_IMAGE_QUALITY;
    return { model, quality };
  } catch {
    return { ...DEFAULT_OAUTH_IMAGE_SETTINGS };
  }
}

export function writeOAuthImageSettings(
  storage: Pick<Storage, 'setItem'>,
  settings: OAuthImageSettings,
) {
  storage.setItem(OAUTH_IMAGE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}
