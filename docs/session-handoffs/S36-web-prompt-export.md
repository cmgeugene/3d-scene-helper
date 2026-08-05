# S36 — GPT 웹용 수동 생성 프롬프트 내보내기

## 구현 결과

- Scene Assistant 입력창에 `웹으로 내보내기`를 추가했다.
- fresh 생성은 현재 사용자 지시와 자동 생성에 쓰는 SceneDocument, Semantic Scene Spec,
  LayoutSpec, 레퍼런스 매니페스트를 GPT 웹용 프롬프트로 조립한다.
- edit 보정은 구조화된 `RefinementDirective`, 보정 원본과 같은 생성 근거를 유지한다.
- Codex 전용 `$imagegen` 명령은 웹용 프롬프트에서 제거한다.
- 모달은 GPT 웹에 직접 첨부할 레이아웃, 보정 원본과 레퍼런스 순서를 표시하고 프롬프트 전체를
  클립보드에 복사한다.
- 이 경로는 장면 렌더 업로드, Codex thread/turn, generation record를 만들지 않으며 imagegen
  capability가 없는 런타임에서도 사용할 수 있다.
- GPT 웹에서 수동 생성한 결과는 프로젝트 생성 이력에 자동 등록되지 않는다고 안내한다.

## 검증 범위

- prompt 단위 테스트: fresh/edit 웹 adapter의 명령 제거, 사용자 지시와 첨부 계약 유지
- dialog 단위 테스트: 정확한 원문 복사, 복사 완료 상태, preflight 경고와 Escape 닫기
- panel 통합 테스트: imagegen 미지원 상태에서 모달 열기, 업로드·generation 무호출
- 전체 typecheck, lint, unit test와 production build

실제 GPT 웹 생성과 Codex imagegen 사용량을 소비하는 수동 생성은 자동 검증에 포함하지 않는다.

## 다음 단계

S37에서 generation thumbnail과 선택하지 않은 전체 해상도 이미지·읽기 전용 3D preview의 자원
해제를 구현한다.
