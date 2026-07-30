import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import { createEditorStore } from '../state/editorStore';
import { EditorShell } from './EditorShell';

function createTestStore() {
  return createEditorStore({
    initialDocument: createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: 'mannequin-test',
    }),
    idFactory: () => 'generated-test',
  });
}

describe('EditorShell', () => {
  it('에셋, 뷰포트, 속성의 3열 편집 작업 영역을 표시한다', () => {
    render(<EditorShell store={createTestStore()} webGLState="available" />);

    expect(
      screen.getByRole('complementary', { name: '에셋과 장면' }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: '장면 뷰포트' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: '속성' })).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 1, name: 'I2V 3D Scene Helper' }),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: '장면 시작' })).toBeVisible();
    expect(screen.getByRole('group', { name: '파일과 출력' })).toBeVisible();
  });

  it('화면비와 가이드를 바꾸고 기본 장면으로 초기화한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addObject({ kind: 'cube', name: '테스트 큐브' });
    render(<EditorShell store={store} webGLState="available" />);

    await user.selectOptions(screen.getByLabelText('화면비'), '9:16');
    expect(store.getState().document.output).toMatchObject({
      aspectRatioId: '9:16',
      width: 1080,
      height: 1920,
    });

    await user.click(screen.getByRole('checkbox', { name: '3분할선' }));
    expect(store.getState().guideVisibility.thirds).toBe(true);

    await user.click(
      screen.getByRole('button', { name: '모든 가이드 숨기기' }),
    );
    expect(store.getState().guideVisibility).toMatchObject({
      thirds: false,
      center: false,
      actionSafe: false,
      titleSafe: false,
    });

    await user.click(
      screen.getByRole('button', { name: '기본 장면으로 초기화' }),
    );
    expect(
      store
        .getState()
        .document.objects.some(({ name }) => name === '테스트 큐브'),
    ).toBe(false);
  });

  it('아웃라이너 선택을 store와 속성 숫자 입력에 연결한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);

    expect(screen.getByLabelText('위치 X')).toBeDisabled();
    expect(screen.getByLabelText('회전 X')).toBeDisabled();
    expect(screen.getByLabelText('크기 X')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Mannequin' }));

    expect(store.getState().selectedObjectId).toBe('mannequin-test');
    expect(screen.getByLabelText('위치 Y')).toHaveValue(0.85);
    expect(screen.getByLabelText('회전 X')).toHaveValue(0);
    expect(screen.getByLabelText('크기 X')).toHaveValue(1);
    expect(screen.getByLabelText('위치 X')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mannequin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('한국어 시작 안내와 현재 세션 범위의 조작만 제공한다', () => {
    render(<EditorShell store={createTestStore()} webGLState="available" />);

    expect(
      screen.getByText('기본 마네킹을 선택하고 화면비와 가이드를 정해 보세요.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '큐브 추가' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '구 추가' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '원기둥 추가' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '평면 추가' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '마네킹 추가' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '로컬 저장' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '최근 장면 열기' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'JSON 가져오기' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'JSON 내보내기' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'PNG 내보내기' })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: '실행 취소' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '다시 실행' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        '이 편집기는 1280×720 이상의 데스크톱 화면이 필요합니다.',
      ),
    ).toBeInTheDocument();
  });

  it('상태 표시줄에서 선택과 변형 모드를 알린다', async () => {
    const user = userEvent.setup();
    render(<EditorShell store={createTestStore()} webGLState="available" />);

    expect(screen.getByText('선택 없음 · 이동 모드 · 16:9')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Floor' }));
    expect(screen.getByText('Floor 선택됨 · 이동 모드 · 16:9')).toBeVisible();
  });

  it('속성 패널 탭 상태를 store와 동기화한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);

    expect(screen.getByRole('group', { name: '속성 패널' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '카메라' }));

    expect(store.getState().activePanel).toBe('camera');
    expect(screen.getByRole('button', { name: '카메라' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('region', { name: '카메라' })).toBeVisible();
    expect(
      screen.getByText('카메라 설정은 카메라 구성 단계에서 제공됩니다.'),
    ).toBeVisible();
    expect(screen.queryByLabelText('위치 X')).not.toBeInTheDocument();
  });
});
