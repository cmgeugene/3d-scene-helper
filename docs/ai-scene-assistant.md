# AI Scene Assistant 및 이미지 생성 워크플로 설계안

> 상태: 단계적 구현 중 — S35 브라우저 배포 실행기와 패키징 결정까지 구현. 최신 구현 순서와 완료 기준은
> `roadmap.md`를 따른다.
> 대상: I2V 3D Scene Helper의 로컬 Codex 연동, 레퍼런스 관리, 대화형 장면 해석 및 이미지 생성

## 1. 결정 요약

I2V 3D Scene Helper를 단순한 3D 구도 제작 도구에서 다음 역할을 수행하는 **대화형 씬 디렉팅 도구**로 확장한다.

> 사용자가 3D로 구도를 잡으면 AI가 장면의 의미를 대화로 확인하고, 이미지 생성 모델이 이해할 수 있는 구조화된 장면 명세와 프롬프트로 변환한 뒤 레퍼런스 이미지와 함께 결과 이미지를 생성한다.

확장 기능의 핵심 구성은 다음과 같다.

```text
3D Scene Editor
+ Reference Manager
+ Conversational Scene Assistant
+ Semantic Scene Spec
+ Browser UI and Local Companion
+ Codex App Server and Built-in Imagegen
+ Image Generation and Revision History
```

각 계층의 책임은 명확히 분리한다.

- 3D 씬은 위치, 방향, 크기, 카메라와 가림 관계를 담당한다.
- 레퍼런스는 인물 외형, 배경, 소품과 화풍을 담당한다.
- 사용자와의 대화는 오브젝트의 의미와 연출 의도를 담당한다.
- Scene Spec은 세 정보를 합치는 단일 의미 명세다.
- 최종 프롬프트는 저장 원본이 아니라 Scene Spec에서 생성되는 파생 결과다.
- 브라우저는 편집 UI와 현재 화면에 필요한 가벼운 상태만 담당한다.
- Local Companion은 Codex App Server 프로세스, 프로젝트 파일과 바이너리 에셋을 담당한다.
- Codex thread는 대화 연속성을 담당하지만 프로젝트 데이터의 진실의 원천은 아니다.
- 프로젝트 파일은 브라우저나 Codex thread가 종료되어도 복원 가능한 영구 원본이다.

## 2. 배경과 문제 정의

3D 레이아웃 렌더만으로는 이미지 생성 AI가 기하 구조는 대략 파악할 수 있어도 다음 의미를 안정적으로 추론하기 어렵다.

- 노란 직육면체가 전봇대인지 벽인지
- 프록시의 색상이 최종 색상인지 식별용 가이드인지
- 빨간 마네킹과 파란 마네킹이 각각 어느 캐릭터인지
- 캐릭터 시트에서 얼굴, 체형, 의상, 포즈 중 무엇을 참고해야 하는지
- 초록 원형 오브젝트가 어떤 재질과 용도의 테이블인지
- 어떤 물체가 렌즈 가까이에서 아웃포커스될 전경 차폐물인지
- 배경에 생성할 손님과 테이블 위에 추가할 음식이 무엇인지
- 구도, 배경 구조, 인물 외형과 화풍 중 어떤 지시가 우선하는지

반대로 사용자에게 매번 장면 전체를 긴 자연어로 설명하게 하면 3D 씬을 만든 이점이 사라진다. 따라서 AI가 먼저 씬을 분석하고, 자동으로 알 수 없는 의미만 사용자에게 짧게 질문하는 흐름을 사용한다.

## 3. 목표 사용자 흐름

### 3.1 3D 씬 구성

사용자가 마네킹, 카메라, 테이블과 전경 차폐물을 배치한다. 3D 편집기는 기존과 마찬가지로 구도와 공간 관계를 정확히 표현한다.

### 3.2 AI의 초안 해석

AI는 3D Scene Graph와 현재 출력 카메라 렌더를 함께 확인하고 화면상 관계를 요약한다.

```text
현재 장면을 이렇게 이해했어요.

- 파란 마네킹: 왼쪽 인물, 오른쪽을 바라봄
- 빨간 마네킹: 오른쪽 인물, 왼쪽을 바라봄
- 초록 원형 물체: 두 사람 사이의 테이블
- 노란 물체: 화면 왼쪽 약 30%를 가리는 전경 오브젝트

노란 물체가 실제 장면에서 무엇인지 확인이 필요해요.
```

### 3.3 사용자의 의미 보충

사용자는 기하를 다시 설명하지 않고 의미만 답한다.

```text
노란색은 낡은 콘크리트 전봇대야.
실제 색은 회갈색이고 강하게 아웃포커스해 줘.
```

대화 결과는 채팅 기록에만 남기지 않고 Scene Spec 변경으로 변환한다.

```json
{
  "objectId": "foreground_01",
  "role": "foreground_occluder",
  "type": "concrete_utility_pole",
  "appearance": "old gray-brown concrete",
  "focus": "strong_blur",
  "guideColorOnly": true
}
```

### 3.4 레퍼런스 연결

사용자는 이미지를 마네킹이나 환경에 드래그하거나 대화로 연결한다.

```text
파란 마네킹은 정민이고 이미지 4를 참고해.
빨간 마네킹은 강한나고 이미지 3을 참고해.
포즈는 캐릭터 시트가 아니라 3D 씬을 따라.
```

AI는 해석한 매핑을 적용 전에 명시적으로 보여준다.

```text
- blue_mannequin -> 정민 -> 이미지 4
- red_mannequin -> 강한나 -> 이미지 3
- 캐릭터 시트 사용 범위 -> 얼굴, 체형, 헤어, 의상
- 포즈 기준 -> 3D 레이아웃
```

### 3.5 연출 요소 추가

3D로 직접 모델링할 가치가 낮은 생성 전용 요소는 대화로 추가한다.

```text
테이블 위에는 치킨, 치킨무와 맥주를 올려줘.
배경 테이블에는 손님 5~8명이 있었으면 좋겠어.
```

### 3.6 충돌 검사와 확인

