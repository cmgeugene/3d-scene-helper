import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import { CAMERA_SHOT_PRESETS, LENS_PRESETS } from '../presets/cameras';
import { LIGHTING_PRESETS } from '../presets/lighting';
import { createEditorStore } from '../state/editorStore';
import { EditorShortcuts } from './EditorShortcuts';
import { Inspector } from './Inspector';
import { isSceneShortcutTarget } from './shortcutTarget';

const MANNEQUIN_ID = 'mannequin-test';

function createTestStore(generatedIds: string[] = []) {
  const ids = [...generatedIds];
  return createEditorStore({
    initialDocument: createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: MANNEQUIN_ID,
    }),
    idFactory: () => ids.shift() ?? 'generated-test',
  });
}

describe('Inspector', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
    store.getState().selectObject(MANNEQUIN_ID);
  });

  it('움직임 구도 가이드는 메모와 모호한 강도 입력 없이 방향만 설정한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);

    const subjectGuide = screen.getByRole('group', {
      name: '움직임 구도 가이드',
    });
    expect(
      within(subjectGuide).queryByLabelText('장면 노트'),
    ).not.toBeInTheDocument();
    expect(
      within(subjectGuide).queryByLabelText('피사체 모션 강도'),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      within(subjectGuide).getByLabelText('피사체 이동 방향'),
      'right',
    );
    expect(store.getState().document.subjectMotionGuide).toMatchObject({
      subjectId: MANNEQUIN_ID,
      label: '오른쪽',
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.5,
    });

    await user.click(screen.getByRole('button', { name: '카메라' }));
    const cameraGuide = screen.getByRole('group', {
      name: '카메라 이동 가이드',
    });
    expect(
      within(cameraGuide).queryByLabelText('카메라 모션 강도'),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      within(cameraGuide).getByLabelText('카메라 이동 방향'),
      'dolly',
    );
    expect(store.getState().document.cameraMotionGuide).toMatchObject({
      motionType: 'dolly',
      label: '돌리 인',
      direction: { x: 0, y: 0, z: -1 },
      strength: 0.5,
    });
  });

  it('숫자 transform을 local draft로 편집하고 blur에서 한 번 commit한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);
    const positionX = screen.getByLabelText('위치 X');
    const documentBeforeEdit = store.getState().document;
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    await user.clear(positionX);
    await user.type(positionX, '2.5');

    expect(store.getState().document).toBe(documentBeforeEdit);
    fireEvent.blur(positionX);

    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID)
        ?.transform.position.x,
    ).toBe(2.5);
    expect(documentChanges).toBe(1);
    expect(store.getState().inProgressTransform).toBeNull();
    unsubscribe();
  });

  it('Enter로 numeric draft를 한 번 commit하고 Inspector 값을 동기화한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);
    const rotationY = screen.getByLabelText('회전 Y');
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    await user.clear(rotationY);
    await user.type(rotationY, '45{Enter}');

    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID)
        ?.transform.rotationDeg.y,
    ).toBe(45);
    expect(rotationY).toHaveValue(45);
    expect(documentChanges).toBe(1);
    unsubscribe();
  });

  it('0 이하 scale draft를 거부하고 committed 값을 복원한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);
    const scaleX = screen.getByLabelText('크기 X');
    const documentBeforeEdit = store.getState().document;

    await user.clear(scaleX);
    await user.type(scaleX, '0');
    fireEvent.blur(scaleX);

    expect(store.getState().document).toBe(documentBeforeEdit);
    expect(scaleX).toHaveValue(1);
    expect(scaleX).toHaveAttribute('aria-invalid', 'true');
  });

  it('선택 오브젝트의 이름과 이미지 생성 의미를 편집한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);

    const name = screen.getByLabelText('오브젝트 이름');
    await user.clear(name);
    await user.type(name, '정민{Enter}');

    const meaning = screen.getByLabelText('오브젝트 실제 의미');
    await user.type(meaning, '화면 왼쪽에 앉은 정민');
    fireEvent.blur(meaning);
    const notes = screen.getByLabelText('오브젝트 생성 메모');
    await user.type(notes, '외형은 캐릭터 레퍼런스, 포즈는 3D를 따른다.');
    fireEvent.blur(notes);

    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID),
    ).toMatchObject({
      name: '정민',
      semantic: {
        meaning: '화면 왼쪽에 앉은 정민',
        generationNotes: '외형은 캐릭터 레퍼런스, 포즈는 3D를 따른다.',
      },
    });
    expect(screen.getByText('정민')).toBeVisible();
  });

  it('proxy opacity와 최종 표면을 분리하고 typed containment를 편집한다', async () => {
    const user = userEvent.setup();
    store = createTestStore([
      'cube-contained',
      'relation-contained',
      'relation-duplicate',
    ]);
    store.getState().addObject({ kind: 'cube', name: 'Contained prop' });
    store.getState().selectObject(MANNEQUIN_ID);
    render(<Inspector store={store} />);

    const opacity = screen.getByLabelText('프록시 불투명도');
    await user.clear(opacity);
    await user.type(opacity, '0.3');
    fireEvent.blur(opacity);
    await user.selectOptions(
      screen.getByLabelText('최종 표면 타입'),
      'transparent',
    );
    await user.type(
      screen.getByLabelText('최종 재질 메모'),
      '맑은 아크릴 외피',
    );
    fireEvent.blur(screen.getByLabelText('최종 재질 메모'));

    await user.selectOptions(
      screen.getByLabelText('내부 오브젝트'),
      'cube-contained',
    );
    await user.selectOptions(
      screen.getByLabelText('내부 오브젝트 가시성'),
      'cutaway',
    );
    await user.click(screen.getByRole('button', { name: '내부 관계 추가' }));

    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID),
    ).toMatchObject({
      visualization: { proxyOpacity: 0.3 },
      appearanceIntent: {
        surfaceType: 'transparent',
        materialNotes: '맑은 아크릴 외피',
      },
    });
    expect(store.getState().document.spatialRelations).toEqual([
      {
        id: 'relation-contained',
        type: 'contains',
        containerObjectId: MANNEQUIN_ID,
        containedObjectId: 'cube-contained',
        visibility: 'cutaway',
      },
    ]);
    expect(
      screen.getByRole('list', { name: '내부 관계 목록' }),
    ).toHaveTextContent('Contained prop');

    await user.selectOptions(
      screen.getByLabelText('내부 오브젝트'),
      'cube-contained',
    );
    await user.click(screen.getByRole('button', { name: '내부 관계 추가' }));
    expect(screen.getByRole('alert')).toHaveTextContent('중복, 순환');
    await user.click(
      screen.getByRole('button', {
        name: 'relation-contained 내부 관계 삭제',
      }),
    );
    expect(store.getState().document.spatialRelations).toEqual([]);
  });

  it('연출 탭에서 장면 전체 spec을 구조화해 한 번 적용하고 history/undo 복원한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);

    await user.click(screen.getByRole('button', { name: '연출' }));
    await user.type(screen.getByLabelText('장소'), '한국 노포 야외 치킨집');
    await user.type(screen.getByLabelText('시간대'), '해질녘');
    await user.type(
      screen.getByLabelText('분위기'),
      '따뜻한 저녁의 조용한 대화',
    );
    await user.type(
      screen.getByLabelText('화풍 의도'),
      '시네마틱 2D 애니메이션',
    );
    await user.type(
      screen.getByLabelText('생성 전용 소품'),
      '치킨 | 테이블 중앙 | 핵심{enter}맥주 | 테이블 오른쪽 | 보조',
    );
    await user.click(screen.getByRole('checkbox', { name: '엑스트라 사용' }));
    await user.clear(screen.getByLabelText('엑스트라 최소 인원'));
    await user.type(screen.getByLabelText('엑스트라 최소 인원'), '5');
    await user.clear(screen.getByLabelText('엑스트라 최대 인원'));
    await user.type(screen.getByLabelText('엑스트라 최대 인원'), '8');
    await user.type(
      screen.getByLabelText('엑스트라 배치'),
      '오른쪽 배경 테이블',
    );
    await user.type(
      screen.getByLabelText('엑스트라 중요도'),
      '주인공보다 낮음',
    );
    await user.type(
      screen.getByLabelText('인물 및 오브젝트 관계'),
      `${MANNEQUIN_ID} | floor-test | 친구 | 바닥 쪽 시선 | 서 있음`,
    );
    await user.type(
      screen.getByLabelText('필수 유지 요소'),
      '카메라 구도{enter}인물 외형',
    );
    await user.type(screen.getByLabelText('변경 가능 요소'), '배경 디테일');

    expect(store.getState().isDirty).toBe(false);
    await user.click(screen.getByRole('button', { name: '장면 명세 적용' }));

    expect(store.getState().document.semanticSceneSpec).toMatchObject({
      intent: {
        location: '한국 노포 야외 치킨집',
        timeOfDay: '해질녘',
        mood: '따뜻한 저녁의 조용한 대화',
        visualStyle: '시네마틱 2D 애니메이션',
      },
      generatedProps: [
        { name: '맥주', placement: '테이블 오른쪽', importance: '보조' },
        { name: '치킨', placement: '테이블 중앙', importance: '핵심' },
      ],
      extras: {
        enabled: true,
        minCount: 5,
        maxCount: 8,
        placement: '오른쪽 배경 테이블',
        importance: '주인공보다 낮음',
      },
      relationships: [
        {
          subjectObjectId: MANNEQUIN_ID,
          targetObjectId: 'floor-test',
          relationship: '친구',
          gaze: '바닥 쪽 시선',
          action: '서 있음',
        },
      ],
      constraints: {
        preserve: ['인물 외형', '카메라 구도'],
        allowChanges: ['배경 디테일'],
      },
    });
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().isDirty).toBe(true);

    store.getState().undo();
    expect(store.getState().document.semanticSceneSpec.intent.location).toBe(
      '',
    );
    store.getState().redo();
    expect(store.getState().document.semanticSceneSpec.intent.location).toBe(
      '한국 노포 야외 치킨집',
    );
  });

  it('빈 오브젝트 이름을 거부하고 기존 이름을 복원한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);
    const name = screen.getByLabelText('오브젝트 이름');

    await user.clear(name);
    fireEvent.blur(name);

    expect(name).toHaveValue('Mannequin');
    expect(name).toHaveAttribute('aria-invalid', 'true');
  });

  it('색상/표시와 duplicate/delete inspector action을 document에 반영한다', async () => {
    const user = userEvent.setup();
    store = createTestStore(['mannequin-copy']);
    store.getState().selectObject(MANNEQUIN_ID);
    render(<Inspector store={store} />);

    fireEvent.change(screen.getByLabelText('색상'), {
      target: { value: '#123456' },
    });
    await user.click(screen.getByRole('checkbox', { name: '표시' }));

    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID),
    ).toMatchObject({ color: '#123456', visible: false });

    await user.click(screen.getByRole('button', { name: '복제' }));
    expect(store.getState().selectedObjectId).toBe('mannequin-copy');
    expect(store.getState().document.objects).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: '삭제' }));
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().document.objects).toHaveLength(2);
  });

  it('selected mannequin에 3개 체형 preset을 제공하고 선택 체형을 저장한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);

    const bodyTypeGroup = screen.getByRole('group', { name: '마네킹 체형' });
    for (const label of ['일반 체형', '건장한 체형', '뚱뚱한 체형']) {
      expect(
        within(bodyTypeGroup).getByRole('button', { name: label }),
      ).toBeVisible();
    }
    await user.click(
      within(bodyTypeGroup).getByRole('button', { name: '건장한 체형' }),
    );
    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID),
    ).toMatchObject({ mannequinBodyType: 'athletic' });
  });

  it('selected mannequin에 4개 pose preset과 object/hand IK tool을 제공한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);

    const poseGroup = screen.getByRole('group', { name: '마네킹 포즈' });
    for (const label of ['기본 서기', 'A 포즈', 'T 포즈', '걷기 준비']) {
      expect(
        within(poseGroup).getByRole('button', { name: label }),
      ).toBeVisible();
    }
    await user.click(within(poseGroup).getByRole('button', { name: 'T 포즈' }));
    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID)
        ?.mannequinPose?.id,
    ).toBe('t');

    await user.click(within(poseGroup).getByRole('button', { name: /손 IK/ }));
    expect(store.getState().mannequinTool).toBe('ik');
    await user.click(
      within(poseGroup).getByRole('button', { name: '오브젝트 변형' }),
    );
    expect(store.getState().mannequinTool).toBe('object');
  });

  it('camera panel에서 lens와 shot을 적용하고 방향 view는 제공하지 않는다', async () => {
    const user = userEvent.setup();
    render(
      <>
        <EditorShortcuts store={store} />
        <Inspector store={store} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: '카메라' }));

    const lens = screen.getByLabelText('렌즈');
    expect(screen.getAllByRole('option', { name: /mm$/ })).toHaveLength(
      LENS_PRESETS.length,
    );
    const dofGroup = screen.getByRole('group', { name: '시네마틱 심도' });
    const depthSlider = within(dofGroup).getByRole('slider', {
      name: '조리개/심도',
    });
    expect(depthSlider).toHaveAttribute('min', '0');
    expect(depthSlider).toHaveAttribute('max', '24');
    expect(depthSlider).toHaveAttribute('aria-valuetext', 'f/2.8');
    expect(depthSlider).toBeDisabled();
    expect(
      within(dofGroup).queryByRole('textbox', { name: '조리개 F값' }),
    ).not.toBeInTheDocument();
    expect(
      within(dofGroup).getByText('얕은 심도·강한 아웃포커스'),
    ).toBeVisible();
    expect(
      within(dofGroup).getByText('깊은 심도·약한 아웃포커스'),
    ).toBeVisible();

    await user.selectOptions(lens, '18');
    expect(depthSlider).toHaveAttribute('min', '0');
    expect(depthSlider).toHaveAttribute('max', '24');
    expect(depthSlider).toHaveValue('15');
    expect(depthSlider).toHaveAttribute('aria-valuetext', 'f/8');
    await user.selectOptions(lens, '85');
    expect(depthSlider).toHaveValue('3');
    expect(depthSlider).toHaveAttribute('aria-valuetext', 'f/2');
    expect(store.getState().document.outputCamera).toMatchObject({
      focalLengthMm: 85,
      depthOfField: { apertureMode: 'auto', fStop: 2 },
    });

    await user.click(screen.getByRole('checkbox', { name: '심도 사용' }));
    expect(store.getState().document.outputCamera.depthOfField.enabled).toBe(
      false,
    );
    await user.click(screen.getByRole('radio', { name: '수동 조리개' }));
    expect(depthSlider).toBeEnabled();
    const historyBeforeDrag = store.getState().history.past.length;
    fireEvent.pointerDown(depthSlider);
    fireEvent.change(depthSlider, { target: { value: '4' } });
    fireEvent.change(depthSlider, { target: { value: '5' } });
    fireEvent.change(depthSlider, { target: { value: '6' } });
    expect(store.getState().document.outputCamera.depthOfField.fStop).toBe(2);
    fireEvent.pointerUp(depthSlider, { currentTarget: { value: '6' } });
    expect(store.getState().document.outputCamera.depthOfField).toMatchObject({
      apertureMode: 'manual',
      fStop: 2.8,
    });
    expect(store.getState().history.past).toHaveLength(historyBeforeDrag + 1);

    const historyBeforeArrow = store.getState().history.past.length;
    await user.click(depthSlider);
    await user.keyboard('{ArrowRight}');
    expect(store.getState().document.outputCamera.depthOfField.fStop).toBe(3.2);
    expect(depthSlider).toHaveAttribute('aria-valuetext', 'f/3.2');
    expect(store.getState().history.past).toHaveLength(historyBeforeArrow + 1);
    await user.keyboard('{Delete}');
    expect(
      store.getState().document.objects.some(({ id }) => id === MANNEQUIN_ID),
    ).toBe(true);
    await user.selectOptions(lens, '24');
    expect(depthSlider).toHaveValue('7');
    expect(depthSlider).toHaveAttribute('aria-valuetext', 'f/3.2');

    const shotGroup = screen.getByRole('group', { name: '샷 프리셋' });
    for (const preset of CAMERA_SHOT_PRESETS) {
      expect(
        within(shotGroup).getByRole('button', { name: preset.label }),
      ).toBeVisible();
    }
    await user.click(within(shotGroup).getByRole('button', { name: '전신' }));
    expect(store.getState().statusMessage).toBe('전신 샷을 적용했습니다.');

    expect(screen.queryByRole('group', { name: '방향 뷰' })).toBeNull();
    for (const label of [
      '정면',
      '후면',
      '좌측',
      '우측',
      '3/4 정면',
      '3/4 후면',
    ]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }

    await user.click(screen.getByRole('button', { name: '선택 프레임 맞춤' }));
    expect(store.getState().document.outputCamera.target).toEqual({
      x: 0,
      y: 0.85,
      z: -0.047,
    });
    await user.click(
      screen.getByRole('button', { name: '선택을 타겟·초점으로 (T)' }),
    );
    expect(store.getState().statusMessage).toBe(
      'Mannequin을 카메라 타겟·초점으로 설정했습니다.',
    );
  });

  it('photographic slider는 기존 non-stop manual f-stop을 숨기지 않고 nearest thumb와 정확한 현재값을 표시한다', async () => {
    const user = userEvent.setup();
    store.getState().setCameraApertureMode('manual');
    store.getState().setCameraFStop(2.7);
    render(<Inspector store={store} />);
    await user.click(screen.getByRole('button', { name: '카메라' }));

    const depthSlider = screen.getByRole('slider', { name: '조리개/심도' });
    expect(depthSlider).toHaveValue('6');
    expect(depthSlider).toHaveAttribute('aria-valuetext', 'f/2.7');
    expect(screen.getByText('f/2.7')).toBeVisible();

    fireEvent.change(depthSlider, { target: { value: '24' } });
    expect(depthSlider).toHaveValue('6');
    expect(depthSlider).toHaveAttribute('aria-valuetext', 'f/2.7');
  });

  it('Camera > 시네마틱 심도에서 전역 마네킹 초점 등고선을 DOF와 독립적으로 토글한다', async () => {
    const user = userEvent.setup();
    store.getState().setCameraDepthOfFieldEnabled(false);
    const cameraBefore = structuredClone(
      store.getState().document.outputCamera,
    );
    render(<Inspector store={store} />);
    await user.click(screen.getByRole('button', { name: '카메라' }));

    const dofGroup = screen.getByRole('group', { name: '시네마틱 심도' });
    const contours = within(dofGroup).getByRole('checkbox', {
      name: '마네킹 초점 확인 등고선',
    });
    expect(contours).not.toBeChecked();

    await user.click(contours);

    expect(contours).toBeChecked();
    expect(store.getState().document.mannequinAppearance).toEqual({
      focusContoursEnabled: true,
    });
    expect(store.getState().document.outputCamera).toEqual(cameraBefore);
    expect(store.getState().statusMessage).toBe(
      '모든 마네킹의 초점 확인 등고선을 표시합니다.',
    );
  });

  it('camera selected action은 selection이 없을 때 camera를 보존하고 status를 설정한다', async () => {
    const user = userEvent.setup();
    store.getState().selectObject(null);
    const camera = store.getState().document.outputCamera;
    render(<Inspector store={store} />);
    await user.click(screen.getByRole('button', { name: '카메라' }));

    await user.click(screen.getByRole('button', { name: '선택 프레임 맞춤' }));
    expect(store.getState().document.outputCamera).toBe(camera);
    expect(store.getState().statusMessage).toBe(
      '프레임에 맞출 오브젝트를 먼저 선택하세요.',
    );
    await user.click(
      screen.getByRole('button', { name: '선택을 타겟·초점으로 (T)' }),
    );
    expect(store.getState().document.outputCamera).toBe(camera);
    expect(store.getState().statusMessage).toBe(
      '카메라 타겟·초점으로 설정할 오브젝트를 먼저 선택하세요.',
    );
  });

  it('lighting panel에서 preset과 노출, 배경, key 방향, shadow 및 reset을 제어한다', async () => {
    const user = userEvent.setup();
    const camera = structuredClone(store.getState().document.outputCamera);
    const objects = structuredClone(store.getState().document.objects);
    render(<Inspector store={store} />);
    await user.click(screen.getByRole('button', { name: '조명' }));

    const preset = screen.getByLabelText('조명 프리셋');
    expect(within(preset).getAllByRole('option')).toHaveLength(
      LIGHTING_PRESETS.length,
    );
    await user.selectOptions(preset, 'sunset');
    expect(store.getState().document.lighting).toEqual(
      LIGHTING_PRESETS[2].value,
    );
    expect(store.getState().document.background.color).toBe(
      LIGHTING_PRESETS[2].backgroundColor,
    );

    const exposure = screen.getByLabelText('노출');
    fireEvent.change(exposure, {
      target: { value: '1.35' },
    });
    fireEvent.blur(exposure);
    fireEvent.change(screen.getByLabelText('배경 색상'), {
      target: { value: '#112233' },
    });
    const keyDirectionX = screen.getByLabelText('키 라이트 방향 X');
    fireEvent.change(keyDirectionX, {
      target: { value: '-2' },
    });
    fireEvent.blur(keyDirectionX);
    await user.click(screen.getByRole('checkbox', { name: '그림자' }));

    expect(store.getState().document).toMatchObject({
      lighting: {
        presetId: 'sunset',
        exposure: 1.35,
        key: { direction: { x: -2 } },
        shadows: { enabled: false },
      },
      background: { color: '#112233' },
      outputCamera: camera,
      objects,
    });

    await user.click(screen.getByRole('button', { name: '프리셋으로 재설정' }));
    expect(store.getState().document).toMatchObject({
      lighting: LIGHTING_PRESETS[2].value,
      background: { color: LIGHTING_PRESETS[2].backgroundColor },
      outputCamera: camera,
      objects,
    });
  });
});

