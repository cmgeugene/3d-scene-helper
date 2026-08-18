// @vitest-environment node

import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AppServerStatus,
  CodexRuntime,
  TurnInput,
} from './appServerClient';
import { startCompanionServer, type CompanionServerHandle } from './server';
import { TEST_LAYOUT_SPEC } from '../shared/layoutSpecTestFixture';
import { createLayoutSpec } from '../src/assistant/layoutSpec';
import { createStarterSceneDocument } from '../src/editor/persistence/sceneSchema';

const tempRoots: string[] = [];
const servers: CompanionServerHandle[] = [];
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

class FakeRuntime extends EventEmitter implements CodexRuntime {
  readonly status: AppServerStatus = {
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
  };
  readonly startTurn = vi
    .fn<(threadId: string, input: TurnInput[]) => Promise<string>>()
    .mockResolvedValue('turn_1');

  async start() {}
  async stop() {}
  async refreshAccount() {
    return this.status;
  }
  readonly startThread = vi.fn(async () => 'thread_1');
  readonly resumeThread = vi.fn(async (threadId: string) => threadId);
  readonly respondServerRequest = vi.fn();
  readonly rejectServerRequest = vi.fn();
  async interruptTurn() {}
}

async function createServer(options: Record<string, unknown> = {}) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'i2v-companion-'));
  tempRoots.push(projectRoot);
  await mkdir(path.join(projectRoot, 'assets', 'references'), {
    recursive: true,
  });
  await writeFile(
    path.join(projectRoot, 'assets', 'references', 'character.png'),
    'png',
  );
  const runtime = new FakeRuntime();
  const server = await startCompanionServer({
    runtime,
    projectRoot,
    allowedOrigins: ['http://127.0.0.1:5173'],
    token: 'test-token',
    ...options,
  });
  servers.push(server);
  return { projectRoot, runtime, server };
}