AI는 생성 전에 구도나 주인공 가독성을 해칠 가능성이 있는 지시를 알려준다.

```text
강한나 바로 뒤에 손님을 배치하면 얼굴 실루엣이 복잡해질 수 있어요.
손님들을 출입구와 화면 오른쪽 배경에 배치할까요?
```

중요 변경은 즉시 적용하지 않고 구조화된 변경 미리보기를 제공한다.

```text
전봇대 화면 점유율: 30% -> 25%
정민 위치: X 0.40 -> X 0.25

[적용] [미리보기] [취소]
```

### 3.7 생성과 수정

앱은 Scene Graph, Scene Spec과 레퍼런스를 조합하여 간결한 모델용 프롬프트를 만들고 이미지 생성을 요청한다. 생성 결과는 프로젝트에 보관하며, 후속 대화는 전체 프롬프트를 다시 쓰는 대신 작은 수정 지시로 이어간다.

```text
나머지는 유지하고 전봇대가 화면을 가리는 비율만 조금 줄여줘.
정민과 강한나의 얼굴, 의상, 테이블과 카메라 구도는 변경하지 마.
```

## 4. 화면 구성

데스크톱 화면은 기존 3D 편집기를 중심으로 유지하면서 Scene Assistant와 레퍼런스 트레이를 추가한다.

```text
┌──────────────────────────┬────────────────────────┐
│                          │ Scene Assistant        │
│       3D Viewport        │                        │
│                          │ AI의 씬 요약            │
│ 선택 오브젝트 강조       │ 확인 질문               │
│ 번호 또는 역할 표시      │ 변경 미리보기 카드       │
│                          │ 생성 및 수정 대화        │
├──────────────────────────┴────────────────────────┤
│ References                                         │
│ [Layout] [Background] [정민] [강한나] [Style] [+]  │
└───────────────────────────────────────────────────┘
```

상호 연결 규칙은 다음과 같다.

- 대화에서 오브젝트를 언급하면 뷰포트에서 강조한다.
- 뷰포트에서 오브젝트를 선택하면 채팅의 현재 대상을 변경한다.
- 레퍼런스 카드를 마네킹에 드롭하면 연결 제안을 생성한다.
- AI가 Scene Spec을 수정하면 변경된 속성을 Inspector에서도 표시한다.
- 최종 프롬프트와 실제 첨부 순서는 고급 보기에서 확인할 수 있다.

## 5. 레퍼런스 매니저

### 5.1 레퍼런스 유형

| 유형          | 책임                            | 대표 연결 대상             |
| ------------- | ------------------------------- | -------------------------- |
| `layout`      | 카메라, 구도, 원근, 가림        | 출력 카메라 또는 장면 전체 |
| `background`  | 장소, 공간 구조, 조명           | 환경                       |
| `character`   | 얼굴, 체형, 헤어, 의상          | 특정 마네킹                |
| `prop`        | 테이블, 음식, 차량 등 소품 외형 | 특정 씬 오브젝트           |
| `style`       | 화풍, 색감, 렌더링 인상         | 장면 전체                  |
| `composition` | 별도의 콘티나 사진 구도         | 카메라                     |
| `other`       | 사용자가 지정한 특수 역할       | 자유 대상                  |

MVP는 `layout`, `background`, `character`, `style` 네 종류부터 지원한다.

### 5.2 사용 범위 지정

레퍼런스가 담당할 속성과 담당하지 않을 속성을 명시한다.

```text
이름: 정민 캐릭터 시트
종류: Character
연결 대상: blue_mannequin

사용:
  얼굴, 헤어스타일, 체형, 의상

사용하지 않음:
  포즈, 배경, 캐릭터 시트의 글자
```

이 정보는 이미지 생성 모델의 공식 가중치가 아니라 프롬프트 생성과 충돌 해결에 사용하는 앱 내부 의미 데이터다.

### 5.3 캐릭터 시트 크롭

여러 방향, 표정, 글자와 세부 컷이 한 장에 있는 캐릭터 시트는 생성 모델을 혼동시킬 수 있다. 원본 전체 사용 외에 다음 영역 선택을 제공한다.

- 얼굴
- 정면 전신
- 3/4 전신
- 측면 또는 후면
- 의상 디테일
- 사용자 지정 크롭

마네킹이 카메라에서 보이는 방향을 기준으로 앱이 적절한 영역을 추천할 수 있다. 크롭은 원본을 수정하지 않고 파생 파일로 저장한다.

### 5.4 안정적인 첨부 순서

내부 첨부 순서는 자동으로 정규화한다.

```text
1. Layout
2. Background
3. Character references
4. Prop references
5. Style references
```

최종 프롬프트 앞에는 순서와 역할을 짧게 생성한다.

```text
이미지 1은 카메라 구도와 배치 기준입니다.
이미지 2는 장소, 조명과 화풍 기준입니다.
이미지 3은 강한나의 외형 기준이며 red_mannequin에 대응합니다.
이미지 4는 정민의 외형 기준이며 blue_mannequin에 대응합니다.
```

## 6. 데이터 경계

### 6.1 Scene Graph

> 구현 상태: `LayoutSpec v1`으로 첫 단계 구현 완료. 현재 OutputCamera 기준 화면 바운드·점유율·깊이 밴드·마네킹의 전체 XYZ 회전 방향·레퍼런스 결합·잠재 가림 관계를 생성 요청과 generation record에 포함한다. 정밀 mesh-level visibility는 후속 단계다.

3D 편집기의 관측 가능한 사실 데이터다.

Scene Graph는 별도 영구 원본이 아니라 특정 `sceneRevision`과 OutputCamera에서 계산한 불변 분석 스냅샷이다. 각 요청은 `sceneRevision`, 카메라 해시와 레이아웃 렌더 콘텐츠 해시를 함께 전달한다. 화면 좌표와 점유율은 출력 프레임 기준의 `0..1` 정규화 값으로 표현하며, 프레임 밖 오브젝트와 완전히 가려진 오브젝트를 구분한다.

