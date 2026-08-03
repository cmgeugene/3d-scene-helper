# S16 — Semantic object authoring

## 결과

3D 프리미티브가 최종 이미지에서 무엇으로 해석되어야 하는지 프로젝트에 저장하고 생성까지 전달하는 첫 수직 슬라이스를 구현했다.

- Inspector에서 선택 오브젝트 이름 편집
- 오브젝트별 `semantic.meaning`, `semantic.generationNotes` 편집
- SceneDocument 직렬화·autosave·JSON import/export에 의미 데이터 포함
- LayoutSpec의 `semanticMeaning`, `generationNotes`로 전달
- 생성 prompt에서 프리미티브 이름과 guide color보다 저장된 의미를 우선하도록 명시
- Scene Assistant의 변환 계약 미리보기에 실제 의미 표시
- 이름 변경이 아웃라이너와 레퍼런스 연결 대상 이름에 반영
- 기존 LayoutSpec generation record에는 두 필드를 `null`로 보완하는 하위 호환 파싱
- 마네킹 방향 계산이 Y yaw만 보던 문제를 고쳐 XYZ Euler 회전을 모두 반영

## 수동 확인

1. Companion과 앱을 다시 시작하고 기존 프로젝트를 연다.
2. 씬 목록에서 마네킹을 선택해 이름을 `정민`으로 바꾼다.
3. References의 Character 카드 `설정`에서 연결 대상 이름이 `정민`으로 보이는지 확인한다.
4. Cylinder를 선택해 이름을 `포차 테이블`, 실제 의미를 `빨간 원형 포차 테이블`, 생성 메모를 `위치와 크기는 유지하고 실제 플라스틱 테이블로 교체`로 입력한다.
5. 다른 오브젝트를 선택했다가 돌아와 세 값이 유지되는지 확인한다.
6. 페이지를 새로고침하거나 JSON으로 내보냈다가 다시 가져와 값이 유지되는지 확인한다.
7. Scene Assistant의 `3D → 키프레임 변환 계약`에 `빨간 원형 포차 테이블`이 표시되는지 확인한다.
8. 실제 생성 전에는 사용량을 쓰지 않고 여기까지 확인할 수 있다. 생성할 경우 generation record의 LayoutSpec에도 두 의미 필드가 저장된다.

## 다음 단계

- 대화 응답의 구조화된 semantic patch 미리보기·승인·적용
- 장면 전체 intent, 생성 전용 소품, 엑스트라 저장 UI
- 레퍼런스·Semantic Scene Spec·LayoutSpec 충돌 검사
- 오브젝트 복제·삭제 시 의미와 레퍼런스 연결의 참조 무결성 강화
