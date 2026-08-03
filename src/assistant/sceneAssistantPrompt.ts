import type { GenerationRecord, ReferenceArtifact } from './companionClient';
import type { LayoutSpec } from '../../shared/layoutSpecSchema';
import type { SceneDocument } from '../editor/persistence/sceneSchema';
import { normalizeSemanticSceneSpec } from '../editor/persistence/semanticSceneSpec';

const SCENE_ASSISTANT_INSTRUCTIONS = `너는 I2V 3D Scene Helper의 Scene Assistant다.
현재 요청에서는 파일을 수정하거나 명령을 실행하지 말고, 제공된 SceneDocument와 사용자의 설명을 바탕으로 장면을 해석하고 필요한 확인 질문이나 연출 제안을 한국어로 간결하게 답한다.
SceneDocument의 위치, 카메라, 가림 관계는 구도 기준이며 색상만으로 오브젝트의 실제 의미를 단정하지 않는다.
확실하지 않은 의미 정보는 추측을 사실처럼 말하지 말고 사용자에게 확인한다.`;

function referenceManifest(
  references: ReferenceArtifact[],
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
  if (intentLines.length > 0) {
    blocks.push(`[장면 의도]\n${intentLines.join('\n')}`);
  }

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

export function createSceneAssistantPrompt(
  userMessage: string,
  sceneDocument: unknown,
  references: ReferenceArtifact[] = [],
) {
  const referenceBlock = referenceManifest(references, 0);
  const serializedReferences =
    referenceBlock.length === 0
      ? ''
      : `

[선택 레퍼런스 매니페스트 / 첨부 순서]
${JSON.stringify(referenceBlock)}`;

  return `${SCENE_ASSISTANT_INSTRUCTIONS}

[사용자 메시지]
${userMessage}

[현재 SceneDocument]
${JSON.stringify(sceneDocument)}${serializedReferences}`;
}

export function createImageGenerationPrompt(
  sceneDocument: SceneDocument,
  layoutSpec: LayoutSpec,
  references: ReferenceArtifact[] = [],
) {
  const referenceBlock = referenceManifest(references, 1);
  const semanticSpecBlock = serializeSemanticSceneSpecPrompt(
    sceneDocument.semanticSceneSpec,
  );
  const semanticSection =
    semanticSpecBlock === '' ? '' : `\n\n${semanticSpecBlock}`;
  const sceneDocumentWithoutSemanticSpec = Object.fromEntries(
    Object.entries(sceneDocument).filter(
      ([key]) => key !== 'semanticSceneSpec',
    ),
  );
  return `$imagegen
첨부 이미지 1은 현재 OutputCamera의 3D 레이아웃 렌더이며 최종 키프레임의 공간 설계도입니다. LayoutSpec의 정규화 화면 좌표, 점유율, 깊이 순서와 잠재 가림 관계를 최종 이미지에서도 유지하세요.
3D 레이아웃이 권위를 갖는 항목은 카메라, 원근, 크롭, 화면상 배치와 크기, 포즈, 방향, 깊이와 가림입니다. 3D 프록시의 색, 재질과 단순 도형 외형은 최종 외형이 아니며 의미 데이터와 역할별 레퍼런스로 교체하세요.
이어지는 이미지는 아래 매니페스트의 순서와 역할에만 사용하세요. 캐릭터 레퍼런스는 연결된 마네킹의 얼굴, 체형, 헤어와 의상에만 사용하고 포즈와 위치는 3D 레이아웃을 따릅니다. 캐릭터 시트의 글자나 패널 구성은 결과에 포함하지 마세요.
저장된 Semantic Scene Spec은 장소, 시간대, 분위기, 화풍 의도, 생성 전용 소품, 엑스트라, 관계와 제약의 권위 있는 현재 상태입니다. 채팅 기록을 장면 원본으로 사용하지 마세요. 명시적 지시가 없는 한 LayoutSpec의 preserve 항목을 변경하지 말고 한 장의 완성 이미지만 생성하세요. 파일 수정이나 명령 실행은 하지 마세요.
LayoutSpec 각 오브젝트의 semanticMeaning과 generationNotes는 해당 오브젝트에만 권위가 있는 의미 데이터입니다. 장면 전체 spec과 중복 추론하지 말고 일반적인 primitive 이름이나 guideColor보다 우선해 실제 사물로 교체하세요.${semanticSection}

[LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약]
${JSON.stringify(layoutSpec)}

[현재 SceneDocument]
${JSON.stringify(sceneDocumentWithoutSemanticSpec)}

[선택 레퍼런스 매니페스트 / 첨부 순서]
${JSON.stringify(referenceBlock)}`;
}

export function createImageRefinementPrompt(
  feedback: string,
  sceneDocument: unknown,
  layoutSpec: LayoutSpec,
  sourceGeneration: Pick<GenerationRecord, 'id' | 'versionNumber'>,
  references: ReferenceArtifact[] = [],
) {
  const referenceBlock = referenceManifest(references, 2);
  return `$imagegen
첨부 이미지 1은 보정의 기준이 되는 기존 완성 키프레임입니다. 전체 구도, 인물 정체성, 의상, 색감과 이미 완성된 디테일을 우선 보존하고 아래 피드백에 필요한 부분만 다시 생성하세요.
첨부 이미지 2는 현재 OutputCamera의 3D 레이아웃 렌더입니다. LayoutSpec과 함께 카메라, 화면 배치, 크기, 자세, 방향, 깊이 및 가림 관계를 검증하는 공간 설계도로 사용하세요. 3D 프록시의 색과 단순 형상은 최종 외형이 아닙니다.
첨부 이미지 3 이후는 역할별 외형 레퍼런스입니다. 매니페스트의 use 항목만 사용하고 exclude 항목은 가져오지 마세요.
이 요청은 기존 파일을 픽셀 단위로 수정하는 작업이 아니라, 기존 키프레임을 고충실도 입력으로 사용하는 한 번의 완성 이미지 재생성입니다. 요청하지 않은 부분을 임의로 바꾸거나 새로운 요소를 추가하지 마세요. 이미지 한 장만 생성하고 파일 수정이나 명령 실행은 하지 마세요.

[보정 요청]
${feedback}

[보정 원본]
${JSON.stringify(sourceGeneration)}

[LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약]
${JSON.stringify(layoutSpec)}

[현재 SceneDocument]
${JSON.stringify(sceneDocument)}

[선택 레퍼런스 매니페스트 / 첨부 순서]
${JSON.stringify(referenceBlock)}`;
}