- 오브젝트 ID와 종류
- 위치, 회전과 크기
- 카메라 위치, 타깃, 화각과 화면비
- 화면상 바운딩 박스와 점유율
- 카메라로부터의 거리
- 전경, 중경, 배경 분류
- 인물 또는 프록시의 방향
- 오브젝트 간 가림 관계

### 6.2 Semantic Scene Spec

AI와 사용자가 합의한 의미와 연출 데이터다.

> 구현 상태: 첫 수직 슬라이스 완료. Inspector에서 각 SceneDocument 오브젝트의 이름, `semantic.meaning`, `semantic.generationNotes`를 편집·저장하며 LayoutSpec과 생성 prompt까지 전달한다. 엑스트라, 장면 전체 의도, 시선 관계, 구조화된 대화 patch와 충돌 검사는 후속 단계다.

- 오브젝트의 실제 의미
- 가이드 색상과 최종 외형의 차이
- 마네킹과 캐릭터 레퍼런스 매핑
- 레퍼런스별 사용 범위
- 시선 대상과 관계
- 전경 오브젝트의 초점 처리
- 생성 전용 소품과 배경 인물
- 장소, 분위기, 시간대와 연출 의도
- 반드시 유지할 제약과 금지 사항

예시:

```json
{
  "version": 2,
  "intent": {
    "location": "한국 노포 야외 치킨집",
    "time": "sunset",
    "mood": "따뜻한 저녁의 조용한 대화"
  },
  "bindings": [
    {
      "objectId": "blue_mannequin",
      "name": "정민",
      "referenceId": "ref_character_jeongmin",
      "use": ["face", "body", "hair", "clothing"],
      "exclude": ["pose", "background", "text"]
    }
  ],
  "semanticObjects": {
    "foreground_01": {
      "role": "foreground_occluder",
      "type": "concrete_utility_pole",
      "appearance": "old gray-brown concrete",
      "focus": "strong_blur",
      "guideColorOnly": true
    },
    "table_01": {
      "type": "red_outdoor_table",
      "generatedProps": [
        "fried chicken",
        "pickled radish",
        "two beer bottles",
        "two beer glasses"
      ]
    }
  },
  "extras": {
    "enabled": true,
    "count": {
      "min": 5,
      "max": 8
    },
    "placement": "entrance and right background tables",
    "prominence": "lower than protagonists"
  }
}
```

### 6.3 Reference Manifest

Reference Manifest는 원본과 파생 이미지의 안정적인 ID, 콘텐츠 해시, 역할과 사용 범위를 소유한다. 브라우저용 URL이나 외부 절대 경로는 저장하지 않는다.

```json
{
  "version": 1,
  "references": [
    {
      "id": "ref_character_jeongmin",
      "kind": "character",
      "artifactId": "artifact_ref_04",
      "contentHash": "sha256:...",
      "mimeType": "image/png",
      "width": 1536,
      "height": 2048,
      "derivedFrom": "artifact_original_04",
      "targetObjectId": "blue_mannequin",
      "use": ["face", "body", "hair", "clothing"],
      "exclude": ["pose", "background", "text"]
    }
  ]
}
```

`artifactId`는 Local Companion이 프로젝트 내부 파일로 해석한다. `contentHash`는 생성 요청 재현과 파일 변경 감지에 사용하며, 크롭은 새 artifact와 `derivedFrom` 관계로 기록한다.

### 6.4 Generation Prompt

Generation Prompt는 저장된 원본 데이터가 아니다. 다음 입력에서 모델별 어댑터가 매번 생성한다.

```text
Scene Graph
+ Semantic Scene Spec
+ Reference Manifest
+ Target Model Prompt Template
= Generation Request
```

프롬프트 템플릿은 다음 블록만 유지한다.

1. 출력 형식
2. 레퍼런스 역할
3. 카메라와 구도
4. 주인공 배치
5. 핵심 소품
6. 배경과 엑스트라
7. 실제 실패 가능성이 높은 필수 제약

존재하지 않는 요소는 부정문으로 길게 설명하지 않고 블록 자체를 생략한다. 제약은 보통 5~7개 이내로 유지한다.

### 6.5 Refinement Directive

보정 생성은 자유 텍스트 `feedback`만을 권위 원본으로 사용하지 않는다. version 1
`RefinementDirective`가 기존 키프레임에서 유지할 요소와 다시 생성할 요소를 분리한다.

```json
{
  "version": 1,
  "preserve": ["전체 구도", "인물 의상과 정체성"],
  "change": ["전봇대 가림을 10% 이하로 줄이기", "표정을 더 밝게"]
}
```

- `change`는 최소 한 항목이 필요하고 `preserve`는 명시 항목이 없을 수 있다.
- 각 목록의 중복과 같은 항목의 유지·변경 동시 지정은 거부한다.
- `edit` generation에는 directive가 필수이며 `fresh` generation에는 허용하지 않는다.
- prompt는 directive JSON과 함께 `preserve` 우선, `change` 한정 재생성, 미지정 요소 보존 규칙을 전달한다.
- Companion과 generation store가 브라우저와 같은 schema와 generation mode 조합을 다시 검증한다.
- generation history는 구조화된 두 목록을 표시하며 구형 기록은 기존 `feedback`으로 fallback한다.

### 6.6 Generation Version Comparison

키프레임 작업 공간은 선택 generation의 부모와 같은 부모를 가진 형제 generation만 비교
대상으로 제공한다. 계보 밖 ID가 브라우저 저장소에 남아 있어도 비교 대상으로 복원하지 않고,
유효한 부모가 있으면 부모를 기본 대상으로 사용한다.

한 비교 대상은 다음 정보를 같은 두 generation에 고정해 보여준다.

- 선택 결과와 부모·형제 결과 이미지
- version, `fresh`/`edit`, 상태, parent와 source generation ID
- 두 `RefinementDirective`의 유지·변경 목록
- `SceneDocument`의 revision, 카메라, 출력, Semantic Scene Spec, 오브젝트와 모션 차이
- `LayoutSpec`의 프레임, 카메라 분석, 권위, 화면 배치와 가림 차이

