import { describe, expect, it, vi } from 'vitest';
import { MAX_SCENE_STORAGE_BYTES, SCENE_STORAGE_KEY } from '../constants';
import { createStarterSceneDocument } from './sceneSchema';
import {
  encodeSceneDocument,
  importSceneDocument,
  loadSceneDocument,
  parseSceneDocument,
  saveSceneDocument,
  SceneCodecError,
  SceneStorageError,
  UnsupportedSceneVersionError,
} from './sceneCodec';

const SCENE_IDS = {
  documentId: 'scene-codec',
  floorId: 'floor-codec',
  mannequinId: 'mannequin-codec',
} as const;

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
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

describe('sceneCodec', () => {
  it('versioned Zod SceneDocument를 JSON으로 round-trip한다', () => {
    const document = createStarterSceneDocument(SCENE_IDS);

    const encoded = encodeSceneDocument(document);
    const decoded = parseSceneDocument(encoded);

    expect(JSON.parse(encoded)).toEqual(document);
    expect(decoded).toEqual(document);
    expect(decoded).not.toBe(document);
  });

  it('malformed JSON과 current-version schema 위반을 actionable codec error로 거부한다', () => {
    expect(() => parseSceneDocument('{"version":')).toThrow(SceneCodecError);
    expect(() =>
      parseSceneDocument(JSON.stringify({ version: 1, id: 'incomplete' })),
    ).toThrowError(/유효하지 않은 장면 데이터/);
  });

  it('size limit을 넘는 serialized scene을 JSON parse 전에 거부한다', () => {
    const document = createStarterSceneDocument(SCENE_IDS);
    const oversized = JSON.stringify({
      ...document,
      name: 'x'.repeat(MAX_SCENE_STORAGE_BYTES + 1),
    });

    expect(() => parseSceneDocument(oversized)).toThrowError(/크기 제한/);
  });

  it('placeholder migration boundary에서 unknown version을 명시적으로 거부한다', () => {
    const document = createStarterSceneDocument(SCENE_IDS);

    expect(() =>
      parseSceneDocument(JSON.stringify({ ...document, version: 999 })),
    ).toThrow(UnsupportedSceneVersionError);
    expect(() =>
      parseSceneDocument(JSON.stringify({ ...document, version: 999 })),
    ).toThrowError(/지원하지 않는 장면 버전.*999/);
  });

  it('namespaced localStorage key와 approximate size limit으로 save/load한다', () => {
    const document = createStarterSceneDocument(SCENE_IDS);
    const storage = createMemoryStorage();

    saveSceneDocument(storage, document);

    expect(SCENE_STORAGE_KEY).toMatch(/^i2v-3d-scene-helper:scene:v1$/);
    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(
      encodeSceneDocument(document),
    );
    expect(loadSceneDocument(storage)).toEqual(document);
    expect(MAX_SCENE_STORAGE_BYTES).toBeGreaterThan(1_000_000);
    expect(() => saveSceneDocument(storage, document, 10)).toThrowError(
      /크기 제한/,
    );
  });

  it('QuotaExceededError를 actionable error로 바꾸고 기존 valid autosave를 보존한다', () => {
    const document = createStarterSceneDocument(SCENE_IDS);
    const validAutosave = encodeSceneDocument(document);
    const storage = createMemoryStorage({
      [SCENE_STORAGE_KEY]: validAutosave,
    });
    storage.setItem = vi.fn(() => {
      throw new DOMException('quota full', 'QuotaExceededError');
    });

    expect(() => saveSceneDocument(storage, document)).toThrow(
      SceneStorageError,
    );
    expect(() => saveSceneDocument(storage, document)).toThrowError(
      /저장 공간이 부족.*JSON 내보내기/,
    );
    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(validAutosave);
  });

  it('malformed import를 완전히 parse+validate한 뒤에만 교체해 live scene과 autosave를 보존한다', () => {
    const document = createStarterSceneDocument(SCENE_IDS);
    const validAutosave = encodeSceneDocument(document);
    const storage = createMemoryStorage({
      [SCENE_STORAGE_KEY]: validAutosave,
    });
    const replaceDocument = vi.fn();

    expect(() => importSceneDocument('{"version":1}', replaceDocument)).toThrow(
      SceneCodecError,
    );
    expect(replaceDocument).not.toHaveBeenCalled();
    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(validAutosave);

    importSceneDocument(validAutosave, replaceDocument);
    expect(replaceDocument).toHaveBeenCalledWith(document);
  });
});
