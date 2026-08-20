import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSceneObject,
  createStarterSceneDocument,
} from '../persistence/sceneSchema';
import {
  MANNEQUIN_ARM_ANCHORS,
  createMannequinPose,
  solveMannequinArmIk,
} from '../mannequin/mannequinRig';
import { CAMERA_SHOT_PRESETS } from '../presets/cameras';
import { LIGHTING_PRESETS } from '../presets/lighting';
import { getSceneObjectBounds } from '../scene/sceneObjectModel';
import {
  createEditorStore,
  DOCUMENT_MUTATION_KINDS,
  type EditorStore,
} from './editorStore';
import { HISTORY_LIMIT } from './history';

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
    expect(state.layoutGuide).toEqual({
      objectUrl: null,
      fileName: null,
      opacity: 0.35,
    });
    expect(state.isDirty).toBe(false);
    expect(state.activePanel).toBe('scene');
    expect(state.navigation).toEqual({
      position: { x: 0, y: 1.6, z: -5 },
      target: { x: 0, y: 1.6, z: 0 },
      isInteracting: false,
    });
    expect(state.inProgressTransform).toBeNull();
    expect(state.statusMessage).toBeNull();
    expect(state.exportState).toEqual({
      status: 'idle',
      progress: 0,
      error: null,
    });
  });

  it('레이아웃 가이드 이미지와 불투명도를 문서와 분리해 보관한다', () => {
    const file = new File(['guide'], 'dressing-room.png', {
      type: 'image/png',
    });
    store.getState().setLayoutGuideFile(file);
    expect(store.getState().layoutGuide.fileName).toBe('dressing-room.png');
    expect(store.getState().layoutGuide.objectUrl).toMatch(/^blob:/);
    expect(store.getState().document).toBe(store.getState().document);
    store.getState().setLayoutGuideOpacity(0.2);
    expect(store.getState().layoutGuide.opacity).toBe(0.2);
    store.getState().setLayoutGuideFile(null);
    expect(store.getState().layoutGuide.objectUrl).toBeNull();
    expect(store.getState().isDirty).toBe(false);
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
    store.getState().setObjectSemantic('missing-object', {
      meaning: 'Missing',
      generationNotes: '',
    });
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

  it('rename, semantic, color, visibility object 속성을 committed document에 반영한다', () => {
    store.getState().renameObject(STARTER_IDS.mannequinId, 'Actor');
    store.getState().setObjectSemantic(STARTER_IDS.mannequinId, {
      meaning: '화면 왼쪽의 정민',
      generationNotes: '포즈는 3D 레이아웃을 유지한다.',
    });
    store.getState().setObjectColor(STARTER_IDS.mannequinId, '#123456');
    store.getState().setObjectVisibility(STARTER_IDS.mannequinId, false);

    const mannequin = store
      .getState()
      .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId);

    expect(mannequin).toMatchObject({
      name: 'Actor',
      semantic: {
        meaning: '화면 왼쪽의 정민',
        generationNotes: '포즈는 3D 레이아웃을 유지한다.',
      },
      color: '#123456',
      visible: false,
    });
    expect(store.getState().isDirty).toBe(true);
  });

  it('viewport selection lock을 별도 document mutation으로 기록하고 undo/redo한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);

    store
      .getState()
      .setObjectViewportSelectionLocked(STARTER_IDS.mannequinId, true);

    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.viewportSelectionLocked,
    ).toBe(true);
    expect(store.getState().selectedObjectId).toBe(STARTER_IDS.mannequinId);
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'update-object-selection-lock',
    );

    store.getState().undo();
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.viewportSelectionLocked,
    ).toBe(false);

    store.getState().redo();
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.viewportSelectionLocked,
    ).toBe(true);
  });

  it('오브젝트 삭제 시 group과 spatial relation의 dangling reference를 원자 정리한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    const container = createSceneObject('container', { kind: 'cube' });
    const contained = createSceneObject('contained', { kind: 'sphere' });
    const mirror = createSceneObject('mirror', { kind: 'plane' });
    mirror.appearanceIntent.surfaceType = 'mirror';
    document.objects.push(container, contained, mirror);
    document.groups = [
      {
        id: 'group-props',
        name: 'Props',
        memberObjectIds: [container.id, contained.id, mirror.id],
      },
    ];
    document.spatialRelations = [
      {
        id: 'contains-contained',
        type: 'contains',
        containerObjectId: container.id,
        containedObjectId: contained.id,
        visibility: 'occluded',
      },
      {
        id: 'reflects-contained',
        type: 'reflects',
        mirrorObjectId: mirror.id,
        reflectedObjectIds: [container.id, contained.id],
      },
    ];
    store = createEditorStore({
      initialDocument: document,
      idFactory: () => 'unused',
    });

    store.getState().deleteObject(contained.id);

    expect(store.getState().document.groups[0]?.memberObjectIds).toEqual([
      container.id,
      mirror.id,
    ]);
    expect(store.getState().document.spatialRelations).toEqual([
      {
        id: 'reflects-contained',
        type: 'reflects',
        mirrorObjectId: mirror.id,
        reflectedObjectIds: [container.id],
      },
    ]);
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'delete-object',
    );
  });

  it('다중 선택을 그룹화하고 모든 멤버를 같은 delta로 원자 이동·undo/redo한다', () => {
    store = makeStore(['cube-grouped', 'sphere-grouped', 'group-props']);
    const cubeId = store.getState().addObject({ kind: 'cube' });
    const sphereId = store.getState().addObject({ kind: 'sphere' });
    store.getState().selectObject(cubeId);
    store.getState().toggleObjectSelection(sphereId);
    expect(store.getState()).toMatchObject({
      selectedObjectId: null,
      selectedObjectIds: [cubeId, sphereId],
      selectedGroupId: null,
    });

    const groupId = store
      .getState()
      .createObjectGroup(store.getState().selectedObjectIds, 'Props');
    expect(groupId).toBe('group-props');
    expect(store.getState().document.groups).toEqual([
      {
        id: 'group-props',
        name: 'Props',
        memberObjectIds: [cubeId, sphereId],
      },
    ]);
    expect(store.getState()).toMatchObject({
      selectedObjectId: null,
      selectedObjectIds: [cubeId, sphereId],
      selectedGroupId: 'group-props',
    });

    const before = Object.fromEntries(
      store
        .getState()
        .document.objects.filter(({ id }) => id === cubeId || id === sphereId)
        .map(({ id, transform }) => [id, structuredClone(transform.position)]),
    );
    store
      .getState()
      .translateObjectGroup('group-props', { x: 1.5, y: -0.25, z: 2 });
    for (const objectId of [cubeId, sphereId]) {
      const position = store
        .getState()
        .document.objects.find(({ id }) => id === objectId)!.transform.position;
      expect(position).toEqual({
        x: before[objectId]!.x + 1.5,
        y: before[objectId]!.y - 0.25,
        z: before[objectId]!.z + 2,
      });
    }
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'translate-object-group',
    );

    store.getState().undo();
    for (const objectId of [cubeId, sphereId]) {
      expect(
        store.getState().document.objects.find(({ id }) => id === objectId)
          ?.transform.position,
      ).toEqual(before[objectId]);
    }
    expect(store.getState().selectedGroupId).toBe('group-props');

    store.getState().redo();
    expect(store.getState().selectedGroupId).toBe('group-props');
    store.getState().ungroupObjects('group-props');
    expect(store.getState().document.groups).toEqual([]);
    expect(store.getState().selectedGroupId).toBeNull();
    expect(store.getState().selectedObjectIds).toEqual([cubeId, sphereId]);
  });

  it('floor, 이미 그룹화된 멤버와 1개 선택은 새 그룹으로 만들지 않는다', () => {
    store = makeStore(['cube-for-group', 'unused-group-id']);
    const cubeId = store.getState().addObject({ kind: 'cube' });

    expect(store.getState().createObjectGroup([cubeId])).toBeNull();
    expect(
      store
        .getState()
        .createObjectGroup([STARTER_IDS.floorId, cubeId], 'Invalid'),
    ).toBeNull();
    expect(store.getState().document.groups).toEqual([]);
  });

  it('proxy opacity와 최종 표면 의도를 서로 다른 document mutation으로 저장한다', () => {
    store.getState().setObjectProxyOpacity(STARTER_IDS.mannequinId, 0.35);
    store.getState().setObjectAppearanceIntent(STARTER_IDS.mannequinId, {
      surfaceType: 'transparent',
      materialNotes: '맑은 아크릴 외피',
    });

    const mannequin = store
      .getState()
      .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId);
    expect(mannequin).toMatchObject({
      visualization: { proxyOpacity: 0.35 },
      appearanceIntent: {
        surfaceType: 'transparent',
        materialNotes: '맑은 아크릴 외피',
      },
    });
    expect(store.getState().history.past.at(-2)?.mutationKind).toBe(
      'update-object-visualization',
    );
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'update-object-appearance',
    );
  });

  it('plane mirror의 반사 대상을 단일 typed relation으로 갱신·정리한다', () => {
    store = makeStore([
      'mirror-plane',
      'reflected-cube',
      'reflects-relation',
      'reflects-relation-2',
    ]);
    const mirrorId = store.getState().addObject({ kind: 'plane' });
    const cubeId = store.getState().addObject({ kind: 'cube' });

    store.getState().setObjectAppearanceIntent(mirrorId, {
      surfaceType: 'mirror',
      materialNotes: '은색 평면 거울',
    });
    expect(
      store.getState().setMirrorReflectionTargets(mirrorId, [cubeId]),
    ).toBe(true);
    expect(store.getState().document.spatialRelations).toEqual([
      {
        id: 'reflects-relation',
        type: 'reflects',
        mirrorObjectId: mirrorId,
        reflectedObjectIds: [cubeId],
      },
    ]);
    store.getState().undo();
    expect(store.getState().document.spatialRelations).toEqual([]);
    store.getState().redo();
    expect(store.getState().document.spatialRelations).toEqual([
      expect.objectContaining({ id: 'reflects-relation' }),
    ]);

    expect(
      store
        .getState()
        .setMirrorReflectionTargets(mirrorId, [
          cubeId,
          STARTER_IDS.mannequinId,
        ]),
    ).toBe(true);
    expect(store.getState().document.spatialRelations).toEqual([
      expect.objectContaining({
        id: 'reflects-relation',
        reflectedObjectIds: [cubeId, STARTER_IDS.mannequinId],
      }),
    ]);
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'update-mirror-reflection',
    );

    expect(store.getState().setMirrorReflectionTargets(mirrorId, [])).toBe(
      true,
    );
    expect(store.getState().document.spatialRelations).toEqual([]);

    store.getState().setMirrorReflectionTargets(mirrorId, [cubeId]);
    store.getState().setObjectAppearanceIntent(mirrorId, {
      surfaceType: 'opaque',
      materialNotes: '',
    });
    expect(store.getState().document.spatialRelations).toEqual([]);
    store.getState().undo();
    expect(
      store.getState().document.objects.find(({ id }) => id === mirrorId)
        ?.appearanceIntent.surfaceType,
    ).toBe('mirror');
    expect(store.getState().document.spatialRelations).toEqual([
      expect.objectContaining({ id: 'reflects-relation-2' }),
    ]);
    store.getState().redo();
    expect(store.getState().document.spatialRelations).toEqual([]);

    store.getState().setObjectAppearanceIntent(cubeId, {
      surfaceType: 'mirror',
      materialNotes: 'invalid',
    });
    expect(
      store.getState().document.objects.find(({ id }) => id === cubeId)
        ?.appearanceIntent.surfaceType,
    ).toBe('opaque');
    expect(
      store
        .getState()
        .setMirrorReflectionTargets(cubeId, [STARTER_IDS.mannequinId]),
    ).toBe(false);
  });

  it('typed containment를 추가·삭제하고 중복과 cycle을 fail-closed한다', () => {
    store = makeStore(['relation-1', 'relation-duplicate', 'relation-cycle']);

    const relationId = store
      .getState()
      .addContainmentRelation(
        STARTER_IDS.floorId,
        STARTER_IDS.mannequinId,
        'cutaway',
      );
    expect(relationId).toBe('relation-1');
    expect(store.getState().document.spatialRelations).toEqual([
      {
        id: 'relation-1',
        type: 'contains',
        containerObjectId: STARTER_IDS.floorId,
        containedObjectId: STARTER_IDS.mannequinId,
        visibility: 'cutaway',
      },
    ]);
    expect(
      store
        .getState()
        .addContainmentRelation(
          STARTER_IDS.floorId,
          STARTER_IDS.mannequinId,
          'occluded',
        ),
    ).toBeNull();
    expect(
      store
        .getState()
        .addContainmentRelation(
          STARTER_IDS.mannequinId,
          STARTER_IDS.floorId,
          'occluded',
        ),
    ).toBeNull();
    expect(store.getState().document.spatialRelations).toHaveLength(1);

    store.getState().removeSpatialRelation('relation-1');
    expect(store.getState().document.spatialRelations).toEqual([]);
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'delete-spatial-relation',
    );
  });

  it('검증된 spec patch와 object transform command를 단일 원자 mutation으로 적용하고 stale/double apply를 거부하며 undo/redo한다', () => {
    const original = structuredClone(
      store.getState().document.semanticSceneSpec,
    );
    const proposal = {
      version: 2 as const,
      requestId: 'proposal-store-1',
      baseSceneRevision: 0,
      baseSpecRevision: 0,
      message: '장소를 골목 치킨집으로 변경합니다.',
      specPatch: [
        {
          op: 'replace' as const,
          path: '/intent/location' as const,
          value: '골목 치킨집',
        },
      ],
      sceneCommands: [
        {
          type: 'setObjectTransform' as const,
          objectId: STARTER_IDS.mannequinId,
          transform: {
            position: { x: 1.25, y: 0.85, z: 0 },
            rotationDeg: { x: 0, y: 20, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
      warnings: [],
    };

    const evaluation = store.getState().applySpecPatchProposal(proposal);

    expect(evaluation.changes).toEqual([
      { path: '/intent/location', before: '', after: '골목 치킨집' },
    ]);
    expect(evaluation.sceneCommandChanges).toHaveLength(1);
    expect(store.getState().document).toMatchObject({
      sceneRevision: 1,
      specRevision: 1,
      semanticSceneSpec: { intent: { location: '골목 치킨집' } },
      objects: [
        { id: STARTER_IDS.floorId },
        {
          id: STARTER_IDS.mannequinId,
          transform: proposal.sceneCommands[0].transform,
        },
      ],
    });
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'apply-scene-change-proposal',
    );
    const applied = store.getState().document;
    expect(() => store.getState().applySpecPatchProposal(proposal)).toThrow(
      /stale/i,
    );
    expect(store.getState().document).toBe(applied);

    store.getState().undo();
    expect(store.getState().document.semanticSceneSpec).toEqual(original);
    expect(store.getState().document).toMatchObject({
      sceneRevision: 2,
      specRevision: 2,
    });
    store.getState().redo();
    expect(store.getState().document).toMatchObject({
      sceneRevision: 3,
      specRevision: 3,
      semanticSceneSpec: { intent: { location: '골목 치킨집' } },
      objects: [
        { id: STARTER_IDS.floorId },
        {
          id: STARTER_IDS.mannequinId,
          transform: proposal.sceneCommands[0].transform,
        },
      ],
    });
  });

  it('proposal 표시 뒤 live scene이 바뀌면 apply race를 fail-closed한다', () => {
    const proposal = {
      version: 2 as const,
      requestId: 'proposal-race',
      baseSceneRevision: 0,
      baseSpecRevision: 0,
      message: '분위기를 변경합니다.',
      specPatch: [
        {
          op: 'replace' as const,
          path: '/intent/mood' as const,
          value: '긴장감',
        },
      ],
      sceneCommands: [],
      warnings: [],
    };
    store.getState().renameObject(STARTER_IDS.mannequinId, 'Actor');
    const changed = store.getState().document;

    expect(() => store.getState().applySpecPatchProposal(proposal)).toThrow(
      /stale/i,
    );
    expect(store.getState().document).toBe(changed);
    expect(store.getState().document.semanticSceneSpec.intent.mood).toBe('');
  });

  it('transform-only proposal은 scene revision만 올리고 no-op transaction은 거부한다', () => {
    const originalTransform = structuredClone(
      store.getState().document.objects[1].transform,
    );
    const proposal = {
      version: 2 as const,
      requestId: 'proposal-transform-only',
      baseSceneRevision: 0,
      baseSpecRevision: 0,
      message: '마네킹을 카메라 쪽으로 옮깁니다.',
      specPatch: [],
      sceneCommands: [
        {
          type: 'setObjectTransform' as const,
          objectId: STARTER_IDS.mannequinId,
          transform: {
            ...originalTransform,
            position: { ...originalTransform.position, z: -0.75 },
          },
        },
      ],
      warnings: [],
    };

    store.getState().applySpecPatchProposal(proposal);

    expect(store.getState().document).toMatchObject({
      sceneRevision: 1,
      specRevision: 0,
      objects: [
        { id: STARTER_IDS.floorId },
        {
          id: STARTER_IDS.mannequinId,
          transform: { position: { z: -0.75 } },
        },
      ],
    });

    const noOpStore = createEditorStore({
      initialDocument: createStarterSceneDocument(STARTER_IDS),
      idFactory: () => 'unused',
    });
    const before = noOpStore.getState();
    expect(() =>
      noOpStore.getState().applySpecPatchProposal({
        ...proposal,
        requestId: 'proposal-no-op',
        sceneCommands: [
          {
            ...proposal.sceneCommands[0],
            transform: originalTransform,
          },
        ],
      }),
    ).toThrow(/no effective changes/);
    expect(noOpStore.getState().document).toBe(before.document);
    expect(noOpStore.getState().history).toBe(before.history);
  });

  it('SemanticSceneSpec 편집을 단일 history/dirty mutation으로 기록하고 undo/redo한다', () => {
    const original = structuredClone(
      store.getState().document.semanticSceneSpec,
    );
    const next = {
      ...original,
      intent: {
        location: '한국 노포 야외 치킨집',
        timeOfDay: '해질녘',
        mood: '조용한 대화',
        visualStyle: '시네마틱 2D 애니메이션',
      },
      extras: {
        enabled: true,
        minCount: 5,
        maxCount: 8,
        placement: '오른쪽 배경 테이블',
        importance: '주인공보다 낮음',
      },
    };

    store.getState().setSemanticSceneSpec(next);

    expect(store.getState().document.semanticSceneSpec).toEqual(next);
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'update-semantic-scene-spec',
    );
    expect(store.getState().isDirty).toBe(true);

    store.getState().undo();
    expect(store.getState().document.semanticSceneSpec).toEqual(original);
    store.getState().redo();
    expect(store.getState().document.semanticSceneSpec).toEqual(next);
  });

  it('dangling 관계는 원자적으로 거부하고 object 삭제 시 해당 관계만 정리한다', () => {
    const original = store.getState().document;
    expect(() =>
      store.getState().setSemanticSceneSpec({
        ...original.semanticSceneSpec,
        relationships: [
          {
            subjectObjectId: STARTER_IDS.mannequinId,
            targetObjectId: 'missing',
            relationship: '바라봄',
            gaze: 'missing을 바라봄',
            action: '',
          },
        ],
      }),
    ).toThrow();
    expect(store.getState().document).toBe(original);

    store.getState().setSemanticSceneSpec({
      ...original.semanticSceneSpec,
      relationships: [
        {
          subjectObjectId: STARTER_IDS.mannequinId,
          targetObjectId: STARTER_IDS.floorId,
          relationship: '위에 서 있음',
          gaze: '',
          action: '서 있음',
        },
      ],
    });
    store.getState().deleteObject(STARTER_IDS.floorId);
    expect(store.getState().document.semanticSceneSpec.relationships).toEqual(
      [],
    );
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
    expect(duplicate?.mannequinPose).toEqual(original?.mannequinPose);
    expect(duplicate?.mannequinPose).not.toBe(original?.mannequinPose);
    expect(state.selectedObjectId).toBe(duplicateId);
  });

  it('마네킹 체형 preset을 한 번 commit하고 undo/redo로 보존한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    const originalPose = structuredClone(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.mannequinPose,
    );
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    store.getState().applyMannequinBodyTypePreset('athletic');
    expect(documentChanges).toBe(1);
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId),
    ).toMatchObject({
      mannequinBodyType: 'athletic',
      mannequinPose: originalPose,
      dimensions: { y: 1.8 },
      transform: { position: { y: 0.9 } },
    });

    documentChanges = 0;
    store.getState().applyMannequinBodyTypePreset('athletic');
    expect(documentChanges).toBe(0);
    store.getState().applyMannequinBodyTypePreset('heavy');
    expect(documentChanges).toBe(1);
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.dimensions.y,
    ).toBe(1.7);

    store.getState().undo();
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId),
    ).toMatchObject({
      mannequinBodyType: 'athletic',
      dimensions: { y: 1.8 },
      transform: { position: { y: 0.9 } },
    });
    store.getState().redo();
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId),
    ).toMatchObject({
      mannequinBodyType: 'heavy',
      dimensions: { y: 1.7 },
      transform: { position: { y: 0.85 } },
    });
    unsubscribe();
  });

  it('회전·비균일 scale에서도 체형 키 변경 전후의 바닥 위치를 보존한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    store.getState().beginTransform();
    store.getState().commitTransform({
      position: { x: 0.4, y: 1.7, z: -0.3 },
      rotationDeg: { x: 20, y: 10, z: 15 },
      scale: { x: 1.2, y: 2, z: 0.8 },
    });
    const selected = () => {
      const object = store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId);
      if (object === undefined) throw new Error('mannequin required');
      return object;
    };
    const originalFloorY = getSceneObjectBounds(selected()).min.y;

    for (const bodyType of ['athletic', 'heavy', 'athletic'] as const) {
      store.getState().applyMannequinBodyTypePreset(bodyType);
      expect(getSceneObjectBounds(selected()).min.y).toBeCloseTo(
        originalFloorY,
        10,
      );
    }
  });

  it('키가 잘못 저장된 동일 체형 preset도 바닥을 유지하며 목표 키로 교정한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    const mannequin = document.objects.find(
      ({ id }) => id === STARTER_IDS.mannequinId,
    );
    if (mannequin === undefined) throw new Error('mannequin required');
    mannequin.mannequinBodyType = 'athletic';
    mannequin.dimensions.y = 1.7;
    mannequin.transform.scale.y = 1.5;
    store = createEditorStore({
      initialDocument: document,
      idFactory: () => 'unused-id',
    });
    store.getState().selectObject(STARTER_IDS.mannequinId);
    const originalFloorY = getSceneObjectBounds(mannequin).min.y;

    store.getState().applyMannequinBodyTypePreset('athletic');
    const corrected = store
      .getState()
      .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId);
    if (corrected === undefined)
      throw new Error('corrected mannequin required');
    expect(corrected.dimensions.y).toBe(1.8);
    expect(getSceneObjectBounds(corrected).min.y).toBeCloseTo(
      originalFloorY,
      10,
    );
  });

  it('4개 mannequin pose preset을 한 번 commit하고 undo/redo로 보존한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    for (const presetId of ['default', 'a', 't', 'walk-ready'] as const) {
      documentChanges = 0;
      store.getState().applyMannequinPosePreset(presetId);
      const mannequin = store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId);
      expect(mannequin?.mannequinPose).toEqual(createMannequinPose(presetId));
      expect(documentChanges).toBe(presetId === 'default' ? 0 : 1);
    }

    store.getState().undo();
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.mannequinPose?.id,
    ).toBe('t');
    store.getState().redo();
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.mannequinPose?.id,
    ).toBe('walk-ready');
    unsubscribe();
  });

  it('hand IK pose는 drag 중 runtime-only이고 종료 시 document/history에 정확히 한 번 commit된다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    const documentBeforeDrag = store.getState().document;
    const customPose = createMannequinPose(
      'default',
    ) as (typeof documentBeforeDrag.objects)[number]['mannequinPose'];
    if (customPose === undefined) throw new Error('custom pose가 필요합니다.');
    customPose.id = 'custom';
    customPose.arms.left.elbowBendDeg = 72;
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    store.getState().beginMannequinPose();
    expect(store.getState().document).toBe(documentBeforeDrag);
    expect(store.getState().inProgressMannequinPose).toMatchObject({
      objectId: STARTER_IDS.mannequinId,
    });

    store.getState().commitMannequinPose(customPose);
    store.getState().commitMannequinPose(customPose);

    expect(documentChanges).toBe(1);
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'commit-mannequin-pose',
    );
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.mannequinPose,
    ).toEqual(customPose);
    expect(store.getState().inProgressMannequinPose).toBeNull();
    unsubscribe();
  });

  it('minimum-reach hand IK pose를 schema 오류 없이 정확히 한 번 commit한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    const nearReachPose = solveMannequinArmIk(
      createMannequinPose('default'),
      'left',
      MANNEQUIN_ARM_ANCHORS.left.shoulder,
    );
    const historyBefore = store.getState().history.past.length;

    store.getState().beginMannequinPose();
    expect(() =>
      store.getState().commitMannequinPose(nearReachPose),
    ).not.toThrow();

    expect(store.getState().history.past).toHaveLength(historyBefore + 1);
    expect(store.getState().inProgressMannequinPose).toBeNull();
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.mannequinPose?.arms.left.elbowBendDeg,
    ).toBe(145);
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
      depthOfField: {
        enabled: true,
        apertureMode: 'auto',
        fStop: 4,
      },
    });
    store.getState().setSubjectMotionGuide({
      subjectId: STARTER_IDS.mannequinId,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
      label: '오른쪽',
    });

    store.getState().resetScene();

    expect(store.getState().document).toEqual({
      ...createStarterSceneDocument(STARTER_IDS),
      sceneRevision: 4,
      specRevision: 0,
    });
    expect(store.getState()).toMatchObject({
      selectedObjectId: null,
      hoveredObjectId: null,
      inProgressTransform: null,
      isDirty: false,
      navigation: {
        position: { x: 0, y: 1.6, z: -5 },
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
      'update-object-selection-lock',
      'create-object-group',
      'delete-object-group',
      'translate-object-group',
      'update-object-visualization',
      'update-object-appearance',
      'create-spatial-relation',
      'delete-spatial-relation',
      'update-mirror-reflection',
      'commit-camera',
      'update-lighting-background',
      'update-output',
      'update-motion-metadata',
      'update-semantic-scene-spec',
      'apply-scene-change-proposal',
      'commit-mannequin-pose',
      'update-mannequin-appearance',
      'apply-generation-snapshot',
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
    store.getState().selectObject(STARTER_IDS.mannequinId);
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

  it('lens preset은 auto에서 focal/f-stop을 한 commit으로 바꾸고 manual f-stop은 보존한다', () => {
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    store.getState().setCameraLens(35);

    expect(store.getState().document.outputCamera).toMatchObject({
      focalLengthMm: 35,
      depthOfField: { apertureMode: 'auto', fStop: 4 },
    });
    expect(store.getState().navigation).toMatchObject({
      position: store.getState().document.outputCamera.position,
      target: store.getState().document.outputCamera.target,
      isInteracting: false,
    });
    expect(documentChanges).toBe(1);

    store.getState().setCameraApertureMode('manual');
    store.getState().setCameraFStop(1.8);
    const beforeManualLens = documentChanges;
    store.getState().setCameraLens(85);
    expect(store.getState().document.outputCamera).toMatchObject({
      focalLengthMm: 85,
      depthOfField: { apertureMode: 'manual', fStop: 1.8 },
    });
    expect(documentChanges).toBe(beforeManualLens + 1);
    unsubscribe();
  });

  it('DOF toggle/mode/manual f-stop을 검증된 camera history로 undo/redo한다', () => {
    store.getState().setCameraDepthOfFieldEnabled(false);
    store.getState().setCameraApertureMode('manual');
    store.getState().setCameraFStop(11);
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'commit-camera',
    );
    expect(store.getState().document.outputCamera.depthOfField).toEqual({
      enabled: false,
      apertureMode: 'manual',
      fStop: 11,
    });
    store.getState().undo();
    expect(store.getState().document.outputCamera.depthOfField.fStop).toBe(2.8);
    store.getState().redo();
    expect(store.getState().document.outputCamera.depthOfField.fStop).toBe(11);
  });

  it('전역 마네킹 초점 등고선을 한 번 commit하고 no-op/undo/redo로 보존한다', () => {
    const cameraBefore = structuredClone(
      store.getState().document.outputCamera,
    );
    const objectsBefore = structuredClone(store.getState().document.objects);
    const historyBefore = store.getState().history.past.length;

    store.getState().setMannequinFocusContoursEnabled(true);

    expect(store.getState().document.mannequinAppearance).toEqual({
      focusContoursEnabled: true,
    });
    expect(store.getState().document.outputCamera).toEqual(cameraBefore);
    expect(store.getState().document.objects).toEqual(objectsBefore);
    expect(store.getState().history.past).toHaveLength(historyBefore + 1);
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'update-mannequin-appearance',
    );
    expect(store.getState().statusMessage).toBe(
      '모든 마네킹의 초점 확인 등고선을 표시합니다.',
    );

    const documentAfterEnable = store.getState().document;
    const historyAfterEnable = store.getState().history;
    store.getState().setMannequinFocusContoursEnabled(true);
    expect(store.getState().document).toBe(documentAfterEnable);
    expect(store.getState().history).toBe(historyAfterEnable);

    store.getState().undo();
    expect(
      store.getState().document.mannequinAppearance.focusContoursEnabled,
    ).toBe(false);
    store.getState().redo();
    expect(
      store.getState().document.mannequinAppearance.focusContoursEnabled,
    ).toBe(true);
  });

  it('lighting preset과 reset을 한 번씩 commit하고 camera와 objects를 보존한다', () => {
    const camera = structuredClone(store.getState().document.outputCamera);
    const objects = structuredClone(store.getState().document.objects);
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    store.getState().applyLightingPreset('sunset');
    expect(documentChanges).toBe(1);
    expect(store.getState().document).toMatchObject({
      lighting: LIGHTING_PRESETS[2].value,
      background: { color: LIGHTING_PRESETS[2].backgroundColor },
      outputCamera: camera,
      objects,
    });

    store.getState().setLighting({
      ...store.getState().document.lighting,
      exposure: 1.7,
      key: {
        ...store.getState().document.lighting.key,
        direction: { x: 0.2, y: 1.5, z: -0.4 },
      },
      shadows: {
        ...store.getState().document.lighting.shadows,
        enabled: false,
      },
    });
    store.getState().setBackgroundColor('#010203');
    const beforeResetChanges = documentChanges;

    store.getState().resetLightingPreset();

    expect(documentChanges).toBe(beforeResetChanges + 1);
    expect(store.getState().document).toMatchObject({
      lighting: LIGHTING_PRESETS[2].value,
      background: { color: LIGHTING_PRESETS[2].backgroundColor },
      outputCamera: camera,
      objects,
    });
    unsubscribe();
  });

  it('selection, transform mode, aspect 변경은 이전 camera status를 지운다', () => {
    store.getState().setCameraLens(35);
    expect(store.getState().statusMessage).toBe('35mm 렌즈를 적용했습니다.');

    store.getState().selectObject(STARTER_IDS.mannequinId);
    expect(store.getState().statusMessage).toBeNull();
    store.getState().setCameraLens(50);
    store.getState().setTransformMode('rotate');
    expect(store.getState().statusMessage).toBeNull();
    store.getState().setCameraLens(85);
    store.getState().setOutput({
      ...store.getState().document.output,
      aspectRatioId: '9:16',
      width: 1080,
      height: 1920,
    });
    expect(store.getState().statusMessage).toBeNull();
  });

  it('6개 shot preset을 selected bounds에서 explicit camera commit한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);

    for (const preset of CAMERA_SHOT_PRESETS) {
      store.getState().applyCameraShot(preset.id);
      const camera = store.getState().document.outputCamera;
      expect(camera.target.x).toBe(0);
      expect(camera.target.z).toBe(-0.047);
      expect(Number.isFinite(camera.position.z)).toBe(true);
      expect(camera.rollDeg).toBe(preset.framing.rollDeg);
    }
  });

  it('frame/target selected는 bounds를 사용하고 selection이 없으면 camera/history를 보존한다', () => {
    const initialCamera = store.getState().document.outputCamera;

    store.getState().frameSelected();
    expect(store.getState().document.outputCamera).toBe(initialCamera);
    expect(store.getState().statusMessage).toBe(
      '프레임에 맞출 오브젝트를 먼저 선택하세요.',
    );

    const historyBeforeNoSelection = store.getState().history;
    store.getState().targetSelected();
    expect(store.getState().document.outputCamera).toBe(initialCamera);
    expect(store.getState().statusMessage).toBe(
      '카메라 타겟·초점으로 설정할 오브젝트를 먼저 선택하세요.',
    );
    expect(store.getState().history).toBe(historyBeforeNoSelection);

    store.getState().selectObject(STARTER_IDS.mannequinId);
    store.getState().frameSelected();
    expect(store.getState().document.outputCamera.target).toEqual({
      x: 0,
      y: 0.85,
      z: -0.047,
    });
    expect(store.getState().statusMessage).toBe(
      'Mannequin을 프레임에 맞췄습니다.',
    );

    store.getState().commitCamera({
      ...store.getState().document.outputCamera,
      position: { x: 4, y: 3, z: 6 },
      target: { x: 1, y: 1, z: 1 },
    });
    const beforeTarget = structuredClone(
      store.getState().document.outputCamera,
    );
    const pastCount = store.getState().history.past.length;
    store.getState().targetSelected();
    expect(store.getState().document.outputCamera).toMatchObject({
      position: { x: 4, y: 3, z: 6 },
      target: { x: 0, y: 0.85, z: -0.047 },
      focalLengthMm: beforeTarget.focalLengthMm,
      rollDeg: beforeTarget.rollDeg,
      depthOfField: beforeTarget.depthOfField,
    });
    expect(store.getState().history.past).toHaveLength(pastCount + 1);
    expect(store.getState().statusMessage).toBe(
      'Mannequin을 카메라 타겟·초점으로 설정했습니다.',
    );
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
    store.getState().setStatusMessage('테스트 상태');

    expect(store.getState()).toMatchObject({
      document: originalDocument,
      transformMode: 'rotate',
      guideVisibility: { thirds: true, actionSafe: true },
      activePanel: 'camera',
      navigation: { isInteracting: true },
      exportState: { status: 'exporting', progress: 0.5 },
      statusMessage: '테스트 상태',
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

  it('allowlisted document mutation만 undo/redo하고 transient state는 history에서 제외한다', () => {
    const originalDocument = structuredClone(store.getState().document);

    store.getState().selectObject(STARTER_IDS.mannequinId);
    store.getState().setHoveredObject(STARTER_IDS.floorId);
    store.getState().setActivePanel('camera');
    store.getState().setNavigation({
      position: { x: 3, y: 2, z: 7 },
      target: { x: 0, y: 1, z: 0 },
      isInteracting: true,
    });
    store.getState().setExportState({
      status: 'exporting',
      progress: 0.5,
      error: null,
    });

    expect(store.getState().history.past).toHaveLength(0);

    store.getState().renameObject(STARTER_IDS.mannequinId, 'Actor');
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().canRedo).toBe(false);

    store.getState().undo();
    expect(store.getState().document).toEqual({
      ...originalDocument,
      sceneRevision: 2,
      specRevision: 0,
    });
    expect(store.getState().selectedObjectId).toBe(STARTER_IDS.mannequinId);
    expect(store.getState().activePanel).toBe('camera');
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);

    store.getState().redo();
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.name,
    ).toBe('Actor');
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().canRedo).toBe(false);
  });

  it('undo가 제거한 object를 가리키는 transient selection과 hover만 정리한다', () => {
    store = makeStore(['history-cube']);
    store.getState().addObject({ kind: 'cube' });
    store.getState().setHoveredObject('history-cube');

    store.getState().undo();

    expect(store.getState().document.objects).toHaveLength(2);
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().hoveredObjectId).toBeNull();
    expect(store.getState().canRedo).toBe(true);
  });

  it('camera history undo/redo만 document camera와 runtime navigation을 함께 동기화한다', () => {
    const originalCamera = structuredClone(
      store.getState().document.outputCamera,
    );
    const committedCamera = {
      ...originalCamera,
      position: { x: 4, y: 3, z: 7 },
      target: { x: 1, y: 1, z: 0 },
    };
    store.getState().commitCamera(committedCamera);
    store.getState().setNavigation({
      position: { x: 99, y: 99, z: 99 },
      target: { x: 9, y: 9, z: 9 },
      isInteracting: true,
    });

    store.getState().undo();
    expect(store.getState().document.outputCamera).toEqual(originalCamera);
    expect(store.getState().navigation).toEqual({
      position: originalCamera.position,
      target: originalCamera.target,
      isInteracting: false,
    });

    store.getState().redo();
    expect(store.getState().document.outputCamera).toEqual(committedCamera);
    expect(store.getState().navigation).toEqual({
      position: committedCamera.position,
      target: committedCamera.target,
      isInteracting: false,
    });

    store.getState().setNavigation({
      position: { x: 8, y: 7, z: 6 },
      target: { x: 0, y: 1, z: 0 },
      isInteracting: true,
    });
    const transientNavigation = structuredClone(store.getState().navigation);
    store.getState().renameObject(STARTER_IDS.mannequinId, 'Actor');
    store.getState().undo();
    expect(store.getState().navigation).toEqual(transientNavigation);
  });

  it('persisted document로 되돌아오면 dirty를 해제하고 no-op mutation은 history에 넣지 않는다', () => {
    const persisted = store.getState().document;
    store.getState().markDocumentPersisted(persisted);

    store.getState().renameObject(STARTER_IDS.mannequinId, 'Mannequin');
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().isDirty).toBe(false);

    store.getState().renameObject(STARTER_IDS.mannequinId, 'Actor');
    expect(store.getState().isDirty).toBe(true);
    store.getState().undo();

    expect(store.getState().document).toEqual({
      ...persisted,
      sceneRevision: 2,
      specRevision: 0,
    });
    expect(store.getState().isDirty).toBe(false);
  });

  it('연속 gizmo drag의 begin/commit 경계를 history 한 entry로 기록한다', () => {
    store.getState().selectObject(STARTER_IDS.mannequinId);
    const originalTransform = structuredClone(
      store.getState().document.objects[1].transform,
    );
    const finalTransform = {
      position: { x: 2, y: 0.85, z: -1 },
      rotationDeg: { x: 0, y: 35, z: 0 },
      scale: { x: 1.2, y: 1.2, z: 1.2 },
    };

    store.getState().beginTransform();
    store.getState().commitTransform(finalTransform);
    store.getState().commitTransform(finalTransform);

    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().document.objects[1].transform).toEqual(
      originalTransform,
    );
    store.getState().redo();
    expect(store.getState().document.objects[1].transform).toEqual(
      finalTransform,
    );
  });

  it('S02 document mutation allowlist의 모든 mutation family를 history에 기록한다', () => {
    store = makeStore(['object-cube', 'object-cube-copy']);
    const starter = structuredClone(store.getState().document);

    const cubeId = store.getState().addObject({ kind: 'cube' });
    const copyId = store.getState().duplicateObject(cubeId);
    store.getState().renameObject(cubeId, 'Hero cube');
    if (copyId === null) throw new Error('복제 ID가 필요합니다.');
    store.getState().deleteObject(copyId);
    store.getState().selectObject(cubeId);
    store.getState().beginTransform();
    store.getState().commitTransform({
      ...store.getState().document.objects.at(-1)!.transform,
      position: { x: 2, y: 0.5, z: 0 },
    });
    store.getState().commitCamera({
      ...starter.outputCamera,
      focalLengthMm: 35,
    });
    store.getState().setLighting({
      ...starter.lighting,
      exposure: 1.2,
    });
    store.getState().setBackgroundColor('#112233');
    store.getState().setOutput({
      aspectRatioId: '9:16',
      width: 1080,
      height: 1920,
      mode: 'clean',
    });
    store.getState().setSubjectMotionGuide({
      subjectId: cubeId,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
      label: '오른쪽',
    });
    store.getState().setCameraMotionGuide({
      motionType: 'dolly',
      direction: { x: 0, y: 0, z: -1 },
      strength: 0.5,
      label: '돌리 인',
    });
    store.getState().setSceneNotes('history note');

    expect(
      store.getState().history.past.map(({ mutationKind }) => mutationKind),
    ).toEqual([
      'add-object',
      'duplicate-object',
      'update-object-property',
      'delete-object',
      'commit-transform',
      'commit-camera',
      'update-lighting-background',
      'update-lighting-background',
      'update-output',
      'update-motion-metadata',
      'update-motion-metadata',
      'update-motion-metadata',
    ]);
  });

  it('undo/redo history를 최근 50 entry로 제한한다', () => {
    for (let index = 1; index <= HISTORY_LIMIT + 5; index += 1) {
      store.getState().renameObject(STARTER_IDS.mannequinId, `Actor ${index}`);
    }

    expect(store.getState().history.past).toHaveLength(HISTORY_LIMIT);
    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      store.getState().undo();
    }
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.name,
    ).toBe('Actor 5');
    expect(store.getState().history.future).toHaveLength(HISTORY_LIMIT);

    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      store.getState().redo();
    }
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === STARTER_IDS.mannequinId)
        ?.name,
    ).toBe(`Actor ${HISTORY_LIMIT + 5}`);
  });

  it('generation snapshot 적용을 단일 history action으로 기록하고 undo가 직전 scene과 selection을 정확히 복원한다', () => {
    const previousDocument = structuredClone(store.getState().document);
    store.getState().selectObject(STARTER_IDS.mannequinId);
    const snapshot = createStarterSceneDocument({
      documentId: 'scene-generation',
      floorId: 'generation-floor',
      mannequinId: 'generation-mannequin',
    });
    snapshot.outputCamera.position = { x: 2, y: 2.4, z: -7 };

    store.getState().applyGenerationSnapshot(snapshot, {
      generationId: 'generation-source',
      versionNumber: 3,
    });

    expect(store.getState().document).toMatchObject({
      id: 'scene-generation',
      generationSource: {
        generationId: 'generation-source',
        versionNumber: 3,
      },
      outputCamera: { position: { x: 2, y: 2.4, z: -7 } },
    });
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().history.past.at(-1)?.mutationKind).toBe(
      'apply-generation-snapshot',
    );
    expect(store.getState().history.past).toHaveLength(1);

    store.getState().undo();

    expect(store.getState().document).toEqual({
      ...previousDocument,
      sceneRevision: 2,
      specRevision: 0,
    });
    expect(store.getState().selectedObjectId).toBe(STARTER_IDS.mannequinId);
    expect(store.getState().navigation).toMatchObject({
      position: previousDocument.outputCamera.position,
      target: previousDocument.outputCamera.target,
      isInteracting: false,
    });
  });

  it('validated scene replacement는 transient/history를 정리하고 정확한 persisted snapshot만 dirty를 해제한다', () => {
    store = makeStore(['object-cube']);
    store.getState().addObject({ kind: 'cube' });
    const imported = createStarterSceneDocument({
      documentId: 'scene-imported',
      floorId: 'floor-imported',
      mannequinId: 'mannequin-imported',
    });
    imported.outputCamera.position = { x: 3, y: 2, z: 8 };

    store.getState().replaceDocument(imported, false);
    const importedSnapshot = store.getState().document;

    expect(store.getState()).toMatchObject({
      document: {
        ...imported,
        sceneRevision: 2,
        specRevision: 0,
      },
      selectedObjectId: null,
      hoveredObjectId: null,
      inProgressTransform: null,
      history: { past: [], future: [] },
      canUndo: false,
      canRedo: false,
      isDirty: true,
      navigation: {
        position: { x: 3, y: 2, z: 8 },
        target: imported.outputCamera.target,
        isInteracting: false,
      },
    });

    store.getState().markDocumentPersisted(importedSnapshot);
    expect(store.getState().isDirty).toBe(false);

    store.getState().renameObject('mannequin-imported', 'Imported actor');
    store.getState().markDocumentPersisted(importedSnapshot);
    expect(store.getState().isDirty).toBe(true);

    store.getState().replaceDocument(imported, true);
    expect(store.getState().isDirty).toBe(false);
  });
});