선택 generation과 비교 generation ID는 별도 키로 저장한다. 새로고침 뒤 목록을 다시 받은
시점에 저장된 선택이 현재 계보에 속하는지 재검증한 뒤 비교 결과 이미지와 스냅샷 차이를 다시
구성한다. 스냅샷이 없는 구형 기록과 장면 ID가 다른 기록은 `동일`로 취급하지 않고 각각 자료
없음과 mismatch로 표시한다.

### 6.7 Generation Request Lifecycle

브라우저가 시작하는 새 generation 요청은 200자 이하의 고유 `requestId`를 가진다. Companion은
정규화된 요청 전체의 SHA-256 fingerprint를 generation manifest에 함께 저장한다.

- 같은 request ID와 같은 fingerprint의 동시·반복 POST는 최초 turn과 generation record를
  반환하며 imagegen을 다시 실행하지 않는다.
- 같은 request ID에 다른 prompt, snapshot, LayoutSpec, render 또는 reference 입력을 보내면
  `409 Conflict`로 거부한다.
- request ID가 없는 구형 클라이언트 요청은 서버가 호환용 ID를 부여하지만 재전송 idempotency를
  보장하지 않는다. 현재 브라우저는 항상 명시적 ID를 보낸다.
- 브라우저는 빠른 다중 클릭을 ref 경계에서 먼저 차단한다. 정규화한 POST payload는 응답을 받기
  전 localStorage 복구 슬롯에 저장한다.
- 네트워크 응답이 유실되면 payload를 새로 캡처하지 않고 같은 request ID로 명시적으로 다시
  확인한다. 서버에 기록이 있으면 기존 상태를 반환하고, 없을 때만 최초 turn을 시작한다.
- reload에서 저장된 `inProgress` generation의 thread/turn을 복원해 같은 turn을 중단할 수 있다.
- Companion 프로세스 재시작 시 이전 프로세스의 `inProgress` record는 고아 작업으로 보고
  `interrupted`와 복구 이유를 durable manifest에 기록한다. 동일 request ID 재전송은 이 terminal
  record를 반환하며 자동 재실행하지 않는다.
- `failed`와 `interrupted`는 terminal 상태다. 사용자가 다시 생성하면 새 request ID의 새 시도로
  기록한다.

### 6.8 Reproducible Generation Execution Summary

신규 generation은 version 1 실행 요약을 불변 record에 저장한다. 요약은 prompt,
`SceneDocument`, 별도 Semantic Scene Spec snapshot과 `LayoutSpec`의 SHA-256, 레이아웃 렌더 ID와
파일 해시, 원본 키프레임 ID·결과 해시, 정렬된 레퍼런스 ID·해시를 포함한다. 실제 Codex turn에
전달한 이미지 배열은 1부터 시작하는 attachment index와 `sourceGeneration`/`layout`/`reference`
역할로 그대로 기록한다.

Companion은 generation 목록과 콘텐츠 응답을 만들 때 manifest의 현재 저장값으로 요약을 다시
계산한다. 저장 요약과의 차이 외에도 다음 근거를 독립적으로 검사한다.

- `SceneDocument.semanticSceneSpec`과 별도 Semantic Scene Spec snapshot의 동일성
- generation mode에 따른 원본, 레이아웃, 레퍼런스의 실제 첨부 순서
- prompt 안의 versioned `SceneDocument`, `LayoutSpec`, Semantic Scene Spec과 레퍼런스 매니페스트
  블록이 저장 스냅샷에서 직렬화한 값과 같은지 여부
- 원본 키프레임과 모든 첨부에 확인 가능한 콘텐츠 해시가 있는지 여부

공개 record에는 실행 요약과 `valid`/`legacy`/`mismatch` 무결성 상태 및 구체적 오류를 제공한다.
키프레임 상세는 전체 해시와 첨부 순서를 표시한다. 실행 요약이 없는 이전 generation은 추정값을
만들지 않고 `legacy`로 표시한다.

## 7. 대화와 변경 계약

Scene Assistant의 응답은 사용자용 메시지와 기계 적용 데이터를 분리한다.

```json
{
  "version": 1,
  "requestId": "req_01",
  "baseSceneRevision": 12,
  "baseSpecRevision": 7,
  "message": "장소와 배경 손님 연출을 변경할게요.",
  "specPatch": [
    {
      "op": "replace",
      "path": "/intent/location",
      "value": "골목 치킨집"
    },
    {
      "op": "replace",
      "path": "/extras/enabled",
      "value": true
    },
    {
      "op": "replace",
      "path": "/extras/minCount",
      "value": 5
    },
    {
      "op": "replace",
      "path": "/extras/maxCount",
      "value": 8
    }
  ],
  "sceneCommands": [
    {
      "type": "setObjectTransform",
      "objectId": "foreground_01",
      "transform": {
        "position": { "x": 1.25, "y": 0.85, "z": 0 },
        "rotationDeg": { "x": 0, "y": 20, "z": 0 },
        "scale": { "x": 1, "y": 1, "z": 1 }
      }
    }
  ],
  "warnings": ["전경 오브젝트의 위치와 회전을 함께 변경합니다."]
}
```

S25의 version 2 계약은 `setObjectTransform`만 허용한다. `specPatch`와 `sceneCommands`는 같은
base revision에서 검증하고 하나의 원자 transaction으로 적용한다. object 생성·삭제와 포즈 변경은
아직 제안하지 않는다.

적용 규칙은 다음과 같다.

