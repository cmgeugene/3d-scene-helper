import type { SceneDocument } from '../src/editor/persistence/sceneSchema';
import {
  getMaximumReferenceImages,
  type ImageInputBudget,
} from './imageInputBudget';
import type { LayoutSpec } from './layoutSpecSchema';

export interface GenerationPreflightReference {
  id: string;
  name: string;
  kind: 'layout' | 'background' | 'character' | 'style';
  targetObjectId: string | null;
  use: string[];
  exclude: string[];
  enabled: boolean;
}

export interface GenerationPreflightInput extends ImageInputBudget {
  scene: SceneDocument;
  layoutSpec: LayoutSpec;
  references: GenerationPreflightReference[];
}

export type GenerationPreflightIssueSeverity = 'blocking' | 'warning';

export type GenerationPreflightIssueCode =
  | 'input-budget-exceeded'
  | 'duplicate-reference'
  | 'disabled-reference-selected'
  | 'layout-scene-mismatch'
  | 'layout-object-mismatch'
  | 'layout-occlusion-object-missing'
  | 'dangling-reference-target'
  | 'reference-target-omitted'
  | 'reference-scope-conflict'
  | 'pose-authority-conflict'
  | 'ambiguous-character-reference'
  | 'subject-occlusion';

export interface GenerationPreflightIssue {
  id: string;
  code: GenerationPreflightIssueCode;
  severity: GenerationPreflightIssueSeverity;
  message: string;
  referenceId?: string;
  objectId?: string;
}

export interface GenerationPreflightResult {
  issues: GenerationPreflightIssue[];
  blockers: GenerationPreflightIssue[];
  warnings: GenerationPreflightIssue[];
}

export const SUBJECT_OCCLUSION_WARNING_THRESHOLD = 0.25;

function normalizedScope(value: string) {
  return value.trim().toLocaleLowerCase();
}

function isPoseScope(value: string) {
  const normalized = normalizedScope(value);
  return normalized.includes('pose') || normalized.includes('포즈');
}

function issue(
  severity: GenerationPreflightIssueSeverity,
  code: GenerationPreflightIssueCode,
  idSuffix: string,
  message: string,
  details: Pick<GenerationPreflightIssue, 'referenceId' | 'objectId'> = {},
): GenerationPreflightIssue {
  return { id: `${code}:${idSuffix}`, code, severity, message, ...details };
}

