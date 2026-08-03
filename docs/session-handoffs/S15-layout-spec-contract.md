# Session S15 Handoff — 3D 레이아웃과 키프레임 변환 계약

## 완료한 목표

Codex가 3D 레이아웃을 단순 참고 이미지로 취급하지 않고 최종 키프레임의 공간 설계도로 해석하도록 `LayoutSpec v1` 계층을 구현했다.

- 브라우저와 Companion이 공유하는 strict LayoutSpec 스키마
- OutputCamera와 world bounds 기반 정규화 화면 바운드
- 프레임 점유율과 `visible / partial / outside / behind-camera` 상태
- 카메라 깊이와 `foreground / midground / background` 분류
- 마네킹 pose ID, world yaw와 카메라 상대 방향
- 마네킹에 연결된 appearance reference ID
- 화면 바운드와 깊이를 이용한 잠재 가림 쌍과 겹침 비율
- 숨김 또는 출력 제외 오브젝트 목록
- 3D에서 유지할 항목과 최종 이미지에서 재해석할 항목의 authority 규칙
- Scene Assistant의 생성 전 `3D → 키프레임 변환 계약` 미리보기
- `$imagegen` prompt에 전체 LayoutSpec과 변환 규칙 포함
- generation record와 `generations.json`에 사용된 LayoutSpec 저장

## 변환 우선순위

```text
3D Layout
  카메라, 원근, 크롭, 화면상 배치와 크기, 포즈, 방향, 깊이와 가림

Target-bound Character Reference
  얼굴, 체형, 헤어와 의상

Background / Style Reference
  장소 외관, 환경 디테일과 렌더링 처리

User Direction
  프록시의 실제 의미, 분위기, 생성 전용 요소와 명시적 예외
```

프록시의 guide color와 primitive material은 최종 외형의 권위가 없다고 명시한다. `potentialOcclusions`는 AABB 투영 기반 힌트이므로 mesh-level 확정 가림으로 표현하지 않는다.

## 검증 범위

- 정면·전경 배치에서 화면 위치, 점유율과 깊이 밴드
- 마네킹 pose와 카메라 상대 방향
- 캐릭터 레퍼런스와 마네킹 결합
- 전경 프록시와 후경 인물의 잠재 가림
- 숨김·출력 제외 오브젝트
- prompt의 변환 계약과 첨부 순서
- 브라우저 API를 통한 LayoutSpec 전달
- generation manifest 영속화와 결과 완료 후 보존
- React 생성 전 미리보기와 실제 generation 요청 인자

## 다음 단계

- 대화에서 합의한 프록시 의미를 `Semantic Scene Spec`으로 영속화
- LayoutSpec과 Semantic Scene Spec의 충돌 검사
- 사용자에게 생성 전 변경 미리보기와 명시적 적용/취소 제공
- mesh-level visibility 또는 GPU ID pass 기반 정밀 가림 분석
- 이전 generation을 부모로 삼는 revision 기록과 유지 제약 diff