- AI가 임의로 UI 상태를 직접 조작하지 않는다.
- 앱은 patch와 명령의 스키마, 허용 연산과 대상 경로를 검증한다.
- 응답의 기준 revision이 현재 프로젝트와 다르면 적용하지 않고 재분석 또는 사용자 확인을 요구한다.
- 의미 변경은 Semantic Scene Spec에 적용한다.
- 위치, 회전, 크기 변경은 별도의 SceneDocument 명령으로 번역한다.
- 확인 필요 여부는 AI가 아니라 앱의 변경 정책이 결정한다.
- 파괴적 변경이나 큰 구도 변경은 앱이 항상 확인을 요구한다.
- 한 응답의 `specPatch`와 `sceneCommands`는 하나의 프로젝트 트랜잭션으로 검증하고 원자적으로 적용한다.
- 모든 적용 가능한 변경은 통합 undo/redo 이력에 포함한다.
- 실패한 patch는 부분 적용하지 않고 사용자에게 이유를 보여준다.
- 삭제되었거나 복제된 오브젝트의 의미 데이터와 레퍼런스 연결은 참조 무결성 규칙에 따라 함께 정리한다.

`specPatch`는 MVP에서 `add`, `remove`, `replace`만 허용하는 제한된 JSON Patch 부분집합으로 정의한다. 배열 인덱스나 임의 경로 수정을 허용하지 않고 스키마가 승인한 경로만 사용할 수 있다. 3D 변형은 JSON Patch로 직접 수정하지 않고 ID 기반의 도메인 명령을 사용한다.

지원할 대표 자연어 명령은 다음과 같다.

```text
"노란 기둥은 전봇대야."
"이 색들은 모두 구분용이야."
"파란 마네킹은 정민이고 이 캐릭터 시트를 참고해."
"정민을 조금 더 카메라 쪽으로 옮겨."
"강한나는 정민을 바라보게 해."
"배경 손님은 오른쪽에만 배치해."
"좀 더 몰래 지켜보는 느낌으로 바꿔줘."
```

## 8. 브라우저 UI와 로컬 Codex 런타임

첫 구현은 브라우저 기반 편집 UI를 유지하면서 작은 Local Companion이 Codex App Server와 로컬 파일 시스템을 중개하는 구조를 사용한다. Electron이나 Tauri 패키징은 필수가 아니며, 초기 버전은 로컬 실행기가 Companion을 시작하고 기본 브라우저에서 UI를 여는 방식으로 배포할 수 있다.

S35에서 초기 배포 형태를 **platform별 Codex 포함 브라우저 bundle**로 확정했다. bundle은
production 편집기 정적 파일, 단일 JavaScript Companion runner와 현재 platform용 Codex package를
포함하고 사용자가 설치한 지원 Node.js에서 실행한다. 편집기와 API는 같은 무작위 loopback port를
사용하므로 개발용 Vite 서버와 CORS 설정이 필요 없다. 프로젝트는 `--project-root`의 명시적 절대
경로로 선택하고, 기본 브라우저를 열어 기존 WebGL·다운로드·접근성 경로를 그대로 사용한다.
세부 비교와 데스크톱 shell 전환 조건은 `distribution-decision.md`를 따른다.

```text
사용자 브라우저
  -> React/Vite UI
  -> localhost API and event stream
  -> Local Companion
      -> Codex App Server over stdio
      -> Project files and binary assets
      -> Built-in imagegen
  -> Project generation history
```

브라우저가 Codex 프로세스를 직접 실행하거나 프로젝트 디렉터리를 임의로 읽고 쓰지 않는다. Local Companion은 App Server 수명주기와 stdio 프로토콜을 소유하고 브라우저에는 장면 보조 기능에 필요한 제한된 로컬 API만 노출한다. App Server의 실험적 WebSocket 전송을 브라우저의 주 연결 경로로 사용하지 않는다.

### 8.1 세션과 데이터 소유권

- Codex thread는 대화 문맥과 연속 작업 흐름을 소유한다.
- SceneDocument, Semantic Scene Spec, Reference Manifest와 생성 기록은 프로젝트가 소유한다.
- 프로젝트는 `threadId`, `lastAppliedTurnId`, `sceneRevision`, `specRevision`을 저장한다.
- 브라우저 새로고침이나 재시작 후 Local Companion이 기존 thread를 재개한다.
- 매 요청은 현재 revision과 필요한 Scene/Spec 스냅샷을 명시적으로 전달한다.
- thread의 기억만으로 확정된 장면 상태를 복원하지 않는다.
- 긴 대화는 생성 완료 시 구조화된 요약을 프로젝트에 저장하고, 필요하면 최신 요약과 명세로 새 thread를 시작한다.

S32부터 Local Companion은 프로젝트 루트의 `conversations.json`을 version 1 manifest로 관리한다.
이 파일은 활성·보관 task의 thread ID, turn 수와 마지막 turn 상태, 크기가 제한된 최근 사용자
요청·assistant 요약, scene/spec revision과 시각만 저장한다. 전체 prompt나 transcript는 저장하지
않으며 `sessionStorage`는 구형 Companion·테스트를 위한 탭 단위 캐시에만 사용한다.

프로젝트를 다시 열면 저장 task를 자동 재개하지 않는다. 사용자는 저장 task 재개 또는 새 task
시작을 명시적으로 선택하며, 새 task는 이전 활성 task를 보관 상태로 전환한다. 재개 실패 때는
저장 metadata를 유지한 채 다시 시도하거나 새 task를 시작할 수 있다. 일반 대화, spec patch와
generation turn은 동일한 수명주기 metadata를 사용하고, Companion 재시작 시 완료를 확인할 수
없는 `inProgress` turn은 `interrupted`로 복구한다. 이 metadata는 대화 연속성 보조 정보이며
SceneDocument, Semantic Scene Spec과 generation record의 영구 원본 지위를 대체하지 않는다.

예시:

```json
{
  "codexSession": {
    "threadId": "thr_123",
    "lastAppliedTurnId": "turn_456",
    "sceneRevision": 12,
    "specRevision": 7
  }
}
```

### 8.2 내장 이미지 생성

MVP의 기본 생성 경로는 별도 OpenAI API 키를 요구하는 직접 API 호출이 아니라 Codex의 내장 `imagegen`이다. 사용자의 Codex 사용량과 워크스페이스 정책 안에서 실행하며, Local Companion이 레이아웃 렌더와 레퍼런스 파일을 Codex turn에 전달한다.

