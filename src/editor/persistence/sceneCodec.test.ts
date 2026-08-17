import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_SCENE_STORAGE_KEYS,
  MAX_SCENE_STORAGE_BYTES,
  SCENE_STORAGE_KEY,
} from '../constants';
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

function createLegacyV1Scene() {
  const legacy = structuredClone(
    createStarterSceneDocument(SCENE_IDS),
  ) as unknown as {
    version: number;
    objects: Array<{ kind: string; mannequinPose?: unknown }>;
    outputCamera: { position: { x: number; y: number; z: number } };
    [key: string]: unknown;
  };
  legacy.version = 1;
  legacy.outputCamera.position.z = 5;
  for (const object of legacy.objects) delete object.mannequinPose;
  return legacy;
}

function createLegacyV2Scene() {
  const legacy = structuredClone(
    createStarterSceneDocument(SCENE_IDS),
  ) as unknown as {
    version: number;
    outputCamera: { depthOfField?: unknown };
  };
  legacy.version = 2;
  delete legacy.outputCamera.depthOfField;
  return legacy;
}

describe('sceneCodec', () => {
  it('versioned Zod SceneDocument를 JSON으로 round-trip한다', () => {
    const document = createStarterSceneDocument(SCENE_IDS);
    document.semanticSceneSpec.intent.location = '한국 노포 야외 치킨집';
    document.semanticSceneSpec.generatedProps = [
      { name: '치킨', placement: '테이블 중앙', importance: '핵심' },
    ];
    const mannequin = document.objects.find(({ kind }) => kind === 'mannequin');
    if (mannequin?.mannequinPose === undefined) {
      throw new Error('starter mannequin pose가 필요합니다.');
    }
    mannequin.mannequinPose.id = 'custom';
    mannequin.mannequinPose.arms.left.elbowBendDeg = 74;
    document.mannequinAppearance.focusContoursEnabled = true;

    const encoded = encodeSceneDocument(document);
    const decoded = parseSceneDocument(encoded);

    expect(JSON.parse(encoded)).toEqual(document);
    expect(decoded).toEqual(document);
    expect(decoded).not.toBe(document);
    expect(decoded.semanticSceneSpec).toEqual(document.semanticSceneSpec);
    expect(
      decoded.objects.find(({ kind }) => kind === 'mannequin'),
    ).toHaveProperty('mannequinPose.arms.left.elbowBendDeg', 74);
    expect(decoded.mannequinAppearance.focusContoursEnabled).toBe(true);
  });

  it('기존 v2 문서는 기존 외관 보존을 위해 DOF disabled로 migration한다', () => {
    const migrated = parseSceneDocument(JSON.stringify(createLegacyV2Scene()));

    expect(migrated.version).toBe(3);
    expect(migrated.outputCamera.depthOfField).toEqual({
      enabled: false,
      apertureMode: 'auto',
      fStop: 2.8,
    });
    expect(migrated.mannequinAppearance).toEqual({
      focusContoursEnabled: false,
    });
  });

  it('spec 없는 구형 v2는 기본값으로 복원하고 malformed/unknown spec import는 부분 적용하지 않는다', () => {
    const legacy = structuredClone(
      createStarterSceneDocument(SCENE_IDS),
    ) as Partial<ReturnType<typeof createStarterSceneDocument>>;
    delete legacy.semanticSceneSpec;
    const restored = parseSceneDocument(JSON.stringify(legacy));
    expect(restored.semanticSceneSpec).toMatchObject({
      version: 1,
      generatedProps: [],
      relationships: [],
    });

    const replaceDocument = vi.fn();
    expect(() =>
      importSceneDocument(
        JSON.stringify({
          ...legacy,
          semanticSceneSpec: { version: 99 },
        }),
        replaceDocument,
      ),
    ).toThrow(SceneCodecError);
    expect(replaceDocument).not.toHaveBeenCalled();
  });

  it('기존 v2 팔다리 포즈의 누락된 joint deviation을 0도로 보정한다', () => {
    const legacyV2 = structuredClone(
      createStarterSceneDocument(SCENE_IDS),
    ) as unknown as {
      objects: Array<{
        kind: string;
        mannequinPose?: {
          arms: Record<'left' | 'right', { elbowDeviationDeg?: number }>;
          legs: Record<'left' | 'right', { kneeDeviationDeg?: number }>;
        };
      }>;
    };
    const mannequin = legacyV2.objects.find(({ kind }) => kind === 'mannequin');
    if (mannequin?.mannequinPose === undefined) {
      throw new Error('starter mannequin pose가 필요합니다.');
    }
    delete mannequin.mannequinPose.arms.left.elbowDeviationDeg;
    delete mannequin.mannequinPose.arms.right.elbowDeviationDeg;
    delete mannequin.mannequinPose.legs.left.kneeDeviationDeg;
    delete mannequin.mannequinPose.legs.right.kneeDeviationDeg;

    const legacy = {
      ...legacyV2,
      version: 2,
      outputCamera: createLegacyV2Scene().outputCamera,
    };
    const migrated = parseSceneDocument(JSON.stringify(legacy));
    const pose = migrated.objects.find(
      ({ kind }) => kind === 'mannequin',
    )?.mannequinPose;

    expect(pose?.arms.left.elbowDeviationDeg).toBe(0);
    expect(pose?.arms.right.elbowDeviationDeg).toBe(0);
    expect(pose?.legs.left.kneeDeviationDeg).toBe(0);
    expect(pose?.legs.right.kneeDeviationDeg).toBe(0);
  });

  it('v1 scene을 v3 default mannequin pose와 disabled DOF로 안전하게 migration한다', () => {
    const legacy = createLegacyV1Scene();

    const migrated = parseSceneDocument(JSON.stringify(legacy));

    expect(migrated.version).toBe(3);
    expect(migrated.outputCamera.position.z).toBe(5);
    expect(
      migrated.objects.find(({ kind }) => kind === 'mannequin'),
    ).toMatchObject({
      mannequinPose: { id: 'default' },
    });
    expect(
      migrated.objects.find(({ kind }) => kind === 'floor'),
    ).not.toHaveProperty('mannequinPose');
    expect(migrated.outputCamera.depthOfField.enabled).toBe(false);
  });

  it('v3 key가 없으면 legacy v2 localStorage key를 읽어 migration한다', () => {
    const storage = createMemoryStorage({
      [LEGACY_SCENE_STORAGE_KEYS[0]]: JSON.stringify(createLegacyV2Scene()),
    });

    const migrated = loadSceneDocument(storage);

    expect(migrated).toMatchObject({
      version: 3,
      outputCamera: { depthOfField: { enabled: false } },
    });
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

    expect(SCENE_STORAGE_KEY).toMatch(/^i2v-3d-scene-helper:scene:v3$/);
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
