import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_PANEL_COLLAPSED_STORAGE_KEY,
  ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
  SCENE_STORAGE_KEY,
} from '../constants';
import { encodeSceneDocument } from '../persistence/sceneCodec';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import { createEditorStore } from '../state/editorStore';
import { EditorShell } from './EditorShell';
import type {
  CompanionBrowserClient,
  GenerationRecord,
} from '../../assistant/companionClient';
import { TEST_LAYOUT_SPEC } from '../../../shared/layoutSpecTestFixture';

const sceneViewportModuleLoaded = vi.hoisted(() => vi.fn());
const sceneViewportFailure = vi.hoisted(() => ({
  current: null as Error | null,
}));

vi.mock('../scene/SceneViewport', () => {
  sceneViewportModuleLoaded();
  return {
    SceneViewport: () => {
      if (sceneViewportFailure.current !== null)
        throw sceneViewportFailure.current;
      return null;
    },
  };
});

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

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('EditorShell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sceneViewportModuleLoaded.mockClear();
    sceneViewportFailure.current = null;
  });

  it('WebGL fallback에서는 viewport chunk를 불러오지 않는다', async () => {
    render(
      <EditorShell
        store={createTestStore()}
        webGLState="fallback"
        canvasEnabled
      />,
    );

    expect(
      await screen.findByText(
        'WebGL을 사용할 수 없어 3D 장면을 표시할 수 없습니다.',
      ),
    ).toBeVisible();
    expect(sceneViewportModuleLoaded).not.toHaveBeenCalled();
  });

  it('viewport render 오류가 나도 serialized scene을 보존하고 복구 안내를 표시한다', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const store = createTestStore();
    store.getState().addObject({ kind: 'cube', name: 'Preserved cube' });
    const preservedDocument = structuredClone(store.getState().document);
    sceneViewportFailure.current = new Error('forced viewport failure');

    render(<EditorShell store={store} webGLState="available" canvasEnabled />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '3D 뷰포트를 표시하지 못했습니다. 직렬화된 장면 데이터는 보존되었습니다.',
    );
    expect(
      screen.getByRole('button', { name: 'Preserved cube' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'JSON 내보내기' })).toBeEnabled();
    expect(
      screen.getByText('WebGL을 사용할 수 없어 기본 안내 화면을 표시합니다.'),
    ).toHaveAttribute('data-webgl-state', 'fallback');
    expect(screen.getByRole('button', { name: 'PNG 내보내기' })).toBeDisabled();
    expect(store.getState().document).toEqual(preservedDocument);
    expect(consoleError).toHaveBeenCalled();
  });

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

  it('3D 씬과 키프레임 작업 모드를 전환하고 선택한 완료 generation으로 보정에 진입한다', async () => {
    const user = userEvent.setup();
    const scene = createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: 'mannequin-test',
    });
    const generation: GenerationRecord = {
      id: 'generation-selected',
      threadId: 'thread-test',
      turnId: 'turn-test',
      status: 'completed',
      prompt: '$imagegen selected',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: scene,
      referenceSnapshots: [],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
      generationMode: 'fresh',
      layoutRenderId: 'render-selected',
      referenceIds: [],
      attachments: [{ type: 'layout', id: 'render-selected', kind: 'layout' }],
      revisedPrompt: null,
      result: {
        artifactId: 'artifact-selected',
        contentHash: `sha256:${'a'.repeat(64)}`,
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
        byteLength: 3,
      },
      error: null,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:01:00.000Z',
    };
    const client: CompanionBrowserClient = {
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      startThread: async () => 'thread-test',
      startTurn: async () => 'turn-test',
      interruptTurn: async () => undefined,
      listReferences: async () => [],
      importReference: async () => {
        throw new Error('not used');
      },
      updateReference: async () => {
        throw new Error('not used');
      },
      loadReferenceBlob: async () => new Blob(),
      createSceneRender: async () => {
        throw new Error('not used');
      },
      loadSceneRenderBlob: async () =>
        new Blob(['layout'], { type: 'image/png' }),
      listGenerations: async () => [generation],
      startGeneration: async () => {
        throw new Error('not used');
      },
      loadGenerationBlob: async () =>
        new Blob(['result'], { type: 'image/png' }),
      subscribe: () => () => undefined,
    };
    const storage = createMemoryStorage();
    const store = createTestStore();

    render(
      <EditorShell
        store={store}
        webGLState="available"
        storage={storage}
        companionConnection={{
          version: 1,
          url: 'http://127.0.0.1:61234',
          token: 'a'.repeat(43),
        }}
        assistantClientFactory={() => client}
        createAssistantObjectUrl={() => 'blob:test'}
        revokeAssistantObjectUrl={() => undefined}
      />,
    );

    const modes = screen.getByRole('group', { name: '작업 모드' });
    expect(
      within(modes).getByRole('button', { name: '3D 씬' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(modes).getByRole('button', { name: '키프레임' }));
    expect(
      await screen.findByRole('heading', { name: '키프레임 작업 공간' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('region', { name: '장면 뷰포트' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '삭제' }),
    ).not.toBeInTheDocument();
    act(() => store.getState().selectObject('mannequin-test'));
    await user.keyboard('{Delete}');
    expect(
      store
        .getState()
        .document.objects.some(({ id }) => id === 'mannequin-test'),
    ).toBe(true);

    await user.click(
      await screen.findByRole('button', { name: '선택 결과로 보정' }),
    );
    expect(screen.getByRole('region', { name: '장면 뷰포트' })).toBeVisible();
    expect(await screen.findByText('키프레임 보정 모드')).toBeVisible();
    expect(screen.getByText(/v1.*generation-selected.*결과/)).toBeVisible();
  });

  it('우측 패널 너비를 키보드로 조절하고 확장·접기 상태를 저장한다', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage({
      [ASSISTANT_PANEL_WIDTH_STORAGE_KEY]: '400',
    });
    const view = render(
      <EditorShell
        store={createTestStore()}
        webGLState="available"
        storage={storage}
      />,
    );

    const separator = screen.getByRole('separator', {
      name: '우측 패널 너비 조절',
    });
    expect(separator).toHaveAttribute('aria-valuenow', '400');
    separator.focus();
    await user.keyboard('{ArrowLeft}');
    expect(separator).toHaveAttribute('aria-valuenow', '416');
    await waitFor(() =>
      expect(storage.getItem(ASSISTANT_PANEL_WIDTH_STORAGE_KEY)).toBe('416'),
    );

    await user.click(screen.getByRole('button', { name: '넓게' }));
    expect(Number(separator.getAttribute('aria-valuenow'))).toBeGreaterThan(
      416,
    );
    await user.click(screen.getByRole('button', { name: '이전 너비' }));
    expect(separator).toHaveAttribute('aria-valuenow', '416');

    await user.click(screen.getByRole('button', { name: '접기' }));
    expect(
      screen.getByRole('button', { name: '우측 패널 펼치기' }),
    ).toBeVisible();
    expect(separator).toHaveAttribute('tabindex', '-1');
    await waitFor(() =>
      expect(storage.getItem(ASSISTANT_PANEL_COLLAPSED_STORAGE_KEY)).toBe(
        'true',
      ),
    );

    await user.click(screen.getByRole('button', { name: '우측 패널 펼치기' }));
    expect(
      screen.getByRole('heading', { name: 'Scene Assistant' }),
    ).toBeVisible();
    view.unmount();

    render(
      <EditorShell
        store={createTestStore()}
        webGLState="available"
        storage={storage}
      />,
    );
    expect(
      screen.getByRole('separator', { name: '우측 패널 너비 조절' }),
    ).toHaveAttribute('aria-valuenow', '416');
  });

  it('화면비와 가이드를 바꾸고 기본 장면으로 초기화한다', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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

    const nameInput = screen.getByLabelText('오브젝트 이름');
    await user.clear(nameInput);
    await user.type(nameInput, '정민');
    await user.keyboard('{Enter}');

    expect(store.getState().document.objects[1]?.name).toBe('정민');
    expect(screen.getByRole('button', { name: '정민' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('한국어 시작 안내와 asset 추가를 제공하되 PNG 출력은 비활성화한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);

    expect(
      screen.getByText('기본 마네킹을 선택하고 화면비와 가이드를 정해 보세요.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '큐브 추가' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '구 추가' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '원기둥 추가' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '평면 추가' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '마네킹 추가' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '방 세트 추가' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '방 세트 추가' }));
    expect(store.getState().document.objects.at(-1)).toMatchObject({
      id: 'generated-test',
      kind: 'room',
      name: 'Room Set',
      dimensions: { x: 4, y: 2.7, z: 4 },
      transform: { position: { x: 0, y: 1.35, z: 0 } },
    });
    expect(store.getState().selectedObjectId).toBe('generated-test');
    expect(screen.getByRole('button', { name: 'PNG 내보내기' })).toBeDisabled();
    expect(
      screen.getByText(
        '이 편집기는 1280×720 이상의 데스크톱 화면이 필요합니다.',
      ),
    ).toBeInTheDocument();
  });

  it('상태 표시줄에서 선택과 변형 모드를 알린다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);

    expect(screen.getByText('선택 없음 · 이동 모드 · 16:9')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Floor' }));
    expect(screen.getByText('Floor 선택됨 · 이동 모드 · 16:9')).toBeVisible();

    act(() => store.getState().setStatusMessage('카메라 동작 완료'));
    expect(
      screen.getByText('카메라 동작 완료 · Floor 선택됨 · 이동 모드 · 16:9'),
    ).toBeVisible();
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
    expect(screen.getByLabelText('렌즈')).toBeVisible();
    expect(screen.getByRole('group', { name: '샷 프리셋' })).toBeVisible();
    expect(screen.queryByLabelText('위치 X')).not.toBeInTheDocument();
  });

  it('toolbar 조작 action과 전역 transform shortcut을 실제 shell에 연결한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);
    await user.click(screen.getByRole('button', { name: 'Mannequin' }));
    const actions = screen.getByRole('group', { name: '오브젝트 조작' });

    await user.click(within(actions).getByRole('button', { name: '복제' }));
    expect(store.getState().selectedObjectId).toBe('generated-test');
    expect(store.getState().document.objects).toHaveLength(3);

    await user.keyboard('e');
    expect(store.getState().transformMode).toBe('rotate');

    await user.click(within(actions).getByRole('button', { name: '삭제' }));
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().document.objects).toHaveLength(2);
  });

  it('undo/redo 버튼과 Cmd/Ctrl+Z shortcut을 focus guard와 함께 연결한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);
    const undoButton = screen.getByRole('button', { name: '실행 취소' });
    const redoButton = screen.getByRole('button', { name: '다시 실행' });

    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '큐브 추가' }));
    expect(undoButton).toBeEnabled();

    await user.click(undoButton);
    expect(store.getState().document.objects).toHaveLength(2);
    expect(redoButton).toBeEnabled();

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(store.getState().document.objects).toHaveLength(3);

    const screenRatio = screen.getByLabelText('화면비');
    await user.click(screenRatio);
    await user.keyboard('{Control>}z{/Control}');
    expect(store.getState().document.objects).toHaveLength(3);

    await user.click(
      screen.getByRole('heading', { name: 'I2V 3D Scene Helper' }),
    );
    await user.keyboard('{Control>}z{/Control}');
    expect(store.getState().document.objects).toHaveLength(2);
  });

  it('local save/reopen과 validated JSON file import를 toolbar에 연결한다', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const store = createTestStore();
    const storage = createMemoryStorage();
    render(
      <EditorShell store={store} storage={storage} webGLState="available" />,
    );

    await user.click(screen.getByRole('button', { name: '큐브 추가' }));
    await user.click(screen.getByRole('button', { name: '로컬 저장' }));
    const saved = storage.getItem(SCENE_STORAGE_KEY);
    expect(saved).not.toBeNull();
    expect(store.getState().isDirty).toBe(false);

    act(() => store.getState().renameObject('generated-test', 'Unsaved cube'));
    await user.click(screen.getByRole('button', { name: '최근 장면 열기' }));
    expect(
      store
        .getState()
        .document.objects.find(({ id }) => id === 'generated-test')?.name,
    ).toBe('Cube');
    expect(store.getState().isDirty).toBe(false);

    const imported = createStarterSceneDocument({
      documentId: 'scene-file',
      floorId: 'floor-file',
      mannequinId: 'mannequin-file',
    });
    imported.name = 'Imported file';
    await user.upload(
      screen.getByLabelText('장면 JSON 파일'),
      new File([encodeSceneDocument(imported)], 'scene.json', {
        type: 'application/json',
      }),
    );

    await waitFor(() =>
      expect(store.getState()).toMatchObject({
        document: { id: 'scene-file', name: 'Imported file' },
        isDirty: true,
      }),
    );
    expect(screen.getByRole('button', { name: 'JSON 내보내기' })).toBeEnabled();
  });

  it('dirty document의 reset, reopen, valid import를 확인 없이 교체하지 않는다', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const store = createTestStore();
    const storage = createMemoryStorage({
      [SCENE_STORAGE_KEY]: encodeSceneDocument(store.getState().document),
    });
    render(
      <EditorShell store={store} storage={storage} webGLState="available" />,
    );
    await user.click(screen.getByRole('button', { name: '큐브 추가' }));
    const dirtyDocument = store.getState().document;

    await user.click(screen.getByRole('button', { name: '최근 장면 열기' }));
    await user.click(screen.getByRole('button', { name: '새 장면' }));

    const imported = createStarterSceneDocument({
      documentId: 'blocked-import',
      floorId: 'blocked-floor',
      mannequinId: 'blocked-mannequin',
    });
    const input = screen.getByLabelText('장면 JSON 파일');
    expect(input).toHaveAttribute('tabindex', '-1');
    await user.upload(
      input,
      new File([encodeSceneDocument(imported)], 'blocked.json', {
        type: 'application/json',
      }),
    );

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(3));
    expect(store.getState().document).toBe(dirtyDocument);
    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().statusMessage).toBe(
      'JSON 장면 가져오기를 취소했습니다.',
    );
  });

  it('늦게 완료된 이전 JSON import가 더 최신 import 결과를 덮어쓰지 않는다', async () => {
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);
    const input = screen.getByLabelText('장면 JSON 파일');
    const first = createStarterSceneDocument({
      documentId: 'first-import',
      floorId: 'first-floor',
      mannequinId: 'first-mannequin',
    });
    const second = createStarterSceneDocument({
      documentId: 'second-import',
      floorId: 'second-floor',
      mannequinId: 'second-mannequin',
    });
    let resolveFirst!: (value: string) => void;
    const firstFile = {
      size: encodeSceneDocument(first).length,
      text: () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    } as File;
    const secondFile = {
      size: encodeSceneDocument(second).length,
      text: () => Promise.resolve(encodeSceneDocument(second)),
    } as File;

    fireEvent.change(input, { target: { files: [firstFile] } });
    expect(
      screen.getByRole('button', { name: 'JSON 가져오기' }),
    ).toBeDisabled();
    fireEvent.change(input, { target: { files: [secondFile] } });

    await waitFor(() =>
      expect(store.getState().document.id).toBe('second-import'),
    );
    await act(async () => {
      resolveFirst(encodeSceneDocument(first));
      await Promise.resolve();
    });

    expect(store.getState().document.id).toBe('second-import');
  });

  it('malformed JSON import 실패 시 live scene과 valid autosave를 모두 보존한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const validAutosave = encodeSceneDocument(store.getState().document);
    const storage = createMemoryStorage({
      [SCENE_STORAGE_KEY]: validAutosave,
    });
    render(
      <EditorShell store={store} storage={storage} webGLState="available" />,
    );
    act(() => store.getState().addObject({ kind: 'cube' }));
    const liveDocument = store.getState().document;

    await user.upload(
      screen.getByLabelText('장면 JSON 파일'),
      new File(['{"version":1}'], 'broken.json', {
        type: 'application/json',
      }),
    );

    await waitFor(() =>
      expect(store.getState().statusMessage).toMatch(
        /유효하지 않은 장면 데이터/,
      ),
    );
    expect(store.getState().document).toBe(liveDocument);
    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(validAutosave);
  });
});
