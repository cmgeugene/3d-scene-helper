import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { SCENE_STORAGE_KEY } from '../src/editor/constants';

const token = 'e2e-semantic-scene-spec-token'.padEnd(43, 'x');

interface GenerationRequest {
  threadId: string;
  prompt: string;
  layoutSpec: { sceneId: string };
  sceneSnapshot: {
    id: string;
    semanticSceneSpec: {
      version: number;
      intent: { location: string };
      generatedProps: Array<{ name: string }>;
      extras: { enabled: boolean; minCount: number; maxCount: number };
      relationships: Array<{
        subjectObjectId: string;
        targetObjectId: string;
      }>;
      constraints: { preserve: string[]; allowChanges: string[] };
    };
  };
  referenceIds: string[];
  parentGenerationId: string | null;
  sourceGenerationId: string | null;
  feedback: string | null;
  generationMode: 'fresh' | 'edit';
  layoutRenderId: string;
}

async function readRequest(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(
  response: import('node:http').ServerResponse,
  value: unknown,
  status = 200,
) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
    Vary: 'Origin',
  });
  response.end(JSON.stringify(value));
}

function browserProblemCollector(page: import('@playwright/test').Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (
      (message.type() === 'warning' &&
        (text.includes('THREE.Clock: This module has been deprecated') ||
          text.includes('GPU stall due to ReadPixels'))) ||
      (message.type() === 'error' &&
        text.includes('net::ERR_INCOMPLETE_CHUNKED_ENCODING'))
    ) {
      return;
    }
    if (message.type() === 'warning' || message.type() === 'error') {
      problems.push(`${message.type()}: ${text}`);
    }
  });
  return problems;
}

let server: Server;
let companionUrl = '';
let generationRequest: GenerationRequest | null = null;
let generationSnapshot:
  GenerationRequest['sceneSnapshot']['semanticSceneSpec'] | null = null;

