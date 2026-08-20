# 레이아웃 권위와 오브젝트 작업 흐름 개선 계획

> 상태: Proposed — 구현 전 설계 문서
>
> 작성일: 2026-08-20
>
> 대상: 이미지 생성/보정의 3D 레이아웃 권위, 내부 오브젝트와 거울 표현,
> 뷰포트 선택 잠금, 오브젝트 그룹 이동

## 1. 문서 목적

현재 제품은 `SceneDocument`, OutputCamera 렌더, `LayoutSpec`, 선택 레퍼런스와
Companion 대화 의도를 조합해 이미지를 생성한다. 기본 생성에서는 3D 레이아웃이 구도
기준으로 전달되지만, 기존 생성 이미지를 입력에 포함하는 보정 작업과 Companion 대화가
반복될수록 이미지별 역할과 권위가 프롬프트 컴파일 과정에서 재해석될 여지가 있다.

또한 현재 오브젝트 모델은 개별 오브젝트의 변형, 표시 여부, 이미지 생성 의미를 저장하지만
다음 편집 의도를 직접 표현하지 못한다.

- 뷰포트에서는 클릭되지 않되 장면 목록에서는 선택 가능한 오브젝트
- 여러 오브젝트를 하나의 단위로 함께 이동하는 그룹
- 다른 오브젝트 내부에 들어 있는 오브젝트와 내부 가시성
- 편집 확인용 반투명 프록시와 최종 이미지의 실제 투명 재질 사이의 차이
- 거울 표면과 거울에 비쳐야 하는 대상

이 문서는 위 문제를 해결하기 위한 제품 규칙, 데이터 계약, 구현 순서, 마이그레이션과 검증
기준을 고정한다. 이 문서 자체는 구현 완료 기록이 아니며, 실제 작업 시작 시 세션 단위 계획과
handoff를 별도로 작성한다.

## 2. 현재 기준선

### 2.1 이미지 생성 첨부 순서

현재 Companion 서버가 만드는 실제 이미지 입력 순서는 다음과 같다.

신규 생성(`fresh`):

1. 현재 OutputCamera의 3D 레이아웃 렌더
2. 선택한 역할별 레퍼런스

보정 생성(`edit`):

1. 보정 원본 generation 이미지
2. 현재 OutputCamera의 3D 레이아웃 렌더
3. 선택한 역할별 레퍼런스

서버는 레이아웃 렌더를 항상 해석하고 첨부하며, 생성 전 검사도 레이아웃 한 장을 이미지 입력
예산에 예약한다. 따라서 현재 관찰되는 문제는 주로 파일 첨부 누락보다 **프롬프트 내부에서
레이아웃 이미지의 역할 또는 권위가 약해지거나 다른 역할로 재분류되는 현상**으로 본다.

### 2.2 현재 프롬프트 검증의 한계

이미지 프롬프트 컴파일러는 최종 프롬프트에 필요한 섹션이 존재하는지, 모든 `Image N`에
일반적인 역할 설명이 있는지를 검증한다. 그러나 다음 항목은 구조적으로 고정하지 않는다.

- 특정 번호의 이미지가 서버가 지정한 실제 역할과 일치하는지
- 레이아웃 이미지가 카메라와 블로킹에 대한 최상위 권위를 갖는지
- 보정 원본 이미지가 레이아웃 권위를 침범하지 않는지
- 최신 Companion 대화 의도가 레이아웃 유지 계약과 충돌하는지

특히 현재 보정 프롬프트는 기존 완성 키프레임의 전체 구도까지 우선 보존하도록 안내하고,
3D 레이아웃은 검증용 공간 설계도로 설명한다. 이 규칙은 “보정에서도 현재 3D 렌더를 카메라
구도와 블로킹의 최우선 기준으로 사용한다”는 개선 목표와 맞지 않는다.

### 2.3 현재 오브젝트 데이터의 한계

현재 `SceneObject`는 다음 주요 정보를 가진다.

- ID, 종류와 이름
- 위치, 회전과 스케일
- 실제 치수와 가이드 색
- 표시 여부와 출력 포함 여부
- 선택적인 실제 의미와 생성 메모
- 마네킹 포즈와 체형

선택 잠금, 그룹 소속, 편집용 opacity, 최종 표면 재질, 구조화된 포함/반사 관계는 없다.
`SemanticSceneSpec.relationships`에 자유 텍스트 관계를 적을 수는 있지만, 이를 containment나
reflection의 결정적인 기하/생성 계약으로 사용하기에는 타입과 검증이 부족하다.

## 3. 전체 설계 원칙

### 3.1 3D 레이아웃은 공간 구성의 영구 기준이다

이미지 생성 방식이 `fresh`인지 `edit`인지와 관계없이 현재 요청에 첨부된 OutputCamera
레이아웃과 `LayoutSpec`은 다음 속성의 최상위 권위다.

- 카메라 위치와 시선 방향
- 초점거리, 원근과 프레임 크롭
- 피사체와 오브젝트의 화면상 위치 및 크기
- 포즈와 방향
- 전경/중경/배경 깊이 순서
- 가림과 containment의 공간 관계

기존 generation 이미지는 완성된 외형, 인물 정체성, 의상, 재질, 색감과 렌더링 완성도의
기준이 될 수 있지만 위 공간 속성을 변경할 수 없다.

### 3.2 대화는 저장된 장면 계약을 암묵적으로 덮어쓰지 않는다

