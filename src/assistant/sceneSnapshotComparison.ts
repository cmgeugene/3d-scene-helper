import type { GenerationRecord } from './companionClient';
import type {
  SceneDocument,
  SceneObject,
} from '../editor/persistence/sceneSchema';

export interface SceneDifference {
  id: string;
  label: string;
  detail: string;
}

export interface SceneComparison {
  changed: boolean;
  differences: SceneDifference[];
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function vector({ x, y, z }: { x: number; y: number; z: number }) {
  return `(${x}, ${y}, ${z})`;
}

function objectLabel(object: SceneObject) {
  return `${object.name} · ${object.kind}`;
}

function valueChange(
  label: string,
  snapshot: unknown,
  current: unknown,
  format: (value: never) => string = String,
) {
  return same(snapshot, current)
    ? null
    : `${label} snapshot ${format(snapshot as never)} → 현재 ${format(current as never)}`;
}

function compact(parts: Array<string | null>) {
  return parts.filter((part): part is string => part !== null).join(' · ');
}

function semanticValue(value: string | undefined) {
  return value?.trim() || '없음';
}

export function assessGenerationSceneIntegrity(
  generation: GenerationRecord,
): NonNullable<GenerationRecord['sceneIntegrity']> {
  const snapshotSceneId = generation.sceneSnapshot?.id ?? null;
  const layoutSpecSceneId = generation.layoutSpec?.sceneId ?? null;
  const layoutRenderSceneId =
    generation.sceneIntegrity?.layoutRenderSceneId ?? null;
  const reported = generation.sceneIntegrity;

  if (snapshotSceneId === null) {
    return {
      status: 'legacy',
      snapshotSceneId,
      layoutSpecSceneId,
      layoutRenderSceneId,
    };
  }

  const browserValidated =
    reported?.status === 'valid' &&
    reported.snapshotSceneId === snapshotSceneId &&
    reported.layoutSpecSceneId === layoutSpecSceneId &&
    snapshotSceneId === layoutSpecSceneId &&
    snapshotSceneId === layoutRenderSceneId;

  return {
    status: browserValidated ? 'valid' : 'mismatch',
    snapshotSceneId,
    layoutSpecSceneId,
    layoutRenderSceneId,
  };
}

export function compareSceneDocuments(
  current: SceneDocument,
  snapshot: SceneDocument,
): SceneComparison {
  const differences: SceneDifference[] = [];

  if (current.id !== snapshot.id) {
    differences.push({
      id: 'scene-id',
      label: '장면 ID',
      detail: `snapshot ${snapshot.id} · 현재 ${current.id}`,
    });
  }

  if (current.name !== snapshot.name) {
    differences.push({
      id: 'scene-name',
      label: '장면 이름',
      detail: `snapshot ${snapshot.name || '없음'} → 현재 ${current.name || '없음'}`,
    });
  }

  if (!same(current.outputCamera, snapshot.outputCamera)) {
    differences.push({
      id: 'camera',
      label: '카메라',
      detail: compact([
        valueChange(
          '렌즈',
          `${snapshot.outputCamera.focalLengthMm}mm`,
          `${current.outputCamera.focalLengthMm}mm`,
        ),
        valueChange(
          '위치',
          snapshot.outputCamera.position,
          current.outputCamera.position,
          vector,
        ),
        valueChange(
          'target',
          snapshot.outputCamera.target,
          current.outputCamera.target,
          vector,
        ),
        valueChange(
          'roll',
          `${snapshot.outputCamera.rollDeg}°`,
          `${current.outputCamera.rollDeg}°`,
        ),
      ]),
    });
  }

  if (!same(current.output, snapshot.output)) {
    differences.push({
      id: 'output',
      label: '출력',
      detail: `snapshot ${snapshot.output.aspectRatioId} ${snapshot.output.width}×${snapshot.output.height} ${snapshot.output.mode} → 현재 ${current.output.aspectRatioId} ${current.output.width}×${current.output.height} ${current.output.mode}`,
    });
  }

  if (
    !same(current.lighting, snapshot.lighting) ||
    !same(current.background, snapshot.background)
  ) {
    const lightingDetails = same(current.lighting, snapshot.lighting)
      ? null
      : compact([
          valueChange(
            '조명 프리셋',
            snapshot.lighting.presetId,
            current.lighting.presetId,
          ),
          same(
            { ...snapshot.lighting, presetId: undefined },
            { ...current.lighting, presetId: undefined },
          )
            ? null
            : '조명 강도·색상·방향·노출 또는 그림자 설정 변경',
        ]);
    differences.push({
      id: 'look',
      label: '조명·배경',
      detail: compact([
        lightingDetails,
        valueChange(
          '배경',
          snapshot.background.color,
          current.background.color,
        ),
      ]),
    });
  }

  const currentById = new Map(
    current.objects.map((object) => [object.id, object]),
  );
  const snapshotById = new Map(
    snapshot.objects.map((object) => [object.id, object]),
  );

  for (const object of snapshot.objects) {
    const liveObject = currentById.get(object.id);
    if (liveObject === undefined) {
      differences.push({
        id: `deleted:${object.id}`,
        label: objectLabel(object),
        detail: '현재 씬에서 삭제',
      });
      continue;
    }
    if (
      !same(liveObject.transform, object.transform) ||
      !same(liveObject.dimensions, object.dimensions)
    ) {
      differences.push({
        id: `transform:${object.id}`,
        label: objectLabel(object),
        detail: `변형 · ${compact([
          valueChange(
            '위치',
            object.transform.position,
            liveObject.transform.position,
            vector,
          ),
          valueChange(
            '회전',
            object.transform.rotationDeg,
            liveObject.transform.rotationDeg,
            vector,
          ),
          valueChange(
            'scale',
            object.transform.scale,
            liveObject.transform.scale,
            vector,
          ),
          valueChange(
            'dimensions',
            object.dimensions,
            liveObject.dimensions,
            vector,
          ),
        ])}`,
      });
    }
    if (!same(liveObject.semantic, object.semantic)) {
      differences.push({
        id: `semantic:${object.id}`,
        label: objectLabel(object),
        detail: compact([
          valueChange(
            '의미',
            semanticValue(object.semantic?.meaning),
            semanticValue(liveObject.semantic?.meaning),
          ),
          valueChange(
            '생성 메모',
            semanticValue(object.semantic?.generationNotes),
            semanticValue(liveObject.semantic?.generationNotes),
          ),
        ]),
      });
    }
    if (
      liveObject.kind !== object.kind ||
      liveObject.name !== object.name ||
      liveObject.color !== object.color ||
      liveObject.visible !== object.visible ||
      liveObject.exportable !== object.exportable
    ) {
      differences.push({
        id: `appearance:${object.id}`,
        label: objectLabel(object),
        detail: compact([
          valueChange('종류', object.kind, liveObject.kind),
          valueChange('이름', object.name, liveObject.name),
          valueChange('색상', object.color, liveObject.color),
          valueChange(
            '가시성',
            object.visible ? '표시' : '숨김',
            liveObject.visible ? '표시' : '숨김',
          ),
          valueChange(
            '출력 포함',
            object.exportable ? '포함' : '제외',
            liveObject.exportable ? '포함' : '제외',
          ),
        ]),
      });
    }
    if (!same(liveObject.mannequinPose, object.mannequinPose)) {
      differences.push({
        id: `pose:${object.id}`,
        label: objectLabel(object),
        detail: '마네킹 포즈 변경',
      });
    }
  }

  for (const object of current.objects) {
    if (snapshotById.has(object.id)) continue;
    differences.push({
      id: `added:${object.id}`,
      label: objectLabel(object),
      detail: '현재 씬에 추가',
    });
  }

  if (
    current.sceneNotes !== snapshot.sceneNotes ||
    !same(current.subjectMotionGuide, snapshot.subjectMotionGuide) ||
    !same(current.cameraMotionGuide, snapshot.cameraMotionGuide)
  ) {
    differences.push({
      id: 'scene-metadata',
      label: '장면 메모·모션 가이드',
      detail: '생성 의미 또는 모션 메타데이터 변경',
    });
  }

  return { changed: differences.length > 0, differences };
}
