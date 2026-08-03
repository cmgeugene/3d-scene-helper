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
  async startThread() {
    return 'thread_1';
  }
  async resumeThread(threadId: string) {
    return threadId;
  }
  async interruptTurn() {}
}

async function createServer() {
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

    const generationResponse = await fetch(`${server.url}/api/generations`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId: 'thread_1',
        prompt: '$imagegen 현재 구도로 이미지를 생성해 주세요.',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: createStarterSceneDocument({
          documentId: 'scene-test',
          floorId: 'floor-test',
          mannequinId: 'mannequin-test',
        }),
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
      { headers: { Authorization: 'Bearer test-token' } },
    );
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(onePixelPng);

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
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: createStarterSceneDocument({
          documentId: 'scene-test',
          floorId: 'floor-test',
          mannequinId: 'mannequin-test',
        }),
        layoutRenderId: render.render.id,
        referenceIds: [importedReference.reference.id],
        parentGenerationId: started.generation.id,
        feedback: '전봇대가 가리는 비율만 줄여 주세요.',
        generationMode: 'edit',
      }),
    });
    expect(refinementResponse.status).toBe(202);
    await expect(refinementResponse.json()).resolves.toMatchObject({
      turnId: 'turn_2',
      generation: {
        parentGenerationId: started.generation.id,
        versionNumber: 2,
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