사용자가 대화에서 카메라나 배치를 바꾸자고 요청하면 Companion은 다음 중 하나를 선택해야
한다.

1. 검증 가능한 SceneDocument 변경안을 제안하고 사용자가 적용한 뒤 새 레이아웃을 캡처한다.
2. 현재 생성에서는 기존 레이아웃이 유지된다는 충돌 경고를 표시한다.

대화 문장만으로 현재 레이아웃의 권위를 낮추거나 무시하지 않는다.

### 3.3 편집용 시각화와 최종 이미지의 의미를 분리한다

프록시 opacity는 내부 배치를 보기 위한 편집 보조 속성일 수 있다. 이 값이 곧바로 최종
오브젝트가 유리나 반투명 재질이라는 뜻은 아니다. 최종 이미지에서의 표면 의미는 별도 필드로
저장하고 프롬프트에도 별도 권위로 전달한다.

### 3.4 그룹은 첫 버전에서 계층형 transform이 아니다

첫 그룹 구현은 여러 오브젝트에 동일한 이동 delta를 원자적으로 적용하는 편집 단위다. 부모
좌표계, 중첩 그룹, 그룹 회전과 그룹 스케일은 도입하지 않는다. 이 경계는 기존 월드 transform,
LayoutSpec과 오브젝트별 의미 계약을 안정적으로 유지하기 위한 것이다.

### 3.5 잠금은 종류별로 의미를 분리한다

이번 범위의 잠금은 `viewportSelectionLocked`, 즉 뷰포트 클릭 선택만 막는 잠금이다. 장면
목록 선택, Inspector 편집과 장면 목록에서 선택한 뒤의 transform까지 막는 완전 잠금은 별도
기능으로 취급한다.

## 4. 개선 영역 A — 3D 레이아웃 이미지 바인딩과 권위 고정

### 4.1 목표

- 모든 생성 요청에 정확히 한 장의 현재 3D 레이아웃이 포함된다.
- 해당 레이아웃은 항상 같은 번호와 같은 역할을 가진다.
- 대화, 보정 원본과 외형 레퍼런스가 레이아웃의 공간 권위를 변경하지 못한다.
- 프롬프트 컴파일러가 잘못된 바인딩을 반환하면 이미지 생성을 시작하지 않는다.
- generation 이력에서 실제 이미지 순서와 권위 판정을 재현할 수 있다.

### 4.2 표준 첨부 순서 변경

앞으로 모든 생성에서 레이아웃을 `Image 1`로 고정한다.

신규 생성:

1. `layout` — 현재 3D 레이아웃
2. 이후 — 역할별 레퍼런스

보정 생성:

1. `layout` — 현재 3D 레이아웃
2. `sourceGeneration` — 보정 원본 이미지
3. 이후 — 역할별 레퍼런스

레이아웃을 항상 첫 번째 입력으로 고정하면 UI, 웹 내보내기, Companion, 프롬프트 컴파일러와
generation 이력에서 동일한 번호를 사용할 수 있다. 이미지 입력 예산은 바뀌지 않는다.

### 4.3 구조화된 첨부 계약

프롬프트 컴파일러에 `filePaths: string[]`만 전달하지 않고, 다음과 같은 서버 생성형 첨부
descriptor를 전달한다.

```ts
type GenerationImageRole =
  | 'layout'
  | 'sourceGeneration'
  | 'backgroundReference'
  | 'characterReference'
  | 'styleReference';

interface GenerationImageDescriptor {
  attachmentIndex: number;
  path: string;
  role: GenerationImageRole;
  artifactId: string;
  authority: string[];
  prohibitedAuthority: string[];
  targetObjectId: string | null;
}
```

클라이언트가 attachment index나 역할을 임의 지정하지 않는다. Companion이 검증된 레이아웃,
원본 generation과 reference manifest를 해석한 뒤 canonical descriptor 배열을 만든다.

### 4.4 권위 매트릭스

| 입력 역할            | 권위가 있는 속성                                              | 권위가 없는 속성                                  |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| 3D layout            | 카메라, 크롭, 배치, 크기, 포즈, 방향, 깊이, 가림, containment | 실제 얼굴, 의상, 재질, 프록시 색과 단순 도형 외형 |
| source generation    | 완성 외형, 정체성, 의상, 재질, 색감, 렌더 디테일              | 카메라, 배치, 크기, 포즈, 깊이와 가림             |
| character reference  | 연결 대상의 얼굴, 체형, 헤어, 의상                            | 포즈, 카메라, 배경, 시트 레이아웃과 텍스트        |
| background reference | 장소 외형, 환경 재질과 배경 디테일                            | OutputCamera와 피사체 블로킹                      |
| style reference      | 화풍, 렌더링 처리와 표면 표현 방식                            | 장면 내용, 카메라와 오브젝트 배치                 |

### 4.5 프롬프트 컴파일러 요청

컴파일러 planning-only 요청에는 다음을 포함한다.

- canonical attachment manifest 전체
- `Image 1 = layout` 불변식
- 역할별 허용 권위와 금지 권위
- LayoutSpec의 preserve/reinterpret 계약
- 보정 원본보다 레이아웃의 공간 권위가 높다는 명시적 우선순위
- 충돌하는 conversation intent는 적용하지 말고 충돌로 보고하라는 규칙

컴파일러 출력 스키마도 단일 `finalPrompt` 문자열보다 구조화된 결과를 권장한다.

