import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { TEST_LAYOUT_SPEC } from '../shared/layoutSpecTestFixture';
import { createStarterSceneDocument } from '../src/editor/persistence/sceneSchema';

const token = 'e2e-keyframe-token-'.padEnd(43, 'x');
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const sceneSnapshot = createStarterSceneDocument({
  documentId: 'scene-e2e',
  floorId: 'floor-e2e',
  mannequinId: 'mannequin-e2e',
});

function generation(id: string, legacy = false) {
  return {
    id,
    threadId: 'thread-e2e',
    turnId: `turn-${id}`,
    status: 'completed',
    prompt: `$imagegen ${id} 지시`,
    layoutSpec: legacy ? null : TEST_LAYOUT_SPEC,
    sceneSnapshot: legacy ? null : sceneSnapshot,
    referenceSnapshots: [],
    parentGenerationId: null,
    versionNumber: 1,
    feedback: null,
    generationMode: 'fresh',
    layoutRenderId: `render-${id}`,
    referenceIds: [],
    attachments: [{ type: 'layout', id: `render-${id}`, kind: 'layout' }],
    revisedPrompt: `revised ${id}`,
    result: {
      artifactId: `artifact-${id}`,
      contentHash: `sha256:${'a'.repeat(64)}`,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteLength: onePixelPng.byteLength,
    },
    error: null,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: legacy ? '2026-08-03T00:02:00.000Z' : '2026-08-03T00:01:00.000Z',
  } as const;
}

const generations = [
  generation('generation-complete'),
  generation('generation-legacy', true),
];
let server: Server;
let companionUrl: string;

function sendJson(
  response: import('node:http').ServerResponse,
  value: unknown,
) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
    Vary: 'Origin',
  });
  response.end(JSON.stringify(value));
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4173');
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      });
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401);
      response.end();
      return;
    }
    if (request.url === '/api/runtime') {
      sendJson(response, {
        state: 'ready',
        version: 'codex-e2e',
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
    if (request.url === '/api/generations') {
      sendJson(response, { version: 1, generations });
      return;
    }
    if (request.url === '/api/references') {
      sendJson(response, { version: 1, references: [] });
      return;
    }
    if (request.url === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
      });
      response.write(': connected\n\n');
      return;
    }
    if (
      request.url?.match(
        /^\/api\/(?:generations|scene-renders)\/[^/]+\/content$/,
      )
    ) {
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': String(onePixelPng.byteLength),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
      });
      response.end(onePixelPng);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  companionUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('키프레임 이력 선택·비교·복원 제한·새로고침·선택 generation 보정 흐름', async ({
  page,
}) => {
  const browserProblems: string[] = [];
  page.on('pageerror', (error) =>
    browserProblems.push(`pageerror: ${error.message}`),
  );
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, url: companionUrl, token }),
  ).toString('base64url');
  await page.goto(`/#companion=${encoded}`);

  const [titleBounds, modeBounds, firstToolbarActionBounds] = await Promise.all(
    [
      page.getByRole('heading', { name: 'I2V 3D Scene Helper' }).boundingBox(),
      page.getByRole('group', { name: '작업 모드' }).boundingBox(),
      page.getByRole('button', { name: '실행 취소' }).boundingBox(),
    ],
  );
  expect(titleBounds).not.toBeNull();
  expect(modeBounds).not.toBeNull();
  expect(firstToolbarActionBounds).not.toBeNull();
  if (
    titleBounds === null ||
    modeBounds === null ||
    firstToolbarActionBounds === null
  ) {
    throw new Error('작업 모드 전환과 toolbar bounds를 읽지 못했습니다.');
  }
  expect(modeBounds.y).toBeGreaterThanOrEqual(
    titleBounds.y + titleBounds.height,
  );
  expect(modeBounds.x + modeBounds.width).toBeLessThanOrEqual(
    firstToolbarActionBounds.x,
  );

  await page.getByRole('button', { name: '키프레임' }).click();
  await expect(
    page.getByRole('heading', { name: '키프레임 작업 공간' }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Generation 이력' }).getByRole('button'),
  ).toHaveCount(2);
  await expect(
    page.getByRole('img', { name: '선택 generation 결과' }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: '생성 당시 3D 레이아웃' }),
  ).toBeVisible();

  const complete = page.getByRole('button', { name: /generation-complete/ });
  await complete.click();
  await expect(complete).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByText('$imagegen generation-complete 지시'),
  ).toBeVisible();

  const legacy = page.getByRole('button', { name: /generation-legacy/ });
  await legacy.click();
  await expect(page.getByText('구형 기록 · 3D 장면 복원 제한')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '키프레임 작업 공간' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /generation-legacy/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('구형 기록 · 3D 장면 복원 제한')).toBeVisible();

  await page.getByRole('button', { name: /generation-complete/ }).click();
  await page.getByRole('button', { name: '선택 결과로 보정' }).click();
  await expect(page.getByRole('button', { name: '3D 씬' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('키프레임 보정 모드')).toBeVisible();
  await expect(page.getByText(/v1.*generation-complete.*결과/)).toBeVisible();
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);
  expect(browserProblems).toEqual([]);
});
