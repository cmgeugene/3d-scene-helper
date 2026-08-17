import type { GenerationRecord } from './companionClient';

export type GenerationComparisonRelation = 'parent' | 'sibling';

export interface GenerationComparisonCandidate {
  generation: GenerationRecord;
  relation: GenerationComparisonRelation;
}

export interface GenerationDifference {
  id: string;
  label: string;
  detail: string;
}

export interface GenerationSnapshotComparison {
  status: 'same' | 'changed' | 'unavailable' | 'mismatch';
  differences: GenerationDifference[];
}

export interface GenerationVersionComparison {
  scene: GenerationSnapshotComparison;
  layout: GenerationSnapshotComparison;
  directiveChanged: boolean;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function summarizeIds(ids: string[]) {
  return ids.length <= 4
    ? ids.join(' · ')
    : `${ids.slice(0, 4).join(' · ')} 외 ${ids.length - 4}개`;
}

function difference(
  id: string,
  label: string,
  detail: string,
): GenerationDifference {
  return { id, label, detail };
}

function compareObjects(
  selected: NonNullable<GenerationRecord['sceneSnapshot']>['objects'],
  comparison: NonNullable<GenerationRecord['sceneSnapshot']>['objects'],
) {
  const differences: GenerationDifference[] = [];
  const selectedById = new Map(selected.map((object) => [object.id, object]));
  const comparisonById = new Map(
    comparison.map((object) => [object.id, object]),
  );
  const added = selected
    .filter((object) => !comparisonById.has(object.id))
    .map((object) => object.name);
  const removed = comparison
    .filter((object) => !selectedById.has(object.id))
    .map((object) => object.name);
  const changed = selected
    .filter((object) => {
      const previous = comparisonById.get(object.id);
      return previous !== undefined && !same(object, previous);
    })
    .map((object) => object.name);

  if (added.length > 0) {
    differences.push(
      difference('objects-added', '오브젝트 추가', summarizeIds(added)),
    );
  }
  if (removed.length > 0) {
    differences.push(
      difference('objects-removed', '오브젝트 제거', summarizeIds(removed)),
    );
  }
  if (changed.length > 0) {
    differences.push(
      difference(
        'objects-changed',
        '오브젝트 속성·변형',
        summarizeIds(changed),
      ),
    );
  }
  return differences;
}

function compareSceneSnapshots(
  selected: GenerationRecord,
  comparison: GenerationRecord,
): GenerationSnapshotComparison {
  const current = selected.sceneSnapshot;
  const previous = comparison.sceneSnapshot;
  if (current === null || previous === null) {
    return {
      status: 'unavailable',
      differences: [
        difference(
          'scene-unavailable',
          'SceneDocument',
          current === null && previous === null
            ? '두 generation 모두 스냅샷 없음'
            : current === null
              ? '선택 generation 스냅샷 없음'
              : '비교 generation 스냅샷 없음',
        ),
      ],
    };
  }

  const differences: GenerationDifference[] = [];
  if (current.id !== previous.id) {
    differences.push(
      difference(
        'scene-id',
        '장면 ID',
        `비교 ${previous.id} → 선택 ${current.id}`,
      ),
    );
  }
  if (
    current.sceneRevision !== previous.sceneRevision ||
    current.specRevision !== previous.specRevision
  ) {
    differences.push(
      difference(
        'scene-revisions',
        'SceneDocument revision',
        `비교 scene r${previous.sceneRevision} · spec r${previous.specRevision} → 선택 scene r${current.sceneRevision} · spec r${current.specRevision}`,
      ),
    );
  }
  if (!same(current.outputCamera, previous.outputCamera)) {
    differences.push(
      difference(
        'camera',
        '출력 카메라',
        `비교 ${previous.outputCamera.focalLengthMm}mm → 선택 ${current.outputCamera.focalLengthMm}mm`,
      ),
    );
  }
  if (!same(current.output, previous.output)) {
    differences.push(
      difference(
        'output',
        '출력 설정',
        `비교 ${previous.output.aspectRatioId} ${previous.output.width}×${previous.output.height} → 선택 ${current.output.aspectRatioId} ${current.output.width}×${current.output.height}`,
      ),
    );
  }
  if (
    current.name !== previous.name ||
    !same(current.lighting, previous.lighting) ||
    !same(current.background, previous.background)
  ) {
    differences.push(
      difference('scene-look', '장면 이름·조명·배경', '장면 연출 속성 변경'),
    );
  }
  if (!same(current.semanticSceneSpec, previous.semanticSceneSpec)) {
    differences.push(
      difference(
        'semantic-scene-spec',
        'Semantic Scene Spec',
        '장소·분위기·생성 요소 또는 연출 제약 변경',
      ),
    );
  }
  differences.push(...compareObjects(current.objects, previous.objects));
  if (
    current.sceneNotes !== previous.sceneNotes ||
    !same(current.subjectMotionGuide, previous.subjectMotionGuide) ||
    !same(current.cameraMotionGuide, previous.cameraMotionGuide)
  ) {
    differences.push(
      difference(
        'scene-metadata',
        '장면 메모·모션',
        '생성 의미 또는 모션 가이드 변경',
      ),
    );
  }

  return {
    status:
      current.id !== previous.id
        ? 'mismatch'
        : differences.length === 0
          ? 'same'
          : 'changed',
    differences,
  };
}

function compareLayoutSpecs(
  selected: GenerationRecord,
  comparison: GenerationRecord,
): GenerationSnapshotComparison {
  const current = selected.layoutSpec;
  const previous = comparison.layoutSpec;
  if (current === null || previous === null) {
    return {
      status: 'unavailable',
      differences: [
        difference(
          'layout-unavailable',
          'LayoutSpec',
          current === null && previous === null
            ? '두 generation 모두 스냅샷 없음'
            : current === null
              ? '선택 generation 스냅샷 없음'
              : '비교 generation 스냅샷 없음',
        ),
      ],
    };
  }

  const differences: GenerationDifference[] = [];
  if (current.sceneId !== previous.sceneId) {
    differences.push(
      difference(
        'layout-scene-id',
        'LayoutSpec 장면 ID',
        `비교 ${previous.sceneId} → 선택 ${current.sceneId}`,
      ),
    );
  }
  if (!same(current.output, previous.output)) {
    differences.push(
      difference(
        'layout-output',
        '프레임',
        `비교 ${previous.output.aspectRatioId} ${previous.output.width}×${previous.output.height} → 선택 ${current.output.aspectRatioId} ${current.output.width}×${current.output.height}`,
      ),
    );
  }
  if (!same(current.camera, previous.camera)) {
    differences.push(
      difference(
        'layout-camera',
        '카메라 분석',
        `비교 ${previous.camera.focalLengthMm}mm → 선택 ${current.camera.focalLengthMm}mm`,
      ),
    );
  }
  if (!same(current.authority, previous.authority)) {
    differences.push(
      difference(
        'layout-authority',
        '생성 권위',
        '유지·재해석·레퍼런스 우선순위 변경',
      ),
    );
  }
  const currentById = new Map(
    current.objects.map((object) => [object.objectId, object]),
  );
  const previousById = new Map(
    previous.objects.map((object) => [object.objectId, object]),
  );
  const added = current.objects
    .filter((object) => !previousById.has(object.objectId))
    .map((object) => object.name);
  const removed = previous.objects
    .filter((object) => !currentById.has(object.objectId))
    .map((object) => object.name);
  const changed = current.objects
    .filter((object) => {
      const previousObject = previousById.get(object.objectId);
      return previousObject !== undefined && !same(object, previousObject);
    })
    .map((object) => object.name);
  if (added.length + removed.length + changed.length > 0) {
    differences.push(
      difference(
        'layout-objects',
        '화면 배치·오브젝트',
        [
          added.length === 0 ? null : `추가 ${summarizeIds(added)}`,
          removed.length === 0 ? null : `제거 ${summarizeIds(removed)}`,
          changed.length === 0 ? null : `변경 ${summarizeIds(changed)}`,
        ]
          .filter((value): value is string => value !== null)
          .join(' · '),
      ),
    );
  }
  if (
    !same(current.potentialOcclusions, previous.potentialOcclusions) ||
    !same(current.omittedObjectIds, previous.omittedObjectIds)
  ) {
    differences.push(
      difference(
        'layout-visibility',
        '가림·프레임 제외',
        '가시성 분석 결과 변경',
      ),
    );
  }

  return {
    status:
      current.sceneId !== previous.sceneId
        ? 'mismatch'
        : differences.length === 0
          ? 'same'
          : 'changed',
    differences,
  };
}

export function getGenerationComparisonCandidates(
  selected: GenerationRecord,
  generations: GenerationRecord[],
): GenerationComparisonCandidate[] {
  if (selected.parentGenerationId === null) return [];
  const parent = generations.find(
    (generation) => generation.id === selected.parentGenerationId,
  );
  const siblings = generations.filter(
    (generation) =>
      generation.id !== selected.id &&
      generation.id !== parent?.id &&
      generation.parentGenerationId === selected.parentGenerationId,
  );
  return [
    ...(parent === undefined
      ? []
      : [{ generation: parent, relation: 'parent' as const }]),
    ...siblings.map((generation) => ({
      generation,
      relation: 'sibling' as const,
    })),
  ];
}

export function compareGenerationVersions(
  selected: GenerationRecord,
  comparison: GenerationRecord,
): GenerationVersionComparison {
  return {
    scene: compareSceneSnapshots(selected, comparison),
    layout: compareLayoutSpecs(selected, comparison),
    directiveChanged: !same(
      selected.refinementDirective,
      comparison.refinementDirective,
    ),
  };
}