```ts
interface CompiledGenerationPrompt {
  finalPrompt: string;
  bindings: Array<{
    attachmentIndex: number;
    role: GenerationImageRole;
    authority: string[];
  }>;
}
```

최종 운영 프롬프트는 여전히 사람이 읽을 수 있는 `Image N` 역할 섹션을 가지되, 검증은
문장 추측이 아니라 `bindings` 데이터와 canonical descriptor의 완전 일치로 수행한다.

### 4.6 fail-closed 검증

다음 중 하나라도 발생하면 이미지 공급자를 호출하지 않는다.

- layout descriptor가 없거나 둘 이상임
- layout의 attachment index가 1이 아님
- 컴파일러 출력 bindings의 개수 또는 순서 불일치
- 컴파일러가 Image 1을 layout이 아닌 역할로 반환함
- layout의 공간 권위 필수 항목 누락
- layout 설명에 ignore, exclude, optional 또는 공간 비권위 표현이 포함됨
- source generation이 카메라/배치/포즈/깊이 권위를 가짐
- reference target이나 실제 attachment hash가 generation snapshot과 불일치

브라우저 사전검사는 빠른 사용자 피드백을 위해 같은 규칙을 실행하고, Companion이 동일
입력을 다시 검증한다.

### 4.7 대화 의도 충돌 처리

generation intent를 다음 범주로 분리한다.

- `appearance`: 외형, 재질, 분위기, 색감
- `semantic`: 실제 사물 의미, 관계와 행동
- `spatial`: 카메라, 위치, 스케일, 포즈, 깊이와 가림

`appearance`와 `semantic`은 현재 생성에 반영할 수 있다. `spatial` 의도가 현재
SceneDocument/LayoutSpec과 다르면 자동 반영하지 않고 다음 상태를 제공한다.

- 변경안 적용 필요
- 현재 레이아웃 유지 후 생성
- 사용자가 요청을 취소하고 3D 장면을 직접 수정

첫 구현에서는 충돌을 자동 해결하지 않고 generation preflight blocker로 처리하는 것이
안전하다.

### 4.8 UI와 실행 이력

Scene Assistant 생성 영역에 다음을 표시한다.

- `Image 1 · 3D 구도 기준 · 고정` 카드
- 보정 시 `Image 2 · 외형 보정 원본` 카드
- 이후 역할별 reference 카드
- 레이아웃과 대화 의도가 충돌할 때 생성 버튼 대신 변경 안내

generation record와 실행 요약에는 다음을 저장한다.

- descriptor snapshot
- descriptor별 asset ID와 hash
- 컴파일러가 반환한 binding
- 적용된 권위 매트릭스 버전
- 레이아웃 권위 충돌 검사 결과

과거 generation은 기존 attachment 목록을 읽되 새 권위 매트릭스로 소급 승격하지 않는다.

### 4.9 완료 기준

1. fresh/edit 모두 Image 1이 현재 3D 레이아웃이다.
2. 여러 번의 Companion 대화 후에도 binding 역할과 공간 권위가 변하지 않는다.
3. 컴파일러가 layout을 style/reference/optional로 바꾸면 공급자 호출 전에 실패한다.
4. edit 결과는 source generation의 외형은 유지할 수 있지만 현재 layout과 다른 카메라나
   블로킹을 유지할 수 없다.
5. 실행 이력에서 실제 첨부 순서와 각 이미지의 권위를 확인할 수 있다.
6. 웹 내보내기도 동일한 순서와 권위 문구를 사용한다.

## 5. 개선 영역 B — 내부 오브젝트, opacity와 거울

### 5.1 opacity만으로 부족한 이유

이미지 생성 모델은 반투명하게 렌더된 프록시를 다음 중 어느 의미로든 해석할 수 있다.

- 최종 물체가 유리임
- 홀로그램 또는 유령 효과임
- 편집용 X-ray 표시임
- 단순 렌더링 오류임

따라서 숫자 opacity만 첨부 이미지에 반영하면 의도가 불안정하다. 최소한 다음 세 정보를
분리해야 한다.

1. 편집자가 내부 배치를 보기 위한 프록시 표시 방식
2. 최종 이미지에서 외부 오브젝트가 가져야 하는 실제 표면 재질
3. 내부 오브젝트가 외부에서 보여야 하는 방식

### 5.2 제안 오브젝트 표면 모델

`SceneObject`에 다음 선택 속성을 추가한다.

```ts
interface ObjectVisualization {
  proxyOpacity: number; // 0.05..1, 편집/레이아웃 확인용
}

type FinalSurfaceType = 'opaque' | 'transparent' | 'translucent' | 'mirror';

interface ObjectAppearanceIntent {
  surfaceType: FinalSurfaceType;
  materialNotes: string;
}
```

기본값은 `proxyOpacity: 1`, `surfaceType: 'opaque'`다. `proxyOpacity`는
`guideColor`처럼 최종 외형에 권위가 없는 프록시 시각화 값으로 LayoutSpec에 기록한다.
`surfaceType`과 `materialNotes`는 최종 생성 결과에 권위가 있는 의미 데이터다.

### 5.3 구조화된 공간 관계

자유 텍스트 관계와 별도로 `SceneDocument.spatialRelations`를 추가한다.