describe('Companion loopback API', () => {
  it('healthz 외의 API에는 세션 토큰을 요구한다', async () => {
    const { server } = await createServer();

    const health = await fetch(`${server.url}/healthz`);
    const unauthorized = await fetch(`${server.url}/api/runtime`);

    expect(health.status).toBe(200);
    expect(unauthorized.status).toBe(401);
  });

  it('허용되지 않은 브라우저 Origin을 거부한다', async () => {
    const { server } = await createServer();

    const response = await fetch(`${server.url}/api/runtime`, {
      headers: {
        Authorization: 'Bearer test-token',
        Origin: 'https://example.com',
      },
    });

    expect(response.status).toBe(403);
  });

  it('App Server 승인·사용자 입력 요청을 저장하고 인증된 응답으로 정확히 한 번 해제한다', async () => {
    const { projectRoot, runtime, server } = await createServer();
    const headers = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    };
    runtime.emit('serverRequest', {
      id: 501,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread_approval',
        turnId: 'turn_approval',
        itemId: 'item_command',
        startedAtMs: Date.now(),
        command: 'npm run build',
        cwd: projectRoot,
        reason: 'production 검증',
      },
    });

    let commandRequestId = '';
    await vi.waitFor(async () => {
      const listed = (await fetch(`${server.url}/api/runtime-requests`, {
        headers,
      }).then((response) => response.json())) as {
        requests: Array<{ id: string }>;
      };
      expect(listed).toMatchObject({
        version: 1,
        requests: [
          {
            kind: 'commandApproval',
            status: 'pending',
            impact: 'npm run build',
            reason: 'production 검증',
          },
        ],
      });
      commandRequestId = listed.requests[0].id as string;
    });

    const approved = await fetch(
      `${server.url}/api/runtime-requests/${commandRequestId}/respond`,
      { method: 'POST', headers, body: JSON.stringify({ action: 'approve' }) },
    );
    expect(approved.status).toBe(200);
    expect(runtime.respondServerRequest).toHaveBeenCalledWith(501, {
      decision: 'accept',
    });
    await expect(approved.json()).resolves.toMatchObject({
      request: { id: commandRequestId, status: 'approved' },
    });
    const duplicate = await fetch(
      `${server.url}/api/runtime-requests/${commandRequestId}/respond`,
      { method: 'POST', headers, body: JSON.stringify({ action: 'decline' }) },
    );
    expect(duplicate.status).toBe(409);

    runtime.emit('serverRequest', {
      id: 'question-502',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread_approval',
        turnId: 'turn_question',
        itemId: 'item_question',
        autoResolutionMs: null,
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
      },
    });

    let questionRequestId = '';
    await vi.waitFor(async () => {
      const listed = (await fetch(`${server.url}/api/runtime-requests`, {
        headers,
      }).then((response) => response.json())) as {
        requests: Array<{ id: string; kind: string }>;
      };
      questionRequestId = listed.requests.find(
        (request: { kind: string }) => request.kind === 'userInput',
      )?.id as string;
      expect(questionRequestId).toEqual(expect.any(String));
    });
    const answered = await fetch(
      `${server.url}/api/runtime-requests/${questionRequestId}/respond`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'answer',
          answers: { direction: ['오른쪽'], secret: ['do-not-store'] },
        }),
      },
    );
    expect(answered.status).toBe(200);
    expect(runtime.respondServerRequest).toHaveBeenCalledWith('question-502', {
      answers: {
        direction: { answers: ['오른쪽'] },
        secret: { answers: ['do-not-store'] },
      },
    });
    expect(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(path.join(projectRoot, 'runtime-requests.json'), 'utf8'),
      ),
    ).not.toContain('do-not-store');
  });

  it('지원하지 않는 App Server 요청은 fail-closed protocol error로 종료한다', async () => {
    const { runtime } = await createServer();
    runtime.emit('serverRequest', {
      id: 700,
      method: 'item/permissions/requestApproval',
      params: {},
    });
    await vi.waitFor(() =>
      expect(runtime.rejectServerRequest).toHaveBeenCalledWith(
        700,
        -32601,
        expect.stringContaining('지원하지 않는'),
      ),
    );
  });

  it('프로젝트 task를 명시적으로 시작·재개하고 bounded 대화 metadata를 저장한다', async () => {
    const { runtime, server } = await createServer();
    const headers = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    };

    const empty = await fetch(`${server.url}/api/conversation-session`, {
      headers,
    });
    await expect(empty.json()).resolves.toEqual({
      version: 1,
      activeTask: null,
      archivedTaskCount: 0,
    });

    const started = await fetch(`${server.url}/api/threads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'new' }),
    });
    expect(started.status).toBe(200);
    await expect(started.json()).resolves.toMatchObject({
      threadId: 'thread_1',
      session: { activeTask: { threadId: 'thread_1', turnCount: 0 } },
    });
    expect(runtime.startThread).toHaveBeenCalledOnce();

    runtime.startTurn.mockResolvedValueOnce('turn_conversation');
    const turn = await fetch(`${server.url}/api/turns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: 'serialized scene prompt',
        metadata: {
          kind: 'conversation',
          userMessage: '노란 오브젝트는 전봇대야.',
          sceneRevision: 5,
          specRevision: 3,
        },
      }),
    });
    expect(turn.status).toBe(202);

    runtime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_conversation',
        item: {
          type: 'agentMessage',
          id: 'message-conversation',
          text: '전봇대 의미를 저장된 장면 기준으로 사용하겠습니다.',
        },
      },
    });
    runtime.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread_1',
        turn: {
          id: 'turn_conversation',
          status: 'completed',
          error: null,
        },
      },
    });

    await vi.waitFor(async () => {
      const response = await fetch(`${server.url}/api/conversation-session`, {
        headers,
      });
      await expect(response.json()).resolves.toMatchObject({
        activeTask: {
          threadId: 'thread_1',
          turnCount: 1,
          lastTurnId: 'turn_conversation',
          lastTurnKind: 'conversation',
          lastTurnStatus: 'completed',
          lastUserMessage: '노란 오브젝트는 전봇대야.',
          lastAssistantSummary:
            '전봇대 의미를 저장된 장면 기준으로 사용하겠습니다.',
          sceneRevision: 5,
          specRevision: 3,
        },
      });
    });

    const resumed = await fetch(`${server.url}/api/threads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'resume', threadId: 'thread_1' }),
    });
    expect(resumed.status).toBe(200);
    expect(runtime.resumeThread).toHaveBeenCalledWith(
      'thread_1',
      expect.any(String),
    );
  });

  it('OAuth 생성은 실제 imagegen 스킬 prompt를 최종 전달하고 task를 completed로 종료한다', async () => {
    let generatedPath = '';
    let runtimeForCompiler: FakeRuntime | null = null;
    const cleanup = vi.fn(async () => undefined);
    const skillPrompt =
      'Use case: photorealistic-natural\nPrimary request: finished frame\nInput images and authority: Image 1 controls layout.\nStyle/medium and integration: cohesive cinematic image.\nStrict composition and camera invariants: preserve OutputCamera.\nAvoid: no drift.';
    const imagegenPromptCompiler = vi.fn(
      async (input: { onThreadStarted?: (threadId: string) => void }) => {
        runtimeForCompiler!.emit('notification', {
          method: 'thread/started',
          params: {
            thread: {
              id: 'thread-compiler',
              threadSource: 'i2v-3d-scene-helper:imagegen-prompt-compiler:test',
            },
          },
        });
        input.onThreadStarted?.('thread-compiler');
        runtimeForCompiler!.emit('serverRequest', {
          id: 901,
          method: 'item/commandExecution/requestApproval',
          params: {
            threadId: 'thread-compiler',
            turnId: 'turn-compiler',
          },
        });
        runtimeForCompiler!.emit('notification', {
          method: 'item/completed',
          params: {
            threadId: 'thread-compiler',
            turnId: 'turn-compiler',
            item: {
              type: 'agentMessage',
              id: 'compiler-message',
              text: JSON.stringify({ finalPrompt: skillPrompt }),
            },
          },
        });
        runtimeForCompiler!.emit('notification', {
          method: 'turn/completed',
          params: {
            threadId: 'thread-compiler',
            turn: {
              id: 'turn-compiler',
              status: 'completed',
              error: null,
            },
          },
        });
        return {
          finalPrompt: skillPrompt,
          compiler: 'codex-imagegen-skill' as const,
          compilerThreadId: 'thread-compiler',
          compilerTurnId: 'turn-compiler',
        };
      },
    );
    const oauthImageGenerator = vi.fn(
      async (input: { generationPrompt: string }) => ({
        base64: onePixelPng.toString('base64'),
        revisedPrompt: 'tool revised prompt',
        generationSpec: input.generationPrompt,
        filePath: generatedPath,
        cleanup,
      }),
    );
    const { projectRoot, runtime, server } = await createServer({
      imageProvider: 'oauth',
      oauthUrl: 'http://127.0.0.1:10532',
      imageModel: 'gpt-5.6-sol',
      imageQuality: 'high',
      reasoningEffort: 'high',
      imagegenPromptCompiler,
      oauthImageGenerator,
    });
    runtimeForCompiler = runtime;
    generatedPath = path.join(projectRoot, 'oauth-result.png');
    await writeFile(generatedPath, onePixelPng);
    const jsonHeaders = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    };
    const imageHeaders = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'image/png',
    };

    await fetch(`${server.url}/api/threads`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ mode: 'new' }),
    });
    runtime.startTurn.mockResolvedValueOnce('turn-intent');
    await fetch(`${server.url}/api/turns`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: 'scene prompt',
        metadata: {
          kind: 'conversation',
          userMessage: '비가 그친 새벽으로 해줘.',
          sceneRevision: 1,
          specRevision: 0,
        },
      }),
    });
    runtime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn-intent',
        item: {
          type: 'agentMessage',
          id: 'intent-message',
          text: '젖은 노면과 차가운 새벽빛을 반영합니다.',
        },
      },
    });
    runtime.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread_1',
        turn: { id: 'turn-intent', status: 'completed', error: null },
      },
    });
    await vi.waitFor(async () => {
      const session = await fetch(`${server.url}/api/conversation-session`, {
        headers: { Authorization: 'Bearer test-token' },
      }).then((response) => response.json());
      expect(session).toMatchObject({
        activeTask: { generationIntent: { sourceTurnId: 'turn-intent' } },
      });
    });

    const eventsController = new AbortController();
    const eventsResponse = await fetch(`${server.url}/api/events`, {
      headers: { Authorization: 'Bearer test-token' },
      signal: eventsController.signal,
    });
    const eventsReader = eventsResponse.body!.getReader();
    const eventsDecoder = new TextDecoder();
    let events = '';
    const readEventsUntil = async (needle: string) => {
      await vi.waitFor(
        async () => {
          const next = await eventsReader.read();
          if (!next.done)
            events += eventsDecoder.decode(next.value, { stream: true });
          expect(events).toContain(needle);
        },
        { timeout: 2_000 },
      );
    };
    await readEventsUntil(': connected');

    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-oauth',
      floorId: 'floor-oauth',
      mannequinId: 'mannequin-oauth',
    });
    const renderResponse = await fetch(
      `${server.url}/api/scene-renders?sceneId=scene-oauth`,
      { method: 'POST', headers: imageHeaders, body: onePixelPng },
    );
    const render = (await renderResponse.json()) as { render: { id: string } };
    const generationResponse = await fetch(`${server.url}/api/generations`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        requestId: 'oauth-intent-request',
        threadId: 'thread_1',
        prompt: '$imagegen current scene evidence',
        layoutSpec: createLayoutSpec(sceneSnapshot),
        sceneSnapshot,
        layoutRenderId: render.render.id,
        referenceIds: [],
        imageModel: 'gpt-5.6-sol',
        imageQuality: 'high',
      }),
    });
    expect(generationResponse.status).toBe(202);
    await readEventsUntil('"status":"completed"');
    runtime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread-compiler',
        turnId: 'turn-compiler',
        item: {
          type: 'agentMessage',
          id: 'late-compiler-message',
          text: '{"finalPrompt":"late compiler event"}',
        },
      },
    });
    runtime.emit('serverRequest', {
      id: 902,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-compiler',
        turnId: 'turn-compiler',
      },
    });
    runtime.emit('notification', {
      method: 'test/marker',
      params: { threadId: 'thread_1', marker: 'after-compiler-marker' },
    });
    await readEventsUntil('after-compiler-marker');
    expect(events).not.toContain('thread-compiler');
    expect(events).not.toContain('compiler-message');
    expect(events).not.toContain('late-compiler-message');
    expect(runtime.rejectServerRequest).toHaveBeenCalledWith(
      902,
      -32600,
      expect.stringContaining('planning-only'),
    );
    const runtimeRequests = (await fetch(`${server.url}/api/runtime-requests`, {
      headers: { Authorization: 'Bearer test-token' },
    }).then((response) => response.json())) as { requests: unknown[] };
    expect(runtimeRequests.requests).toEqual([]);
    eventsController.abort();

    await vi.waitFor(async () => {
      const generations = (await fetch(`${server.url}/api/generations`, {
        headers: { Authorization: 'Bearer test-token' },
      }).then((response) => response.json())) as {
        generations: Array<Record<string, unknown>>;
      };
      expect(generations.generations).toContainEqual(
        expect.objectContaining({
          status: 'completed',
          provider: 'oauth',
          responseModel: 'gpt-5.6-sol',
          imageQuality: 'high',
          reasoningEffort: 'high',
          generationSpec: skillPrompt,
          promptCompiler: 'codex-imagegen-skill',
          revisedPrompt: 'tool revised prompt',
          generationIntentSnapshot: expect.objectContaining({
            sourceTurnId: 'turn-intent',
            userMessage: '비가 그친 새벽으로 해줘.',
          }),
        }),
      );
      const session = await fetch(`${server.url}/api/conversation-session`, {
        headers: { Authorization: 'Bearer test-token' },
      }).then((response) => response.json());
      expect(session).toMatchObject({
        activeTask: {
          lastTurnKind: 'generation',
          lastTurnStatus: 'completed',
        },
      });
    });
    expect(imagegenPromptCompiler).toHaveBeenCalledOnce();
    expect(imagegenPromptCompiler).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime,
        projectRoot,
        sourcePrompt: '$imagegen current scene evidence',
        generationIntent: expect.objectContaining({
          sourceTurnId: 'turn-intent',
        }),
        filePaths: [expect.stringContaining('/assets/scene-renders/')],
      }),
    );
    expect(oauthImageGenerator).toHaveBeenCalledOnce();
    expect(oauthImageGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        generationPrompt: skillPrompt,
        model: 'gpt-5.6-sol',
        quality: 'high',
      }),
    );
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('구조화된 Codex outputSchema 응답을 동일 proposal schema로 검증해 SSE에 전달한다', async () => {
    const { runtime, server } = await createServer();
    const controller = new AbortController();
    const eventsResponse = await fetch(`${server.url}/api/events`, {
      headers: { Authorization: 'Bearer test-token' },
      signal: controller.signal,
    });
    expect(eventsResponse.status).toBe(200);
    const reader = eventsResponse.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const readUntil = async (needle: string) => {
      await vi.waitFor(
        async () => {
          const next = await reader.read();
          if (!next.done)
            received += decoder.decode(next.value, { stream: true });
          expect(received).toContain(needle);
        },
        { timeout: 2_000 },
      );
    };
    await readUntil(': connected');

    const scene = createStarterSceneDocument({
      documentId: 'scene-proposal',
      floorId: 'floor-proposal',
      mannequinId: 'mannequin-proposal',
    });
    const response = await fetch(`${server.url}/api/spec-patch-proposals`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        requestId: 'request-proposal-1',
        baseSceneRevision: 0,
        baseSpecRevision: 0,
        userMessage: '장소를 골목 치킨집으로 바꿔줘.',
        sceneDocument: scene,
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      turnId: 'turn_1',
      requestId: 'request-proposal-1',
    });
    expect(runtime.startTurn).toHaveBeenCalledWith(
      'thread_1',
      [
        {
          type: 'text',
          text: expect.stringContaining('장소를 골목 치킨집으로 바꿔줘.'),
        },
      ],
      { outputSchema: expect.objectContaining({ type: 'object' }) },
    );

    const proposal = {
      version: 2,
      requestId: 'request-proposal-1',
      baseSceneRevision: 0,
      baseSpecRevision: 0,
      message: '장소를 골목 치킨집으로 변경합니다.',
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
          objectId: 'mannequin-proposal',
          transform: {
            position: { x: 1.25, y: 0.85, z: 0 },
            rotationDeg: { x: 0, y: 20, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
      warnings: [],
    };
    runtime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          type: 'agentMessage',
          id: 'proposal-message-1',
          text: JSON.stringify(proposal),
        },
      },
    });
    await readUntil('event: spec-patch-proposal');
    expect(received).toContain(`data: ${JSON.stringify(proposal)}`);

    const invalidResponse = await fetch(
      `${server.url}/api/spec-patch-proposals`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          threadId: 'thread_1',
          requestId: 'request-proposal-invalid',
          baseSceneRevision: 0,
          baseSpecRevision: 0,
          userMessage: 'object transform을 바꿔줘.',
          sceneDocument: scene,
        }),
      },
    );
    expect(invalidResponse.status).toBe(202);
    runtime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          type: 'agentMessage',
          id: 'proposal-message-invalid',
          text: JSON.stringify({
            ...proposal,
            requestId: 'request-proposal-invalid',
            specPatch: [],
            sceneCommands: [
              {
                ...proposal.sceneCommands[0],
                objectId: 'deleted-object',
              },
            ],
          }),
        },
      },
    });
    await readUntil('event: spec-patch-proposal-error');
    expect(received).toContain('request-proposal-invalid');

    const staleRequest = await fetch(`${server.url}/api/spec-patch-proposals`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        requestId: 'request-proposal-stale',
        baseSceneRevision: 99,
        baseSpecRevision: 0,
        userMessage: '장소를 바꿔줘.',
        sceneDocument: scene,
      }),
    });
    expect(staleRequest.status).toBe(400);

    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it('프로젝트 artifact를 localImage 입력으로 변환한다', async () => {
    const { runtime, server } = await createServer();

    const response = await fetch(`${server.url}/api/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:5173',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: '$imagegen 이 레퍼런스를 사용해 장면을 생성해 주세요.',
        attachments: ['references/character.png'],
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ turnId: 'turn_1' });
    expect(runtime.startTurn).toHaveBeenCalledWith('thread_1', [
      {
        type: 'text',
        text: '$imagegen 이 레퍼런스를 사용해 장면을 생성해 주세요.',
      },
      {
        type: 'localImage',
        path: expect.stringMatching(
          /[\\/]assets[\\/]references[\\/]character\.png$/,
        ),
        detail: 'original',
      },
    ]);
  });

  it('레퍼런스 이미지를 가져오고 인증된 content API로 제공한다', async () => {
    const { server, runtime } = await createServer();
    const query = new URLSearchParams({
      name: '정민 캐릭터 시트',
      kind: 'character',
      fileName: 'jeongmin.png',
    });

    const importedResponse = await fetch(
      `${server.url}/api/references?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'image/png',
          Origin: 'http://127.0.0.1:5173',
        },
        body: onePixelPng,
      },
    );
    expect(importedResponse.status).toBe(201);
    const imported = (await importedResponse.json()) as {
      reference: { id: string; name: string; kind: string };
    };
    expect(imported.reference).toMatchObject({
      name: '정민 캐릭터 시트',
      kind: 'character',
    });

    const listResponse = await fetch(`${server.url}/api/references`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await expect(listResponse.json()).resolves.toMatchObject({
      version: 1,
      references: [imported.reference],
    });

    const contentResponse = await fetch(
      `${server.url}/api/references/${imported.reference.id}/content`,
      { headers: { Authorization: 'Bearer test-token' } },
    );
    expect(contentResponse.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await contentResponse.arrayBuffer())).toEqual(
      onePixelPng,
    );

    const updateResponse = await fetch(
      `${server.url}/api/references/${imported.reference.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetObjectId: 'blue-mannequin',
          use: ['face', 'clothing'],
          exclude: ['pose', 'text'],
          enabled: true,
        }),
      },
    );
    await expect(updateResponse.json()).resolves.toMatchObject({
      reference: {
        targetObjectId: 'blue-mannequin',
        use: ['face', 'clothing'],
        exclude: ['pose', 'text'],
      },
    });

    const turnResponse = await fetch(`${server.url}/api/turns`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: '선택한 레퍼런스를 확인해줘.',
        referenceIds: [imported.reference.id],
      }),
    });
    expect(turnResponse.status).toBe(202);
    expect(runtime.startTurn).toHaveBeenCalledWith('thread_1', [
      { type: 'text', text: '선택한 레퍼런스를 확인해줘.' },
      {
        type: 'localImage',
        path: expect.stringMatching(
          /[\\/]assets[\\/]references[\\/]artifact_.+\.png$/,
        ),
        detail: 'original',
      },
    ]);
  });

  it('레퍼런스를 삭제하면 목록과 content API에서 제거한다', async () => {
    const { server } = await createServer();
    const importedResponse = await fetch(
      `${server.url}/api/references?name=${encodeURIComponent('삭제할 배경')}&kind=background&fileName=alley.png`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'image/png',
        },
        body: onePixelPng,
      },
    );
    const imported = (await importedResponse.json()) as {
      reference: { id: string };
    };

    const deletedResponse = await fetch(
      `${server.url}/api/references/${imported.reference.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-token' },
      },
    );
    expect(deletedResponse.status).toBe(200);
    await expect(deletedResponse.json()).resolves.toEqual({
      deleted: imported.reference.id,
    });

    const listResponse = await fetch(`${server.url}/api/references`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await expect(listResponse.json()).resolves.toMatchObject({
      references: [],
    });

    const missingResponse = await fetch(
      `${server.url}/api/references/${imported.reference.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-token' },
      },
    );
    expect(missingResponse.status).toBe(404);
  });

  it('3D 구도와 imagegen 결과를 생성 기록으로 보관한다', async () => {
    const { projectRoot, runtime, server } = await createServer();
    const headers = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'image/png',
    };
    const renderResponse = await fetch(
      `${server.url}/api/scene-renders?sceneId=scene-test`,
      { method: 'POST', headers, body: onePixelPng },
    );
    expect(renderResponse.status).toBe(201);
    const render = (await renderResponse.json()) as { render: { id: string } };
    const referenceResponse = await fetch(
      `${server.url}/api/references?name=${encodeURIComponent('정민 캐릭터')}&kind=character&fileName=jeongmin.png`,
      { method: 'POST', headers, body: onePixelPng },
    );
    expect(referenceResponse.status).toBe(201);
    const importedReference = (await referenceResponse.json()) as {
      reference: { id: string };
    };
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: 'mannequin-test',
    });
    const layoutSpec = createLayoutSpec(sceneSnapshot);

    const generationResponse = await fetch(`${server.url}/api/generations`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: '$imagegen 현재 구도로 이미지를 생성해 주세요.',
        layoutSpec,
        sceneSnapshot,
        layoutRenderId: render.render.id,
        referenceIds: [importedReference.reference.id],
      }),
    });
    expect(generationResponse.status).toBe(202);
    const started = (await generationResponse.json()) as {
      generation: {
        id: string;
        status: string;
        layoutSpec: { sceneId: string };
        sceneSnapshot: { id: string };
        referenceSnapshots: unknown[];
        parentGenerationId: string | null;
        versionNumber: number;
        generationMode: string;
      };
    };
    expect(started.generation.status).toBe('inProgress');
    expect(started.generation.layoutSpec.sceneId).toBe('scene-test');
    expect(started.generation).toMatchObject({
      sceneSnapshot: { id: 'scene-test' },
      referenceSnapshots: [
        expect.objectContaining({
          id: importedReference.reference.id,
          name: '정민 캐릭터',
          kind: 'character',
        }),
      ],
      parentGenerationId: null,
      versionNumber: 1,
      generationMode: 'fresh',
    });
    expect(runtime.startTurn).toHaveBeenLastCalledWith('thread_1', [
      {
        type: 'text',
        text: '$imagegen 현재 구도로 이미지를 생성해 주세요.',
      },
      {
        type: 'localImage',
        path: expect.stringMatching(
          /[\\/]assets[\\/]scene-renders[\\/]artifact_.+\.png$/,
        ),
        detail: 'original',
      },
      {
        type: 'localImage',
        path: expect.stringMatching(
          /[\\/]assets[\\/]references[\\/]artifact_.+\.png$/,
        ),
        detail: 'original',
      },
    ]);

    const savedPath = path.join(projectRoot, 'codex-result.png');
    await writeFile(savedPath, onePixelPng);
    runtime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          type: 'imageGeneration',
          id: 'image-1',
          status: 'completed',
          revisedPrompt: 'revised prompt',
          result: '',
          savedPath,
        },
      },
    });
    runtime.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread_1',
        turn: { id: 'turn_1', status: 'completed', error: null },
      },
    });

    await vi.waitFor(async () => {
      const response = await fetch(`${server.url}/api/generations`, {
        headers: { Authorization: 'Bearer test-token' },
      });
      const body = (await response.json()) as {
        generations: Array<{
          id: string;
          status: string;
          layoutSpec: { sceneId: string };
        }>;
      };
      expect(body.generations).toContainEqual(
        expect.objectContaining({
          id: started.generation.id,
          status: 'completed',
          layoutSpec: expect.objectContaining({ sceneId: 'scene-test' }),
        }),
      );
    });

    const content = await fetch(
      `${server.url}/api/generations/${started.generation.id}/content`,
      { headers: { Authorization: ['Bearer', 'test-token'].join(' ') } },
    );
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(onePixelPng);

    const thumbnail = await fetch(
      `${server.url}/api/generations/${started.generation.id}/thumbnail`,
      { headers: { Authorization: ['Bearer', 'test-token'].join(' ') } },
    );
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toBe('image/webp');
    expect((await thumbnail.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const unauthorizedLayout = await fetch(
      `${server.url}/api/scene-renders/${render.render.id}/content`,
    );
    expect(unauthorizedLayout.status).toBe(401);
    const layoutContent = await fetch(
      `${server.url}/api/scene-renders/${render.render.id}/content`,
      { headers: { Authorization: 'Bearer test-token' } },
    );
    expect(layoutContent.status).toBe(200);
    expect(layoutContent.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await layoutContent.arrayBuffer())).toEqual(onePixelPng);

    runtime.startTurn.mockResolvedValueOnce('turn_fresh_from_layout');
    const freshFromAppliedLayout = await fetch(
      `${server.url}/api/generations`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          threadId: 'thread_1',
          prompt: '$imagegen 적용한 3D 구도에서 새로 생성해 주세요.',
          layoutSpec,
          sceneSnapshot,
          layoutRenderId: render.render.id,
          referenceIds: [importedReference.reference.id],
          parentGenerationId: null,
          sourceGenerationId: started.generation.id,
          generationMode: 'fresh',
        }),
      },
    );
    expect(freshFromAppliedLayout.status).toBe(202);
    await expect(freshFromAppliedLayout.json()).resolves.toMatchObject({
      turnId: 'turn_fresh_from_layout',
      generation: {
        parentGenerationId: null,
        sourceGenerationId: started.generation.id,
        versionNumber: 1,
        generationMode: 'fresh',
        attachments: [
          { type: 'layout', id: render.render.id, kind: 'layout' },
          {
            type: 'reference',
            id: importedReference.reference.id,
            kind: 'character',
          },
        ],
      },
    });

    runtime.startTurn.mockResolvedValueOnce('turn_2');
    const refinementResponse = await fetch(`${server.url}/api/generations`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: '$imagegen 전봇대가 가리는 비율만 줄여 주세요.',
        layoutSpec,
        sceneSnapshot,
        layoutRenderId: render.render.id,
        referenceIds: [importedReference.reference.id],
        parentGenerationId: started.generation.id,
        feedback: '전봇대가 가리는 비율만 줄여 주세요.',
        refinementDirective: {
          version: 1,
          preserve: ['전체 구도', '인물 의상'],
          change: ['전봇대가 가리는 비율만 줄여 주세요.'],
        },
        generationMode: 'edit',
      }),
    });
    expect(refinementResponse.status).toBe(202);
    await expect(refinementResponse.json()).resolves.toMatchObject({
      turnId: 'turn_2',
      generation: {
        parentGenerationId: started.generation.id,
        versionNumber: 2,
        refinementDirective: {
          preserve: ['전체 구도', '인물 의상'],
          change: ['전봇대가 가리는 비율만 줄여 주세요.'],
        },
        generationMode: 'edit',
        attachments: [
          {
            type: 'sourceGeneration',
            id: started.generation.id,
            kind: null,
          },
          { type: 'layout', id: render.render.id, kind: 'layout' },
          {
            type: 'reference',
            id: importedReference.reference.id,
            kind: 'character',
          },
        ],
      },
    });
    expect(runtime.startTurn).toHaveBeenLastCalledWith('thread_1', [
      {
        type: 'text',
        text: '$imagegen 전봇대가 가리는 비율만 줄여 주세요.',
      },
      {
        type: 'localImage',
        path: expect.stringMatching(
          /[\\/]assets[\\/]generations[\\/]artifact_.+\.png$/,
        ),
        detail: 'original',
      },
      {
        type: 'localImage',
        path: expect.stringMatching(
          /[\\/]assets[\\/]scene-renders[\\/]artifact_.+\.png$/,
        ),
        detail: 'original',
      },
      {
        type: 'localImage',
        path: expect.stringMatching(
          /[\\/]assets[\\/]references[\\/]artifact_.+\.png$/,
        ),
        detail: 'original',
      },
    ]);
  });

  it('동일 generation request를 한 turn으로 합치고 재시작 뒤 interrupted 기록을 재사용한다', async () => {
    const { projectRoot, runtime, server } = await createServer();
    const binaryHeaders = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'image/png',
    };
    const renderResponse = await fetch(
      `${server.url}/api/scene-renders?sceneId=scene-idempotent`,
      { method: 'POST', headers: binaryHeaders, body: onePixelPng },
    );
    const render = (await renderResponse.json()) as { render: { id: string } };
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-idempotent',
      floorId: 'floor-idempotent',
      mannequinId: 'mannequin-idempotent',
    });
    const requestBody = {
      requestId: 'generation-request-server-1',
      threadId: 'thread-idempotent',
      prompt: '$imagegen idempotency test',
      layoutSpec: createLayoutSpec(sceneSnapshot),
      sceneSnapshot,
      layoutRenderId: render.render.id,
      referenceIds: [],
    };
    const request = (body: typeof requestBody) =>
      fetch(`${server.url}/api/generations`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

    const [first, duplicate] = await Promise.all([
      request(requestBody),
      request(requestBody),
    ]);
    expect([first.status, duplicate.status].sort()).toEqual([200, 202]);
    const firstBody = (await first.json()) as {
      turnId: string;
      generation: { id: string; requestId: string };
      reused: boolean;
    };
    const duplicateBody = (await duplicate.json()) as typeof firstBody;
    expect(firstBody.turnId).toBe(duplicateBody.turnId);
    expect(firstBody.generation.id).toBe(duplicateBody.generation.id);
    expect(firstBody.generation.requestId).toBe(requestBody.requestId);
    expect([firstBody.reused, duplicateBody.reused].sort()).toEqual([
      false,
      true,
    ]);
    expect(runtime.startTurn).toHaveBeenCalledTimes(1);

    const conflict = await request({
      ...requestBody,
      prompt: '$imagegen different payload',
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: expect.stringContaining('다른 입력'),
    });
    expect(runtime.startTurn).toHaveBeenCalledTimes(1);

    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const restartedRuntime = new FakeRuntime();
    const restarted = await startCompanionServer({
      runtime: restartedRuntime,
      projectRoot,
      allowedOrigins: ['http://127.0.0.1:5173'],
      token: 'test-token',
    });
    servers.push(restarted);

    const recoveredList = await fetch(`${restarted.url}/api/generations`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    await expect(recoveredList.json()).resolves.toMatchObject({
      generations: [
        {
          id: firstBody.generation.id,
          requestId: requestBody.requestId,
          status: 'interrupted',
          error: expect.stringContaining('재시작'),
        },
      ],
    });
    const replay = await fetch(`${restarted.url}/api/generations`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      turnId: firstBody.turnId,
      generation: {
        id: firstBody.generation.id,
        status: 'interrupted',
      },
      reused: true,
    });
    expect(restartedRuntime.startTurn).not.toHaveBeenCalled();
  });

  it('생성 전 무결성 오류를 차단하고 확인한 경고만 통과시킨다', async () => {
    const { runtime, server } = await createServer();
    const binaryHeaders = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'image/png',
    };
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-preflight',
      floorId: 'floor-preflight',
      mannequinId: 'mannequin-preflight',
    });
    const layoutSpec = createLayoutSpec(sceneSnapshot);
    const renderResponse = await fetch(
      `${server.url}/api/scene-renders?sceneId=${sceneSnapshot.id}`,
      { method: 'POST', headers: binaryHeaders, body: onePixelPng },
    );
    const render = (await renderResponse.json()) as { render: { id: string } };
    const referenceResponse = await fetch(
      `${server.url}/api/references?name=${encodeURIComponent('포즈 캐릭터')}&kind=character&fileName=pose.png`,
      { method: 'POST', headers: binaryHeaders, body: onePixelPng },
    );
    const imported = (await referenceResponse.json()) as {
      reference: { id: string };
    };
    const jsonHeaders = {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    };
    const updateReference = (targetObjectId: string, use: string[]) =>
      fetch(`${server.url}/api/references/${imported.reference.id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({
          targetObjectId,
          use,
          exclude: ['background'],
          enabled: true,
        }),
      });
    const requestGeneration = (
      acknowledgedPreflightWarningIds: string[] = [],
    ) =>
      fetch(`${server.url}/api/generations`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          threadId: 'thread_1',
          prompt: '$imagegen 생성 전 검사 테스트',
          layoutSpec,
          sceneSnapshot,
          layoutRenderId: render.render.id,
          referenceIds: [imported.reference.id],
          acknowledgedPreflightWarningIds,
        }),
      });

    expect((await updateReference('deleted-object', ['face'])).status).toBe(
      200,
    );
    const danglingResponse = await requestGeneration();
    expect(danglingResponse.status).toBe(400);
    await expect(danglingResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining('삭제된 object deleted-object'),
    });
    expect(runtime.startTurn).not.toHaveBeenCalled();

    expect(
      (await updateReference('mannequin-preflight', ['face', 'pose'])).status,
    ).toBe(200);
    const warningId = `pose-authority-conflict:${imported.reference.id}:mannequin-preflight`;
    const unacknowledgedResponse = await requestGeneration();
    expect(unacknowledgedResponse.status).toBe(400);
    await expect(unacknowledgedResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining(warningId),
    });
    expect(runtime.startTurn).not.toHaveBeenCalled();

    const acknowledgedResponse = await requestGeneration([warningId]);
    expect(acknowledgedResponse.status).toBe(202);
    expect(runtime.startTurn).toHaveBeenCalledTimes(1);
  });

  it('generation mode와 구조화된 보정 지시의 조합을 fail-closed 검증한다', async () => {
    const { runtime, server } = await createServer();
    const common = {
      threadId: 'thread_1',
      prompt: '$imagegen refinement directive contract',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createStarterSceneDocument({
        documentId: 'scene-test',
        floorId: 'floor-test',
        mannequinId: 'mannequin-test',
      }),
      layoutRenderId: 'render-test',
      referenceIds: [],
    };
    const request = (body: Record<string, unknown>) =>
      fetch(`${server.url}/api/generations`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...common, ...body }),
      });

    const missingDirective = await request({
      parentGenerationId: 'generation-parent',
      feedback: '가림만 줄여줘.',
      generationMode: 'edit',
    });
    expect(missingDirective.status).toBe(400);
    await expect(missingDirective.json()).resolves.toMatchObject({
      error: expect.stringContaining('구조화된 유지·변경 지시'),
    });

    const freshWithDirective = await request({
      refinementDirective: {
        version: 1,
        preserve: [],
        change: ['조명 변경'],
      },
      generationMode: 'fresh',
    });
    expect(freshWithDirective.status).toBe(400);
    await expect(freshWithDirective.json()).resolves.toMatchObject({
      error: expect.stringContaining('새 생성에는 보정 지시'),
    });
    expect(runtime.startTurn).not.toHaveBeenCalled();
  });

  it('레이아웃 외 레퍼런스가 네 장을 넘는 생성 요청을 거부한다', async () => {
    const { runtime, server } = await createServer();
    const response = await fetch(`${server.url}/api/generations`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: '$imagegen 테스트',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: createStarterSceneDocument({
          documentId: 'scene-test',
          floorId: 'floor-test',
          mannequinId: 'mannequin-test',
        }),
        layoutRenderId: 'render-test',
        referenceIds: ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5'],
      }),
    });

    expect(response.status).toBe(400);
    expect(runtime.startTurn).not.toHaveBeenCalled();

    const editResponse = await fetch(`${server.url}/api/generations`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: '$imagegen 보정 테스트',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: createStarterSceneDocument({
          documentId: 'scene-test',
          floorId: 'floor-test',
          mannequinId: 'mannequin-test',
        }),
        layoutRenderId: 'render-test',
        referenceIds: ['ref-1', 'ref-2', 'ref-3', 'ref-4'],
        parentGenerationId: 'generation-test',
        feedback: '작게 줄여줘.',
        generationMode: 'edit',
      }),
    });
    expect(editResponse.status).toBe(400);
    expect(runtime.startTurn).not.toHaveBeenCalled();
  });
});
