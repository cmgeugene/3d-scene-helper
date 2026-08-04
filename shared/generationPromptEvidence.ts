import type { LayoutSpec } from './layoutSpecSchema';
import type { SceneDocument } from '../src/editor/persistence/sceneSchema';
import { normalizeSemanticSceneSpec } from '../src/editor/persistence/semanticSceneSpec';

export interface PromptReference {
  id: string;
  name: string;
  kind: 'layout' | 'background' | 'character' | 'style';
  createdAt: string;
  targetObjectId: string | null;
  use: string[];
  exclude: string[];
}

export function referencePromptManifest(
  references: PromptReference[],
  attachmentIndexOffset: number,
) {
  return [...references]
    .sort((left, right) => {
      const order = { layout: 0, background: 1, character: 2, style: 3 };
      const kindDifference = order[left.kind] - order[right.kind];
      return kindDifference === 0
        ? left.createdAt.localeCompare(right.createdAt)
        : kindDifference;
    })
    .map((reference, index) => ({
      attachmentIndex: index + 1 + attachmentIndexOffset,
      id: reference.id,
      name: reference.name,
      role: reference.kind,
      targetObjectId: reference.targetObjectId,
      use: reference.use,
      exclude: reference.exclude,
    }));
}

export function serializeSemanticSceneSpecPrompt(
  spec: SceneDocument['semanticSceneSpec'],
) {
  const normalized = normalizeSemanticSceneSpec(spec);
  const blocks: string[] = [];
  const intentLines = [
    ['장소', normalized.intent.location],
    ['시간대', normalized.intent.timeOfDay],
    ['분위기', normalized.intent.mood],
    ['화풍 의도', normalized.intent.visualStyle],
  ]
    .filter((entry): entry is [string, string] => entry[1] !== '')
    .map(([label, value]) => `- ${label}: ${value}`);
  if (intentLines.length > 0)
    blocks.push(`[장면 의도]\n${intentLines.join('\n')}`);

  if (normalized.generatedProps.length > 0) {
    blocks.push(
      `[생성 전용 소품]\n${normalized.generatedProps
        .map(({ name, placement, importance }) =>
          [
            `- ${name}`,
            placement === '' ? '' : `배치: ${placement}`,
            importance === '' ? '' : `중요도: ${importance}`,
          ]
            .filter(Boolean)
            .join(' · '),
        )
        .join('\n')}`,
    );
  }

  if (normalized.extras.enabled) {
    const count =
      normalized.extras.minCount === normalized.extras.maxCount
        ? `${normalized.extras.minCount}명`
        : `${normalized.extras.minCount}~${normalized.extras.maxCount}명`;
    const lines = [
      `- 인원: ${count}`,
      normalized.extras.placement === ''
        ? ''
        : `- 배치: ${normalized.extras.placement}`,
      normalized.extras.importance === ''
        ? ''
        : `- 중요도: ${normalized.extras.importance}`,
    ].filter(Boolean);
    blocks.push(`[엑스트라]\n${lines.join('\n')}`);
  }

  if (normalized.relationships.length > 0) {
    blocks.push(
      `[인물/오브젝트 관계]\n${normalized.relationships
        .map(
          ({ subjectObjectId, targetObjectId, relationship, gaze, action }) =>
            [
              `- ${subjectObjectId} → ${targetObjectId}`,
              relationship === '' ? '' : `관계: ${relationship}`,
              gaze === '' ? '' : `시선: ${gaze}`,
              action === '' ? '' : `행동: ${action}`,
            ]
              .filter(Boolean)
              .join(' · '),
        )
        .join('\n')}`,
    );
  }

  if (normalized.constraints.preserve.length > 0) {
    blocks.push(
      `[필수 유지]\n${normalized.constraints.preserve
        .map((value) => `- ${value}`)
        .join('\n')}`,
    );
  }
  if (normalized.constraints.allowChanges.length > 0) {
    blocks.push(
      `[변경 가능]\n${normalized.constraints.allowChanges
        .map((value) => `- ${value}`)
        .join('\n')}`,
    );
  }

  return blocks.join('\n\n');
}

export function generationPromptEvidence(
  sceneDocument: SceneDocument,
  layoutSpec: LayoutSpec,
  mode: 'fresh' | 'edit',
  references: PromptReference[] = [],
) {
  const sceneInput =
    mode === 'edit'
      ? sceneDocument
      : Object.fromEntries(
          Object.entries(sceneDocument).filter(
            ([key]) => key !== 'semanticSceneSpec',
          ),
        );
  const semantic = serializeSemanticSceneSpecPrompt(
    sceneDocument.semanticSceneSpec,
  );
  return {
    layoutSpec: `[LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약]\n${JSON.stringify(layoutSpec)}`,
    sceneDocument: `[현재 SceneDocument]\n${JSON.stringify(sceneInput)}`,
    semanticSceneSpec: mode === 'edit' || semantic === '' ? null : semantic,
    references: `[선택 레퍼런스 매니페스트 / 첨부 순서]\n${JSON.stringify(
      referencePromptManifest(references, mode === 'edit' ? 2 : 1),
    )}`,
  };
}