```ts
type SpatialRelation =
  | {
      id: string;
      type: 'contains';
      containerObjectId: string;
      containedObjectId: string;
      visibility:
        | 'occluded'
        | 'through-opening'
        | 'through-transparent-surface'
        | 'cutaway';
    }
  | {
      id: string;
      type: 'reflects';
      mirrorObjectId: string;
      reflectedObjectIds: string[];
    };
```

검증 규칙:

- 모든 참조 ID가 현재 장면에 존재해야 한다.
- 오브젝트가 자기 자신을 포함하거나 반사할 수 없다.
- 같은 방향의 containment 중복을 허용하지 않는다.
- containment cycle을 허용하지 않는다.
- `mirrorObjectId`는 `surfaceType: 'mirror'`여야 한다.
- 첫 버전에서 mirror는 평면으로 취급할 수 있는 `plane`만 허용한다.
- 오브젝트 삭제 시 관련 spatial relation을 원자적으로 제거한다.

### 5.4 내부 오브젝트 편집 UX

Inspector에서 다음을 제공한다.

- 프록시 불투명도 슬라이더
- 최종 표면 유형 선택
- `이 오브젝트가 포함하는 대상` 선택
- 내부 대상 가시성 선택

장면 목록은 containment를 그룹과 혼동하지 않도록 별도 아이콘이나 관계 배지로 표시한다.
containment는 의미/공간 관계이고 함께 이동하는 그룹이 아니다.

내부 배치를 편집할 때 container의 proxy opacity를 낮춰 contained object를 볼 수 있다. 이
표시는 3D 공간 확인용이며, 최종 표면이 opaque이면 프롬프트는 투명 재질로 생성하지 않는다.

### 5.5 LayoutSpec 확장

LayoutSpec에는 다음을 추가한다.

- 오브젝트별 `proxyVisualization.opacity`
- 오브젝트별 `appearanceIntent.surfaceType`과 material notes
- 검증된 containment 목록
- 내부 오브젝트 가시성 모드
- 검증된 reflection 목록
- 거울 표면의 화면 bounds와 방향

현재 LayoutSpec v1 snapshot과 구분하기 위해 LayoutSpec v2로 올리는 것을 권장한다. generation
history는 v1과 v2를 모두 읽되, v1에는 새 관계가 존재한다고 추론하지 않는다.

### 5.6 생성 프롬프트 규칙

- proxy opacity는 편집/X-ray 시각화일 뿐 최종 material opacity가 아니다.
- 최종 투명성은 `surfaceType`과 containment visibility로만 결정한다.
- opaque + occluded 조합에서는 내부 물체를 외부에 노출하지 않는다.
- opaque + through-opening 조합에서는 지정된 입구나 창을 통해서만 보이게 한다.
- transparent + through-transparent-surface 조합에서는 굴절과 표면 반사를 포함해 내부가 보이게
  한다.
- cutaway는 일반적인 완성 장면과 다른 시각화 모드이므로 사용자가 명시적으로 선택한 경우에만
  사용한다.

### 5.7 거울 1차 구현

첫 버전의 거울은 평면 거울만 지원한다.

- plane 오브젝트의 최종 표면을 mirror로 지정
- reflects 관계에서 반사 대상 지정
- 거울의 transform으로 반사 평면 계산
- 뷰포트에는 planar reflection 프리뷰 제공
- OutputCamera layout capture에서도 같은 반사 구도를 확인
- LayoutSpec에는 mirror screen bounds, plane normal과 반사 대상 ID 기록
- 생성 prompt에는 거울 밖 장면과 거울 속 반사상을 중복 실물로 만들지 말라는 금지 규칙 추가

planar reflection은 별도 render pass와 GPU 자원을 사용하므로 다음 수명주기를 검증해야 한다.

- 오브젝트 삭제/표면 변경/unmount 시 render target dispose
- read-only preview 종료 시 반사 자원 해제
- clean/reference export와 depth-of-field pipeline에서 중복 렌더 또는 recursion 방지
- 저사양 환경에서 해상도 제한 또는 프리뷰 비활성화 fallback

곡면 거울, 거울 속 거울, 여러 번의 재귀 반사는 후속 범위다.

### 5.8 완료 기준

1. container opacity를 낮춰 내부 오브젝트를 편집할 수 있다.
2. proxy opacity가 최종 투명 재질로 자동 해석되지 않는다.
3. containment와 내부 가시성 모드가 JSON, snapshot, LayoutSpec과 prompt에 보존된다.
4. opaque/transparent/cutaway 의도가 서로 다른 프롬프트 계약을 만든다.
5. 평면 거울에 지정된 대상이 뷰포트와 생성 계약에서 반사 대상으로 식별된다.
6. 삭제된 오브젝트를 참조하는 containment/reflection이 남지 않는다.

## 6. 개선 영역 C — 뷰포트 선택 잠금

### 6.1 제품 동작

`viewportSelectionLocked`는 다음 의미만 가진다.

- 장면 목록에서는 선택할 수 있다.
- 뷰포트에서 오브젝트 표면을 클릭해도 해당 오브젝트가 선택되지 않는다.
- 잠긴 오브젝트가 앞에 있을 때 뒤쪽의 잠기지 않은 오브젝트를 선택할 수 있어야 한다.
- 장면 목록에서 선택한 잠긴 오브젝트는 Inspector에서 편집할 수 있다.
- 장면 목록에서 선택했다면 transform gizmo도 사용할 수 있다.

향후 완전 transform 잠금이 필요하면 `transformLocked`를 별도로 추가한다. 두 의미를 하나의
`locked` 필드로 합치지 않는다.

