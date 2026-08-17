import { describe, expect, it } from 'vitest';
import { SCENE_STORAGE_KEY } from '../constants';
import { createStarterSceneDocument } from './sceneSchema';
import {
  PRE_APPLY_RECOVERY_STORAGE_KEY,
  loadPreApplySceneRecovery,
  saveSceneBeforeGenerationApply,
} from './sceneRecovery';

function memoryStorage(initial: Record<string, string> = {}): Storage {
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

const document = createStarterSceneDocument({
  documentId: 'scene-current',
  floorId: 'floor-current',
  mannequinId: 'mannequin-current',
});

describe('pre-apply scene recovery', () => {
  it('현재 SceneDocument와 selection을 일반 autosave와 별도 durable recovery에 함께 저장한다', () => {
    const storage = memoryStorage();

    saveSceneBeforeGenerationApply(storage, {
      document,
      selectedObjectId: 'mannequin-current',
      targetGenerationId: 'generation-target',
      targetVersionNumber: 4,
    });

    expect(JSON.parse(storage.getItem(SCENE_STORAGE_KEY)!)).toEqual(document);
    expect(loadPreApplySceneRecovery(storage)).toMatchObject({
      document,
      selectedObjectId: 'mannequin-current',
      targetGenerationId: 'generation-target',
      targetVersionNumber: 4,
    });
  });

  it('일반 autosave write 실패 시 기존 autosave와 recovery를 byte-identical하게 보존한다', () => {
    const oldAutosave = '{"old":"autosave"}';
    const oldRecovery = '{"old":"recovery"}';
    const base = memoryStorage({
      [SCENE_STORAGE_KEY]: oldAutosave,
      [PRE_APPLY_RECOVERY_STORAGE_KEY]: oldRecovery,
    });
    const storage: Storage = {
      ...base,
      setItem(key, value) {
        if (key === SCENE_STORAGE_KEY) throw new Error('disk full');
        base.setItem(key, value);
      },
    };

    expect(() =>
      saveSceneBeforeGenerationApply(storage, {
        document,
        selectedObjectId: 'mannequin-current',
        targetGenerationId: 'generation-target',
        targetVersionNumber: 4,
      }),
    ).toThrow('브라우저에 장면을 저장하지 못했습니다.');
    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(oldAutosave);
    expect(storage.getItem(PRE_APPLY_RECOVERY_STORAGE_KEY)).toBe(oldRecovery);
  });
});
