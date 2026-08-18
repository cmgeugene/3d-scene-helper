import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompanionBrowserClient,
  GenerationRecord,
} from './companionClient';
import { startGenerationInputSchema } from './companionClient';
import { SceneAssistantPanel } from './SceneAssistantPanel';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';
import { createEditorStore } from '../editor/state/editorStore';
import type { SpecPatchProposal } from '../editor/persistence/specPatchProposal';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';
import { GENERATION_REQUEST_RECOVERY_STORAGE_KEY } from './generationRequestRecovery';

const connection = {
  version: 1 as const,
  url: 'http://127.0.0.1:61234',
  token: 'a'.repeat(43),
};

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

const conversationMethods = {
  startThread: async () => 'thread-test',
  startTurn: async () => 'turn-test',
  interruptTurn: async () => undefined,
  listReferences: async () => [],
  importReference: async () => {
    throw new Error('not implemented in this test');
  },
  loadReferenceBlob: async () => new Blob(),
  updateReference: async () => {
    throw new Error('not implemented in this test');
  },
  deleteReference: async () => {
    throw new Error('not implemented in this test');
  },
  createSceneRender: async () => {
    throw new Error('not implemented in this test');
  },
  loadSceneRenderBlob: async () => new Blob(),
  listGenerations: async () => [],
  startGeneration: async () => {
    throw new Error('not implemented in this test');
  },
  loadGenerationBlob: async () => new Blob(),
};

const characterReference = {
  id: 'ref-character',
  name: '정민 캐릭터 시트',
  kind: 'character' as const,
  artifactId: 'artifact-character',
  contentHash: `sha256:${'a'.repeat(64)}`,
  mimeType: 'image/png' as const,
  width: 1536,
  height: 2048,
  originalFileName: 'jeongmin.png',
  byteLength: 1024,
  createdAt: '2026-08-03T00:00:00.000Z',
  targetObjectId: 'mannequin-blue',
  use: ['face', 'hair', 'clothing'],
  exclude: ['pose', 'background', 'text'],
  enabled: true,
};

