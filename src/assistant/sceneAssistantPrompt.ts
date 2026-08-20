import type { GenerationRecord, ReferenceArtifact } from './companionClient';
import type { LayoutSpec } from '../../shared/layoutSpecSchema';
import type { SceneDocument } from '../editor/persistence/sceneSchema';
import type { RefinementDirective } from '../../shared/refinementDirective';
import {
  referencePromptManifest,
  serializeSemanticSceneSpecPrompt,
} from '../../shared/generationPromptEvidence';

const SCENE_ASSISTANT_INSTRUCTIONS = `너는 I2V 3D Scene Helper의 Scene Assistant다.
현재 요청에서는 파일을 수정하거나 명령을 실행하지 말고, 제공된 현재 3D 레이아웃 렌더, LayoutSpec, SceneDocument와 사용자의 설명을 바탕으로 장면을 해석하고 필요한 확인 질문이나 연출 제안을 한국어로 간결하게 답한다.
SceneDocument의 위치, 카메라, 가림 관계는 구도 기준이며 색상만으로 오브젝트의 실제 의미를 단정하지 않는다.
SceneDocument의 transform.rotationDeg는 월드 좌표의 실제 회전이다. 화면에서 보이는 방향이나 카메라 기준 회전으로 바꿔 해석하거나, 대각선으로 보인다는 이유만으로 월드 Y 회전이 잘못됐다고 단정하지 않는다.
마네킹 방향을 말할 때는 월드 진행 방향(worldDirection), 카메라 상대 시점(cameraAzimuthFromForwardDeg와 viewClassification), 화면 투영 방향(screenDirection과 screenDirectionLabel)을 구분한다. cameraAzimuthFromForwardDeg의 양수는 카메라가 마네킹의 왼쪽, 음수는 오른쪽에 있다는 뜻이다. screenDirection은 x가 오른쪽, y가 아래쪽인 출력 화면 좌표이며 ↙는 down-left다.
화면상 방향 질문에는 LayoutSpec의 파생 방향값과 현재 3D 레이아웃 렌더를 우선 확인하고, 사용자가 월드 회전을 바꾸라고 명시하지 않았다면 오브젝트 transform과 카메라 중 무엇을 바꿀지 임의로 결론내리지 않는다.
첨부 레퍼런스를 답변에서 지칭할 때는 이미지 번호를 사용하지 말고 매니페스트의 name, id와 role을 사용한다. attachmentIndex는 현재 대화에서만 유효하며 이후 이미지 생성의 첨부 번호가 아니다.
확실하지 않은 의미 정보는 추측을 사실처럼 말하지 말고 사용자에게 확인한다.`;

const OBJECT_SURFACE_INSTRUCTIONS = `LayoutSpec v2의 proxyVisualization.opacity는 내부 배치를 확인하기 위한 3D 편집 표시값일 뿐 최종 재질의 투명도를 뜻하지 않습니다. 최종 표면은 appearanceIntent.surfaceType과 materialNotes만 따르세요.
containment는 실제 포함 관계와 내부 오브젝트의 최종 가시성 계약입니다. occluded는 외부에서 숨기고, through-opening은 열린 부분으로, through-transparent-surface는 실제 투명 표면을 통해, cutaway는 의도적인 단면/컷어웨이로 표현하세요.
mirrors의 screenBounds와 world plane 방향 안에 reflectedObjectIds의 반사상을 표현하세요. 반사상은 거울 표면 내부에만 존재하며 장면 밖에 동일한 실물 오브젝트를 추가하거나 거울 속 오브젝트를 별도 인물·소품으로 복제하지 마세요.`;

function referenceManifest(
  references: ReferenceArtifact[],
  attachmentIndexOffset: number,
) {
  return referencePromptManifest(references, attachmentIndexOffset);
}

export { serializeSemanticSceneSpecPrompt };

export interface SceneAssistantLayoutContext {
  layoutSpec: LayoutSpec;
  layoutRenderAttached: boolean;
}

export function createSceneAssistantPrompt(
  userMessage: string,
  sceneDocument: unknown,
  references: ReferenceArtifact[] = [],
  layoutContext: SceneAssistantLayoutContext | null = null,
) {
  const referenceBlock = referenceManifest(
    references,
    layoutContext?.layoutRenderAttached === true ? 1 : 0,
  );
  const layoutBlock =
    layoutContext === null
      ? ''
      : `

[현재 3D 레이아웃 렌더]
${
  layoutContext.layoutRenderAttached
    ? '첨부 이미지 1은 이 SceneDocument와 같은 시점의 현재 OutputCamera 3D 렌더다. 화면 구도와 보이는 방향을 판단하는 시각 증거로 사용한다.'
    : '렌더 이미지는 이번 대화에 첨부되지 않았다. 아래 LayoutSpec의 파생값과 SceneDocument를 사용하고 보이지 않는 시각 정보를 추측하지 않는다.'
}

[LayoutSpec / 현재 카메라 기준 파생 구도]
${JSON.stringify(layoutContext.layoutSpec)}`;
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
${JSON.stringify(sceneDocument)}${layoutBlock}${serializedReferences}`;
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
${OBJECT_SURFACE_INSTRUCTIONS}

[LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약]
${JSON.stringify(layoutSpec)}

[현재 SceneDocument]
${JSON.stringify(sceneDocumentWithoutSemanticSpec)}

[선택 레퍼런스 매니페스트 / 첨부 순서]
${JSON.stringify(referenceBlock)}`;
}