내장 생성 결과는 Codex 관리 영역에 먼저 생성될 수 있으므로 Local Companion이 최종 선택 결과를 프로젝트의 `assets/generations/`로 복사한 뒤 프로젝트 기록에 등록한다. 프로젝트에서 참조하는 결과를 Codex 관리 경로에만 남겨 두지 않는다.

앱은 다음 상태를 구분해서 보여준다.

- Codex 실행 파일과 App Server 시작 가능 여부
- 로그인 여부와 thread 연결 상태
- 내장 imagegen 사용 가능 여부
- 레퍼런스 전달, 생성, 결과 편입 단계별 진행 상태
- 취소, 사용 한도, 기능 미지원과 생성 실패 원인

내장 imagegen 호출 방식, 결과 이벤트와 파일 경로 수신 방식, 후속 수정 시 이전 결과를 다시 전달하는 방식은 단계 0 기술 스파이크에서 실제 App Server 버전으로 고정한다.

### 8.3 인증 원칙

- 사용자는 Codex가 제공하는 `Sign in with ChatGPT` 흐름으로 로그인한다.
- 앱과 Local Companion은 `~/.codex/auth.json`이나 OAuth 액세스 토큰을 직접 읽거나 복사하지 않는다.
- 인증 수명주기와 갱신은 Codex에 맡긴다.
- Local Companion은 App Server 프로토콜로만 Codex와 통신한다.
- Codex 로그인 토큰을 일반 OpenAI API 호출용 토큰으로 재사용하지 않는다.
- 이미지 생성 사용 가능 여부와 한도는 사용자의 계정, 플랜과 워크스페이스 설정에 따른다.

### 8.4 연결과 복구 책임

Codex나 Local Companion 프로세스가 종료되거나 인증이 만료되어도 SceneDocument, Scene Spec, 레퍼런스와 생성 결과는 로컬 프로젝트에 남아야 한다. 재연결 시 프로젝트 revision과 마지막 적용 turn을 기준으로 상태를 맞추며, 완료 여부를 확인할 수 없는 요청을 자동으로 중복 실행하지 않는다.

S34부터 로컬 실행기는 프로젝트 루트의 `.i2v-companion.lock`을 원자적으로 획득해 프로젝트별
Companion을 하나만 허용한다. 살아 있는 PID의 중복 실행은 거부하고, 종료된 PID나 손상된 lock은
stale 상태로 복구한다. lock에는 인증 토큰을 저장하지 않는다. 지정 포트 충돌은 기본적으로 OS가
선택한 빈 포트로 한 번 전환하고 `--strict-port`에서는 실패한다. 준비가 끝나면 세션 토큰을 URL
fragment에만 담은 편집기 주소를 기본 브라우저에서 열며 `--no-open`으로 생략할 수 있다. 정상
신호 종료는 HTTP 서버, App Server와 소유 lock을 함께 정리한다.

브라우저는 SSE 또는 런타임 상태 조회 실패 시 0.5초, 1초, 2초 간격으로 최대 3회 자동
재연결한다. 각 시도는 런타임, 대화 session, generation과 runtime request 상태를 다시 읽고,
진행 중이던 POST나 turn을 자동 재전송하지 않는다. 사용자는 대기 중 즉시 다시 연결하거나 자동
시도 소진 뒤 수동 재시도를 선택할 수 있다. 복구된 저장 thread는 다음 사용자 동작에서만
재개하므로, 응답 유실과 프로세스 재시작이 중복 turn을 만들지 않는다. Companion 프로세스가
재시작되어 세션 토큰이 바뀌면 새로 열린 launcher URL로 연결 정보를 갱신한다.

S33부터 command 실행 승인, 파일 변경 승인과 `request_user_input` 요청은 원시 App Server
payload를 브라우저에 그대로 전달하지 않고 Companion이 검증·정규화한다. 브라우저는 thread,
turn, 요청 이유와 영향·경로를 보여 준 뒤 이번 요청에 한정된 승인·거부 또는 질문 답변을
인증된 API로 전송한다. 세션 전체 승인이나 protocol이 제안한 정책 변경은 UI에서 노출하지 않는다.

프로젝트 루트의 `runtime-requests.json` version 1 manifest에는 최근 요청 50개의 제한된 metadata와
상태만 저장한다. 사용자 답변, 특히 secret 답변은 App Server 응답에만 사용하고 파일·SSE·로그에
저장하지 않는다. 동일 요청은 현재 App Server 연결에서 정확히 한 번만 응답할 수 있으며 외부
auto-resolution은 `serverRequest/resolved` 알림으로 닫는다. Companion이 재시작되면 기존 JSON-RPC
callback은 복원할 수 없으므로 남은 `pending` 요청을 실행 불가능한 `expired` 상태로 전환하고,
새 요청이 도착할 때만 다시 결정하게 한다. 지원하지 않거나 잘못된 server request는 protocol
error로 fail-closed 종료한다.

### 8.5 보안 경계

- Local Companion은 loopback 인터페이스에만 바인딩하고 공개 네트워크에 노출하지 않는다.
- 브라우저와 Companion 사이에는 실행 시 생성한 세션 토큰과 엄격한 Origin 검사를 사용한다.
- Companion API는 임의 명령 실행이나 임의 경로 읽기를 제공하지 않는다.
- 승인 API는 현재 App Server가 보낸 검증된 pending 요청 ID에만 응답하며 임의 JSON-RPC 호출을 제공하지 않는다.
- secret 사용자 답변은 프로젝트 metadata, SSE와 로그에 남기지 않는다.
- 프로젝트 루트와 명시적으로 가져온 파일만 접근 가능하게 한다.
- 생성 요청에 포함될 파일 목록을 사용자에게 확인 가능하게 한다.
- 외부 원본 이미지는 프로젝트 관리 영역으로 명시적으로 가져온다.
- 로그에는 인증 정보, 세션 토큰이나 이미지 원본의 base64 데이터를 남기지 않는다.

## 9. 파일 및 프로젝트 구조

