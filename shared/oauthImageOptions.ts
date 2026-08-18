export const OAUTH_IMAGE_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
] as const;

export const OAUTH_IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto'] as const;

export type OAuthImageModel = (typeof OAUTH_IMAGE_MODELS)[number];
export type OAuthImageQuality = (typeof OAUTH_IMAGE_QUALITIES)[number];

export const DEFAULT_OAUTH_IMAGE_MODEL =
  'gpt-5.4-mini' satisfies OAuthImageModel;
export const DEFAULT_OAUTH_IMAGE_QUALITY = 'medium' satisfies OAuthImageQuality;
export const DEFAULT_OAUTH_PROXY_PORT = 10532;

export function parseOAuthReadyUrl(line: string) {
  const match = line.match(
    /https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/v1)?/i,
  );
  return match ? match[0].replace(/\/v1\/?$/i, '') : null;
}

export function filterOAuthImageModels(models: readonly string[]) {
  const allowed = new Set<string>(OAUTH_IMAGE_MODELS);
  return models.filter((model) => allowed.has(model));
}