function createMockCompanion() {
  return createServer(async (request, response) => {
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
        version: 'codex-semantic-e2e',
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
    if (request.method === 'GET' && url.pathname === '/api/generations') {
      sendJson(response, { version: 1, generations: [] });
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
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/threads') {
      await readRequest(request);
      sendJson(response, { threadId: 'thread-semantic-e2e' }, 201);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/scene-renders') {
      const body = await readRequest(request);
      const sceneId = url.searchParams.get('sceneId') ?? 'missing-scene';
      sendJson(
        response,
        {
          render: {
            id: 'render-semantic-e2e',
            sceneId,
            artifactId: 'artifact-render-semantic-e2e',
            contentHash: `sha256:${'a'.repeat(64)}`,
            mimeType: 'image/png',
            width: 1920,
            height: 1080,
            byteLength: body.byteLength,
            createdAt: '2026-08-04T00:00:00.000Z',
          },
        },
        201,
      );
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/generations') {
      generationRequest = JSON.parse(
        (await readRequest(request)).toString('utf8'),
      ) as GenerationRequest;
      generationSnapshot = structuredClone(
        generationRequest.sceneSnapshot.semanticSceneSpec,
      );
      const now = '2026-08-04T00:00:01.000Z';
      sendJson(
        response,
        {
          turnId: 'turn-semantic-e2e',
          generation: {
            id: 'generation-semantic-e2e',
            threadId: generationRequest.threadId,
            turnId: 'turn-semantic-e2e',
            status: 'inProgress',
            prompt: generationRequest.prompt,
            layoutSpec: generationRequest.layoutSpec,
            sceneSnapshot: generationRequest.sceneSnapshot,
            semanticSceneSpecSnapshot: generationSnapshot,
            referenceSnapshots: [],
            parentGenerationId: generationRequest.parentGenerationId,
            sourceGenerationId: generationRequest.sourceGenerationId,
            versionNumber: 1,
            feedback: generationRequest.feedback,
            generationMode: generationRequest.generationMode,
            layoutRenderId: generationRequest.layoutRenderId,
            referenceIds: generationRequest.referenceIds,
            attachments: [
              {
                type: 'layout',
                id: generationRequest.layoutRenderId,
                kind: 'layout',
              },
            ],
            revisedPrompt: null,
            result: null,
            error: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        202,
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });
}

test.beforeAll(async () => {
  generationRequest = null;
  generationSnapshot = null;
  server = createMockCompanion();
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

test('Semantic Scene Spec 편집·undo/redo·autosave/reload·generation snapshot/prompt가 1280×720에서 왕복된다', async ({
  page,
}) => {
  const browserProblems = browserProblemCollector(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, url: companionUrl, token }),
  ).toString('base64url');
  await page.goto(`/#companion=${encoded}`);
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect(page.getByText('연결됨')).toBeVisible();

  const objectIds = await page.evaluate(() => {
    const runtime = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState(): {
          document: { objects: Array<{ id: string; kind: string }> };
        };
      };
    };
    const objects = runtime.__I2V_EDITOR_STORE__?.getState().document.objects;
    if (objects === undefined) throw new Error('editor test bridge missing');
    return {
      floor: objects.find(({ kind }) => kind === 'floor')?.id ?? '',
      mannequin: objects.find(({ kind }) => kind === 'mannequin')?.id ?? '',
    };
  });
  expect(objectIds.floor).not.toBe('');
  expect(objectIds.mannequin).not.toBe('');

  await page.getByRole('button', { name: '연출' }).click();
  await page.getByLabel('장소').fill('한국 노포 야외 치킨집');
  await page.getByLabel('시간대').fill('해질녘');
  await page.getByLabel('분위기').fill('따뜻한 저녁의 조용한 대화');
  await page.getByLabel('화풍 의도').fill('시네마틱 2D 애니메이션');
  await page
    .getByLabel('생성 전용 소품')
    .fill('치킨 | 테이블 중앙 | 핵심\n맥주 | 테이블 오른쪽 | 보조');
  await page.getByRole('checkbox', { name: '엑스트라 사용' }).check();
  await page.getByLabel('엑스트라 최소 인원').fill('5');
  await page.getByLabel('엑스트라 최대 인원').fill('8');
  await page.getByLabel('엑스트라 배치').fill('오른쪽 배경 테이블');
  await page.getByLabel('엑스트라 중요도').fill('주인공보다 낮음');
  await page
    .getByLabel('인물 및 오브젝트 관계')
    .fill(
      `${objectIds.mannequin} | ${objectIds.floor} | 주인공과 공간 | 출입구 쪽 | 서 있음`,
    );
  await page.getByLabel('필수 유지 요소').fill('카메라 구도\n인물 외형');
  await page.getByLabel('변경 가능 요소').fill('배경 디테일');
  await page.getByRole('button', { name: '장면 명세 적용' }).click();

  await expect(page.getByLabel('장소')).toHaveValue('한국 노포 야외 치킨집');
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeEnabled();
  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(page.getByLabel('장소')).toHaveValue('');
  await page.getByRole('button', { name: '다시 실행' }).click();
  await expect(page.getByLabel('장소')).toHaveValue('한국 노포 야외 치킨집');
  await expect(page.locator('.status-bar')).toContainText(
    '장면을 자동 저장했습니다.',
  );

  const storedBeforeReload = await page.evaluate(
    (key) => localStorage.getItem(key),
    SCENE_STORAGE_KEY,
  );
  expect(storedBeforeReload).not.toBeNull();
  expect(JSON.parse(storedBeforeReload!)).toMatchObject({
    semanticSceneSpec: {
      version: 1,
      intent: { location: '한국 노포 야외 치킨집' },
      extras: { enabled: true, minCount: 5, maxCount: 8 },
    },
  });

  await page.reload();
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await page.getByRole('button', { name: '연출' }).click();
  await expect(page.getByLabel('장소')).toHaveValue('한국 노포 야외 치킨집');
  await expect(page.getByLabel('생성 전용 소품')).toContainText('맥주');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 내보내기' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, 'utf8')) as {
    semanticSceneSpec: unknown;
  };
  expect(exported.semanticSceneSpec).toEqual(
    JSON.parse(storedBeforeReload!).semanticSceneSpec,
  );

  const chatOnlyText = '채팅에만 있고 저장 spec에는 없는 문장';
  await page.getByLabel('장면에 대해 말하기').fill(chatOnlyText);
  await page.getByRole('button', { name: '이미지 생성' }).click();
  await expect.poll(() => generationRequest).not.toBeNull();

  expect(generationRequest!.sceneSnapshot.semanticSceneSpec).toMatchObject({
    version: 1,
    intent: { location: '한국 노포 야외 치킨집' },
    generatedProps: [{ name: '맥주' }, { name: '치킨' }],
    extras: { enabled: true, minCount: 5, maxCount: 8 },
    constraints: {
      preserve: ['인물 외형', '카메라 구도'],
      allowChanges: ['배경 디테일'],
    },
  });
  expect(generationSnapshot).toEqual(
    generationRequest!.sceneSnapshot.semanticSceneSpec,
  );
  expect(generationRequest!.prompt).toContain('- 장소: 한국 노포 야외 치킨집');
  expect(generationRequest!.prompt).toContain('[생성 전용 소품]');
  expect(generationRequest!.prompt).toContain('[인물/오브젝트 관계]');
  expect(generationRequest!.prompt).not.toContain(chatOnlyText);
  expect(generationRequest!.prompt).not.toContain('"semanticSceneSpec"');

  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);
  expect(browserProblems).toEqual([]);
});
