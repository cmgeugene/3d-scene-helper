import {
  LEGACY_SCENE_STORAGE_KEYS,
  MAX_SCENE_STORAGE_BYTES,
  SCENE_DOCUMENT_VERSION,
  SCENE_STORAGE_KEY,
} from '../constants';
import { createMannequinPose } from '../mannequin/mannequinRig';
import { createLensDepthOfFieldSettings } from '../scene/lensDepthOfField';
import { sceneDocumentSchema, type SceneDocument } from './sceneSchema';

export class SceneCodecError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SceneCodecError';
  }
}

export class UnsupportedSceneVersionError extends SceneCodecError {
  constructor(version: unknown) {
    super(
      `지원하지 않는 장면 버전입니다: ${String(version)}. 최신 버전의 파일을 선택하세요.`,
    );
    this.name = 'UnsupportedSceneVersionError';
  }
}

export class SceneStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SceneStorageError';
  }
}

function migrateSceneDocument(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('version' in value)) {
    return value;
  }

  if (value.version === SCENE_DOCUMENT_VERSION) return value;

  if (value.version === 1 || value.version === 2) {
    const legacy = value as Record<string, unknown>;
    const objects =
      value.version === 1 && Array.isArray(legacy.objects)
        ? legacy.objects.map((object) => {
            if (
              typeof object !== 'object' ||
              object === null ||
              !('kind' in object) ||
              object.kind !== 'mannequin'
            ) {
              return object;
            }
            return {
              ...object,
              mannequinPose: createMannequinPose('default'),
            };
          })
        : legacy.objects;
    const outputCamera =
      typeof legacy.outputCamera === 'object' &&
      legacy.outputCamera !== null &&
      !Array.isArray(legacy.outputCamera)
        ? {
            ...legacy.outputCamera,
            depthOfField: createLensDepthOfFieldSettings(false),
          }
        : legacy.outputCamera;
    return {
      ...legacy,
      version: SCENE_DOCUMENT_VERSION,
      objects,
      outputCamera,
    };
  }

  throw new UnsupportedSceneVersionError(value.version);
}

export function encodeSceneDocument(document: SceneDocument): string {
  return JSON.stringify(sceneDocumentSchema.parse(document), null, 2);
}

export function parseSceneDocument(serialized: string): SceneDocument {
  if (approximateUtf8Size(serialized) > MAX_SCENE_STORAGE_BYTES) {
    throw new SceneCodecError(
      '장면 JSON이 크기 제한을 초과했습니다. 더 작은 장면 파일을 선택하세요.',
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new SceneCodecError(
      '장면 JSON을 읽을 수 없습니다. 올바른 JSON 파일인지 확인하세요.',
      { cause: error },
    );
  }

  const result = sceneDocumentSchema.safeParse(migrateSceneDocument(value));
  if (!result.success) {
    throw new SceneCodecError(
      '유효하지 않은 장면 데이터입니다. 파일 내용과 버전을 확인하세요.',
      { cause: result.error },
    );
  }

  return result.data;
}

function approximateUtf8Size(serialized: string): number {
  return new TextEncoder().encode(serialized).byteLength;
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

export function saveSceneDocument(
  storage: Storage,
  document: SceneDocument,
  maxBytes = MAX_SCENE_STORAGE_BYTES,
): string {
  const serialized = encodeSceneDocument(document);
  if (approximateUtf8Size(serialized) > maxBytes) {
    throw new SceneStorageError(
      '장면이 로컬 저장 크기 제한을 초과했습니다. JSON 내보내기로 백업하세요.',
    );
  }

  try {
    storage.setItem(SCENE_STORAGE_KEY, serialized);
  } catch (error) {
    if (isQuotaExceededError(error)) {
      throw new SceneStorageError(
        '브라우저 저장 공간이 부족합니다. 불필요한 사이트 데이터를 정리하거나 JSON 내보내기로 장면을 백업하세요.',
        { cause: error },
      );
    }
    throw new SceneStorageError('브라우저에 장면을 저장하지 못했습니다.', {
      cause: error,
    });
  }

  return serialized;
}

export function loadSceneDocument(storage: Storage): SceneDocument | null {
  const serialized =
    storage.getItem(SCENE_STORAGE_KEY) ??
    LEGACY_SCENE_STORAGE_KEYS.map((key) => storage.getItem(key)).find(
      (candidate): candidate is string => candidate !== null,
    ) ??
    null;
  return serialized === null ? null : parseSceneDocument(serialized);
}

export function importSceneDocument(
  serialized: string,
  replaceDocument: (document: SceneDocument) => void,
): SceneDocument {
  const document = parseSceneDocument(serialized);
  replaceDocument(document);
  return document;
}