### 6.2 데이터와 store 변경

- `SceneObject.viewportSelectionLocked: boolean`
- 기본값 `false`
- `setObjectViewportSelectionLocked(id, locked)` store action
- document mutation kind에 선택 잠금 변경 포함
- undo/redo, dirty 판정, JSON import/export와 generation snapshot에 포함

선택 잠금은 편집 상태가 아니라 장면 authoring 데이터이므로 SceneDocument에 영구 저장한다.
이미지 생성의 시각 결과에는 영향을 주지 않으며 LayoutSpec 오브젝트 포함 여부도 바꾸지 않는다.

### 6.3 아웃라이너 UX

- 각 오브젝트 행에 잠금 토글 버튼 제공
- 행 선택 버튼과 잠금 버튼의 클릭 영역 분리
- 아이콘만으로 의미를 전달하지 않고 접근 가능한 label/title 제공
- 잠긴 오브젝트의 행은 선택 가능 상태를 유지
- 그룹 멤버에도 같은 잠금 표시

### 6.4 뷰포트 이벤트 규칙

현재 SceneObject root의 click handler는 이벤트 전파를 중단한 뒤 선택한다. 잠긴 오브젝트는
전파를 먼저 중단하면 안 된다.

권장 순서:

1. 클릭 대상의 `viewportSelectionLocked` 확인
2. 잠겨 있으면 선택하지 않고 다음 intersection으로 이벤트 전파
3. 잠겨 있지 않으면 기존 selection suppression 검사
4. 이벤트 전파를 중단하고 오브젝트 선택

빈 공간 선택 해제와 transform 종료 직후 selection suppression 동작도 회귀 검증한다.

### 6.5 완료 기준

1. 잠긴 오브젝트를 뷰포트에서 클릭해도 선택되지 않는다.
2. 잠긴 오브젝트 뒤의 잠기지 않은 오브젝트를 클릭할 수 있다.
3. 잠긴 오브젝트를 아웃라이너에서 선택하고 Inspector와 이동 gizmo를 사용할 수 있다.
4. 잠금 변경은 undo/redo와 저장/불러오기 후에도 보존된다.
5. 잠금은 이미지 출력, LayoutSpec과 generation object 목록을 변경하지 않는다.

## 7. 개선 영역 D — 오브젝트 그룹화와 그룹 이동

### 7.1 첫 버전 범위

포함:

- 아웃라이너 다중 선택
- 두 개 이상 오브젝트 그룹화
- 그룹 이름과 멤버 목록 저장
- 그룹 선택과 그룹 단위 XYZ 이동
- 그룹 해제
- 원자적인 undo/redo

제외:

- 그룹 회전과 스케일
- 중첩 그룹
- 그룹별 local coordinate system
- 그룹 자체의 visibility/exportability/material
- 그룹 복제
- 그룹을 이미지 생성의 실물 오브젝트로 취급하는 동작

### 7.2 데이터 모델

그룹을 synthetic SceneObject로 만들지 않고 SceneDocument의 별도 컬렉션으로 저장한다.

```ts
interface SceneObjectGroup {
  id: string;
  name: string;
  memberObjectIds: string[];
}

interface SceneDocument {
  // 기존 필드
  groups: SceneObjectGroup[];
}
```

검증 규칙:

- group ID는 고유해야 한다.
- 한 그룹에 서로 다른 오브젝트가 두 개 이상 있어야 한다.
- 모든 member ID가 장면에 존재해야 한다.
- 첫 버전에서 한 오브젝트는 최대 한 그룹에만 속한다.
- floor 포함 여부는 제품 결정이 필요하지만, 기본적으로 starter floor는 그룹화 대상에서 제외한다.

그룹은 이미지 생성 의미를 갖지 않는다. LayoutSpec은 기존과 같이 개별 오브젝트를 계산하며,
group ID는 실행 재현과 편집 문맥을 위해 선택적으로 기록할 수 있다.

### 7.3 선택 모델

현재 `selectedObjectId` 하나만으로는 그룹 생성과 그룹 선택을 표현할 수 없다. 편집기 transient
상태를 다음과 같이 확장한다.

```ts
type EditorSelection =
  | { kind: 'none' }
  | { kind: 'objects'; objectIds: string[]; primaryObjectId: string }
  | { kind: 'group'; groupId: string };
```

기존 컴포넌트와 테스트에 미치는 영향을 줄이기 위해 전환 기간에는 `selectedObjectId`를 primary
object에서 파생하는 selector를 제공할 수 있다. 최종적으로 selection 원본이 두 군데 존재하지
않도록 한 모델로 수렴한다.

권장 선택 UX:

- 일반 클릭: 단일 선택
- Ctrl/Cmd 클릭: 선택 집합에 추가/제거
- Shift 범위 선택은 아웃라이너에서만 후속 적용 가능
- 그룹 행 클릭: 그룹 선택
- 뷰포트에서 그룹 멤버 클릭: 그룹 선택
- 아웃라이너의 중첩 멤버 행 클릭: 개별 오브젝트 선택

### 7.4 그룹 생성과 해제

그룹 생성:

1. 선택된 object ID를 장면 순서 기준으로 정규화
2. 그룹 불가 대상과 기존 그룹 중복 검사
3. 새 group ID와 기본 이름 생성
4. SceneDocument에 단일 mutation으로 추가
5. 새 그룹을 선택