Local Companion이 프로젝트 디렉터리의 유일한 파일 쓰기 주체다. 외부 절대 경로를 장기적으로 직접 참조하지 않고 프로젝트 안으로 가져와 관리한다. 브라우저는 Companion이 발급한 프로젝트 내부 artifact ID와 썸네일 URL만 사용한다.

```text
project/
  project.json        # 프로젝트 버전, revision과 Codex session
  assets/
    originals/       # 사용자가 가져온 원본
    references/      # 크롭 및 생성용 파생 이미지
    scene-renders/   # 출력 카메라 레이아웃 렌더
    generations/     # 생성 결과와 썸네일
  scene.json         # 3D SceneDocument
  scene-spec.json    # Semantic Scene Spec
  references.json    # Reference Manifest
  generations.json   # 생성 관계와 재현 메타데이터
  conversations.json # 활성·보관 Codex task와 제한된 대화 metadata
  runtime-requests.json # 승인·질문 요청의 제한된 수명주기 metadata
```

`project.json`은 최소한 `version`, `projectId`, `sceneRevision`, `specRevision`과 `codexSession`을 가진다. SceneDocument와 Scene Spec을 함께 변경하는 작업은 임시 파일에 모두 기록하고 검증한 뒤 교체하거나, 동일한 복구 로그를 사용하는 방식으로 원자성을 보장한다.

각 생성 결과에는 다음 재현 정보를 함께 보관한다.

- 생성 시점 SceneDocument와 Scene Spec의 revision·콘텐츠 해시
- LayoutSpec과 레이아웃 렌더의 ID·콘텐츠 해시
- 레퍼런스 및 원본 키프레임 ID와 콘텐츠 해시
- 실제 이미지 첨부 순서와 역할
- 렌더된 최종 프롬프트의 콘텐츠 해시와 저장 입력 블록 검증 결과
- 원본 결과와 후속 수정 관계

### 9.1 브라우저 메모리 정책

브라우저는 원본 이미지, 생성 결과의 전체 해상도 데이터나 base64 문자열을 장기 상태에 보관하지 않는다.

- Zustand와 undo/redo에는 artifact ID, 해시와 메타데이터만 저장한다.
- 원본과 생성 결과는 Local Companion이 프로젝트 파일로 보관한다.
- 브라우저 목록에는 크기가 제한된 썸네일만 로드한다.
- 갤러리는 가상화하고 화면 밖 전체 해상도 이미지를 언로드한다.
- `URL.createObjectURL()`로 만든 URL은 사용이 끝나면 즉시 해제한다.
- 교체하거나 제거한 Three.js texture, material, geometry와 render target은 `dispose()`한다.
- 오프스크린 렌더가 끝나면 픽셀 버퍼, 임시 Canvas와 GPU 자원 참조를 해제한다.
- 프로젝트 전환 시 이전 프로젝트의 이미지 캐시와 3D 런타임 자원을 비운다.
- 브라우저가 종료되어도 프로젝트 파일과 Codex thread ID를 사용해 복원할 수 있어야 한다.

## 10. 프롬프트 보일러플레이트 원칙

긴 설명을 누적하지 않고 고정 템플릿과 장면별 데이터로 분리한다.

```yaml
output:
  aspectRatio: '16:9'
  medium: 'cinematic 2D animation illustration'

camera:
  shot: 'medium observational shot'
  viewpoint: 'from behind a utility pole'
  focus: 'two protagonists'

foreground:
  enabled: true
  objectId: 'foreground_01'

extras:
  enabled: true
  count:
    min: 5
    max: 8
```

렌더된 프롬프트는 이미지 레퍼런스가 이미 제공하는 정보를 중복 서술하지 않는다. 구도, 매핑, 생성 전용 요소와 실패하기 쉬운 제약을 우선한다.

수정 요청은 별도 템플릿을 사용한다.

```text
나머지 구성은 유지하고 다음 항목만 수정하세요:
{{ corrections }}.

{{ lockedAttributes }}는 변경하지 마세요.
```

## 11. MVP 범위와 구현 순서

### 단계 0: Local Runtime 및 Imagegen 기술 스파이크

- Local Companion이 Codex App Server를 stdio로 시작하고 종료
- 브라우저와 Companion 사이의 인증된 localhost API와 이벤트 스트림
- 로그인 상태와 thread 시작, 재개 및 취소
- 레이아웃 렌더와 로컬 레퍼런스를 Codex turn에 전달
- 내장 imagegen 호출, 결과 이벤트 수신과 프로젝트 파일 편입
- Codex 미설치, 로그아웃, imagegen 미지원과 사용 한도 상태 검증
- 브라우저 새로고침 후 thread 재개와 중복 요청 방지

### 단계 1: Reference Manager

- Layout, Background, Character, Style 레퍼런스 추가
- 썸네일과 메타데이터 표시
- 캐릭터 레퍼런스와 마네킹 연결
- 사용 범위와 제외 범위 지정
- 캐릭터 시트 크롭과 파생 파일 저장
- 생성용 첨부 순서 정규화

### 단계 2: Semantic Scene Spec

- Project Manifest, Reference Manifest와 Generation Record 스키마 정의
- 버전이 있는 스키마 정의
- SceneDocument 오브젝트 ID와 의미 데이터 연결 — 오브젝트별 실제 의미·생성 메모 구현 완료
- 생성 당시 SceneDocument·레퍼런스 불변 스냅샷과 부모 버전 계보 저장 — 구현 완료
- 생성 전용 소품과 엑스트라 저장
- 유효성 검사, 마이그레이션과 직렬화
- SceneDocument와 Scene Spec의 통합 트랜잭션, undo/redo 및 dirty lifecycle
- request ID, revision과 stale 응답 거부 계약

### 단계 3: Prompt Builder

- Scene Graph 요약기
- 레퍼런스 역할 매니페스트 생성
- 조건부 프롬프트 블록
- 필수 제약 축약
- 생성 프롬프트와 수정 프롬프트 렌더링
- 입력 데이터와 렌더 결과의 스냅샷 테스트

