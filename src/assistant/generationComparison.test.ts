import { describe, expect, it } from 'vitest';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';
import type { GenerationRecord } from './companionClient';
import {
  compareGenerationVersions,
  getGenerationComparisonCandidates,
} from './generationComparison';

function generation(
  id: string,
  overrides: Partial<GenerationRecord> = {},
): GenerationRecord {
  return {
    id,
    threadId: 'thread-1',
    turnId: `turn-${id}`,
    status: 'completed',
    prompt: '장면 생성',
    layoutSpec: structuredClone(TEST_LAYOUT_SPEC),
    sceneSnapshot: createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: 'mannequin-test',
    }),
    semanticSceneSpecSnapshot: null,
    referenceSnapshots: [],
    parentGenerationId: null,
    versionNumber: 1,
    feedback: null,
    refinementDirective: null,
    generationMode: 'fresh',
    layoutRenderId: `layout-${id}`,
    sceneIntegrity: {
      status: 'valid',
      snapshotSceneId: 'scene-test',
      layoutSpecSceneId: 'scene-test',
      layoutRenderSceneId: 'scene-test',
    },
    referenceIds: [],
    attachments: [],
    revisedPrompt: null,
    result: {
      artifactId: `artifact-${id}`,
      contentHash: `sha256:${'a'.repeat(64)}`,
      mimeType: 'image/png',
      width: 1920,
      height: 1080,
      byteLength: 100,
    },
    error: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:01.000Z',
    ...overrides,
  };
}

describe('generation comparison', () => {
  it('선택 generation의 부모와 같은 부모를 가진 형제만 후보로 만든다', () => {
    const parent = generation('parent');
    const selected = generation('selected', {
      parentGenerationId: parent.id,
      versionNumber: 2,
      generationMode: 'edit',
    });
    const sibling = generation('sibling', {
      parentGenerationId: parent.id,
      versionNumber: 3,
      generationMode: 'edit',
    });
    const unrelated = generation('unrelated');

    expect(
      getGenerationComparisonCandidates(selected, [
        unrelated,
        sibling,
        selected,
        parent,
      ]).map(({ generation: candidate, relation }) => [candidate.id, relation]),
    ).toEqual([
      ['parent', 'parent'],
      ['sibling', 'sibling'],
    ]);
    expect(
      getGenerationComparisonCandidates(parent, [parent, selected, sibling]),
    ).toEqual([]);
  });

  it('RefinementDirective와 SceneDocument·LayoutSpec의 주요 차이를 설명한다', () => {
    const comparison = generation('parent');
    const sceneSnapshot = structuredClone(comparison.sceneSnapshot!);
    sceneSnapshot.sceneRevision = 2;
    sceneSnapshot.specRevision = 1;
    sceneSnapshot.outputCamera.focalLengthMm = 35;
    sceneSnapshot.semanticSceneSpec.intent.mood = '긴장된 저녁';
    sceneSnapshot.objects[1] = {
      ...sceneSnapshot.objects[1]!,
      name: '이동한 주인공',
      transform: {
        ...sceneSnapshot.objects[1]!.transform,
        position: { x: 1, y: 0.85, z: 0 },
      },
    };
    const layoutSpec = structuredClone(TEST_LAYOUT_SPEC);
    layoutSpec.camera.focalLengthMm = 35;
    layoutSpec.authority.preserveFromLayout = ['camera'];
    const selected = generation('selected', {
      parentGenerationId: comparison.id,
      versionNumber: 2,
      generationMode: 'edit',
      sceneSnapshot,
      layoutSpec,
      refinementDirective: {
        version: 1,
        preserve: ['카메라 구도'],
        change: ['인물 표정을 바꿔줘'],
      },
    });

    const result = compareGenerationVersions(selected, comparison);

    expect(result.directiveChanged).toBe(true);
    expect(result.scene.status).toBe('changed');
    expect(result.scene.differences.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'scene-revisions',
        'camera',
        'semantic-scene-spec',
        'objects-changed',
      ]),
    );
    expect(result.layout.status).toBe('changed');
    expect(result.layout.differences.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['layout-camera', 'layout-authority']),
    );
  });

  it('구형 스냅샷 부재와 다른 장면 ID를 명시적으로 구분한다', () => {
    const legacy = generation('legacy', {
      sceneSnapshot: null,
      layoutSpec: null,
    });
    const current = generation('current');
    const unavailable = compareGenerationVersions(current, legacy);
    expect(unavailable.scene.status).toBe('unavailable');
    expect(unavailable.layout.status).toBe('unavailable');

    const otherScene = generation('other', {
      sceneSnapshot: {
        ...structuredClone(current.sceneSnapshot!),
        id: 'scene-other',
      },
      layoutSpec: {
        ...structuredClone(TEST_LAYOUT_SPEC),
        sceneId: 'scene-other',
      },
    });
    const mismatch = compareGenerationVersions(current, otherScene);
    expect(mismatch.scene.status).toBe('mismatch');
    expect(mismatch.layout.status).toBe('mismatch');
  });
});