그룹 해제:

1. group metadata만 제거
2. 멤버 SceneObject와 transform은 그대로 유지
3. 기존 멤버 중 primary object 하나를 선택

`그룹 삭제`라는 표현은 오브젝트 삭제와 혼동되므로 첫 버전 UI는 `그룹 해제`만 제공한다.

### 7.5 그룹 이동 알고리즘

그룹은 별도 transform을 저장하지 않는다. 선택 시 멤버 전체의 월드 AABB 중심을 runtime pivot으로
계산한다.

드래그 시작:

1. 멤버별 initial transform snapshot 저장
2. pivot의 initial position 저장
3. 단일 in-progress group transform 상태 시작

드래그 중:

1. gizmo의 현재 위치에서 initial pivot 위치를 빼 translation delta 계산
2. 각 멤버의 initial position에 같은 delta를 더해 runtime root에 적용
3. document는 아직 변경하지 않음

드래그 완료:

1. 모든 최종 transform을 한 번에 schema 검증
2. 하나의 `commit-group-translation` history entry로 SceneDocument 변경
3. 실패하면 모든 runtime root를 initial transform으로 복원

Escape, unmount, 멤버 삭제나 selection 변경으로 취소되면 모든 멤버를 initial transform으로
복원하고 history를 만들지 않는다.

### 7.6 transform 도구 제한

그룹 선택 시:

- translate만 활성화
- rotate/scale 버튼 비활성화
- E/R shortcut은 동작하지 않고 상태 메시지 표시
- Inspector에는 그룹 중심 위치 또는 이동 delta만 표시
- 개별 멤버의 회전/스케일 값은 변경하지 않음

개별 멤버를 아웃라이너에서 선택하면 기존 오브젝트 transform 도구를 그대로 사용할 수 있다.

### 7.7 다른 기능과의 상호작용

잠금:

- 그룹 멤버가 viewport selection locked여도 아웃라이너에서 그룹 선택과 이동은 가능하다.
- 뷰포트 클릭으로 그룹을 선택할 때 잠긴 멤버는 hit target으로 사용하지 않는다.

삭제:

- 멤버 하나가 삭제되면 group membership에서 제거한다.
- 남은 멤버가 한 개 이하이면 그룹을 자동 해제한다.
- 관련 motion guide, semantic relation과 spatial relation도 기존 삭제 규칙과 함께 정리한다.

복제:

- 첫 버전에서 그룹 선택 중 복제 버튼은 비활성화한다.
- 개별 멤버 복제본은 기존 그룹에 자동 포함하지 않는다.

generation snapshot:

- groups metadata는 SceneDocument snapshot에 보존한다.
- LayoutSpec의 공간 계산은 이동이 반영된 개별 object transform을 사용한다.
- 그룹 자체를 생성할 실물 오브젝트로 prompt에 전달하지 않는다.

### 7.8 완료 기준

1. 두 개 이상 오브젝트를 선택해 그룹화하고 저장/복원할 수 있다.
2. 그룹 이동은 모든 멤버에 동일한 월드 delta를 적용한다.
3. 그룹 이동 한 번은 undo 한 번으로 전체 복원된다.
4. 드래그 취소와 검증 실패 시 부분적으로 이동된 멤버가 남지 않는다.
5. 그룹 선택 상태에서는 회전과 스케일을 사용할 수 없다.
6. 그룹 해제 후 멤버 위치와 개별 의미 데이터가 그대로 유지된다.
7. 그룹 이동 후 LayoutSpec은 변경된 개별 오브젝트 위치를 정확히 반영한다.

## 8. 스키마 버전과 마이그레이션

### 8.1 SceneDocument v4

다음 필드를 한 번에 도입한다면 `SCENE_DOCUMENT_VERSION`을 4로 올린다.

- `SceneObject.viewportSelectionLocked`
- `SceneObject.visualization`
- `SceneObject.appearanceIntent`
- `SceneDocument.groups`
- `SceneDocument.spatialRelations`

v1~v3 마이그레이션 기본값:

```ts
{
  viewportSelectionLocked: false,
  visualization: { proxyOpacity: 1 },
  appearanceIntent: {
    surfaceType: 'opaque',
    materialNotes: '',
  },
  groups: [],
  spatialRelations: [],
}
```

마이그레이션은 입력 객체를 직접 수정하지 않고 새 객체를 만들며, 마이그레이션 후 v4 schema를
통과한 경우에만 현재 문서를 교체한다.

### 8.2 LayoutSpec v2

LayoutSpec v2는 다음을 추가한다.

- proxy visualization과 final surface의 분리
- containment/reflection
- 선택적인 group provenance
- 권위 매트릭스 버전

generation record는 v1/v2 union으로 읽는다. v1 기록에는 새 필드를 추정해서 채우지 않고
`지원되지 않는 과거 근거`로 표시한다.

### 8.3 generation attachment contract 버전

첨부 순서가 edit에서 `source → layout`에서 `layout → source`로 바뀌므로 실행 요약에 attachment
contract version을 저장한다.

- version 1: 기존 순서
- version 2: layout이 항상 Image 1

과거 기록의 표시와 hash 검증은 저장 당시 version을 사용한다.

## 9. 구현 단계

### 단계 1 — 생성 attachment contract v2