### 단계 4: Local Companion 및 Codex 연결

- App Server 실행과 연결 상태
- 로그인 상태 안내
- 지속 대화 thread 관리와 프로젝트 session metadata
- Scene Graph, Scene Spec과 레퍼런스 전달
- 구조화된 응답 계약과 오류 처리

### 단계 5: 대화형 Scene Assistant

- AI의 씬 요약
- 의미가 불명확한 오브젝트 질문
- 뷰포트 선택과 대화 대상 동기화
- Scene Spec patch 미리보기와 적용
- 3D 변형 제안과 확인
- 충돌 검사와 생성 전 점검

### 단계 6: 이미지 생성 및 결과 관리

- 레이아웃 자동 렌더
- 레퍼런스 첨부와 생성 요청
- 진행 상태, 취소와 오류 표시
- 생성 결과 갤러리
- 수정 대화와 버전 연결
- 프롬프트 및 재현 메타데이터 저장
- 썸네일, 가상화와 전체 해상도 이미지 언로드
- 프로젝트 전환과 장시간 사용 시 브라우저/GPU 자원 정리

## 12. MVP에서 미룰 기능

- AI가 확인 없이 3D 씬 전체를 자유롭게 조작하는 기능
- 복잡한 영역 마스크 및 인페인팅 편집기
- 다수 이미지의 자동 합성 또는 포토배싱
- 클라우드 사용자 계정 및 앱 자체 크레딧 과금
- 원격 Codex App Server 운영
- 여러 이미지 생성 공급자를 동시에 지원하는 라우터
- 레퍼런스마다 생성 모델의 수치형 가중치를 제공하는 UI

## 13. 수락 기준

다음 흐름이 한 프로젝트 안에서 완료되면 첫 대화형 이미지 생성 MVP가 성립한다.

1. 사용자가 기존 3D 편집기에서 카메라와 프록시를 배치한다.
2. 앱이 출력 카메라 렌더와 Scene Graph 요약을 생성한다.
3. 사용자가 배경과 두 캐릭터 레퍼런스를 가져온다.
4. 각 캐릭터 레퍼런스를 해당 마네킹에 연결한다.
5. AI가 불명확한 전경 물체의 의미를 질문한다.
6. 사용자 답변이 검증 가능한 Scene Spec patch로 적용된다.
7. AI가 주인공, 배경 손님과 소품의 충돌 가능성을 점검한다.
8. 앱이 짧고 역할이 명확한 최종 프롬프트를 생성한다.
9. Codex의 내장 imagegen을 통해 레퍼런스 기반 이미지를 생성하고 결과를 프로젝트로 편입한다.
10. 사용자가 결과를 보고 한 요소만 수정하는 후속 요청을 수행한다.
11. 생성 결과, 레퍼런스 매핑, 프롬프트와 Scene Spec 버전을 다시 열 수 있다.
12. 브라우저를 새로고침해도 기존 Codex thread와 프로젝트 revision을 재개한다.
13. 원본과 전체 해상도 생성 이미지를 브라우저 상태에 누적하지 않고 장시간 사용 후에도 편집을 계속할 수 있다.

### 13.1 제품 가설 검증

기술 수락과 별도로 고정된 대표 장면 5개를 자연어 프롬프트만 사용하는 기준선과 비교한다.

- 5개 중 4개 이상에서 인물 좌우 배치, 카메라 방향과 주요 가림 관계가 3D 레이아웃과 일치한다.
- 5개 중 4개 이상에서 두 캐릭터 레퍼런스가 올바른 마네킹에 대응한다.
- 단일 요소 수정 5회 중 4회 이상에서 잠금 속성이 유지된다.
- 의미 확인은 대표 흐름에서 생성 전 3회 이하의 짧은 질문으로 끝난다.
- 저장한 프로젝트 5개 모두에서 레퍼런스, Scene Spec, 생성 관계와 Codex session metadata를 다시 열 수 있다.
- 비교 결과와 실패 유형을 기록해 다음 단계의 충돌 검사와 프롬프트 규칙에 반영한다.

## 14. 확정 기술 결정과 열린 결정

### 14.1 확정 기술 결정

- 편집 UI는 React/Vite 기반 브라우저 UI를 유지한다.
- Local Companion이 Codex App Server를 stdio로 실행하고 프로젝트 파일을 소유한다.
- Electron/Tauri 패키징은 MVP 필수 조건이 아니다.
- Codex thread는 대화 연속성만 소유하고 프로젝트 파일이 영구적인 진실의 원천이다.
- MVP 이미지 생성은 Codex 사용량을 사용하는 내장 imagegen을 기본 경로로 한다.
- 브라우저는 전체 해상도 바이너리를 장기 상태에 보관하지 않는다.
- 초기 내부 배포는 정적 편집기와 platform Codex를 포함한 브라우저 bundle을 사용한다.
- Electron/Tauri는 네이티브 project picker, 서명 installer와 자동 업데이트가 출시 조건이 될 때
  다시 평가한다.

### 14.2 열린 기술 결정

- App Server에서 이미지 입력과 내장 imagegen 결과 이벤트를 전달하는 구체적인 프로토콜
- 기존 `SceneDocument`에 의미 데이터를 포함할지 별도 `scene-spec.json`으로 유지할지
- 프로젝트의 기본 작업 형식을 디렉터리로 하고 휴대용 내보내기를 단일 아카이브로 제공할지
- 크롭과 썸네일 처리 중 브라우저와 Local Companion의 정확한 책임 분리
- 생성 작업 취소, 재시도와 부분 실패의 상태 머신
- 사용자의 Codex 환경에서 이미지 생성 기능을 탐지하는 방법과 미지원 상태 UX
- SceneDocument와 Scene Spec의 원자적 저장 및 복구 로그 형식

첫 구현을 시작하기 전에 단계 0에서 App Server 버전별 프로토콜, 내장 imagegen 결과 편입과 재연결 흐름을 검증한다. 스파이크가 통과하기 전에는 생성 UI 전체를 구현하지 않는다.