function createWebImagePrompt(codexPrompt: string, manualInstruction?: string) {
  const promptWithoutSkillCommand = codexPrompt.replace(/^\$imagegen\n/, '');
  const normalizedInstruction = manualInstruction?.trim() ?? '';
  const instructionSection =
    normalizedInstruction === ''
      ? ''
      : `[이번 수동 생성 요청]\n${normalizedInstruction}\n\n`;

  return `아래 첨부 이미지와 지시를 사용해 한 장의 완성 이미지를 생성하세요. 첨부 순서는 프롬프트에 적힌 번호와 일치해야 합니다.\n\n${instructionSection}${promptWithoutSkillCommand}`;
}

export function createWebImageGenerationPrompt(
  sceneDocument: SceneDocument,
  layoutSpec: LayoutSpec,
  references: ReferenceArtifact[] = [],
  manualInstruction = '',
) {
  return createWebImagePrompt(
    createImageGenerationPrompt(sceneDocument, layoutSpec, references),
    manualInstruction,
  );
}

export function createImageRefinementPrompt(
  directive: RefinementDirective,
  sceneDocument: unknown,
  layoutSpec: LayoutSpec,
  sourceGeneration: Pick<GenerationRecord, 'id' | 'versionNumber'>,
  references: ReferenceArtifact[] = [],
) {
  const referenceBlock = referenceManifest(references, 2);
  return `$imagegen
첨부 이미지 1은 현재 OutputCamera의 3D 레이아웃 렌더이며 이 보정에서도 최종 키프레임의 최상위 공간 설계도입니다. LayoutSpec과 함께 카메라, 원근, 크롭, 화면 배치, 크기, 자세, 방향, 깊이 및 가림 관계를 결정하며 다른 첨부 이미지나 대화 의도가 이 공간 계약을 덮어쓸 수 없습니다. 3D 프록시의 색과 단순 형상은 최종 외형이 아닙니다.
첨부 이미지 2는 보정의 기준이 되는 기존 완성 키프레임입니다. 인물 정체성, 의상, 재질, 색감과 이미 완성된 디테일의 외형 기준으로 사용하되, 카메라, 크롭, 배치, 크기, 포즈, 방향, 깊이와 가림은 첨부 이미지 1과 LayoutSpec을 따르세요.
첨부 이미지 3 이후는 역할별 외형 레퍼런스입니다. 매니페스트의 use 항목만 사용하고 exclude 항목은 가져오지 마세요.
이 요청은 기존 파일을 픽셀 단위로 수정하는 작업이 아니라, 기존 키프레임을 고충실도 입력으로 사용하는 한 번의 완성 이미지 재생성입니다. 요청하지 않은 부분을 임의로 바꾸거나 새로운 요소를 추가하지 마세요. 이미지 한 장만 생성하고 파일 수정이나 명령 실행은 하지 마세요.
${OBJECT_SURFACE_INSTRUCTIONS}

[보정 지시 / RefinementDirective]
${JSON.stringify(directive)}

[보정 권위 규칙]
preserve 항목 중 외형 속성은 기존 완성 키프레임을 권위 원본으로 삼아 바꾸지 마세요. change 항목만 다시 생성하고, 두 목록에 없는 외형 요소도 기존 키프레임을 우선 보존하세요. 카메라, 크롭, 배치, 크기, 포즈, 방향, 깊이와 가림에 대해서는 preserve/change 문구와 관계없이 현재 3D 레이아웃과 LayoutSpec이 항상 최상위 권위입니다.

[보정 원본]
${JSON.stringify(sourceGeneration)}

[LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약]
${JSON.stringify(layoutSpec)}

[현재 SceneDocument]
${JSON.stringify(sceneDocument)}

[선택 레퍼런스 매니페스트 / 첨부 순서]
${JSON.stringify(referenceBlock)}`;
}

export function createWebImageRefinementPrompt(
  directive: RefinementDirective,
  sceneDocument: unknown,
  layoutSpec: LayoutSpec,
  sourceGeneration: Pick<GenerationRecord, 'id' | 'versionNumber'>,
  references: ReferenceArtifact[] = [],
) {
  return createWebImagePrompt(
    createImageRefinementPrompt(
      directive,
      sceneDocument,
      layoutSpec,
      sourceGeneration,
      references,
    ),
  );
}