describe('SceneAssistantPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('Codex 이미지 생성 지원과 무관하게 GPT 웹용 프롬프트를 내보낸다', async () => {
    const user = userEvent.setup();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-web-export',
      floorId: 'floor-web-export',
      mannequinId: 'mannequin-web-export',
    });
    const captureLayout = vi.fn(async () => new Blob());
    const startGeneration = vi.fn<CompanionBrowserClient['startGeneration']>();
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: false,
          webSearch: true,
        },
        error: null,
      }),
      startGeneration,
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        captureLayout={captureLayout}
        getSceneContext={() => sceneSnapshot}
        clientFactory={() => client}
      />,
    );

    await user.type(
      await screen.findByLabelText('장면에 대해 말하기'),
      '비 오는 밤의 영화 장면으로 만들어줘.',
    );
    expect(screen.getByRole('button', { name: '이미지 생성' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '웹으로 내보내기' }));

    expect(
      screen.getByRole('dialog', { name: 'GPT 웹용 프롬프트 내보내기' }),
    ).toBeVisible();
    const prompt =
      screen.getByLabelText<HTMLTextAreaElement>(
        'GPT 웹용 생성 프롬프트',
      ).value;
    expect(prompt).toContain('비 오는 밤의 영화 장면으로 만들어줘.');
    expect(prompt).toContain('[LayoutSpec /');
    expect(prompt).not.toContain('$imagegen');
    expect(
      screen.getByText('현재 OutputCamera의 3D 레이아웃 렌더'),
    ).toBeVisible();
    expect(captureLayout).not.toHaveBeenCalled();
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it('빠른 중복 클릭은 캡처와 generation 요청을 한 번만 시작한다', async () => {
    const user = userEvent.setup();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-double-click',
      floorId: 'floor-double-click',
      mannequinId: 'mannequin-double-click',
    });
    let resolveCapture: ((blob: Blob) => void) | undefined;
    const captureLayout = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          resolveCapture = resolve;
        }),
    );
    const startGeneration = vi.fn<CompanionBrowserClient['startGeneration']>(
      () => new Promise(() => undefined),
    );
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        error: null,
      }),
      createSceneRender: async () => ({
        id: 'render-double-click',
        sceneId: sceneSnapshot.id,
        artifactId: 'artifact-double-click',
        contentHash: `sha256:${'a'.repeat(64)}`,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteLength: 1,
        createdAt: '2026-08-04T00:00:00.000Z',
      }),
      startGeneration,
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        captureLayout={captureLayout}
        getSceneContext={() => sceneSnapshot}
        clientFactory={() => client}
      />,
    );
    await user.type(
      await screen.findByLabelText('장면에 대해 말하기'),
      '한 번만 생성해줘.',
    );
    await user.dblClick(screen.getByRole('button', { name: '이미지 생성' }));
    expect(captureLayout).toHaveBeenCalledOnce();

    resolveCapture?.(new Blob(['png'], { type: 'image/png' }));
    await waitFor(() => expect(startGeneration).toHaveBeenCalledOnce());
  });

  it('응답 유실 요청을 reload 뒤 같은 request ID로 재확인하고 복구 슬롯을 지운다', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-request-recovery',
      floorId: 'floor-request-recovery',
      mannequinId: 'mannequin-request-recovery',
    });
    const seenRequestIds: string[] = [];
    const startGeneration = vi.fn<CompanionBrowserClient['startGeneration']>(
      async (input) => {
        const normalized = startGenerationInputSchema.parse(input);
        seenRequestIds.push(normalized.requestId);
        if (seenRequestIds.length === 1) throw new Error('response lost');
        return {
          turnId: 'turn-request-recovery',
          reused: true,
          generation: {
            id: 'generation-request-recovery',
            requestId: normalized.requestId,
            threadId: normalized.threadId,
            turnId: 'turn-request-recovery',
            status: 'inProgress',
            prompt: normalized.prompt,
            layoutSpec: normalized.layoutSpec,
            sceneSnapshot: normalized.sceneSnapshot,
            semanticSceneSpecSnapshot: structuredClone(
              normalized.sceneSnapshot.semanticSceneSpec,
            ),
            referenceSnapshots: [],
            parentGenerationId: null,
            sourceGenerationId: null,
            versionNumber: 1,
            feedback: null,
            refinementDirective: null,
            generationMode: 'fresh',
            layoutRenderId: normalized.layoutRenderId,
            referenceIds: [],
            attachments: [
              {
                type: 'layout',
                id: normalized.layoutRenderId,
                kind: 'layout',
              },
            ],
            revisedPrompt: null,
            result: null,
            error: null,
            createdAt: '2026-08-04T00:00:00.000Z',
            updatedAt: '2026-08-04T00:00:00.000Z',
          },
        };
      },
    );
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        error: null,
      }),
      createSceneRender: async () => ({
        id: 'render-request-recovery',
        sceneId: sceneSnapshot.id,
        artifactId: 'artifact-request-recovery',
        contentHash: `sha256:${'b'.repeat(64)}`,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteLength: 1,
        createdAt: '2026-08-04T00:00:00.000Z',
      }),
      startGeneration,
      subscribe: () => () => undefined,
    };
    const renderPanel = () =>
      render(
        <SceneAssistantPanel
          connection={connection}
          storage={storage}
          captureLayout={async () => new Blob(['png'], { type: 'image/png' })}
          getSceneContext={() => sceneSnapshot}
          clientFactory={() => client}
        />,
      );

    const first = renderPanel();
    await user.type(
      await screen.findByLabelText('장면에 대해 말하기'),
      '응답이 유실돼도 한 번만 생성해줘.',
    );
    await user.click(screen.getByRole('button', { name: '이미지 생성' }));
    expect(
      await screen.findByRole('article', {
        name: '미확인 generation 요청 복구',
      }),
    ).toBeVisible();
    expect(storage.getItem(GENERATION_REQUEST_RECOVERY_STORAGE_KEY)).not.toBe(
      null,
    );

    first.unmount();
    renderPanel();
    const recoveryCard = await screen.findByRole('article', {
      name: '미확인 generation 요청 복구',
    });
    await user.click(
      within(recoveryCard).getByRole('button', {
        name: '같은 요청 안전하게 다시 확인',
      }),
    );

    await waitFor(() => expect(startGeneration).toHaveBeenCalledTimes(2));
    expect(seenRequestIds[0]).toBe(seenRequestIds[1]);
    expect(storage.getItem(GENERATION_REQUEST_RECOVERY_STORAGE_KEY)).toBeNull();
    expect(
      await screen.findByRole('status', { name: 'generation 요청 상태' }),
    ).toHaveTextContent(`${seenRequestIds[0]} · 진행 중`);
  });

  it('reload로 복원한 inProgress generation을 같은 turn ID로 중단한다', async () => {
    const user = userEvent.setup();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-active-generation',
      floorId: 'floor-active-generation',
      mannequinId: 'mannequin-active-generation',
    });
    const active: GenerationRecord = {
      id: 'generation-active',
      requestId: 'generation-request-active',
      threadId: 'thread-active',
      turnId: 'turn-active',
      status: 'inProgress',
      prompt: '$imagegen active',
      layoutSpec: { ...TEST_LAYOUT_SPEC, sceneId: sceneSnapshot.id },
      sceneSnapshot,
      semanticSceneSpecSnapshot: structuredClone(
        sceneSnapshot.semanticSceneSpec,
      ),
      referenceSnapshots: [],
      parentGenerationId: null,
      sourceGenerationId: null,
      versionNumber: 1,
      feedback: null,
      refinementDirective: null,
      generationMode: 'fresh',
      layoutRenderId: 'render-active',
      referenceIds: [],
      attachments: [{ type: 'layout', id: 'render-active', kind: 'layout' }],
      revisedPrompt: null,
      result: null,
      error: null,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };
    const interruptTurn = vi.fn(async () => undefined);
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      interruptTurn,
      listGenerations: async () => [active],
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        error: null,
      }),
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        getSceneContext={() => sceneSnapshot}
        clientFactory={() => client}
      />,
    );

    expect(
      await screen.findByRole('status', { name: 'generation 요청 상태' }),
    ).toHaveTextContent('진행 중');
    const cancel = screen.getByRole('button', { name: '응답 중단' });
    expect(cancel).toBeEnabled();
    await user.click(cancel);
    expect(interruptTurn).toHaveBeenCalledWith(active.threadId, active.turnId);
  });

  it('연결 정보가 없으면 로컬 개발 서버 연결 안내를 표시한다', () => {
    render(<SceneAssistantPanel connection={null} />);

    expect(screen.getByRole('status')).toHaveTextContent('연결 안 됨');
    expect(screen.getByText(/npm run dev:all/)).toBeVisible();
  });

  it('Companion runtime과 ChatGPT 플랜을 표시한다', async () => {
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test 0.146.0',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        clientFactory={() => client}
      />,
    );

    expect(await screen.findByText('ChatGPT · prolite')).toBeVisible();
    expect(
      screen.getByRole('status', { name: 'Companion 연결 상태' }),
    ).toHaveTextContent('연결됨');
  });

  it('연결 정보를 지울 수 있다', async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn();
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => {
        throw new Error('offline');
      },
      subscribe: () => () => undefined,
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        onDisconnect={disconnect}
        clientFactory={() => client}
      />,
    );

    await user.click(screen.getByRole('button', { name: '연결 정보 지우기' }));
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('SSE 연결 종료 뒤 상태를 자동 재조회하고 turn을 중복 실행하지 않는다', async () => {
    let eventError: Parameters<CompanionBrowserClient['subscribe']>[1] = () =>
      undefined;
    const getRuntime = vi.fn(async () => ({
      state: 'ready' as const,
      version: 'codex-reconnect-test',
      account: { type: 'chatgpt' as const, email: null, planType: 'plus' },
      requiresOpenaiAuth: true,
      error: null,
    }));
    const listGenerations = vi.fn(async () => []);
    const startTurn = vi.fn(async () => 'turn-must-not-start');
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime,
      listGenerations,
      startTurn,
      subscribe: (_listener, onError) => {
        eventError = onError;
        return () => undefined;
      },
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        clientFactory={() => client}
      />,
    );
    expect(await screen.findByText('ChatGPT · plus')).toBeVisible();

    act(() => eventError(new Error('Companion 이벤트 연결이 종료되었습니다.')));
    expect(await screen.findByText('Companion 자동 재연결 1/3')).toBeVisible();
    expect(screen.getByText(/자동으로 다시 실행하지 않습니다/)).toBeVisible();

    await waitFor(() => expect(getRuntime).toHaveBeenCalledTimes(2), {
      timeout: 2_000,
    });
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Companion 연결 상태' }),
      ).toHaveTextContent('연결됨'),
    );
    expect(listGenerations).toHaveBeenCalledTimes(2);
    expect(startTurn).not.toHaveBeenCalled();
  });

  it('현재 SceneDocument와 메시지를 turn으로 보내고 응답을 스트리밍한다', async () => {
    const user = userEvent.setup();
    let eventListener: Parameters<
      CompanionBrowserClient['subscribe']
    >[0] = () => undefined;
    const startThread = vi.fn(async () => 'thread-1');
    const startTurn = vi.fn(async (threadId: string, prompt: string) => {
      void threadId;
      void prompt;
      return 'turn-1';
    });
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      startThread,
      startTurn,
      interruptTurn: async () => undefined,
      listReferences: async () => [],
      importReference: conversationMethods.importReference,
      loadReferenceBlob: conversationMethods.loadReferenceBlob,
      updateReference: conversationMethods.updateReference,
      subscribe: (listener) => {
        eventListener = listener;
        return () => undefined;
      },
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        getSceneContext={() => ({ objects: [{ id: 'pole-1' }] })}
        getSelectedReferences={() => [characterReference]}
        clientFactory={() => client}
      />,
    );

    const input = await screen.findByLabelText('장면에 대해 말하기');
    await user.type(input, '노란 물체는 전봇대야.');
    await user.keyboard('{Shift>}{Enter}{/Shift}강한 아웃포커스야.');
    expect(startTurn).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');

    expect(startThread).toHaveBeenCalledOnce();
    expect(startTurn).toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining('노란 물체는 전봇대야.'),
      ['ref-character'],
    );
    expect(startTurn.mock.calls[0]?.[1]).toContain('"id":"pole-1"');
    expect(startTurn.mock.calls[0]?.[1]).toContain('강한 아웃포커스야.');
    expect(startTurn.mock.calls[0]?.[1]).toContain(
      '"targetObjectId":"mannequin-blue"',
    );
    expect(
      screen.getByText('레퍼런스 1/4개 · 총 이미지 입력 2/5'),
    ).toBeVisible();

    eventListener({
      event: 'codex',
      data: {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'item-1',
          delta: '전경의 전봇대로 이해했습니다.',
        },
      },
    });
    expect(
      await screen.findByText('전경의 전봇대로 이해했습니다.'),
    ).toBeVisible();
  });

  it('사용자 변경 지시를 revisioned structured proposal turn으로 요청한다', async () => {
    const user = userEvent.setup();
    const scene = createStarterSceneDocument({
      documentId: 'scene-proposal-request',
      floorId: 'floor-proposal-request',
      mannequinId: 'mannequin-proposal-request',
    });
    const startTurn = vi.fn(async () => 'ordinary-turn');
    const startSpecPatchProposal = vi.fn(
      async (
        input: Parameters<
          NonNullable<CompanionBrowserClient['startSpecPatchProposal']>
        >[0],
      ) => ({
        turnId: 'proposal-turn-1',
        requestId: input.requestId,
      }),
    );
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      startThread: async () => 'thread-proposal',
      startTurn,
      startSpecPatchProposal,
      subscribe: () => () => undefined,
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        getSceneContext={() => scene}
        clientFactory={() => client}
      />,
    );

    await user.type(
      await screen.findByLabelText('장면에 대해 말하기'),
      '장소를 골목 치킨집으로 바꿔줘.',
    );
    await user.click(screen.getByRole('button', { name: '변경안 제안' }));

    expect(startTurn).not.toHaveBeenCalled();
    expect(startSpecPatchProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-proposal',
        requestId: expect.any(String),
        baseSceneRevision: 0,
        baseSpecRevision: 0,
        userMessage: '장소를 골목 치킨집으로 바꿔줘.',
        sceneDocument: scene,
      }),
    );
    expect(screen.getByText('장소를 골목 치킨집으로 바꿔줘.')).toBeVisible();
  });

  it('진행 중인 turn을 중단한다', async () => {
    const user = userEvent.setup();
    const interruptTurn = vi.fn(async () => undefined);
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      startThread: async () => 'thread-1',
      startTurn: async () => 'turn-1',
      interruptTurn,
      listReferences: async () => [],
      importReference: conversationMethods.importReference,
      loadReferenceBlob: conversationMethods.loadReferenceBlob,
      updateReference: conversationMethods.updateReference,
      subscribe: () => () => undefined,
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        clientFactory={() => client}
      />,
    );

    await user.type(
      await screen.findByLabelText('장면에 대해 말하기'),
      '장면을 설명해줘.',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await user.click(await screen.findByRole('button', { name: '응답 중단' }));

    expect(interruptTurn).toHaveBeenCalledWith('thread-1', 'turn-1');
  });

  it('새로고침 후 보관된 Codex thread를 첫 메시지에서 재개한다', async () => {
    sessionStorage.setItem('i2v.scene-assistant.thread.v1', 'thread-existing');
    const user = userEvent.setup();
    const startThread = vi.fn(async (threadId?: string) => threadId ?? 'new');
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      startThread,
      startTurn: async () => 'turn-1',
      interruptTurn: async () => undefined,
      listReferences: async () => [],
      importReference: conversationMethods.importReference,
      loadReferenceBlob: conversationMethods.loadReferenceBlob,
      updateReference: conversationMethods.updateReference,
      subscribe: () => () => undefined,
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        clientFactory={() => client}
      />,
    );

    expect(
      await screen.findByText('이전 Codex task를 다음 메시지부터 이어갑니다.'),
    ).toBeVisible();
    await user.type(
      screen.getByLabelText('장면에 대해 말하기'),
      '계속 이야기하자.',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));

    expect(startThread).toHaveBeenCalledWith('thread-existing');
  });

  it('프로젝트에 저장된 task의 요약을 보여주고 재개 또는 새 task를 명시적으로 선택한다', async () => {
    const user = userEvent.setup();
    const scene = createStarterSceneDocument({
      documentId: 'scene-session-choice',
      floorId: 'floor-session-choice',
      mannequinId: 'mannequin-session-choice',
    });
    scene.sceneRevision = 8;
    scene.specRevision = 4;
    const startThread = vi.fn(
      async (threadId?: string) => threadId ?? 'thread-new',
    );
    const startConversationTurn = vi.fn(async () => 'turn-next');
    const client: CompanionBrowserClient = {
      ...conversationMethods,
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
          threadId: 'thread-project-saved',
          state: 'active',
          turnCount: 3,
          lastTurnId: 'turn-saved',
          lastTurnKind: 'conversation',
          lastTurnStatus: 'completed',
          lastUserMessage: '배경 오른쪽에 손님을 추가해줘.',
          lastAssistantSummary: '배경 손님 변경안을 준비했습니다.',
          sceneRevision: 7,
          specRevision: 3,
          generationIntent: {
            revision: 1,
            sourceTurnId: 'turn-saved',
            userMessage: '배경 오른쪽에 손님을 추가해줘.',
            assistantSummary: '배경 손님 변경안을 준비했습니다.',
            sceneRevision: 7,
            specRevision: 3,
          },
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:01:00.000Z',
        },
        archivedTaskCount: 1,
      }),
      startThread,
      startConversationTurn,
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        getSceneContext={() => scene}
        clientFactory={() => client}
      />,
    );

    const choice = await screen.findByRole('article', {
      name: '저장된 Codex task 선택',
    });
    expect(choice).toHaveTextContent('thread-project-saved');
    expect(choice).toHaveTextContent('배경 오른쪽에 손님을 추가해줘.');
    expect(choice).toHaveTextContent('배경 손님 변경안을 준비했습니다.');
    expect(choice).toHaveTextContent(
      'turn 3개 · completed · scene r7 · spec r3',
    );
    expect(choice).toHaveTextContent('다음 OAuth 생성 반영 의도 r1');
    expect(screen.getByLabelText('장면에 대해 말하기')).toBeDisabled();

    await user.click(
      within(choice).getByRole('button', { name: '저장된 task 재개' }),
    );
    await waitFor(() =>
      expect(startThread).toHaveBeenCalledWith('thread-project-saved'),
    );
    expect(choice).not.toBeInTheDocument();
    const composer = screen.getByLabelText('장면에 대해 말하기');
    expect(composer).toBeEnabled();
    await user.type(composer, '계속 진행해줘.');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    expect(startConversationTurn).toHaveBeenCalledWith(
      'thread-project-saved',
      expect.stringContaining('계속 진행해줘.'),
      [],
      {
        kind: 'conversation',
        userMessage: '계속 진행해줘.',
        sceneRevision: 8,
        specRevision: 4,
      },
    );
  });

  it('저장 task 재개 실패 뒤에도 명시적으로 새 task를 시작할 수 있다', async () => {
    const user = userEvent.setup();
    const startThread = vi.fn(async (threadId?: string) => {
      if (threadId !== undefined) throw new Error('thread not found');
      return 'thread-recovery-new';
    });
    const client: CompanionBrowserClient = {
      ...conversationMethods,
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
          threadId: 'thread-missing',
          state: 'active',
          turnCount: 1,
          lastTurnId: 'turn-missing',
          lastTurnKind: 'conversation',
          lastTurnStatus: 'completed',
          lastUserMessage: '이전 요청',
          lastAssistantSummary: '이전 응답',
          sceneRevision: 1,
          specRevision: 1,
          generationIntent: null,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:01:00.000Z',
        },
        archivedTaskCount: 0,
      }),
      startThread,
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        clientFactory={() => client}
      />,
    );
    const choice = await screen.findByRole('article', {
      name: '저장된 Codex task 선택',
    });
    await user.click(
      within(choice).getByRole('button', { name: '저장된 task 재개' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '저장된 Codex task를 재개하지 못했습니다',
    );
    expect(choice).toBeVisible();

    await user.click(
      within(choice).getByRole('button', { name: '새 task 시작' }),
    );
    await waitFor(() => expect(startThread).toHaveBeenLastCalledWith());
    expect(choice).not.toBeInTheDocument();
    expect(screen.getByText('장면 대화')).toBeVisible();
  });

  it('새 대화를 시작하면 레퍼런스 선택 초기화 콜백을 호출한다', async () => {
    sessionStorage.setItem('i2v.scene-assistant.thread.v1', 'thread-existing');
    const user = userEvent.setup();
    const onConversationReset = vi.fn();
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      startThread: async () => 'thread-fresh',
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        clientFactory={() => client}
        onConversationReset={onConversationReset}
      />,
    );

    await user.click(await screen.findByRole('button', { name: '새 대화' }));

    await waitFor(() => expect(onConversationReset).toHaveBeenCalledTimes(1));
  });

  it('Codex 승인 요청의 출처·영향을 표시하고 승인과 질문 답변을 명시적으로 보낸다', async () => {
    const user = userEvent.setup();
    const createdAt = '2026-08-04T00:00:00.000Z';
    const commandRequest = {
      id: 'e1ceeae8-f922-4bee-ad7a-7381f61c404d',
      kind: 'commandApproval' as const,
      method: 'item/commandExecution/requestApproval' as const,
      threadId: 'thread-runtime',
      turnId: 'turn-command',
      itemId: 'item-command',
      status: 'pending' as const,
      title: '명령 실행 승인',
      reason: '프로덕션 빌드를 확인합니다.',
      impact: 'npm run build',
      cwd: '/project',
      questions: [],
      autoResolutionMs: null,
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null,
    };
    const questionRequest = {
      id: '4b6af378-f49d-4898-b0c2-3c69ff6cc4a4',
      kind: 'userInput' as const,
      method: 'item/tool/requestUserInput' as const,
      threadId: 'thread-runtime',
      turnId: 'turn-question',
      itemId: 'item-question',
      status: 'pending' as const,
      title: 'Codex 확인 질문',
      reason: null,
      impact: '답변을 보내면 현재 Codex turn이 계속 진행됩니다.',
      cwd: null,
      questions: [
        {
          id: 'direction',
          header: '연출 방향',
          question: '어느 방향으로 진행할까요?',
          isOther: true,
          isSecret: false,
          options: [
            { label: '왼쪽', description: '왼쪽 구도를 선택합니다.' },
            { label: '오른쪽', description: '오른쪽 구도를 선택합니다.' },
          ],
        },
        {
          id: 'secret',
          header: '비밀 값',
          question: '일회성 값을 입력해 주세요.',
          isOther: false,
          isSecret: true,
          options: null,
        },
      ],
      autoResolutionMs: null,
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null,
    };
    const respondRuntimeRequest = vi.fn(
      async (requestId: string, response: { action: string }) => {
        const original =
          requestId === commandRequest.id ? commandRequest : questionRequest;
        return {
          ...original,
          status:
            response.action === 'approve'
              ? ('approved' as const)
              : ('answered' as const),
          updatedAt: '2026-08-04T00:01:00.000Z',
          resolvedAt: '2026-08-04T00:01:00.000Z',
        };
      },
    );
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      listRuntimeRequests: async () => ({
        version: 1,
        requests: [commandRequest, questionRequest],
      }),
      respondRuntimeRequest,
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        clientFactory={() => client}
      />,
    );

    const approval = await screen.findByRole('article', {
      name: '명령 실행 승인: item-command',
    });
    expect(approval).toHaveTextContent(
      'thread thread-runtime · turn turn-command',
    );
    expect(approval).toHaveTextContent('프로덕션 빌드를 확인합니다.');
    expect(approval).toHaveTextContent('npm run build');
    expect(approval).toHaveTextContent('/project');
    await user.click(
      within(approval).getByRole('button', { name: '이번 요청 승인' }),
    );
    await waitFor(() => expect(approval).not.toBeInTheDocument());
    expect(respondRuntimeRequest).toHaveBeenCalledWith(commandRequest.id, {
      action: 'approve',
    });

    const question = screen.getByRole('article', {
      name: 'Codex 확인 질문: item-question',
    });
    await user.click(within(question).getByRole('radio', { name: /오른쪽/ }));
    await user.type(
      within(question).getByLabelText('비밀 값 답변'),
      'one-time-secret',
    );
    expect(question).toHaveTextContent(
      '비밀 답변은 프로젝트 metadata에 저장하지 않습니다.',
    );
    await user.click(
      within(question).getByRole('button', { name: '답변 보내기' }),
    );
    expect(respondRuntimeRequest).toHaveBeenCalledWith(questionRequest.id, {
      action: 'answer',
      answers: {
        direction: ['오른쪽'],
        secret: ['one-time-secret'],
      },
    });
  });

  it('Companion 재시작으로 만료된 요청은 실행 버튼 없이 복구 안내를 표시한다', async () => {
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      listRuntimeRequests: async () => ({
        version: 1,
        requests: [
          {
            id: '7d68500d-b320-4886-8d15-1fe3e3bce4b9',
            kind: 'fileChangeApproval',
            method: 'item/fileChange/requestApproval',
            threadId: 'thread-expired',
            turnId: 'turn-expired',
            itemId: 'item-expired',
            status: 'expired',
            title: '파일 변경 승인',
            reason: null,
            impact: '프로젝트 파일 변경',
            cwd: null,
            questions: [],
            autoResolutionMs: null,
            createdAt: '2026-08-04T00:00:00.000Z',
            updatedAt: '2026-08-04T00:01:00.000Z',
            resolvedAt: '2026-08-04T00:01:00.000Z',
          },
        ],
      }),
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        clientFactory={() => client}
      />,
    );
    const expired = await screen.findByRole('article', {
      name: '만료된 Codex 요청',
    });
    expect(expired).toHaveTextContent('Companion 재시작');
    expect(
      within(expired).queryByRole('button', { name: '이번 요청 승인' }),
    ).not.toBeInTheDocument();
  });

  it('검증된 proposal을 keyboard-accessible 변경 카드로 표시하고 취소는 editor state를 바꾸지 않는다', async () => {
    const user = userEvent.setup();
    const store = createEditorStore({
      initialDocument: createStarterSceneDocument({
        documentId: 'scene-proposal-ui',
        floorId: 'floor-proposal-ui',
        mannequinId: 'mannequin-proposal-ui',
      }),
      idFactory: () => 'unused',
    });
    let eventListener: Parameters<
      CompanionBrowserClient['subscribe']
    >[0] = () => undefined;
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      subscribe: (listener) => {
        eventListener = listener;
        return () => undefined;
      },
    };
    const beforeDocument = store.getState().document;
    const beforeHistory = store.getState().history;

    render(
      <SceneAssistantPanel
        connection={connection}
        getSceneContext={() => store.getState().document}
        onApplySpecPatchProposal={(proposal) =>
          store.getState().applySpecPatchProposal(proposal)
        }
        clientFactory={() => client}
      />,
    );
    await screen.findByText('ChatGPT · prolite');

    eventListener({
      event: 'spec-patch-proposal',
      data: {
        version: 2,
        requestId: 'proposal-ui-1',
        baseSceneRevision: 0,
        baseSpecRevision: 0,
        message: '장소와 분위기를 변경합니다.',
        specPatch: [
          {
            op: 'replace',
            path: '/intent/location',
            value: '골목 치킨집',
          },
          {
            op: 'replace',
            path: '/intent/mood',
            value: '긴장감',
          },
        ],
        sceneCommands: [
          {
            type: 'setObjectTransform',
            objectId: 'mannequin-proposal-ui',
            transform: {
              position: { x: 1.25, y: 0.85, z: 0 },
              rotationDeg: { x: 0, y: 20, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
          },
        ],
        warnings: ['조명은 변경하지 않습니다.'],
      },
    });

    const card = await screen.findByRole('article', {
      name: '장면 변경안',
    });
    expect(within(card).getByText('장소와 분위기를 변경합니다.')).toBeVisible();
    expect(within(card).getByText('/intent/location')).toBeVisible();
    expect(within(card).getByText(/골목 치킨집/)).toBeVisible();
    expect(
      within(card).getByText(/Mannequin.*mannequin-proposal-ui.*3D transform/),
    ).toBeVisible();
    expect(within(card).getByText(/위치 \(1.25, 0.85, 0\)/)).toBeVisible();
    expect(within(card).getByText('조명은 변경하지 않습니다.')).toBeVisible();
    expect(store.getState().document).toBe(beforeDocument);
    expect(store.getState().history).toBe(beforeHistory);
    expect(store.getState().isDirty).toBe(false);

    await user.click(within(card).getByRole('button', { name: '변경안 취소' }));
    expect(
      screen.queryByRole('article', { name: '장면 변경안' }),
    ).not.toBeInTheDocument();
    expect(store.getState().document).toBe(beforeDocument);
    expect(store.getState().history).toBe(beforeHistory);
    expect(store.getState().isDirty).toBe(false);
  });

  it('변경안 적용을 double click에도 단 한 번 atomic editor mutation으로 실행한다', async () => {
    const user = userEvent.setup();
    const store = createEditorStore({
      initialDocument: createStarterSceneDocument({
        documentId: 'scene-proposal-apply',
        floorId: 'floor-proposal-apply',
        mannequinId: 'mannequin-proposal-apply',
      }),
      idFactory: () => 'unused',
    });
    let eventListener: Parameters<
      CompanionBrowserClient['subscribe']
    >[0] = () => undefined;
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      subscribe: (listener) => {
        eventListener = listener;
        return () => undefined;
      },
    };
    const apply = vi.fn((proposal: SpecPatchProposal) =>
      store.getState().applySpecPatchProposal(proposal),
    );
    render(
      <SceneAssistantPanel
        connection={connection}
        getSceneContext={() => store.getState().document}
        onApplySpecPatchProposal={apply}
        clientFactory={() => client}
      />,
    );
    await screen.findByText('ChatGPT · prolite');
    eventListener({
      event: 'spec-patch-proposal',
      data: {
        version: 2,
        requestId: 'proposal-apply-1',
        baseSceneRevision: 0,
        baseSpecRevision: 0,
        message: '장소를 변경합니다.',
        specPatch: [
          {
            op: 'replace',
            path: '/intent/location',
            value: '골목 치킨집',
          },
        ],
        sceneCommands: [
          {
            type: 'setObjectTransform',
            objectId: 'mannequin-proposal-apply',
            transform: {
              position: { x: 1.25, y: 0.85, z: 0 },
              rotationDeg: { x: 0, y: 20, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
          },
        ],
        warnings: [],
      },
    });

    await user.dblClick(
      await screen.findByRole('button', { name: '변경안 적용' }),
    );

    expect(apply).toHaveBeenCalledOnce();
    expect(store.getState().document).toMatchObject({
      sceneRevision: 1,
      specRevision: 1,
      semanticSceneSpec: { intent: { location: '골목 치킨집' } },
      objects: [
        { id: 'floor-proposal-apply' },
        {
          id: 'mannequin-proposal-apply',
          transform: {
            position: { x: 1.25, y: 0.85, z: 0 },
            rotationDeg: { x: 0, y: 20, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
    });
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().isDirty).toBe(true);
  });

  it('카드 표시 후 scene race가 발생하면 stale apply를 fail-closed한다', async () => {
    const user = userEvent.setup();
    const store = createEditorStore({
      initialDocument: createStarterSceneDocument({
        documentId: 'scene-proposal-race',
        floorId: 'floor-proposal-race',
        mannequinId: 'mannequin-proposal-race',
      }),
      idFactory: () => 'race-cube',
    });
    let eventListener: Parameters<
      CompanionBrowserClient['subscribe']
    >[0] = () => undefined;
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        error: null,
      }),
      subscribe: (listener) => {
        eventListener = listener;
        return () => undefined;
      },
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        getSceneContext={() => store.getState().document}
        onApplySpecPatchProposal={(proposal) =>
          store.getState().applySpecPatchProposal(proposal)
        }
        clientFactory={() => client}
      />,
    );
    await screen.findByText('ChatGPT · prolite');
    eventListener({
      event: 'spec-patch-proposal',
      data: {
        version: 2,
        requestId: 'proposal-race-1',
        baseSceneRevision: 0,
        baseSpecRevision: 0,
        message: '장소를 변경합니다.',
        specPatch: [
          {
            op: 'replace',
            path: '/intent/location',
            value: '골목 치킨집',
          },
        ],
        sceneCommands: [],
        warnings: [],
      },
    });
    await screen.findByRole('button', { name: '변경안 적용' });

    act(() => store.getState().addObject({ kind: 'cube' }));
    const racedDocument = store.getState().document;
    const racedHistory = store.getState().history;
    await user.click(screen.getByRole('button', { name: '변경안 적용' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /stale scene change proposal/,
    );
    expect(store.getState().document).toBe(racedDocument);
    expect(store.getState().history).toBe(racedHistory);
    expect(store.getState().document.semanticSceneSpec.intent.location).toBe(
      '',
    );
  });

  it('현재 3D 구도를 캡처하고 선택 레퍼런스로 imagegen을 시작한다', async () => {
    const user = userEvent.setup();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-1',
      floorId: 'floor-1',
      mannequinId: 'mannequin-blue',
    });
    sceneSnapshot.generationSource = {
      generationId: 'generation-layout-source',
      versionNumber: 7,
    };
    sceneSnapshot.semanticSceneSpec.intent.location = '한국 노포 야외 치킨집';
    const layoutBlob = new Blob(['png'], { type: 'image/png' });
    const captureLayout = vi.fn(async () => layoutBlob);
    const createSceneRender = vi.fn(async () => ({
      id: 'render-1',
      sceneId: 'scene-1',
      artifactId: 'artifact-render',
      contentHash: `sha256:${'b'.repeat(64)}`,
      mimeType: 'image/png' as const,
      width: 1920,
      height: 1080,
      byteLength: 3,
      createdAt: '2026-08-03T00:00:00.000Z',
    }));
    const generation: GenerationRecord = {
      id: 'generation-1',
      threadId: 'thread-1',
      turnId: 'turn-generation',
      status: 'inProgress',
      prompt: '$imagegen test',
      layoutSpec: { ...TEST_LAYOUT_SPEC, sceneId: 'scene-1' },
      sceneSnapshot,
      semanticSceneSpecSnapshot: structuredClone(
        sceneSnapshot.semanticSceneSpec,
      ),
      referenceSnapshots: [characterReference],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
      refinementDirective: null,
      generationMode: 'fresh',
      layoutRenderId: 'render-1',
      referenceIds: ['ref-character'],
      attachments: [
        { type: 'layout', id: 'render-1', kind: 'layout' },
        { type: 'reference', id: 'ref-character', kind: 'character' },
      ],
      revisedPrompt: null,
      result: null,
      error: null,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    };
    const startGeneration = vi.fn<CompanionBrowserClient['startGeneration']>(
      async () => ({
        turnId: 'turn-generation',
        generation,
      }),
    );
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      createSceneRender,
      startGeneration,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        error: null,
      }),
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        captureLayout={captureLayout}
        getSceneContext={() => sceneSnapshot}
        getSelectedReferences={() => [characterReference]}
        clientFactory={() => client}
      />,
    );

    await user.type(
      await screen.findByLabelText('장면에 대해 말하기'),
      '이 구도로 저녁 치킨집 장면을 만들어줘.',
    );
    await user.click(screen.getByRole('tab', { name: '변환 계약' }));
    const contractSummary = screen.getByText(
      '3D → 키프레임 변환 계약 상세 보기',
    );
    const contract = contractSummary.closest('details');
    expect(contract).not.toBeNull();
    expect(contract).not.toHaveAttribute('open');
    await user.click(contractSummary);
    expect(within(contract!).getByText('3D에서 유지')).toBeVisible();
    expect(within(contract!).getByText('Mannequin')).toBeVisible();
    expect(within(contract!).getByText(/toward-camera/)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: '대화' }));
    expect(
      screen.getByRole('status', { name: '이미지 생성 계보' }),
    ).toHaveTextContent(
      'fresh 새 생성 · 3D 출처 generation-layout-source · 기존 결과 이미지 미사용',
    );
    await user.click(screen.getByRole('button', { name: '이미지 생성' }));

    expect(captureLayout).toHaveBeenCalledOnce();
    expect(createSceneRender).toHaveBeenCalledWith(layoutBlob, 'scene-1');
    expect(startGeneration).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^generation-scene-1-/),
      threadId: 'thread-test',
      prompt: expect.stringMatching(/^\$imagegen/),
      layoutRenderId: 'render-1',
      layoutSpec: expect.objectContaining({ sceneId: 'scene-1' }),
      sceneSnapshot: expect.objectContaining({ id: 'scene-1' }),
      referenceIds: ['ref-character'],
      parentGenerationId: null,
      sourceGenerationId: 'generation-layout-source',
      feedback: null,
      refinementDirective: null,
      generationMode: 'fresh',
      acknowledgedPreflightWarningIds: [],
      imageModel: 'gpt-5.4-mini',
      imageQuality: 'medium',
    });
    expect(startGeneration.mock.calls[0]?.[0].prompt).toContain(
      '"attachmentIndex":2',
    );
    expect(startGeneration.mock.calls[0]?.[0].prompt).toContain(
      '3D 레이아웃과 최종 키프레임의 변환 계약',
    );
    expect(startGeneration.mock.calls[0]?.[0].prompt).toContain(
      '- 장소: 한국 노포 야외 치킨집',
    );
    expect(startGeneration.mock.calls[0]?.[0].prompt).not.toContain(
      '[사용자 연출]',
    );
    expect(startGeneration.mock.calls[0]?.[0].prompt).not.toContain(
      '이 구도로 저녁 치킨집 장면을 만들어줘.',
    );
    expect(await screen.findByText(/이미지를 생성하고 있습니다/)).toBeVisible();
  });

  it('충돌 경고를 확인하기 전에는 캡처하지 않고 확인 ID를 생성 요청에 보낸다', async () => {
    const user = userEvent.setup();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-preflight',
      floorId: 'floor-preflight',
      mannequinId: 'mannequin-blue',
    });
    const poseReference = {
      ...characterReference,
      use: ['face', 'pose'],
      exclude: ['background', 'text'],
    };
    const captureLayout = vi.fn(
      async () => new Blob(['png'], { type: 'image/png' }),
    );
    const createSceneRender = vi.fn(async () => ({
      id: 'render-preflight',
      sceneId: sceneSnapshot.id,
      artifactId: 'artifact-render-preflight',
      contentHash: `sha256:${'e'.repeat(64)}`,
      mimeType: 'image/png' as const,
      width: 1920,
      height: 1080,
      byteLength: 3,
      createdAt: '2026-08-03T00:00:00.000Z',
    }));
    const startGeneration = vi.fn<CompanionBrowserClient['startGeneration']>(
      () => new Promise(() => undefined),
    );
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      createSceneRender,
      startGeneration,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        error: null,
      }),
      subscribe: () => () => undefined,
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        captureLayout={captureLayout}
        getSceneContext={() => sceneSnapshot}
        getSelectedReferences={() => [poseReference]}
        clientFactory={() => client}
      />,
    );

    const draft = await screen.findByLabelText('장면에 대해 말하기');
    await user.type(draft, '현재 구도로 생성해줘.');
    await user.click(screen.getByRole('button', { name: '이미지 생성' }));

    const warningCard = screen.getByRole('article', {
      name: '생성 전 충돌 경고',
    });
    expect(warningCard).toHaveTextContent('3D LayoutSpec의 포즈가 권위 원본');
    expect(captureLayout).not.toHaveBeenCalled();
    expect(startGeneration).not.toHaveBeenCalled();
    expect(draft).toHaveValue('현재 구도로 생성해줘.');

    await user.click(
      within(warningCard).getByRole('button', { name: '경고 확인 후 생성' }),
    );
    await waitFor(() => expect(startGeneration).toHaveBeenCalledOnce());
    expect(captureLayout).toHaveBeenCalledOnce();
    expect(startGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgedPreflightWarningIds: [
          'pose-authority-conflict:ref-character:mannequin-blue',
        ],
      }),
    );
  });

  it('삭제된 object를 가리키는 레퍼런스는 캡처 전에 차단한다', async () => {
    const user = userEvent.setup();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-preflight-blocked',
      floorId: 'floor-preflight',
      mannequinId: 'mannequin-blue',
    });
    const captureLayout = vi.fn(async () => new Blob());
    const startGeneration = vi.fn<CompanionBrowserClient['startGeneration']>(
      () => new Promise(() => undefined),
    );
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      startGeneration,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        error: null,
      }),
      subscribe: () => () => undefined,
    };
    render(
      <SceneAssistantPanel
        connection={connection}
        captureLayout={captureLayout}
        getSceneContext={() => sceneSnapshot}
        getSelectedReferences={() => [
          { ...characterReference, targetObjectId: 'deleted-object' },
        ]}
        clientFactory={() => client}
      />,
    );

    await user.type(
      await screen.findByLabelText('장면에 대해 말하기'),
      '생성해줘.',
    );
    await user.click(screen.getByRole('button', { name: '이미지 생성' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '삭제된 object deleted-object',
    );
    expect(captureLayout).not.toHaveBeenCalled();
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it('완성 키프레임을 원본으로 선택해 보정 생성을 시작한다', async () => {
    const user = userEvent.setup();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-1',
      floorId: 'floor-1',
      mannequinId: 'mannequin-blue',
    });
    const sourceGeneration: GenerationRecord = {
      id: 'generation-source',
      threadId: 'thread-1',
      turnId: 'turn-source',
      status: 'completed',
      prompt: '$imagegen source',
      layoutSpec: { ...TEST_LAYOUT_SPEC, sceneId: 'scene-1' },
      sceneSnapshot,
      semanticSceneSpecSnapshot: structuredClone(
        sceneSnapshot.semanticSceneSpec,
      ),
      referenceSnapshots: [characterReference],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
      refinementDirective: null,
      generationMode: 'fresh',
      layoutRenderId: 'render-source',
      referenceIds: ['ref-character'],
      attachments: [
        { type: 'layout', id: 'render-source', kind: 'layout' },
        { type: 'reference', id: 'ref-character', kind: 'character' },
      ],
      revisedPrompt: null,
      result: {
        artifactId: 'artifact-source',
        contentHash: `sha256:${'c'.repeat(64)}`,
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
        byteLength: 2048,
      },
      error: null,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:01:00.000Z',
    };
    const refinedGeneration: GenerationRecord = {
      ...sourceGeneration,
      id: 'generation-refined',
      turnId: 'turn-refined',
      status: 'inProgress',
      parentGenerationId: sourceGeneration.id,
      versionNumber: 2,
      feedback: '전봇대가 가리는 비율만 줄여줘.',
      refinementDirective: {
        version: 1,
        preserve: ['전체 구도', '인물 의상'],
        change: ['전봇대가 가리는 비율만 줄여줘.'],
      },
      generationMode: 'edit',
      layoutRenderId: 'render-refined',
      result: null,
      attachments: [
        {
          type: 'sourceGeneration',
          id: sourceGeneration.id,
          kind: null,
        },
        { type: 'layout', id: 'render-refined', kind: 'layout' },
        { type: 'reference', id: 'ref-character', kind: 'character' },
      ],
    };
    const startGeneration = vi.fn<CompanionBrowserClient['startGeneration']>(
      async () => ({
        turnId: 'turn-refined',
        generation: refinedGeneration,
      }),
    );
    const onRefinementModeChange = vi.fn();
    const client: CompanionBrowserClient = {
      ...conversationMethods,
      getRuntime: async () => ({
        state: 'ready',
        version: 'codex-test',
        account: { type: 'chatgpt', email: null, planType: 'prolite' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        error: null,
      }),
      listGenerations: async () => [sourceGeneration],
      loadGenerationBlob: async () =>
        new Blob(['source'], { type: 'image/png' }),
      createSceneRender: async () => ({
        id: 'render-refined',
        sceneId: 'scene-1',
        artifactId: 'artifact-render-refined',
        contentHash: `sha256:${'d'.repeat(64)}`,
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
        byteLength: 3,
        createdAt: '2026-08-03T00:02:00.000Z',
      }),
      startGeneration,
      subscribe: () => () => undefined,
    };

    render(
      <SceneAssistantPanel
        connection={connection}
        captureLayout={async () => new Blob(['png'], { type: 'image/png' })}
        getSceneContext={() => sceneSnapshot}
        getSelectedReferences={() => [characterReference]}
        clientFactory={() => client}
        createObjectUrl={() => 'blob:source-generation'}
        revokeObjectUrl={() => undefined}
        onRefinementModeChange={onRefinementModeChange}
        refinementSource={sourceGeneration}
      />,
    );

    expect(await screen.findByText('키프레임 보정 모드')).toBeVisible();
    expect(
      screen.getByRole('status', { name: '이미지 생성 계보' }),
    ).toHaveTextContent('edit 보정 · 기존 결과 이미지 generation-source 기반');
    expect(
      screen.queryByRole('button', { name: '이 결과를 기반으로 보정' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/레퍼런스 최대 3장/)).toBeVisible();
    await waitFor(() =>
      expect(onRefinementModeChange).toHaveBeenLastCalledWith(true),
    );

    const preserveInput = screen.getByLabelText('이 키프레임에서 유지할 요소');
    await user.type(preserveInput, '전봇대가 가리는 비율만 줄여줘.');
    await user.type(
      screen.getByLabelText('이 키프레임에서 바꿀 내용'),
      '전봇대가 가리는 비율만 줄여줘.',
    );
    await user.click(screen.getByRole('button', { name: '보정 생성' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '같은 항목을 유지하면서 동시에 변경할 수 없습니다.',
    );
    expect(startGeneration).not.toHaveBeenCalled();

    await user.clear(preserveInput);
    await user.type(preserveInput, '전체 구도\n인물 의상');
    await user.click(screen.getByRole('button', { name: '보정 생성' }));

    expect(startGeneration).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^generation-scene-1-/),
      threadId: 'thread-test',
      prompt: expect.stringContaining('첨부 이미지 1은 보정의 기준'),
      layoutRenderId: 'render-refined',
      layoutSpec: expect.objectContaining({ sceneId: 'scene-1' }),
      sceneSnapshot: expect.objectContaining({ id: 'scene-1' }),
      referenceIds: ['ref-character'],
      parentGenerationId: 'generation-source',
      sourceGenerationId: null,
      feedback: '전봇대가 가리는 비율만 줄여줘.',
      refinementDirective: {
        version: 1,
        preserve: ['전체 구도', '인물 의상'],
        change: ['전봇대가 가리는 비율만 줄여줘.'],
      },
      generationMode: 'edit',
      acknowledgedPreflightWarningIds: [],
      imageModel: 'gpt-5.4-mini',
      imageQuality: 'medium',
    });
  });
});
