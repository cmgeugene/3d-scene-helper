import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { TEST_LAYOUT_SPEC } from '../shared/layoutSpecTestFixture';
import { createStarterSceneDocument } from '../src/editor/persistence/sceneSchema';

const token = 'e2e-refinement-directive-token'.padEnd(43, 'x');
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const sceneSnapshot = createStarterSceneDocument({
  documentId: 'scene-refinement-e2e',
  floorId: 'starter-floor',
  mannequinId: 'starter-mannequin',
});
const now = '2026-08-04T00:00:00.000Z';

interface RefinementGenerationRequest {
  threadId: string;
  prompt: string;
  layoutSpec: typeof TEST_LAYOUT_SPEC;
  sceneSnapshot: typeof sceneSnapshot;
  referenceIds: string[];
  parentGenerationId: string | null;
  sourceGenerationId: string | null;
  feedback: string | null;
  refinementDirective: {
    version: 1;
    preserve: string[];
    change: string[];
  } | null;
  generationMode: 'fresh' | 'edit';
  layoutRenderId: string;
  acknowledgedPreflightWarningIds: string[];
}

function generationSource() {
  return {
    id: 'generation-refinement-source',
    threadId: 'thread-refinement-e2e',
    turnId: 'turn-refinement-source',
    status: 'completed' as const,
    prompt: '$imagegen source',
    layoutSpec: { ...TEST_LAYOUT_SPEC, sceneId: sceneSnapshot.id },
    sceneSnapshot,
    semanticSceneSpecSnapshot: sceneSnapshot.semanticSceneSpec,
    referenceSnapshots: [],
    parentGenerationId: null,
    sourceGenerationId: null,
    versionNumber: 1,
    feedback: null,
    refinementDirective: null,
    generationMode: 'fresh' as const,
    layoutRenderId: 'render-refinement-source',
    sceneIntegrity: {
      status: 'valid' as const,
      snapshotSceneId: sceneSnapshot.id,
      layoutSpecSceneId: sceneSnapshot.id,
      layoutRenderSceneId: sceneSnapshot.id,
    },
    referenceIds: [],
    attachments: [
      {
        type: 'layout' as const,
        id: 'render-refinement-source',
        kind: 'layout' as const,
      },
    ],
    revisedPrompt: null,
    result: {
      artifactId: 'artifact-refinement-source',
      contentHash: `sha256:${'a'.repeat(64)}`,
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
      byteLength: onePixelPng.byteLength,
    },
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function readRequest(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
    Vary: 'Origin',
  });
  response.end(JSON.stringify(value));
}

