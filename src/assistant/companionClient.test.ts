import { describe, expect, it } from 'vitest';
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
      status: 'inProgress' as const,
      prompt: '$imagegen test',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot,
      referenceSnapshots: [],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
      generationMode: 'fresh' as const,
      layoutRenderId: 'render-1',
      referenceIds: ['ref-1'],
      attachments: [
        { type: 'layout' as const, id: 'render-1', kind: 'layout' as const },
      ],
      revisedPrompt: null,
      result: null,
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
        headers: { 'Content-Type': 'image/png' },
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
        threadId: 'thread-1',
        prompt: '$imagegen test',
        layoutRenderId: 'render-1',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot,
        referenceIds: ['ref-1'],
        parentGenerationId: null,
        feedback: null,
        generationMode: 'fresh',
      }),
    });
    expect(fetchCalls.at(-1)?.input).toBe(
      'http://127.0.0.1:61234/api/scene-renders/render-1/content',
    );
  });
});