export function evaluateGenerationPreflight(
  input: GenerationPreflightInput,
): GenerationPreflightResult {
  const issues: GenerationPreflightIssue[] = [];
  const maximumReferences = getMaximumReferenceImages(input);
  if (input.references.length > maximumReferences) {
    issues.push(
      issue(
        'blocking',
        'input-budget-exceeded',
        `${input.references.length}:${maximumReferences}`,
        `현재 생성 구성에서는 레퍼런스를 최대 ${maximumReferences}장까지 사용할 수 있습니다.`,
      ),
    );
  }

  const sceneObjects = new Map(
    input.scene.objects.map((object) => [object.id, object]),
  );
  const expectedLayoutIds = new Set(
    input.scene.objects
      .filter(({ visible, exportable }) => visible && exportable)
      .map(({ id }) => id),
  );
  const layoutObjects = new Map<string, LayoutSpec['objects'][number]>();
  for (const object of input.layoutSpec.objects) {
    if (layoutObjects.has(object.objectId)) {
      issues.push(
        issue(
          'blocking',
          'layout-object-mismatch',
          `duplicate:${object.objectId}`,
          `LayoutSpec에 object ${object.objectId}가 중복되어 있습니다.`,
          { objectId: object.objectId },
        ),
      );
    }
    layoutObjects.set(object.objectId, object);
  }

  if (input.layoutSpec.sceneId !== input.scene.id) {
    issues.push(
      issue(
        'blocking',
        'layout-scene-mismatch',
        `${input.layoutSpec.sceneId}:${input.scene.id}`,
        'SceneDocument와 LayoutSpec의 scene ID가 일치하지 않습니다.',
      ),
    );
  }
  for (const objectId of expectedLayoutIds) {
    if (!layoutObjects.has(objectId)) {
      issues.push(
        issue(
          'blocking',
          'layout-object-mismatch',
          `missing:${objectId}`,
          `표시 가능한 object ${objectId}가 LayoutSpec에 없습니다.`,
          { objectId },
        ),
      );
    }
  }
  for (const objectId of layoutObjects.keys()) {
    if (!expectedLayoutIds.has(objectId)) {
      issues.push(
        issue(
          'blocking',
          'layout-object-mismatch',
          `unexpected:${objectId}`,
          `LayoutSpec의 object ${objectId}가 현재 생성 가능한 장면 object와 일치하지 않습니다.`,
          { objectId },
        ),
      );
    }
  }

  for (const occlusion of input.layoutSpec.potentialOcclusions) {
    if (
      !layoutObjects.has(occlusion.nearObjectId) ||
      !layoutObjects.has(occlusion.farObjectId)
    ) {
      issues.push(
        issue(
          'blocking',
          'layout-occlusion-object-missing',
          `${occlusion.nearObjectId}:${occlusion.farObjectId}`,
          'LayoutSpec의 가림 관계가 존재하지 않는 object를 참조합니다.',
        ),
      );
    }
  }

  const seenReferenceIds = new Set<string>();
  const subjectCount = [...layoutObjects.values()].filter(
    ({ role }) => role === 'subject',
  ).length;
  for (const reference of input.references) {
    if (seenReferenceIds.has(reference.id)) {
      issues.push(
        issue(
          'blocking',
          'duplicate-reference',
          reference.id,
          `레퍼런스 ${reference.name}이 중복 선택되었습니다.`,
          { referenceId: reference.id },
        ),
      );
      continue;
    }
    seenReferenceIds.add(reference.id);

    if (!reference.enabled) {
      issues.push(
        issue(
          'blocking',
          'disabled-reference-selected',
          reference.id,
          `비활성 레퍼런스 ${reference.name}은 생성 입력으로 사용할 수 없습니다.`,
          { referenceId: reference.id },
        ),
      );
    }

    const useScopes = new Set(reference.use.map(normalizedScope));
    const conflicts = [
      ...new Set(
        reference.exclude
          .map(normalizedScope)
          .filter((scope) => useScopes.has(scope)),
      ),
    ];
    if (conflicts.length > 0) {
      issues.push(
        issue(
          'warning',
          'reference-scope-conflict',
          reference.id,
          `${reference.name}의 사용 범위와 제외 범위가 충돌합니다: ${conflicts.join(', ')}.`,
          { referenceId: reference.id },
        ),
      );
    }

    if (reference.targetObjectId === null) {
      if (reference.kind === 'character' && subjectCount > 1) {
        issues.push(
          issue(
            'warning',
            'ambiguous-character-reference',
            reference.id,
            `${reference.name}의 연결 대상이 없어 여러 인물 중 누구의 외형인지 모호합니다.`,
            { referenceId: reference.id },
          ),
        );
      }
      continue;
    }

    const target = sceneObjects.get(reference.targetObjectId);
    if (target === undefined) {
      issues.push(
        issue(
          'blocking',
          'dangling-reference-target',
          `${reference.id}:${reference.targetObjectId}`,
          `${reference.name}이 삭제된 object ${reference.targetObjectId}에 연결되어 있습니다.`,
          {
            referenceId: reference.id,
            objectId: reference.targetObjectId,
          },
        ),
      );
      continue;
    }
    const layoutTarget = layoutObjects.get(reference.targetObjectId);
    if (layoutTarget === undefined) {
      issues.push(
        issue(
          'blocking',
          'reference-target-omitted',
          `${reference.id}:${reference.targetObjectId}`,
          `${reference.name}의 연결 대상 ${target.name}이 현재 LayoutSpec에서 제외되어 있습니다.`,
          {
            referenceId: reference.id,
            objectId: reference.targetObjectId,
          },
        ),
      );
      continue;
    }
    if (
      reference.kind === 'character' &&
      layoutTarget.role === 'subject' &&
      reference.use.some(isPoseScope)
    ) {
      issues.push(
        issue(
          'warning',
          'pose-authority-conflict',
          `${reference.id}:${reference.targetObjectId}`,
          `${reference.name}이 pose를 사용하도록 설정되어 있지만 3D LayoutSpec의 포즈가 권위 원본입니다.`,
          {
            referenceId: reference.id,
            objectId: reference.targetObjectId,
          },
        ),
      );
    }
  }

  for (const occlusion of input.layoutSpec.potentialOcclusions) {
    if (occlusion.farObjectOverlap < SUBJECT_OCCLUSION_WARNING_THRESHOLD)
      continue;
    const farObject = layoutObjects.get(occlusion.farObjectId);
    const nearObject = layoutObjects.get(occlusion.nearObjectId);
    if (farObject?.role !== 'subject' || nearObject === undefined) continue;
    issues.push(
      issue(
        'warning',
        'subject-occlusion',
        `${occlusion.nearObjectId}:${occlusion.farObjectId}`,
        `${nearObject.name}이 주인공 ${farObject.name}의 화면 영역을 ${Math.round(occlusion.farObjectOverlap * 100)}% 가릴 수 있습니다.`,
        { objectId: occlusion.farObjectId },
      ),
    );
  }

  return {
    issues,
    blockers: issues.filter(({ severity }) => severity === 'blocking'),
    warnings: issues.filter(({ severity }) => severity === 'warning'),
  };
}

export function createGenerationPreflightFingerprint(
  input: GenerationPreflightInput,
) {
  return JSON.stringify({
    sceneRevision: input.scene.sceneRevision,
    specRevision: input.scene.specRevision,
    layoutSpec: input.layoutSpec,
    references: input.references,
    includeLayout: input.includeLayout,
    includeSourceKeyframe: input.includeSourceKeyframe,
  });
}