test('보정 유지·변경 계약이 prompt와 generation history까지 왕복된다', async ({
  page,
}) => {
  const eventResponses = new Set<ServerResponse>();
  const generations: Array<Record<string, unknown>> = [generationSource()];
  let generationRequest: RefinementGenerationRequest | null = null;
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4173');
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/api/runtime') {
      sendJson(response, {
        state: 'ready',
        version: 'codex-refinement-e2e',
        account: { type: 'chatgpt', email: null, planType: 'plus' },
        requiresOpenaiAuth: true,
        capabilities: {
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
        },
        error: null,
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/references') {
      sendJson(response, { version: 1, references: [] });
      return;
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/conversation-session'
    ) {
      sendJson(response, {
        version: 1,
        activeTask: null,
        archivedTaskCount: 0,
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/runtime-requests') {
      sendJson(response, { version: 1, requests: [] });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/generations') {
      sendJson(response, { version: 1, generations });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
      });
      response.write(': connected\n\n');
      eventResponses.add(response);
      request.on('close', () => eventResponses.delete(response));
      return;
    }
    if (
      request.method === 'GET' &&
      /^\/api\/(?:generations|scene-renders)\/[^/]+\/content$/.test(
        url.pathname,
      )
    ) {
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': onePixelPng.byteLength,
        'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
      });
      response.end(onePixelPng);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/threads') {
      await readRequest(request);
      sendJson(response, { threadId: 'thread-refinement-e2e' }, 201);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/scene-renders') {
      const body = await readRequest(request);
      sendJson(
        response,
        {
          render: {
            id: 'render-refinement-child',
            sceneId: url.searchParams.get('sceneId'),
            artifactId: 'artifact-render-refinement-child',
            contentHash: `sha256:${'b'.repeat(64)}`,
            mimeType: 'image/png',
            width: 1920,
            height: 1080,
            byteLength: body.byteLength,
            createdAt: now,
          },
        },
        201,
      );
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/generations') {
      generationRequest = JSON.parse(
        (await readRequest(request)).toString('utf8'),
      ) as RefinementGenerationRequest;
      const child = {
        ...generationSource(),
        id: 'generation-refinement-child',
        turnId: 'turn-refinement-child',
        prompt: generationRequest.prompt,
        layoutSpec: generationRequest.layoutSpec,
        sceneSnapshot: generationRequest.sceneSnapshot,
        semanticSceneSpecSnapshot:
          generationRequest.sceneSnapshot.semanticSceneSpec,
        parentGenerationId: generationRequest.parentGenerationId,
        versionNumber: 2,
        feedback: generationRequest.feedback,
        refinementDirective: generationRequest.refinementDirective,
        generationMode: 'edit' as const,
        layoutRenderId: generationRequest.layoutRenderId,
        attachments: [
          {
            type: 'sourceGeneration' as const,
            id: generationRequest.parentGenerationId!,
            kind: null,
          },
          {
            type: 'layout' as const,
            id: generationRequest.layoutRenderId,
            kind: 'layout' as const,
          },
        ],
        updatedAt: '2026-08-04T00:01:00.000Z',
      };
      generations.push(child);
      sendJson(
        response,
        {
          turnId: child.turnId,
          generation: { ...child, status: 'inProgress' },
        },
        202,
      );
      setTimeout(() => {
        for (const eventResponse of eventResponses) {
          eventResponse.write(
            `event: codex\ndata: ${JSON.stringify({
              method: 'turn/completed',
              params: {
                threadId: generationRequest!.threadId,
                turn: { id: child.turnId, status: 'completed', error: null },
              },
            })}\n\n`,
          );
        }
      }, 50);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const companionUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browserProblems: string[] = [];
  page.on('pageerror', (error) =>
    browserProblems.push(`pageerror: ${error.message}`),
  );
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'warning' &&
      (text.includes('THREE.Clock: This module has been deprecated') ||
        text.includes('GPU stall due to ReadPixels'))
    ) {
      return;
    }
    if (message.type() === 'warning' || message.type() === 'error') {
      browserProblems.push(
        `${message.type()}: ${text} @ ${message.location().url}`,
      );
    }
  });

  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    const encoded = Buffer.from(
      JSON.stringify({ version: 1, url: companionUrl, token }),
    ).toString('base64url');
    await page.goto(`/#companion=${encoded}`);
    await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
      'data-webgl-state',
      'available',
    );
    await page.getByRole('button', { name: '키프레임' }).click();
    await page
      .getByRole('button', { name: /generation-refinement-source/ })
      .click();
    await expect(
      page.getByRole('img', { name: '선택 generation 결과' }),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: '생성 당시 3D 레이아웃' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '선택 결과로 보정' }).click();
    await expect(page.getByText('키프레임 보정 모드')).toBeVisible();

    const preserve = page.getByLabel('이 키프레임에서 유지할 요소');
    const change = page.getByLabel('이 키프레임에서 바꿀 내용');
    await preserve.fill('전체 구도\n전봇대 가림');
    await change.fill('전봇대 가림');
    await page.getByRole('button', { name: '보정 생성' }).click();
    await expect(page.getByRole('alert')).toContainText(
      '같은 항목을 유지하면서 동시에 변경할 수 없습니다.',
    );
    expect(generationRequest).toBeNull();

    await preserve.fill('전체 구도\n인물 의상과 정체성');
    await change.fill('전봇대 가림을 10% 이하로 줄이기\n표정을 더 밝게');
    await page.getByRole('button', { name: '보정 생성' }).click();
    await expect.poll(() => generationRequest).not.toBeNull();
    expect(generationRequest).toMatchObject({
      parentGenerationId: 'generation-refinement-source',
      sourceGenerationId: null,
      feedback: '전봇대 가림을 10% 이하로 줄이기\n표정을 더 밝게',
      generationMode: 'edit',
      refinementDirective: {
        version: 1,
        preserve: ['전체 구도', '인물 의상과 정체성'],
        change: ['전봇대 가림을 10% 이하로 줄이기', '표정을 더 밝게'],
      },
    });
    expect(generationRequest!.prompt).toContain(
      '[보정 지시 / RefinementDirective]',
    );
    expect(generationRequest!.prompt).toContain(
      JSON.stringify(generationRequest!.refinementDirective),
    );
    expect(generationRequest!.prompt).toContain(
      '두 목록에 없는 외형 요소도 기존 키프레임을 우선 보존',
    );
    expect(generationRequest!.prompt).toContain(
      '현재 3D 레이아웃과 LayoutSpec이 항상 최상위 권위',
    );

    await expect(change).toBeEnabled();
    await page.getByRole('button', { name: '키프레임' }).click();
    await page
      .getByRole('button', { name: /generation-refinement-child/ })
      .click();
    const selectedMetadata = page.getByRole('region', {
      name: '선택 Generation 메타데이터',
    });
    await expect(
      selectedMetadata.getByText('전체 구도 · 인물 의상과 정체성'),
    ).toBeVisible();
    await expect(
      selectedMetadata.getByText(
        '전봇대 가림을 10% 이하로 줄이기 · 표정을 더 밝게',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: '선택 generation 결과' }),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: '생성 당시 3D 레이아웃' }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth',
      ),
    ).toBe(true);
    expect(browserProblems).toEqual([]);
  } finally {
    for (const response of eventResponses) response.end();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
