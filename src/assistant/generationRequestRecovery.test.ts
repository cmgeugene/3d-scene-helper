import { describe, expect, it } from 'vitest';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';
import {
  GENERATION_REQUEST_RECOVERY_STORAGE_KEY,
  clearGenerationRequestRecovery,
  readGenerationRequestRecovery,
  storeGenerationRequestRecovery,
} from './generationRequestRecovery';

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

function input() {
  const sceneSnapshot = createStarterSceneDocument({
    documentId: 'scene-recovery',
    floorId: 'floor-recovery',
    mannequinId: 'mannequin-recovery',
  });
  return {
    requestId: 'generation-request-recovery-1',
    threadId: 'thread-recovery',
    prompt: '$imagegen recovery',
    layoutRenderId: 'render-recovery',
    layoutSpec: { ...TEST_LAYOUT_SPEC, sceneId: sceneSnapshot.id },
    sceneSnapshot,
    referenceIds: [],
    parentGenerationId: null,
    sourceGenerationId: null,
    feedback: null,
    refinementDirective: null,
    generationMode: 'fresh' as const,
    acknowledgedPreflightWarningIds: [],
    imageModel: 'gpt-5.4-mini',
    imageQuality: 'medium' as const,
  };
}

describe('generation request recovery', () => {
  it('정규화된 요청을 JSON 왕복하고 명시적으로 정리한다', () => {
    const storage = createMemoryStorage();
    const stored = storeGenerationRequestRecovery(storage, input());

    expect(stored).toMatchObject({
      version: 1,
      input: { requestId: 'generation-request-recovery-1' },
    });
    expect(readGenerationRequestRecovery(storage)).toEqual(stored);
    clearGenerationRequestRecovery(storage);
    expect(readGenerationRequestRecovery(storage)).toBeNull();
  });

  it('손상되거나 계약이 맞지 않는 복구 데이터는 재전송하지 않고 제거한다', () => {
    const storage = createMemoryStorage({
      [GENERATION_REQUEST_RECOVERY_STORAGE_KEY]: JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        input: { requestId: 'missing-payload' },
      }),
    });

    expect(readGenerationRequestRecovery(storage)).toBeNull();
    expect(storage.getItem(GENERATION_REQUEST_RECOVERY_STORAGE_KEY)).toBeNull();
  });
});