- canonical descriptor와 권위 매트릭스 정의
- fresh/edit 순서 통일
- 브라우저/Companion preflight 이중 검증
- 컴파일러 구조화 binding 출력과 fail-closed 검증
- 웹 내보내기와 generation 실행 요약 동기화
- 대화 spatial intent 충돌 차단

이 단계는 다른 오브젝트 기능과 독립적이며 가장 먼저 완료한다.

### 단계 2 — SceneDocument v4 기반

- schema와 codec migration
- 새 필드 기본값
- 삭제/복제/스냅샷 적용/undo/redo 무결성
- 아직 UI가 없는 필드는 기본값만 유지

### 단계 3 — 뷰포트 선택 잠금

- Outliner 잠금 토글
- viewport hit propagation
- Inspector/transform 접근성 유지
- unit 및 Playwright 선택 회귀 테스트

### 단계 4 — 다중 선택과 그룹 이동

- selection 모델 전환
- groups schema/store actions
- Outliner 계층 UI
- runtime group pivot과 translate-only controls
- 원자 commit/cancel/delete 동작

### 단계 5 — containment와 proxy opacity

- visualization/appearance Inspector
- spatial relation authoring
- 순환/누락 참조 검증
- LayoutSpec v2 projection과 prompt evidence
- opaque/transparent/cutaway 시나리오

### 단계 6 — 평면 거울

- mirror surface 제한과 reflects 관계
- planar reflection preview와 export
- LayoutSpec reflection evidence
- GPU 수명주기와 성능 fallback

## 10. 예상 변경 영역

### 장면 데이터와 상태

- `src/editor/constants.ts`
- `src/editor/persistence/sceneSchema.ts`
- `src/editor/persistence/sceneCodec.ts`
- `src/editor/state/editorStore.ts`
- `src/editor/types.ts`

### 편집 UI와 뷰포트

- `src/editor/components/Outliner.tsx`
- `src/editor/components/Inspector.tsx`
- `src/editor/components/TopToolbar.tsx`
- `src/editor/components/EditorShortcuts.tsx`
- `src/editor/scene/SceneViewport.tsx`
- `src/editor/scene/SceneObject.tsx`
- `src/editor/scene/SelectionTransformControls.tsx`
- 신규 group transform/pivot 컴포넌트
- 신규 planar mirror 컴포넌트와 resource lifecycle 모듈

### LayoutSpec과 이미지 생성

- `shared/layoutSpecSchema.ts`
- `shared/generationPreflight.ts`
- `shared/generationPromptEvidence.ts`
- `shared/generationExecutionSummary.ts`
- `src/assistant/layoutSpec.ts`
- `src/assistant/sceneAssistantPrompt.ts`
- `src/assistant/SceneAssistantPanel.tsx`
- `src/assistant/WebPromptExportDialog.tsx`
- `companion/imagegenSkillPromptCompiler.ts`
- `companion/server.ts`
- generation store의 attachment snapshot/요약 처리

## 11. 테스트 계획

### 11.1 단위 테스트 — 생성 권위

- fresh/edit canonical attachment 순서
- Image 1 layout 누락/중복/역할 변경 차단
- source generation의 공간 권위 침범 차단
- conversation spatial intent 충돌 차단
- reference manifest attachment offset 변경
- 실행 요약 contract version별 복원
- legacy generation 순서 보존

### 11.2 단위 테스트 — SceneDocument

- v1/v2/v3 → v4 migration
- 새 필드 JSON 왕복
- invalid group member와 중복 membership 차단
- containment cycle 차단
- dangling containment/reflection 차단
- mirror가 아닌 오브젝트의 reflects 관계 차단
- 오브젝트 삭제 시 그룹과 관계 정리

### 11.3 컴포넌트 테스트

- 잠금 토글 접근성 및 history 기록
- 잠긴 오브젝트의 Outliner 선택
- 다중 선택과 그룹화/해제
- 그룹 선택 중 rotate/scale 비활성화
- proxy opacity와 final surface가 서로 독립적으로 편집됨
- containment 대상/가시성 UI

### 11.4 뷰포트 및 E2E

- 잠긴 전경 오브젝트를 통과해 뒤쪽 오브젝트 선택
- 그룹 translate가 모든 멤버에 동일 delta 적용
- 그룹 drag cancel과 undo/redo
- 저장/새로고침 후 그룹과 잠금 복원
- 그룹 이동 후 layout capture와 LayoutSpec 정합성
- 내부 오브젝트가 proxy opacity 상태에서 편집 가능
- mirror preview/export의 실제 반사 방향
- mirror 생성/삭제 반복 후 WebGL resource 상한
- edit 생성 UI에서 layout이 항상 첫 번째 고정 첨부로 표시됨

### 11.5 최종 게이트

각 단계는 다음을 통과해야 한다.

```text
npm run typecheck
npm run lint
npm test -- --run
npm run test:e2e:preview -- --workers=1
npm run build
```

실제 imagegen 사용량을 소비하는 검증은 자동 테스트와 분리한다. 자동 테스트에서는 prompt,
descriptor, provider 호출 인자와 failure boundary를 검증하고, 최종 수동 검증에서 동일 장면의
fresh/edit 결과를 비교한다.

## 12. 수동 검증 시나리오

### 시나리오 A — 반복 대화 후 구도 유지

1. 3D 장면과 OutputCamera 구성
2. 이미지 생성
3. Companion과 외형/재질 수정 대화를 세 번 이상 진행
4. 원본 generation을 기준으로 edit 생성
5. generation 실행 요약에서 Image 1 layout과 권위 확인
6. 첫 결과와 보정 결과의 카메라, 크롭, 배치, 포즈와 깊이 비교

