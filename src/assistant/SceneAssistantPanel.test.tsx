import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CompanionBrowserClient,
  GenerationRecord,
} from './companionClient';
import { SceneAssistantPanel } from './SceneAssistantPanel';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';

const connection = {
  version: 1 as const,
  url: 'http://127.0.0.1:61234',
  token: 'a'.repeat(43),
};

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
  createSceneRender: async () => {
    throw new Error('not implemented in this test');
  },
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
  beforeEach(() => sessionStorage.clear());

  it('연결 정보가 없으면 launchUrl 안내를 표시한다', () => {
    render(<SceneAssistantPanel connection={null} />);

    expect(screen.getByRole('status')).toHaveTextContent('연결 안 됨');
    expect(screen.getByText(/launchUrl/)).toBeVisible();
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
    expect(screen.getByRole('status')).toHaveTextContent('연결됨');
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

  it('현재 3D 구도를 캡처하고 선택 레퍼런스로 imagegen을 시작한다', async () => {
    const user = userEvent.setup();
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-1',
      floorId: 'floor-1',
      mannequinId: 'mannequin-blue',
    });
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
      referenceSnapshots: [characterReference],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
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
    await user.click(screen.getByRole('button', { name: '이미지 생성' }));

    expect(captureLayout).toHaveBeenCalledOnce();
    expect(createSceneRender).toHaveBeenCalledWith(layoutBlob, 'scene-1');
    expect(startGeneration).toHaveBeenCalledWith({
      threadId: 'thread-test',
      prompt: expect.stringMatching(/^\$imagegen/),
      layoutRenderId: 'render-1',
      layoutSpec: expect.objectContaining({ sceneId: 'scene-1' }),
      sceneSnapshot: expect.objectContaining({ id: 'scene-1' }),
      referenceIds: ['ref-character'],
      parentGenerationId: null,
      feedback: null,
      generationMode: 'fresh',
    });
    expect(startGeneration.mock.calls[0]?.[0].prompt).toContain(
      '"attachmentIndex":2',
    );
    expect(startGeneration.mock.calls[0]?.[0].prompt).toContain(
      '3D 레이아웃과 최종 키프레임의 변환 계약',
    );
    expect(await screen.findByText(/이미지를 생성하고 있습니다/)).toBeVisible();
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
      referenceSnapshots: [characterReference],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
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
      />,
    );

    await user.click(
      await screen.findByRole('button', {
        name: '이 결과를 기반으로 보정',
      }),
    );
    expect(screen.getByText('키프레임 보정 모드')).toBeVisible();
    expect(screen.getByText(/레퍼런스 최대 3장/)).toBeVisible();
    await waitFor(() =>
      expect(onRefinementModeChange).toHaveBeenLastCalledWith(true),
    );

    await user.type(
      screen.getByLabelText('이 키프레임에서 바꿀 내용'),
      '전봇대가 가리는 비율만 줄여줘.',
    );
    await user.click(screen.getByRole('button', { name: '보정 생성' }));

    expect(startGeneration).toHaveBeenCalledWith({
      threadId: 'thread-test',
      prompt: expect.stringContaining('첨부 이미지 1은 보정의 기준'),
      layoutRenderId: 'render-refined',
      layoutSpec: expect.objectContaining({ sceneId: 'scene-1' }),
      sceneSnapshot: expect.objectContaining({ id: 'scene-1' }),
      referenceIds: ['ref-character'],
      parentGenerationId: 'generation-source',
      feedback: '전봇대가 가리는 비율만 줄여줘.',
      generationMode: 'edit',
    });
  });
});
