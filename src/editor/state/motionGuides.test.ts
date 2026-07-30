import { describe, expect, it } from 'vitest';
import { shouldIncludeMotionGuides } from '../export/exportFrame';
import {
  createStarterSceneDocument,
  hasRenderableMotionDirection,
} from '../persistence/sceneSchema';
import { createEditorStore } from './editorStore';

const FLOOR_ID = 'motion-floor';
const MANNEQUIN_ID = 'motion-mannequin';

function createMotionStore() {
  return createEditorStore({
    initialDocument: createStarterSceneDocument({
      documentId: 'motion-scene',
      floorId: FLOOR_ID,
      mannequinId: MANNEQUIN_ID,
    }),
    idFactory: () => 'generated-motion-object',
  });
}

describe('motion guide state', () => {
  it('clean export excludes motion guides while explicit reference export includes them', () => {
    expect(shouldIncludeMotionGuides('clean', true)).toBe(false);
    expect(shouldIncludeMotionGuides('reference', false)).toBe(false);
    expect(shouldIncludeMotionGuides('reference', true)).toBe(true);
  });

  it('creating a guide enables transient preview/reference visibility', () => {
    const store = createMotionStore();
    expect(store.getState().guideVisibility.motion).toBe(false);

    store.getState().selectObject(MANNEQUIN_ID);
    store.getState().setSubjectMotionGuide({
      subjectId: MANNEQUIN_ID,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
      label: '오른쪽',
    });
    expect(store.getState().guideVisibility.motion).toBe(true);

    store.getState().setGuideVisibility({ motion: false });
    store.getState().setCameraMotionGuide({
      motionType: 'dolly',
      direction: { x: 0, y: 0, z: -1 },
      strength: 0.5,
      label: '돌리 인',
    });
    expect(store.getState().guideVisibility.motion).toBe(true);
  });

  it('rejects zero-length directions at the renderer boundary', () => {
    expect(hasRenderableMotionDirection({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(hasRenderableMotionDirection({ x: 1, y: 0, z: 0 })).toBe(true);
  });

  it('subject guide ownership always follows the selected object and remains a single vector', () => {
    const store = createMotionStore();
    store.getState().selectObject(MANNEQUIN_ID);

    store.getState().setSubjectMotionGuide({
      subjectId: FLOOR_ID,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
      label: '오른쪽',
    });

    expect(store.getState().document.subjectMotionGuide).toEqual({
      subjectId: MANNEQUIN_ID,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
      label: '오른쪽',
    });

    store.getState().selectObject(FLOOR_ID);
    store.getState().setSubjectMotionGuide({
      subjectId: MANNEQUIN_ID,
      direction: { x: 0, y: 1, z: 0 },
      strength: 0.8,
      label: '위쪽',
    });

    expect(store.getState().document.subjectMotionGuide).toEqual({
      subjectId: FLOOR_ID,
      direction: { x: 0, y: 1, z: 0 },
      strength: 0.8,
      label: '위쪽',
    });
  });

  it('deleting the owned subject clears it while camera updates replace the single scene guide', () => {
    const store = createMotionStore();
    store.getState().selectObject(MANNEQUIN_ID);
    store.getState().setSubjectMotionGuide({
      subjectId: MANNEQUIN_ID,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
      label: '오른쪽',
    });
    store.getState().setCameraMotionGuide({
      motionType: 'pan',
      direction: { x: -1, y: 0, z: 0 },
      strength: 0.4,
      label: '팬 왼쪽',
    });
    store.getState().setCameraMotionGuide({
      motionType: 'dolly',
      direction: { x: 0, y: 0, z: -1 },
      strength: 0.7,
      label: '돌리 인',
    });

    store.getState().deleteObject(MANNEQUIN_ID);

    expect(store.getState().document.subjectMotionGuide).toBeUndefined();
    expect(store.getState().document.cameraMotionGuide).toEqual({
      motionType: 'dolly',
      direction: { x: 0, y: 0, z: -1 },
      strength: 0.7,
      label: '돌리 인',
    });
  });

  it('scene notes are capped at 2000 characters at the state boundary', () => {
    const store = createMotionStore();

    store.getState().setSceneNotes('n'.repeat(2001));

    expect(store.getState().document.sceneNotes).toHaveLength(2000);
  });
});
