import { describe, expect, it, vi } from 'vitest';
import { CompanionClient, SseDecoder } from './companionClient';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';

const connection = {
  version: 1 as const,
  url: 'http://127.0.0.1:61234',
  token: 'a'.repeat(43),
};

describe('SseDecoder', () => {
  it('분할된 SSE 이벤트와 heartbeat를 처리한다', () => {
    const decoder = new SseDecoder();

    expect(decoder.push(': connected\n\nevent: runt')).toEqual([]);
    expect(
      decoder.push(
        'ime\ndata: {"state":"ready"}\n\n: heartbeat\n\nevent: codex\ndata: plain\n\n',
      ),
    ).toEqual([
      { event: 'runtime', data: { state: 'ready' } },
      { event: 'codex', data: 'plain' },
    ]);
  });
});

describe('CompanionClient', () => {
  it('Bearer 토큰으로 runtime 상태를 가져온다', async () => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input: String(input), init });
      return new Response(
        JSON.stringify({
          state: 'ready',
          version: 'codex-test',
          account: { type: 'chatgpt', email: null, planType: 'prolite' },
          requiresOpenaiAuth: true,
          error: null,
        }),
        { status: 200 },
      );
    };
    const client = new CompanionClient(connection, fetchImpl);

    await expect(client.getRuntime()).resolves.toMatchObject({
      state: 'ready',
      account: { type: 'chatgpt', planType: 'prolite' },
    });
    expect(fetchCalls[0]).toMatchObject({
      input: 'http://127.0.0.1:61234/api/runtime',
      init: {
        headers: { Authorization: `Bearer ${connection.token}` },
      },
    });
  });

  it('401을 세션 오류로 번역한다', async () => {
    const client = new CompanionClient(
      connection,
      async () => new Response(null, { status: 401 }),
    );

    await expect(client.getRuntime()).rejects.toThrow(/세션이 만료/);
  });

  it('Companion의 검증 오류 메시지를 사용자에게 전달한다', async () => {
    const client = new CompanionClient(
      connection,
      async () =>
        new Response(
          JSON.stringify({
            error: 'PNG, JPEG 또는 WebP 이미지만 가져올 수 있습니다.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    await expect(client.listReferences()).rejects.toThrow(
      'PNG, JPEG 또는 WebP 이미지만 가져올 수 있습니다.',
    );
  });

  it('thread 시작, turn 전송과 중단 요청을 인증된 JSON으로 보낸다', async () => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ input: url, init });
      if (url.endsWith('/api/threads')) {
        return new Response(JSON.stringify({ threadId: 'thread-1' }));
      }
      if (url.endsWith('/api/turns/interrupt')) {
        return new Response(JSON.stringify({ interrupted: true }));
      }
      return new Response(JSON.stringify({ turnId: 'turn-1' }), {
        status: 202,
      });
    };
    const client = new CompanionClient(connection, fetchImpl);

    await expect(client.startThread()).resolves.toBe('thread-1');
    await expect(client.startTurn('thread-1', '장면을 설명해줘')).resolves.toBe(
      'turn-1',
    );
    await expect(
      client.interruptTurn('thread-1', 'turn-1'),
    ).resolves.toBeUndefined();

    expect(fetchCalls).toEqual([
      expect.objectContaining({
        input: 'http://127.0.0.1:61234/api/threads',
        init: expect.objectContaining({ method: 'POST', body: '{}' }),
      }),
      expect.objectContaining({
        input: 'http://127.0.0.1:61234/api/turns',
        init: expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            threadId: 'thread-1',
            prompt: '장면을 설명해줘',
            attachments: [],
            referenceIds: [],
          }),
        }),
      }),
      expect.objectContaining({
        input: 'http://127.0.0.1:61234/api/turns/interrupt',
        init: expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ threadId: 'thread-1', turnId: 'turn-1' }),
        }),
      }),
    ]);
    expect(fetchCalls[0].init?.headers).toMatchObject({
      Authorization: `Bearer ${connection.token}`,
      'Content-Type': 'application/json',
    });
  });

  it('프로젝트 대화 metadata를 검증하고 요약 가능한 turn 입력을 보낸다', async () => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const session = {
      version: 1 as const,
      activeTask: {
        threadId: 'thread-saved',
        state: 'active' as const,
        turnCount: 2,
        lastTurnId: 'turn-2',
        lastTurnKind: 'conversation' as const,
        lastTurnStatus: 'completed' as const,
        lastUserMessage: '인물을 오른쪽으로 옮겨줘.',
        lastAssistantSummary: '오른쪽 이동 변경안을 준비했습니다.',
        sceneRevision: 4,
        specRevision: 2,
        generationIntent: null,
        createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:01:00.000Z',
      },
      archivedTaskCount: 1,
    };
    const client = new CompanionClient(connection, async (input, init) => {
      fetchCalls.push({ input: String(input), init });
      if (String(input).endsWith('/api/conversation-session')) {
        return new Response(JSON.stringify(session));
      }
      return new Response(JSON.stringify({ turnId: 'turn-3' }), {
        status: 202,
      });
    });

    await expect(client.getConversationSession()).resolves.toEqual(session);
    await expect(
      client.startConversationTurn(
        'thread-saved',
        'serialized prompt',
        ['ref-1'],
        {
          kind: 'conversation',
          userMessage: '계속 이야기하자.',
          sceneRevision: 5,
          specRevision: 3,
        },
      ),
    ).resolves.toBe('turn-3');

    expect(fetchCalls[1]).toMatchObject({
      input: 'http://127.0.0.1:61234/api/turns',
      init: {
        method: 'POST',
        body: JSON.stringify({
          threadId: 'thread-saved',
          prompt: 'serialized prompt',
          attachments: [],
          referenceIds: ['ref-1'],
          metadata: {
            kind: 'conversation',
            userMessage: '계속 이야기하자.',
            sceneRevision: 5,
            specRevision: 3,
          },
        }),
        headers: expect.objectContaining({
          Authorization: `Bearer ${connection.token}`,
        }),
      },
    });
  });

  it('App Server 요청 목록을 검증하고 승인·답변을 인증된 endpoint로 보낸다', async () => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const pending = {
      id: 'b893b2c7-06b7-4547-988b-5894df20d830',
      kind: 'commandApproval' as const,
      method: 'item/commandExecution/requestApproval' as const,
      threadId: 'thread-approval',
      turnId: 'turn-approval',
      itemId: 'item-command',
      status: 'pending' as const,
      title: '명령 실행 승인',
      reason: '빌드 검증',
      impact: 'npm run build',
      cwd: '/project',
      questions: [],
      autoResolutionMs: null,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
      resolvedAt: null,
    };
    const client = new CompanionClient(connection, async (input, init) => {
      fetchCalls.push({ input: String(input), init });
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            request: {
              ...pending,
              status: 'approved',
              updatedAt: '2026-08-04T00:01:00.000Z',
              resolvedAt: '2026-08-04T00:01:00.000Z',
            },
          }),
        );
      }
      return new Response(JSON.stringify({ version: 1, requests: [pending] }));
    });

    await expect(client.listRuntimeRequests()).resolves.toEqual({
      version: 1,
      requests: [pending],
    });
    await expect(
      client.respondRuntimeRequest(pending.id, { action: 'approve' }),
    ).resolves.toMatchObject({ id: pending.id, status: 'approved' });
    expect(fetchCalls[1]).toMatchObject({
      input: `http://127.0.0.1:61234/api/runtime-requests/${pending.id}/respond`,
      init: expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'approve' }),
        headers: expect.objectContaining({
          Authorization: `Bearer ${connection.token}`,
        }),
      }),
    });
  });

  it('Semantic Scene Spec 변경안 요청을 revisioned SceneDocument와 함께 보낸다', async () => {
    const sceneDocument = createStarterSceneDocument({
      documentId: 'scene-proposal-client',
      floorId: 'floor-proposal-client',
      mannequinId: 'mannequin-proposal-client',
    });
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const client = new CompanionClient(connection, async (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return new Response(
        JSON.stringify({
          turnId: 'turn-proposal-client',
          requestId: 'request-proposal-client',
        }),
        { status: 202 },
      );
    });

    await expect(
      client.startSpecPatchProposal({
        threadId: 'thread-1',
        requestId: 'request-proposal-client',
        baseSceneRevision: 0,
        baseSpecRevision: 0,
        userMessage: '분위기를 긴장감 있게 바꿔줘.',
        sceneDocument,
      }),
    ).resolves.toEqual({
      turnId: 'turn-proposal-client',
      requestId: 'request-proposal-client',
    });
    expect(fetchCalls[0]).toMatchObject({
      input: 'http://127.0.0.1:61234/api/spec-patch-proposals',
      init: expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          threadId: 'thread-1',
          requestId: 'request-proposal-client',
          baseSceneRevision: 0,
          baseSpecRevision: 0,
          userMessage: '분위기를 긴장감 있게 바꿔줘.',
          sceneDocument,
        }),
      }),
    });
  });

  it('브라우저 경계에서 request revision 불일치와 malformed SceneDocument를 전송 전에 거부한다', async () => {
    const sceneDocument = createStarterSceneDocument({
      documentId: 'scene-proposal-invalid-client',
      floorId: 'floor-proposal-invalid-client',
      mannequinId: 'mannequin-proposal-invalid-client',
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            turnId: 'turn-never',
            requestId: 'request-invalid',
          }),
          { status: 202 },
        ),
    );
    const client = new CompanionClient(connection, fetchImpl);

    await expect(
      client.startSpecPatchProposal({
        threadId: 'thread-1',
        requestId: 'request-invalid',
        baseSceneRevision: 1,
        baseSpecRevision: 0,
        userMessage: '장소를 바꿔줘.',
        sceneDocument,
      }),
    ).rejects.toThrow(/revision/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('레퍼런스 목록, 바이너리 가져오기와 콘텐츠 조회를 인증해 처리한다', async () => {
    const reference = {
      id: 'ref-1',
      name: '골목 배경',
      kind: 'background' as const,
      artifactId: 'artifact-1',
      contentHash: `sha256:${'a'.repeat(64)}`,
      mimeType: 'image/png' as const,
      width: 1920,
      height: 1080,
      originalFileName: 'alley.png',
      byteLength: 3,
      createdAt: '2026-08-03T00:00:00.000Z',
      targetObjectId: null,
      use: ['location', 'spatial structure', 'lighting'],
      exclude: ['character appearance', 'text'],
      enabled: true,
    };
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ input: url, init });
      if (url.endsWith('/api/references')) {
        return new Response(
          JSON.stringify({ version: 1, references: [reference] }),
        );
      }
      if (url.includes('/api/references?')) {
        return new Response(JSON.stringify({ reference }), { status: 201 });
      }
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            reference: { ...reference, enabled: false },
          }),
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'image/png' },
      });
    };
    const client = new CompanionClient(connection, fetchImpl);
    const file = new File([new Uint8Array([1, 2, 3])], 'alley.png', {
      type: 'image/png',
    });

    await expect(client.listReferences()).resolves.toEqual([reference]);
    await expect(
      client.importReference(file, '골목 배경', 'background'),
    ).resolves.toEqual(reference);
    await expect(
      client.updateReference('ref-1', {
        targetObjectId: null,
        use: reference.use,
        exclude: reference.exclude,
        enabled: false,
      }),
    ).resolves.toMatchObject({ enabled: false });
    await expect(client.loadReferenceBlob('ref-1')).resolves.toMatchObject({
      type: 'image/png',
      size: 3,
    });

    expect(fetchCalls[1]).toMatchObject({
      input:
        'http://127.0.0.1:61234/api/references?name=%EA%B3%A8%EB%AA%A9+%EB%B0%B0%EA%B2%BD&kind=background&fileName=alley.png',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'image/png',
        },
        body: file,
      },
    });
    expect(fetchCalls[2]).toMatchObject({
      input: 'http://127.0.0.1:61234/api/references/ref-1',
      init: expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          targetObjectId: null,
          use: reference.use,
          exclude: reference.exclude,
          enabled: false,
        }),
      }),
    });
    expect(fetchCalls[3]).toMatchObject({
      input: 'http://127.0.0.1:61234/api/references/ref-1/content',
      init: {
        headers: { Authorization: `Bearer ${connection.token}` },
      },
    });
  });

  it('구도 캡처 업로드와 생성 기록 API를 처리한다', async () => {
    const sceneSnapshot = createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: 'mannequin-test',
    });
    sceneSnapshot.semanticSceneSpec.intent.location = '한국 노포 야외 치킨집';
    const render = {
      id: 'render-1',
      sceneId: 'scene-1',
      artifactId: 'artifact-render',
      contentHash: `sha256:${'a'.repeat(64)}`,
      mimeType: 'image/png' as const,
      width: 1920,
      height: 1080,
      byteLength: 3,
      createdAt: '2026-08-03T00:00:00.000Z',
    };
    const generation = {
      id: 'generation-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      status: 'completed' as const,
      prompt: '$imagegen test',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot,
      semanticSceneSpecSnapshot: structuredClone(
        sceneSnapshot.semanticSceneSpec,
      ),
      referenceSnapshots: [],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
      refinementDirective: null,
      generationMode: 'fresh' as const,
      layoutRenderId: 'render-1',
      referenceIds: ['ref-1'],
      attachments: [
        { type: 'layout' as const, id: 'render-1', kind: 'layout' as const },
      ],
      executionSummary: {
        version: 1 as const,
        requestId: null,
        prompt: { contentHash: `sha256:${'1'.repeat(64)}` },
        sceneDocument: {
          id: sceneSnapshot.id,
          sceneRevision: sceneSnapshot.sceneRevision,
          specRevision: sceneSnapshot.specRevision,
          contentHash: `sha256:${'2'.repeat(64)}`,
        },
        semanticSceneSpec: {
          version: 1 as const,
          contentHash: `sha256:${'3'.repeat(64)}`,
        },
        layoutSpec: {
          version: 1 as const,
          sceneId: TEST_LAYOUT_SPEC.sceneId,
          contentHash: `sha256:${'4'.repeat(64)}`,
        },
        layoutRender: {
          id: 'render-1',
          sceneId: sceneSnapshot.id,
          contentHash: render.contentHash,
        },
        sourceGeneration: null,
        references: [],
        attachments: [
          {
            attachmentIndex: 1,
            type: 'layout' as const,
            id: 'render-1',
            kind: 'layout' as const,
            contentHash: render.contentHash,
          },
        ],
      },
      executionIntegrity: { status: 'valid' as const, issues: [] },
      revisedPrompt: null,
      result: {
        artifactId: 'artifact-generation-1',
        contentHash: `sha256:${'8'.repeat(64)}`,
        mimeType: 'image/png' as const,
        width: 1920,
        height: 1080,
        byteLength: 10_000,
        thumbnail: {
          policyVersion: 1 as const,
          artifactId: 'artifact-generation-1-thumbnail',
          sourceContentHash: `sha256:${'8'.repeat(64)}`,
          contentHash: `sha256:${'9'.repeat(64)}`,
          mimeType: 'image/webp' as const,
          width: 320,
          height: 180,
          byteLength: 512,
        },
      },
      error: null,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    };
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ input: url, init });
      if (url.includes('/api/scene-renders?')) {
        return new Response(JSON.stringify({ render }), { status: 201 });
      }
      if (url.endsWith('/api/generations') && init?.method === 'POST') {
        return new Response(JSON.stringify({ turnId: 'turn-1', generation }), {
          status: 202,
        });
      }
      if (url.endsWith('/api/generations')) {
        return new Response(
          JSON.stringify({ version: 1, generations: [generation] }),
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'Content-Type': url.endsWith('/thumbnail')
            ? 'image/webp'
            : 'image/png',
        },
      });
    };
    const client = new CompanionClient(connection, fetchImpl);
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: 'image/png',
    });

    await expect(client.createSceneRender(blob, 'scene-1')).resolves.toEqual(
      render,
    );
    await expect(client.listGenerations()).resolves.toEqual([generation]);
    await expect(
      client.startGeneration({
        requestId: 'generation-request-client-1',
        threadId: 'thread-1',
        prompt: '$imagegen test',
        layoutRenderId: 'render-1',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot,
        referenceIds: ['ref-1'],
      }),
    ).resolves.toEqual({ turnId: 'turn-1', generation });
    await expect(
      client.loadGenerationBlob('generation-1'),
    ).resolves.toMatchObject({ type: 'image/png', size: 3 });
    await expect(
      client.loadGenerationThumbnailBlob('generation-1'),
    ).resolves.toMatchObject({ type: 'image/webp', size: 3 });
    await expect(client.loadSceneRenderBlob('render-1')).resolves.toMatchObject(
      {
        type: 'image/png',
        size: 3,
      },
    );

    expect(fetchCalls[0]).toMatchObject({
      input: 'http://127.0.0.1:61234/api/scene-renders?sceneId=scene-1',
      init: expect.objectContaining({
        method: 'POST',
        body: blob,
        headers: expect.objectContaining({ 'Content-Type': 'image/png' }),
      }),
    });
    expect(fetchCalls[2]?.init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        requestId: 'generation-request-client-1',
        threadId: 'thread-1',
        prompt: '$imagegen test',
        layoutRenderId: 'render-1',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot,
        referenceIds: ['ref-1'],
        parentGenerationId: null,
        sourceGenerationId: null,
        feedback: null,
        refinementDirective: null,
        generationMode: 'fresh',
        acknowledgedPreflightWarningIds: [],
        imageModel: 'gpt-5.4-mini',
        imageQuality: 'medium',
      }),
    });
    expect(fetchCalls.at(-2)?.input).toBe(
      'http://127.0.0.1:61234/api/generations/generation-1/thumbnail',
    );
    expect(fetchCalls.at(-1)?.input).toBe(
      'http://127.0.0.1:61234/api/scene-renders/render-1/content',
    );
  });
});
