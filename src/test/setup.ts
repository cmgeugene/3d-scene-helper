import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(String(key)) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

for (const storageName of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[storageName]?.clear !== 'function') {
    const storage = createMemoryStorage();
    Object.defineProperty(globalThis, storageName, {
      configurable: true,
      value: storage,
    });
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, storageName, {
        configurable: true,
        value: storage,
      });
    }
  }
}

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => null),
  });
}