describe('EditorShortcuts', () => {
  it('input/textarea/select/contenteditable target을 scene shortcut에서 제외한다', () => {
    for (const tagName of ['input', 'textarea', 'select']) {
      expect(isSceneShortcutTarget(document.createElement(tagName))).toBe(true);
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.append(child);
    expect(isSceneShortcutTarget(child)).toBe(true);
    expect(isSceneShortcutTarget(document.createElement('button'))).toBe(false);
  });

  it('W/E/R, duplicate, delete, Escape를 처리하고 focused input에서는 무시한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore(['mannequin-copy']);
    store.getState().selectObject(MANNEQUIN_ID);
    render(
      <>
        <EditorShortcuts store={store} />
        <input aria-label="편집 입력" />
      </>,
    );

    await user.keyboard('wEr');
    expect(store.getState().transformMode).toBe('scale');

    const input = screen.getByLabelText('편집 입력');
    await user.click(input);
    await user.keyboard('{Delete}');
    expect(store.getState().selectedObjectId).toBe(MANNEQUIN_ID);

    input.blur();
    await user.keyboard('{Control>}d{/Control}');
    expect(store.getState().selectedObjectId).toBe('mannequin-copy');

    store.getState().beginTransform();
    await user.keyboard('{Escape}');
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().inProgressTransform).toBeNull();

    store.getState().selectObject('mannequin-copy');
    await user.keyboard('{Backspace}');
    expect(
      store
        .getState()
        .document.objects.some(({ id }) => id === 'mannequin-copy'),
    ).toBe(false);
  });
});
