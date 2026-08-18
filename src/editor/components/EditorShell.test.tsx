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
  REFERENCE_TRAY_COLLAPSED_STORAGE_KEY,
  RIGHT_PANEL_TAB_STORAGE_KEY,
  SCENE_STORAGE_KEY,
} from '../constants';
import { encodeSceneDocument } from '../persistence/sceneCodec';
import { PRE_APPLY_RECOVERY_STORAGE_KEY } from '../persistence/sceneRecovery';
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

function createGenerationFixture(id = 'generation-apply'): GenerationRecord {
  const scene = createStarterSceneDocument({
    documentId: 'scene-generation',
    floorId: 'floor-generation',
    mannequinId: 'mannequin-generation',
  });
  return {
    id,
    threadId: 'thread-test',
    turnId: `turn-${id}`,
    status: 'completed',
    prompt: '$imagegen apply',
    layoutSpec: { ...TEST_LAYOUT_SPEC, sceneId: scene.id },
    sceneSnapshot: scene,
    semanticSceneSpecSnapshot: structuredClone(scene.semanticSceneSpec),
    referenceSnapshots: [],
    parentGenerationId: null,
    versionNumber: 3,
    feedback: null,
    refinementDirective: null,
    generationMode: 'fresh',
    layoutRenderId: `render-${id}`,
    sceneIntegrity: {
      status: 'valid',
      snapshotSceneId: scene.id,
      layoutSpecSceneId: scene.id,
      layoutRenderSceneId: scene.id,
    },
    referenceIds: [],
    attachments: [{ type: 'layout', id: `render-${id}`, kind: 'layout' }],
    revisedPrompt: null,
    result: {
      artifactId: `artifact-${id}`,
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
}

function clientWithGeneration(
  generation: GenerationRecord,
): CompanionBrowserClient {
  return {
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
    deleteReference: async () => {
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
    loadGenerationBlob: async () => new Blob(['result'], { type: 'image/png' }),
    subscribe: () => () => undefined,
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
      semanticSceneSpecSnapshot: structuredClone(scene.semanticSceneSpec),
      referenceSnapshots: [],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
      refinementDirective: null,
      generationMode: 'fresh',
      layoutRenderId: 'render-selected',
      sceneIntegrity: {
        status: 'valid',
        snapshotSceneId: 'scene-test',
        layoutSpecSceneId: 'scene-test',
        layoutRenderSceneId: 'scene-test',
      },
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
      deleteReference: async () => {
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
    store.getState().addObject({ kind: 'cube', name: '현재 편집 큐브' });
    store.getState().selectObject('mannequin-test');
    const editorStateBeforePreview = {
      document: store.getState().document,
      history: store.getState().history,
      selectedObjectId: store.getState().selectedObjectId,
      isDirty: store.getState().isDirty,
    };

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
      screen.getByRole('heading', { name: 'Generation 이력' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Scene Assistant' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: '장면 뷰포트' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '삭제' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Delete}');
    expect(
      store
        .getState()
        .document.objects.some(({ id }) => id === 'mannequin-test'),
    ).toBe(true);

    await user.click(
      screen.getByRole('button', { name: '생성 당시 3D 씬 미리보기' }),
    );
    expect(
      screen.getByRole('img', { name: '생성 당시 3D 씬 읽기 전용 미리보기' }),
    ).toBeVisible();
    expect(store.getState().document).toBe(editorStateBeforePreview.document);
    expect(store.getState().history).toBe(editorStateBeforePreview.history);
    expect(store.getState().selectedObjectId).toBe(
      editorStateBeforePreview.selectedObjectId,
    );
    expect(store.getState().isDirty).toBe(editorStateBeforePreview.isDirty);

    await user.click(
      await screen.findByRole('button', { name: '선택 결과로 보정' }),
    );
    expect(screen.getByRole('region', { name: '장면 뷰포트' })).toBeVisible();
    expect(await screen.findByText('키프레임 보정 모드')).toBeVisible();
    expect(screen.getByText(/v1.*generation-selected.*결과/)).toBeVisible();
  });

  it('키프레임 탭을 다녀와도 활성화된 장면 대화와 메시지를 유지하고 이어하기를 다시 묻지 않는다', async () => {
    const user = userEvent.setup();
    const startThread = vi.fn(
      async (threadId?: string) => threadId ?? 'thread-new',
    );
    const startConversationTurn = vi.fn(async () => 'turn-next');
    const client: CompanionBrowserClient = {
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      getConversationSession: async () => ({
        version: 1,
        activeTask: {
          threadId: 'thread-live',
          state: 'active',
          turnCount: 2,
          lastTurnId: 'turn-saved',
          lastTurnKind: 'conversation',
          lastTurnStatus: 'completed',
          lastUserMessage: '조명을 더 따뜻하게 해줘.',
          lastAssistantSummary: '조명 변경안을 준비했습니다.',
          sceneRevision: 3,
          specRevision: 2,
          generationIntent: null,
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:01:00.000Z',
        },
        archivedTaskCount: 0,
      }),
      startThread,
      startTurn: async () => 'turn-fallback',
      startConversationTurn,
      interruptTurn: async () => undefined,
      listReferences: async () => [],
      importReference: async () => {
        throw new Error('not used');
      },
      updateReference: async () => {
        throw new Error('not used');
      },
      deleteReference: async () => {
        throw new Error('not used');
      },
      loadReferenceBlob: async () => new Blob(),
      createSceneRender: async () => {
        throw new Error('not used');
      },
      loadSceneRenderBlob: async () =>
        new Blob(['layout'], { type: 'image/png' }),
      listGenerations: async () => [],
      startGeneration: async () => {
        throw new Error('not used');
      },
      loadGenerationBlob: async () =>
        new Blob(['result'], { type: 'image/png' }),
      subscribe: () => () => undefined,
    };
    render(
      <EditorShell
        store={createTestStore()}
        webGLState="available"
        storage={createMemoryStorage({
          [RIGHT_PANEL_TAB_STORAGE_KEY]: 'assistant',
        })}
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

    const choice = await screen.findByRole('article', {
      name: '저장된 Codex task 선택',
    });
    await user.click(
      within(choice).getByRole('button', { name: '저장된 task 재개' }),
    );
    await user.type(
      await screen.findByLabelText('장면에 대해 말하기'),
      '이 조명 그대로 유지해줘.',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByText('이 조명 그대로 유지해줘.')).toBeVisible();
    expect(screen.getByText('장면 대화')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '키프레임' }));
    expect(
      await screen.findByRole('heading', { name: '키프레임 작업 공간' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '3D 씬' }));

    expect(
      screen.queryByRole('article', { name: '저장된 Codex task 선택' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('장면 대화')).toBeVisible();
    expect(screen.getByText('이 조명 그대로 유지해줘.')).toBeVisible();
  });

  it('pre-apply save 실패 시 live scene, selection, history, dirty와 autosave를 전혀 변경하지 않는다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addObject({ kind: 'cube', name: '현재 편집 큐브' });
    store.getState().selectObject('mannequin-test');
    const validAutosave = encodeSceneDocument(store.getState().document);
    const base = createMemoryStorage({ [SCENE_STORAGE_KEY]: validAutosave });
    const storage: Storage = {
      ...base,
      setItem(key, value) {
        if (key === PRE_APPLY_RECOVERY_STORAGE_KEY) {
          throw new Error('forced recovery write failure');
        }
        base.setItem(key, value);
      },
    };
    const before = {
      document: store.getState().document,
      selectedObjectId: store.getState().selectedObjectId,
      history: store.getState().history,
      isDirty: store.getState().isDirty,
      autosave: storage.getItem(SCENE_STORAGE_KEY),
    };
    const generation = createGenerationFixture();

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
        assistantClientFactory={() => clientWithGeneration(generation)}
        createAssistantObjectUrl={() => 'blob:test'}
        revokeAssistantObjectUrl={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: '키프레임' }));
    await user.click(
      await screen.findByRole('button', { name: '현재 씬으로 불러오기' }),
    );
    await user.click(screen.getByRole('button', { name: '현재 씬으로 적용' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '적용 전 복구 지점을 브라우저에 저장하지 못했습니다',
    );
    expect(store.getState().document).toBe(before.document);
    expect(store.getState().selectedObjectId).toBe(before.selectedObjectId);
    expect(store.getState().history).toBe(before.history);
    expect(store.getState().isDirty).toBe(before.isDirty);
    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(before.autosave);
  });

  it('snapshot 적용 후 3D 모드와 provenance를 표시하고 undo 및 reload-safe recovery로 직전 상태를 복원한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    store.getState().addObject({ kind: 'cube', name: '복원할 큐브' });
    store.getState().selectObject('mannequin-test');
    const beforeDocument = structuredClone(store.getState().document);
    const beforeSelection = store.getState().selectedObjectId;
    const storage = createMemoryStorage({
      [SCENE_STORAGE_KEY]: encodeSceneDocument(beforeDocument),
    });
    const generation = createGenerationFixture('generation-safe-apply');
    const view = render(
      <EditorShell
        store={store}
        webGLState="available"
        storage={storage}
        companionConnection={{
          version: 1,
          url: 'http://127.0.0.1:61234',
          token: 'a'.repeat(43),
        }}
        assistantClientFactory={() => clientWithGeneration(generation)}
        createAssistantObjectUrl={() => 'blob:test'}
        revokeAssistantObjectUrl={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: '키프레임' }));
    await user.click(
      await screen.findByRole('button', { name: '현재 씬으로 불러오기' }),
    );
    await user.click(screen.getByRole('button', { name: '현재 씬으로 적용' }));

    expect(screen.getByRole('region', { name: '장면 뷰포트' })).toBeVisible();
    expect(store.getState().document).toMatchObject({
      id: 'scene-generation',
      generationSource: {
        generationId: 'generation-safe-apply',
        versionNumber: 3,
      },
    });
    expect(
      screen.getByRole('status', { name: '적용된 generation 출처' }),
    ).toHaveTextContent('generation-safe-apply · v3 · fresh');
    expect(storage.getItem(PRE_APPLY_RECOVERY_STORAGE_KEY)).not.toBeNull();
    expect(JSON.parse(storage.getItem(SCENE_STORAGE_KEY)!)).toEqual(
      beforeDocument,
    );

    await user.click(screen.getByRole('button', { name: '실행 취소' }));
    expect(store.getState().document).toEqual({
      ...beforeDocument,
      sceneRevision: 3,
    });
    expect(store.getState().selectedObjectId).toBe(beforeSelection);

    store.getState().redo();
    const appliedDocument = structuredClone(store.getState().document);
    storage.setItem(SCENE_STORAGE_KEY, encodeSceneDocument(appliedDocument));
    view.unmount();
    const reloadStore = createEditorStore({
      initialDocument: appliedDocument,
      idFactory: () => 'reload-generated',
    });
    render(
      <EditorShell
        store={reloadStore}
        webGLState="available"
        storage={storage}
      />,
    );

    await user.click(screen.getByRole('button', { name: '적용 전 씬 복구' }));
    expect(reloadStore.getState().document).toEqual({
      ...beforeDocument,
      sceneRevision: 5,
    });
    expect(reloadStore.getState().selectedObjectId).toBe(beforeSelection);
    expect(storage.getItem(PRE_APPLY_RECOVERY_STORAGE_KEY)).toBeNull();
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
    await user.click(screen.getByRole('tab', { name: 'Assistant' }));
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

  it('우측 패널의 속성과 Assistant를 탭으로 전환하고 상태를 저장한다', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const view = render(
      <EditorShell
        store={createTestStore()}
        webGLState="available"
        storage={storage}
      />,
    );

    expect(screen.getByRole('heading', { name: '속성' })).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Scene Assistant' }),
    ).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Assistant' }));
    expect(screen.queryByRole('heading', { name: '속성' })).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Scene Assistant' }),
    ).toBeVisible();
    await waitFor(() =>
      expect(storage.getItem(RIGHT_PANEL_TAB_STORAGE_KEY)).toBe('assistant'),
    );
    view.unmount();

    render(
      <EditorShell
        store={createTestStore()}
        webGLState="available"
        storage={storage}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Scene Assistant' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: '속성' })).toBeNull();
  });

  it('하단 레퍼런스 트레이를 접고 펼치며 상태를 저장한다', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const view = render(
      <EditorShell
        store={createTestStore()}
        webGLState="available"
        storage={storage}
      />,
    );

    expect(screen.getByRole('heading', { name: 'References' })).toBeVisible();
    expect(screen.getByText(/Companion 연결 후/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: '레퍼런스 접기' }));
    expect(screen.getByText(/Companion 연결 후/)).not.toBeVisible();
    expect(
      screen.getByRole('button', { name: '레퍼런스 펼치기' }),
    ).toBeVisible();
    await waitFor(() =>
      expect(storage.getItem(REFERENCE_TRAY_COLLAPSED_STORAGE_KEY)).toBe(
        'true',
      ),
    );
    view.unmount();

    render(
      <EditorShell
        store={createTestStore()}
        webGLState="available"
        storage={storage}
      />,
    );
    expect(screen.getByText(/Companion 연결 후/)).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: '레퍼런스 펼치기' }));
    expect(screen.getByText(/Companion 연결 후/)).toBeVisible();
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
    expect(
      screen.getByRole('button', { name: '라운드 큐브 추가' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: '곡면 추가' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '정삼각형 추가' })).toBeEnabled();
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

  it('T shortcut은 camera button과 같은 target action을 쓰고 focus/modifier guard를 지킨다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);
    await user.click(screen.getByRole('button', { name: 'Mannequin' }));
    await user.click(screen.getByRole('button', { name: '카메라' }));

    const original = structuredClone(store.getState().document.outputCamera);
    await user.click(
      screen.getByRole('button', { name: '선택을 타겟·초점으로 (T)' }),
    );
    const buttonCamera = structuredClone(
      store.getState().document.outputCamera,
    );
    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().document.outputCamera).toEqual(original);

    await user.keyboard('t');
    expect(store.getState().document.outputCamera).toEqual(buttonCamera);
    expect(store.getState().history.past).toHaveLength(1);

    store.getState().undo();
    const lens = screen.getByLabelText('렌즈');
    await user.click(lens);
    await user.keyboard('t');
    expect(store.getState().document.outputCamera).toEqual(original);
    await user.click(
      screen.getByRole('heading', { name: 'I2V 3D Scene Helper' }),
    );
    await user.keyboard('{Control>}t{/Control}');
    expect(store.getState().document.outputCamera).toEqual(original);

    store.getState().selectObject(null);
    await user.keyboard('t');
    expect(store.getState().document.outputCamera).toEqual(original);
    expect(store.getState().statusMessage).toBe(
      '카메라 타겟·초점으로 설정할 오브젝트를 먼저 선택하세요.',
    );
  });

  it('한국어 IME에서도 물리 T 키로 선택 오브젝트를 타겟·초점에 설정한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<EditorShell store={store} webGLState="available" />);
    await user.click(screen.getByRole('button', { name: 'Mannequin' }));

    const originalTarget = structuredClone(
      store.getState().document.outputCamera.target,
    );
    fireEvent.keyDown(window, { key: 'ㅅ', code: 'KeyT' });

    expect(store.getState().document.outputCamera.target).not.toEqual(
      originalTarget,
    );
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().statusMessage).toContain(
      '카메라 타겟·초점으로 설정했습니다.',
    );
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
