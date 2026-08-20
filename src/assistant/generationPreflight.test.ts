import { describe, expect, it } from 'vitest';
import {
  createGenerationPreflightFingerprint,
  evaluateGenerationPreflight,
  type GenerationPreflightReference,
} from '../../shared/generationPreflight';
import type { LayoutSpec } from '../../shared/layoutSpecSchema';
import {
  createSceneObject,
  createStarterSceneDocument,
} from '../editor/persistence/sceneSchema';

const IDS = {
  documentId: 'scene-preflight',
  floorId: 'floor-preflight',
  mannequinId: 'mannequin-primary',
};

function createScene() {
  return createStarterSceneDocument(IDS);
}

function createLayout(scene = createScene()): LayoutSpec {
  return {
    version: 2,
    sceneId: scene.id,
    output: {
      width: scene.output.width,
      height: scene.output.height,
      aspectRatioId: scene.output.aspectRatioId,
    },
    camera: { ...scene.outputCamera, targetDistanceMeters: 5 },
    authority: {
      preserveFromLayout: ['pose'],
      reinterpretForFinalFrame: ['appearance'],
      referencePriority: ['layout'],
    },
    objects: scene.objects
      .filter(({ visible, exportable }) => visible && exportable)
      .map((object) => ({
        objectId: object.id,
        name: object.name,
        kind: object.kind,
        role:
          object.kind === 'mannequin'
            ? ('subject' as const)
            : ('environment' as const),
        guideColor: object.color,
        guideColorOnly: true as const,
        proxyVisualization: { opacity: 1 },
        appearanceIntent: {
          surfaceType: 'opaque' as const,
          materialNotes: '',
        },
        groupId: null,
        semanticMeaning: null,
        generationNotes: null,
        worldBounds: {
          center: object.transform.position,
          size: object.dimensions,
        },
        yawDeg: object.transform.rotationDeg.y,
        facing: null,
        poseId: object.mannequinPose?.id ?? null,
        screen: {
          status: 'visible' as const,
          center: { x: 0.5, y: 0.5 },
          bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
          clippedBounds: {
            x: 0.25,
            y: 0.25,
            width: 0.5,
            height: 0.5,
          },
          occupancy: 0.25,
          depthMeters: 5,
          depthBand: 'midground' as const,
          positionLabel: 'center-middle',
        },
        appearanceReferenceIds: [],
        preserve: ['pose'],
        reinterpret: ['appearance'],
      })),
    potentialOcclusions: [],
    containment: [],
    mirrors: [],
    omittedObjectIds: [],
  };
}

function characterReference(
  overrides: Partial<GenerationPreflightReference> = {},
): GenerationPreflightReference {
  return {
    id: 'ref-character',
    name: '주인공 캐릭터 시트',
    kind: 'character',
    targetObjectId: IDS.mannequinId,
    use: ['face', 'hair', 'clothing'],
    exclude: ['pose', 'background'],
    enabled: true,
    ...overrides,
  };
}

describe('generation preflight', () => {
  it('일관된 scene, layout과 reference는 issue 없이 통과한다', () => {
    const scene = createScene();
    expect(
      evaluateGenerationPreflight({
        scene,
        layoutSpec: createLayout(scene),
        references: [characterReference()],
        includeLayout: true,
        includeSourceKeyframe: false,
      }),
    ).toEqual({ issues: [], blockers: [], warnings: [] });
  });

  it('입력 예산, disabled/dangling target과 scene-layout 불일치를 blocking으로 분류한다', () => {
    const scene = createScene();
    const layout = createLayout(scene);
    layout.objects = layout.objects.filter(
      ({ objectId }) => objectId !== IDS.mannequinId,
    );
    const references = Array.from({ length: 5 }, (_, index) =>
      characterReference({
        id: `ref-${index}`,
        enabled: index !== 0,
        targetObjectId: index === 1 ? 'deleted-object' : IDS.mannequinId,
      }),
    );

    const result = evaluateGenerationPreflight({
      scene,
      layoutSpec: layout,
      references,
      includeLayout: true,
      includeSourceKeyframe: false,
    });

    expect(result.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'input-budget-exceeded',
        'disabled-reference-selected',
        'layout-object-mismatch',
        'dangling-reference-target',
        'reference-target-omitted',
      ]),
    );
  });

  it('주인공 가림, pose/scope 충돌과 다중 subject의 미지정 character reference를 warning으로 분류한다', () => {
    const scene = createScene();
    scene.objects.push(
      createSceneObject('mannequin-secondary', { kind: 'mannequin' }),
      createSceneObject('cube-foreground', { kind: 'cube' }),
    );
    const layout = createLayout(scene);
    const foreground = layout.objects.find(
      ({ objectId }) => objectId === 'cube-foreground',
    )!;
    foreground.role = 'proxy';
    layout.potentialOcclusions = [
      {
        nearObjectId: 'cube-foreground',
        farObjectId: IDS.mannequinId,
        farObjectOverlap: 0.42,
      },
    ];
    const references = [
      characterReference({ use: ['pose'], exclude: ['pose'] }),
      characterReference({
        id: 'ref-ambiguous',
        name: '보조 인물 시트',
        targetObjectId: null,
      }),
    ];

    const result = evaluateGenerationPreflight({
      scene,
      layoutSpec: layout,
      references,
      includeLayout: true,
      includeSourceKeyframe: false,
    });

    expect(result.blockers).toEqual([]);
    expect(result.warnings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'reference-scope-conflict',
        'pose-authority-conflict',
        'ambiguous-character-reference',
        'subject-occlusion',
      ]),
    );
  });

  it('scene revision이나 reference metadata가 바뀌면 확인 fingerprint도 바뀐다', () => {
    const scene = createScene();
    const input = {
      scene,
      layoutSpec: createLayout(scene),
      references: [characterReference()],
      includeLayout: true,
      includeSourceKeyframe: false,
    };
    const fingerprint = createGenerationPreflightFingerprint(input);

    expect(
      createGenerationPreflightFingerprint({
        ...input,
        scene: { ...scene, sceneRevision: 1 },
      }),
    ).not.toBe(fingerprint);
    expect(
      createGenerationPreflightFingerprint({
        ...input,
        references: [characterReference({ use: ['pose'] })],
      }),
    ).not.toBe(fingerprint);
  });
});
