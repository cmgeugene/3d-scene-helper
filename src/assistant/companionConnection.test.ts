import { describe, expect, it, vi } from 'vitest';
import {
  COMPANION_SESSION_KEY,
  consumeCompanionConnection,
} from './companionConnection';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function encode(value: unknown) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

describe('consumeCompanionConnection', () => {
  it('fragment를 소비하고 sessionStorage에만 연결을 보관한다', () => {
    const storage = createStorage();
    const replaceUrl = vi.fn();
    const descriptor = {
      version: 1,
      url: 'http://127.0.0.1:61234',
      token: 'a'.repeat(43),
    };

    const result = consumeCompanionConnection({
      hash: `#companion=${encode(descriptor)}`,
      pathname: '/editor',
      search: '?mode=dev',
      storage,
      replaceUrl,
    });

    expect(result).toEqual({ connection: descriptor, error: null });
    expect(replaceUrl).toHaveBeenCalledWith('/editor?mode=dev');
    expect(JSON.parse(storage.getItem(COMPANION_SESSION_KEY) ?? '')).toEqual(
      descriptor,
    );
  });

  it('원격 주소가 들어 있는 연결 링크를 거부한다', () => {
    const storage = createStorage();
    const result = consumeCompanionConnection({
      hash: `#companion=${encode({
        version: 1,
        url: 'https://example.com',
        token: 'a'.repeat(43),
      })}`,
      pathname: '/',
      search: '',
      storage,
      replaceUrl: vi.fn(),
    });

    expect(result.connection).toBeNull();
    expect(result.error).toMatch(/올바르지 않습니다/);
    expect(storage.getItem(COMPANION_SESSION_KEY)).toBeNull();
  });

  it('새로고침 시 sessionStorage에서 연결을 복원한다', () => {
    const storage = createStorage();
    storage.setItem(
      COMPANION_SESSION_KEY,
      JSON.stringify({
        version: 1,
        url: 'http://localhost:61234',
        token: 'b'.repeat(43),
      }),
    );

    expect(
      consumeCompanionConnection({
        hash: '',
        pathname: '/',
        search: '',
        storage,
        replaceUrl: vi.fn(),
      }).connection,
    ).toMatchObject({ url: 'http://localhost:61234' });
  });
});