기대 결과: 외형은 바뀔 수 있지만 LayoutSpec preserve 항목은 바뀌지 않는다.

### 시나리오 B — 공간 변경 대화 충돌

1. 현재 layout을 캡처한 상태에서 “카메라를 더 낮추고 인물을 오른쪽으로 옮겨 달라”고 대화
2. 바로 생성 시도

기대 결과: 대화만으로 생성하지 않고 SceneDocument 변경 또는 현재 layout 유지 선택을
요구한다.

### 시나리오 C — 내부 오브젝트

1. 큰 container와 작은 contained object 생성
2. proxy opacity를 낮춰 내부 위치 조정
3. `opaque + through-opening`, `transparent + through-transparent-surface`, `cutaway`를 각각 생성

기대 결과: 같은 3D 배치를 유지하면서 최종 가시성 의미가 서로 다르게 전달된다.

### 시나리오 D — 거울

1. plane을 mirror로 지정
2. 카메라에는 직접 보이지 않지만 거울에는 보여야 하는 마네킹을 reflected target으로 지정
3. 뷰포트, layout render와 생성 결과 비교

기대 결과: 거울 속 대상이 별도의 실물 복제처럼 장면에 추가되지 않고 반사상으로 표현된다.

### 시나리오 E — 잠금과 그룹

1. 전경 오브젝트를 viewport selection lock
2. 뒤쪽 오브젝트를 뷰포트에서 선택
3. 잠긴 오브젝트를 Outliner에서 선택해 이동
4. 여러 오브젝트를 그룹화해 이동 후 undo

기대 결과: 선택 잠금과 transform 가능 여부가 분리되고 그룹 이동 전체가 한 번에 복원된다.

## 13. 위험과 대응

### 이미지 모델이 여전히 레이아웃을 완벽히 따르지 않을 수 있음

구조화 binding과 fail-closed 검증은 입력 계약의 드리프트를 차단하지만 생성 모델의 확률적
오차까지 제거하지는 못한다. LayoutSpec과 결과의 화면 bounds를 비교하는 사후 평가 기능은
별도 후속 개선으로 둔다.

### edit 순서 변경이 과거 generation 표시와 충돌할 수 있음

attachment contract version을 저장하고 과거 기록을 당시 순서로 표시한다. 기존 manifest를 새
순서로 재작성하지 않는다.

### selection 모델 변경의 회귀 범위가 큼

다중 선택을 바로 모든 컴포넌트에 노출하지 않고 primary object selector를 통한 호환 계층을
먼저 둔다. 단일 선택 테스트를 유지하면서 그룹 vertical slice를 추가한다.

### opacity가 layout 이미지에서 최종 투명 재질로 오해될 수 있음

프록시 시각화와 final surface를 구조적으로 분리하고, prompt에 opacity의 비권위 상태를
명시한다. 필요하면 generation layout capture에서 proxy opacity 대신 비재질 X-ray/wireframe
표현을 사용하는 후속 옵션을 검토한다.

### planar reflection 비용

반사 render target 해상도를 제한하고 편집 프리뷰 품질과 최종 export 품질을 분리한다. 재귀
반사를 금지하고 read-only preview 및 unmount 자원 해제를 자동 검증한다.

## 14. 구현 전 고정할 제품 결정

현재 문서는 다음 기본 결정을 제안한다.

1. 보정에서도 현재 3D layout이 기존 generation보다 공간 권위가 높다.
2. layout은 fresh/edit 모두 항상 Image 1이다.
3. selection lock은 뷰포트 클릭만 막고 transform은 막지 않는다.
4. 그룹은 translate-only이며 한 오브젝트는 한 그룹에만 속한다.
5. 그룹 해제는 오브젝트를 삭제하지 않는다.
6. proxy opacity와 final surface는 서로 다른 데이터다.
7. containment와 reflection은 자유 텍스트가 아니라 typed spatial relation이다.
8. 첫 mirror 구현은 평면 거울만 지원한다.

실제 구현을 시작하기 전에 위 결정이 제품 의도와 맞는지 확인한다. 하나라도 변경되면 schema,
UI와 테스트 범위가 달라질 수 있다.

## 15. 전체 완료 정의

다음 조건을 모두 만족하면 이 개선 묶음을 완료한 것으로 본다.

1. 대화와 edit 횟수에 관계없이 3D layout의 첨부와 공간 권위가 보존된다.
2. 잘못된 이미지 binding은 공급자 호출 전에 브라우저와 Companion에서 차단된다.
3. 내부 오브젝트의 배치, 최종 가시성과 표면 재질을 서로 독립적으로 표현할 수 있다.
4. 평면 거울과 반사 대상을 구조적으로 지정하고 저장·복원할 수 있다.
5. 오브젝트를 뷰포트 선택에서 잠그되 Outliner에서 계속 편집할 수 있다.
6. 여러 오브젝트를 그룹화하고 translate-only로 원자 이동·취소·undo할 수 있다.
7. SceneDocument v4, LayoutSpec v2와 attachment contract v2가 legacy 데이터를 손상하지 않는다.
8. generation snapshot, 실행 요약과 웹 내보내기가 같은 권위 및 첨부 순서를 사용한다.
9. 관련 unit/component/E2E와 production build가 모두 통과한다.
