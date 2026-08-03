# S18 — Generation source snapshots

## 결과

키프레임 이력과 원본 기반 재생성을 위한 generation source snapshot 계층을 구현했다.

새 generation record는 다음을 저장한다.

- `sceneSnapshot`: 생성 당시 전체 SceneDocument
- `referenceSnapshots`: Companion이 프로젝트에서 확인한 레퍼런스 메타데이터와 콘텐츠 해시
- `parentGenerationId`: 피드백 재생성의 부모 generation
- `versionNumber`: 부모 계보 기준 버전 깊이
- `feedback`: 해당 버전을 만든 피드백
- `generationMode`: `fresh` 또는 명시적 `edit`

현재 UI의 기본 이미지 생성은 `parentGenerationId: null`, `versionNumber: 1`, `feedback: null`, `generationMode: fresh`로 기록한다. 이전 결과 이미지는 새 생성의 입력으로 첨부하지 않는다.

## 무결성 규칙

- SceneDocument, LayoutSpec과 레이아웃 렌더의 scene ID가 일치해야 한다.
- 첨부 reference ID와 reference snapshot ID가 정확히 일치해야 한다.
- 부모 generation이 없으면 자식 generation 생성을 거부한다.
- 버전 번호는 클라이언트가 지정하지 않고 Companion이 부모 기록에서 계산한다.
- Zod parse가 입력 데이터를 복제하므로 생성 이후 현재 씬이나 레퍼런스가 바뀌어도 저장된 스냅샷은 변하지 않는다.
- 기존 generation record에는 `sceneSnapshot: null`, 빈 reference snapshot, v1/fresh 기본값을 적용한다. 기존 파일은 읽을 때 자동으로 다시 쓰지 않는다.

## 수동 확인

1. Companion을 재시작하고 새 이미지를 한 번 생성한다.
2. 결과 캡션에 `키프레임 v1 · 소스 스냅샷 저장됨`이 표시되는지 확인한다.
3. `generations.json`의 새 기록에서 `sceneSnapshot`, `referenceSnapshots`, `versionNumber`, `generationMode`를 확인한다.
4. 이후 현재 씬의 오브젝트 이름이나 의미를 바꿔도 해당 generation의 snapshot이 바뀌지 않는지 확인한다.
5. 기존 generation은 계속 표시되며 캡션에 `기존 기록(3D 복원 제한)`이 표시되는지 확인한다.

## 다음 단계

- `3D 씬 / 키프레임` 작업 모드
- generation 이력과 결과·당시 레이아웃 비교 보기
- 선택 generation 상세 조회와 레이아웃 렌더 콘텐츠 API
- 피드백을 구조화해 부모 generation에서 fresh 자식 버전 생성
