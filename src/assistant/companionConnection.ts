import { z } from 'zod';

export const COMPANION_SESSION_KEY = 'i2v.companion.connection.v1';

const connectionSchema = z.object({
  version: z.literal(1),
  url: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'http:' &&
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      );
    }, 'Companion은 loopback HTTP 주소여야 합니다.'),
  token: z.string().min(32),
});

export type CompanionConnection = z.infer<typeof connectionSchema>;

export interface CompanionConnectionState {
  connection: CompanionConnection | null;
  error: string | null;
}

interface BrowserConnectionContext {
  hash: string;
  pathname: string;
  search: string;
  storage: Storage;
  replaceUrl(url: string): void;
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return decodeURIComponent(
    Array.from(atob(`${normalized}${padding}`))
      .map(
        (character) =>
          `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`,
      )
      .join(''),
  );
}

function parseStoredConnection(value: string | null) {
  if (value === null) return null;
  return connectionSchema.parse(JSON.parse(value) as unknown);
}

export function consumeCompanionConnection(
  context: BrowserConnectionContext,
): CompanionConnectionState {
  const params = new URLSearchParams(context.hash.replace(/^#/, ''));
  const encoded = params.get('companion');

  if (encoded !== null) {
    context.replaceUrl(`${context.pathname}${context.search}`);
    try {
      const connection = connectionSchema.parse(
        JSON.parse(decodeBase64Url(encoded)) as unknown,
      );
      context.storage.setItem(
        COMPANION_SESSION_KEY,
        JSON.stringify(connection),
      );
      return { connection, error: null };
    } catch {
      context.storage.removeItem(COMPANION_SESSION_KEY);
      return {
        connection: null,
        error: 'Companion 연결 링크가 올바르지 않습니다.',
      };
    }
  }

  try {
    return {
      connection: parseStoredConnection(
        context.storage.getItem(COMPANION_SESSION_KEY),
      ),
      error: null,
    };
  } catch {
    context.storage.removeItem(COMPANION_SESSION_KEY);
    return {
      connection: null,
      error: '저장된 Companion 연결 정보가 손상되었습니다.',
    };
  }
}

export function parseCompanionConnectionPayload(value: unknown) {
  const parsed = connectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const COMPANION_DEV_DISCOVERY_PATH = '/__i2v/companion-connection';

export async function discoverCompanionConnection(
  fetchImpl: typeof fetch = fetch,
): Promise<CompanionConnection | null> {
  try {
    const response = await fetchImpl(COMPANION_DEV_DISCOVERY_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return parseCompanionConnectionPayload((await response.json()) as unknown);
  } catch {
    return null;
  }
}

export function clearCompanionConnection(storage: Storage) {
  storage.removeItem(COMPANION_SESSION_KEY);
}
