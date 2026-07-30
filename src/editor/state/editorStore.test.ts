import { beforeEach, describe, expect, it } from 'vitest';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import {
  createEditorStore,
  DOCUMENT_MUTATION_KINDS,
  type EditorStore,
} from './editorStore';

const STARTER_IDS = {
  documentId: 'scene-starter',
  floorId: 'object-floor',
  mannequinId: 'object-mannequin',
} as const;

const makeStore = (generatedIds: string[] = []) => {
  const ids = [...generatedIds];

  return createEditorStore({
    initialDocument: createStarterSceneDocument(STARTER_IDS),
    idFactory: () => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error('테스트 ID가 부족합니다.');
      }
      return id;
    },
  });
};

describe('editorStore', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it('serializable document와 transient editor 초기 상태를 분리한다', () => {
    const state: EditorStore = store.getState();

    expect(state.document.id).toBe(STARTER_IDS.documentId);
    expect(state.selectedObjectId).toBeNull();
    expect(state.hoveredObjectId).toBeNull();
    expect(state.transformMode).toBe('translate');
    expect(state.guideVisibility).toEqual({
      thirds: false,
      center: false,
      actionSafe: false,
      titleSafe: false,
      motion: false,
    });
    expect(state.isDirty).toBe(false);
    expect(state.activePanel).toBe('scene');
    expect(state.navigation).toEqual({
      position: { x: 0, y: 1.6, z: 5 },
      target: { x: 0, y: 1.6, z: 0 },
      isInteracting: false,
    });
    expect(state.inProgressTransform).toBeNull();
    expect(state.exportState).toEqual({
      status: 'idle',
      progress: 0,
      error: null,
    });
  });

  it('주입된 ID로 object를 추가하고 선택하며 dirty로 표시한다', () => {
    store = makeStore(['object-cube']);

    const addedId = store.getState().addObject({
      kind: 'cube',
      name: 'Cube',
    });
    const state = store.getState();

    expect(addedId).toBe('object-cube');
    expect(state.document.objects.at(-1)).toMatchObject({
      id: 'object-cube',
      kind: 'cube',
      name: 'Cube',
      dimensions: { x: 1, y: 1, z: 1 },
      color: '#8c8c8c',
      visible: true,
      exportable: true,
    });
    expect(state.selectedObjectId).toBe('object-cube');
    expect(state.isDirty).toBe(true);
  });

  it('실제 floor는 starter content로만 만들고 addObject asset에서 거부한다', () => {
    store = makeStore(['object-extra-floor']);
    const floorInput = {
      kind: 'floor',
    } as unknown as Parameters<EditorStore['addObject']>[0];

    expect(() => store.getState().addObject(floorInput)).toThrow(
      'Floor is starter scene content',
    );
    expect(store.getState().document.objects).toHaveLength(2);
  });

  it('selection과 hover는 document와 dirty를 변경하지 않는다', () => {
    const originalDocument = store.getState().document;

    store.getState().selectObject(STARTER_IDS.mannequinId);
    store.getState().setHoveredObject(STARTER_IDS.floorId);

    expect(store.getState()).toMatchObject({
      selectedObjectId: STARTER_IDS.mannequinId,
      hoveredObjectId: STARTER_IDS.floorId,
      document: originalDocument,
      isDirty: false,
    });

    store.getState().selectObject(null);
    store.getState().setHoveredObject(null);
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().hoveredObjectId).toBeNull();
  });

  it('존재하지 않는 object ID는 dangling transient state나 거짓 mutation을 만들지 않는다', () => {
    store = makeStore(['unused-id']);
    const originalDocument = store.getState().document;

    store.getState().selectObject('missing-object');
    store.getState().setHoveredObject('missing-object');
    store.getState().renameObject('missing-object', 'Missing');
    store.getState().setObjectColor('missing-object', '#123456');
    store.getState().setObjectVisibility('missing-object', false);
    store.getState().deleteObject('missing-object');
    const duplicateId = store.getState().duplicateObject('missing-object');

    expect(duplicateId).toBeNull();
    expect(store.getState()).toMatchObject({
      document: originalDocument,
      selectedObjectId: null,
      hoveredObjectId: null,
      isDirty: false,
    });
  });

  it('rename, color, visibility object 속성을 committed document에 반영한다', () => {
    store.getState().renameObject(STARTER_IDS.mannequinId, 'Actor');
    store.getState().setObjectColor(STARTER_IDS.mannequinId, '#123456');
    store.getState().setObjectVisibility(STARTER_IDS.mannequinId, false);

    const mannequin = store
      .getState()
      .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId);

    expect(mannequin).toMatchObject({
      name: 'Actor',
      color: '#123456',
      visible: false,
    });
    expect(store.getState().isDirty).toBe(true);
  });

  it('beginTransform은 문서를 쓰지 않고 commitTransform에서 한 번만 최종 transform을 확정한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    const originalDocument = store.getState().document;
    const finalTransform = {
      position: { x: 1, y: 0.85, z: -2 },
      rotationDeg: { x: 0, y: 45, z: 0 },
      scale: { x: 1.25, y: 1.25, z: 1.25 },
    };

    store.getState().beginTransform();

    expect(store.getState().document).toBe(originalDocument);
    expect(store.getState().isDirty).toBe(false);
    expect(store.getState().inProgressTransform).toMatchObject({
      objectId: STARTER_IDS.mannequinId,
      initialTransform: originalDocument.objects[1].transform,
    });

    store.getState().commitTransform(finalTransform);

    expect(store.getState().document.objects[1].transform).toEqual(
      finalTransform,
    );
    expect(store.getState().inProgressTransform).toBeNull();
    expect(store.getState().isDirty).toBe(true);
  });

  it('commitTransform은 양수가 아닌 scale을 거부하고 문서를 보존한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    store.getState().beginTransform();
    const documentBeforeCommit = store.getState().document;

    expect(() =>
      store.getState().commitTransform({
        position: { x: 0, y: 0.85, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 0, z: 1 },
      }),
    ).toThrow();
    expect(store.getState().document).toBe(documentBeforeCommit);
    expect(store.getState().inProgressTransform).not.toBeNull();
  });

  it('cancelTransform은 runtime drag를 document mutation 없이 끝낸다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    const documentBeforeDrag = store.getState().document;
    store.getState().beginTransform();

    store.getState().cancelTransform();

    expect(store.getState().document).toBe(documentBeforeDrag);
    expect(store.getState().inProgressTransform).toBeNull();
    expect(store.getState().isDirty).toBe(false);
  });

  it('한 transform drag는 document 변경을 정확히 한 번만 만든다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });
    const finalTransform = {
      position: { x: 1, y: 0.85, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };

    store.getState().beginTransform();
    store.getState().commitTransform(finalTransform);
    store.getState().commitTransform(finalTransform);

    expect(documentChanges).toBe(1);
    unsubscribe();
  });

  it('commitTransform은 NaN과 infinite transform을 거부한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    store.getState().beginTransform();
    const documentBeforeCommit = store.getState().document;

    expect(() =>
      store.getState().commitTransform({
        position: { x: Number.NaN, y: 0.85, z: 0 },
        rotationDeg: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }),
    ).toThrow();
    expect(store.getState().document).toBe(documentBeforeCommit);
    expect(store.getState().inProgressTransform).not.toBeNull();
  });

  it('object를 주입된 새 ID로 복제해 원본과 독립된 사본을 선택한다', () => {
    store = makeStore(['object-mannequin-copy']);

    const duplicateId = store
      .getState()
      .duplicateObject(STARTER_IDS.mannequinId);
    const state = store.getState();
    const original = state.document.objects.find(
      ({ id }) => id === STARTER_IDS.mannequinId,
    );
    const duplicate = state.document.objects.find(
      ({ id }) => id === duplicateId,
    );

    expect(duplicateId).toBe('object-mannequin-copy');
    expect(duplicate).toMatchObject({
      kind: 'mannequin',
      name: 'Mannequin copy',
      transform: {
        position: { x: 0.5, y: 0.85, z: 0 },
      },
    });
    expect(duplicate?.id).not.toBe(original?.id);
    expect(duplicate?.transform).not.toBe(original?.transform);
    expect(state.selectedObjectId).toBe(duplicateId);
  });

  it('삭제한 object의 selection, hover, in-progress transform을 정리한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    store.getState().setHoveredObject(STARTER_IDS.mannequinId);
    store.getState().beginTransform();
    store.getState().setSubjectMotionGuide({
      subjectId: STARTER_IDS.mannequinId,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
      label: '오른쪽',
    });

    store.getState().deleteObject(STARTER_IDS.mannequinId);

    expect(
      store
        .getState()
        .document.objects.some(({ id }) => id === STARTER_IDS.mannequinId),
    ).toBe(false);
    expect(store.getState()).toMatchObject({
      selectedObjectId: null,
      hoveredObjectId: null,
      inProgressTransform: null,
      isDirty: true,
    });
    expect(store.getState().document.subjectMotionGuide).toBeUndefined();
  });

  it('resetScene은 초기 starter 문서를 복원하고 transient object 상태를 정리한다', () => {
    store = makeStore(['object-cube']);
    store.getState().addObject({ kind: 'cube' });
    store.getState().setHoveredObject('object-cube');
    store.getState().commitCamera({
      position: { x: 3, y: 2, z: 7 },
      target: { x: 1, y: 1, z: 0 },
      focalLengthMm: 35,
      rollDeg: 0,
    });
    store.getState().setSubjectMotionGuide({
      subjectId: STARTER_IDS.mannequinId,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
      label: '오른쪽',
    });

    store.getState().resetScene();

    expect(store.getState().document).toEqual(
      createStarterSceneDocument(STARTER_IDS),
    );
    expect(store.getState()).toMatchObject({
      selectedObjectId: null,
      hoveredObjectId: null,
      inProgressTransform: null,
      isDirty: true,
      navigation: {
        position: { x: 0, y: 1.6, z: 5 },
        target: { x: 0, y: 1.6, z: 0 },
        isInteracting: false,
      },
    });
  });

  it('S08 history가 사용할 document mutation allowlist를 고정한다', () => {
    expect(DOCUMENT_MUTATION_KINDS).toEqual([
      'add-object',
      'delete-object',
      'duplicate-object',
      'commit-transform',
      'update-object-property',
      'commit-camera',
      'update-lighting-background',
      'update-output',
      'update-motion-metadata',
    ]);
  });

  it('camera, lighting/background, output, motion metadata를 검증된 문서 mutation으로 확정한다', () => {
    const starter = createStarterSceneDocument(STARTER_IDS);
    const camera = {
      ...starter.outputCamera,
      position: { x: 2, y: 2, z: 6 },
      focalLengthMm: 35,
      rollDeg: 5,
    };
    const lighting = {
      ...starter.lighting,
      presetId: 'custom-lighting',
      exposure: 1.2,
    };
    const output = {
      aspectRatioId: '9:16' as const,
      width: 1080,
      height: 1920,
      mode: 'reference' as const,
    };

    store.getState().commitCamera(camera);
    store.getState().setLighting(lighting);
    store.getState().setBackgroundColor('#112233');
    store.getState().setOutput(output);
    store.getState().setSubjectMotionGuide({
      subjectId: STARTER_IDS.mannequinId,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.8,
      label: '오른쪽',
    });
    store.getState().setCameraMotionGuide({
      motionType: 'dolly',
      direction: { x: 0, y: 0, z: -1 },
      strength: 0.5,
      label: '돌리 인',
    });
    store.getState().setSceneNotes('피사체가 오른쪽으로 이동');

    expect(store.getState().document).toMatchObject({
      outputCamera: camera,
      lighting,
      background: { color: '#112233' },
      output,
      subjectMotionGuide: { subjectId: STARTER_IDS.mannequinId },
      cameraMotionGuide: { motionType: 'dolly' },
      sceneNotes: '피사체가 오른쪽으로 이동',
    });
    expect(store.getState().isDirty).toBe(true);
  });

  it('transient setter는 document와 dirty 상태를 변경하지 않는다', () => {
    const originalDocument = store.getState().document;

    store.getState().setTransformMode('rotate');
    store.getState().setGuideVisibility({ thirds: true, actionSafe: true });
    store.getState().setActivePanel('camera');
    store.getState().setNavigation({
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 1, z: 0 },
      isInteracting: true,
    });
    store.getState().setExportState({
      status: 'exporting',
      progress: 0.5,
      error: null,
    });

    expect(store.getState()).toMatchObject({
      document: originalDocument,
      transformMode: 'rotate',
      guideVisibility: { thirds: true, actionSafe: true },
      activePanel: 'camera',
      navigation: { isInteracting: true },
      exportState: { status: 'exporting', progress: 0.5 },
      isDirty: false,
    });
  });

  it('transient navigation과 export 입력을 호출자 mutation에서 격리한다', () => {
    const navigation = {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 1, z: 0 },
      isInteracting: true,
    };
    const exportState = {
      status: 'exporting' as const,
      progress: 0.25,
      error: null,
    };

    store.getState().setNavigation(navigation);
    store.getState().setExportState(exportState);
    navigation.position.x = 99;
    exportState.progress = 1;

    expect(store.getState().navigation.position.x).toBe(1);
    expect(store.getState().exportState.progress).toBe(0.25);
  });
});
