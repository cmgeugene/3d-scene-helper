import { describe, expect, it } from 'vitest';
import {
  createSceneObject,
  createStarterSceneDocument,
} from '../editor/persistence/sceneSchema';
import { createLayoutSpec } from './layoutSpec';

function createScene() {
  const document = createStarterSceneDocument({
    documentId: 'scene-1',
    floorId: 'floor-1',
    mannequinId: 'person-far',
  });
  document.objects = [
    ...document.objects,
    {
      ...createSceneObject('pole-near', { kind: 'cube', name: 'Pole proxy' }),
      transform: {
        position: { x: -0.2, y: 1, z: -2 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 0.4, y: 3, z: 0.4 },
      },
    },
  ];
  return document;
}

describe('createLayoutSpec', () => {
  it('OutputCamera 기준 화면 위치·점유율·깊이를 계산한다', () => {
    const spec = createLayoutSpec(createScene());
    const person = spec.objects.find(
      ({ objectId }) => objectId === 'person-far',
    );
    const pole = spec.objects.find(({ objectId }) => objectId === 'pole-near');

    expect(spec.camera.targetDistanceMeters).toBe(5);
    expect(person).toMatchObject({
      role: 'subject',
      guideColorOnly: true,
      poseId: 'default',
      facing: { relativeToCamera: 'toward-camera' },
      screen: {
        depthBand: 'midground',
      },
    });
    expect(['visible', 'partial']).toContain(person?.screen.status);
    expect(person?.screen.positionLabel).toMatch(/^center-/);
    expect(pole?.screen.depthMeters).toBeLessThan(
      person?.screen.depthMeters ?? Infinity,
    );
    expect(pole?.screen.depthBand).toBe('foreground');
    expect(pole?.screen.occupancy).toBeGreaterThan(0);
    expect(pole).toMatchObject({
      semanticMeaning: null,
      generationNotes: null,
    });
  });

  it('마네킹의 XYZ 회전을 모두 반영해 카메라 기준 방향을 계산한다', () => {
    const scene = createScene();
    const mannequin = scene.objects.find(({ id }) => id === 'person-far');
    if (!mannequin) throw new Error('Expected mannequin fixture');
    scene.outputCamera = {
      ...scene.outputCamera,
      position: {
        x: -3.4869238721590516,
        y: 1.7583870106889272,
        z: -1.3595976716513727,
      },
      target: {
        x: -0.03149907076590995,
        y: 1.1077678465901568,
        z: 0.25445239764143746,
      },
      focalLengthMm: 35,
      rollDeg: 0,
    };
    mannequin.transform.position = {
      x: -0.4011545627701079,
      y: 0.6259016411197281,
      z: -0.6938572593114247,
    };
    mannequin.transform.rotationDeg = {
      x: -180,
      y: -5.292545683908243,
      z: -180,
    };

    const spec = createLayoutSpec(scene);

    expect(
      spec.objects.find(({ objectId }) => objectId === 'person-far')?.facing
        ?.relativeToCamera,
    ).toBe('screen-right');
  });

  it('월드 Y 회전과 카메라 상대 시점·화면 8방향을 분리한다', () => {
    const scene = createScene();
    const mannequin = scene.objects.find(({ id }) => id === 'person-far');
    if (!mannequin) throw new Error('Expected mannequin fixture');
    scene.outputCamera = {
      ...scene.outputCamera,
      position: { x: -2, y: 3, z: -5 },
      target: { x: 0, y: 1.6, z: 0 },
    };
    mannequin.transform.rotationDeg = { x: 0, y: 0, z: 0 };

    const spec = createLayoutSpec(scene);
    const person = spec.objects.find(
      ({ objectId }) => objectId === 'person-far',
    );

    expect(person).toMatchObject({
      yawDeg: 0,
      facing: {
        worldDirection: { x: 0, y: 0, z: -1 },
        viewClassification: 'front',
        screenDirectionLabel: 'down-left',
      },
    });
    expect(person?.facing?.cameraAzimuthFromForwardDeg).toBeGreaterThan(0);
    expect(person?.facing?.screenDirection?.x).toBeLessThan(0);
    expect(person?.facing?.screenDirection?.y).toBeGreaterThan(0);
  });

  it('오브젝트에 저장한 실제 의미와 생성 메모를 계약에 포함한다', () => {
    const scene = createScene();
    const pole = scene.objects.find(({ id }) => id === 'pole-near');
    if (!pole) throw new Error('Expected pole fixture');
    pole.semantic = {
      meaning: '카메라 가까이에 흐릿하게 보이는 전봇대',
      generationNotes:
        '형태는 실제 전봇대로 교체하고 강한 아웃포커스를 적용한다.',
    };

    const spec = createLayoutSpec(scene);

    expect(
      spec.objects.find(({ objectId }) => objectId === 'pole-near'),
    ).toMatchObject({
      semanticMeaning: '카메라 가까이에 흐릿하게 보이는 전봇대',
      generationNotes:
        '형태는 실제 전봇대로 교체하고 강한 아웃포커스를 적용한다.',
    });
  });

  it('v2 proxy 표시·최종 표면·group provenance와 containment를 분리해 기록한다', () => {
    const scene = createScene();
    const pole = scene.objects.find(({ id }) => id === 'pole-near');
    if (!pole) throw new Error('Expected pole fixture');
    pole.visualization.proxyOpacity = 0.25;
    pole.appearanceIntent = {
      surfaceType: 'opaque',
      materialNotes: '도색된 금속 외피',
    };
    scene.groups = [
      {
        id: 'group-layout',
        name: 'Foreground and actor',
        memberObjectIds: ['pole-near', 'person-far'],
      },
    ];
    scene.spatialRelations = [
      {
        id: 'contains-layout',
        type: 'contains',
        containerObjectId: 'pole-near',
        containedObjectId: 'person-far',
        visibility: 'cutaway',
      },
    ];

    const spec = createLayoutSpec(scene);

    expect(spec.version).toBe(2);
    expect(
      spec.objects.find(({ objectId }) => objectId === 'pole-near'),
    ).toMatchObject({
      proxyVisualization: { opacity: 0.25 },
      appearanceIntent: {
        surfaceType: 'opaque',
        materialNotes: '도색된 금속 외피',
      },
      groupId: 'group-layout',
    });
    expect(spec.containment).toEqual([
      {
        relationId: 'contains-layout',
        containerObjectId: 'pole-near',
        containedObjectId: 'person-far',
        visibility: 'cutaway',
      },
    ]);
  });

  it('평면 거울의 화면 bounds·world plane·반사 대상 ID를 구조화한다', () => {
    const scene = createScene();
    const mirror = createSceneObject('mirror-layout', {
      kind: 'plane',
      name: 'Wall mirror',
    });
    mirror.appearanceIntent = {
      surfaceType: 'mirror',
      materialNotes: '은색 벽 거울',
    };
    mirror.transform.position = { x: 0, y: 1.5, z: 0.5 };
    mirror.transform.rotationDeg.x = -90;
    mirror.dimensions = { x: 3, y: 0.02, z: 2 };
    scene.objects.push(mirror);
    scene.spatialRelations = [
      {
        id: 'reflects-layout',
        type: 'reflects',
        mirrorObjectId: mirror.id,
        reflectedObjectIds: ['person-far'],
      },
    ];

    const spec = createLayoutSpec(scene);
    const mirrorObject = spec.objects.find(
      ({ objectId }) => objectId === mirror.id,
    );

    expect(spec.mirrors).toEqual([
      {
        relationId: 'reflects-layout',
        mirrorObjectId: mirror.id,
        reflectedObjectIds: ['person-far'],
        screenBounds: mirrorObject?.screen.bounds ?? null,
        pointWorld: { x: 0, y: 1.5, z: 0.5 },
        normalWorld: { x: 0, y: 0, z: -1 },
      },
    ]);
  });

  it('마네킹 레퍼런스 결합과 잠재 가림을 기록한다', () => {
    const spec = createLayoutSpec(createScene(), [
      {
        id: 'ref-person',
        name: '캐릭터 시트',
        kind: 'character',
        artifactId: 'artifact-person',
        contentHash: `sha256:${'a'.repeat(64)}`,
        mimeType: 'image/png',
        width: 100,
        height: 100,
        originalFileName: 'person.png',
        byteLength: 100,
        createdAt: '2026-08-03T00:00:00.000Z',
        targetObjectId: 'person-far',
        use: ['face'],
        exclude: ['pose'],
        enabled: true,
      },
    ]);

    expect(
      spec.objects.find(({ objectId }) => objectId === 'person-far'),
    ).toMatchObject({ appearanceReferenceIds: ['ref-person'] });
    expect(spec.potentialOcclusions).toContainEqual(
      expect.objectContaining({
        nearObjectId: 'pole-near',
        farObjectId: 'person-far',
      }),
    );
  });

  it('숨김 또는 출력 제외 오브젝트를 명시한다', () => {
    const scene = createScene();
    scene.objects[1] = { ...scene.objects[1]!, visible: false };
    const spec = createLayoutSpec(scene);

    expect(spec.omittedObjectIds).toContain('person-far');
    expect(spec.objects).not.toContainEqual(
      expect.objectContaining({ objectId: 'person-far' }),
    );
  });
});
