import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { SCENE_STORAGE_KEY } from '../src/editor/constants';

const token = 'e2e-spec-patch-change-card-token'.padEnd(43, 'x');
let server: Server;
let companionUrl = '';
let turnSequence = 0;
let renderSequence = 0;
let completedGenerationTurns = 0;
const generationRequests: GenerationRequest[] = [];
const sseResponses = new Set<ServerResponse>();

interface ProposalRequest {
  threadId: string;
  requestId: string;
  baseSceneRevision: number;
  baseSpecRevision: number;
  userMessage: string;
}

interface GenerationRequest {
  threadId: string;
  prompt: string;
  layoutSpec: {
    sceneId: string;
    objects: Array<{
      objectId: string;
      yawDeg: number;
      worldBounds: { center: { x: number; y: number; z: number } };
    }>;
  };
  sceneSnapshot: SpecPatchBrowserState['document'] & {
    id: string;
    semanticSceneSpec: { intent: { location: string } };
  };
  referenceIds: string[];
  parentGenerationId: string | null;
  sourceGenerationId: string | null;
  feedback: string | null;
  generationMode: 'fresh' | 'edit';
  layoutRenderId: string;
  acknowledgedPreflightWarningIds: string[];
}

interface SpecPatchBrowserState {
  document: {
    semanticSceneSpec: { intent: { location: string } };
    sceneRevision: number;
    specRevision: number;
    objects: Array<{
      id: string;
      transform: {
        position: { x: number; y: number; z: number };
        rotationDeg: { x: number; y: number; z: number };
        scale: { x: number; y: number; z: number };
      };
    }>;
  };
  history: { past: unknown[] };
  isDirty: boolean;
  addObject: (input: { kind: 'cube' }) => void;
}

interface SpecPatchBrowserGlobal {
  __I2V_EDITOR_STORE__?: { getState: () => SpecPatchBrowserState };
  document: {
    documentElement: { scrollWidth: number };
    querySelector: (
      selector: string,
    ) => { getBoundingClientRect: () => DOMRectLike } | null;
  };
  innerWidth: number;
}

interface DOMRectLike {
  left: number;
  right: number;
}

async function readRequest(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(request: import('node:http').IncomingMessage) {
  return JSON.parse((await readRequest(request)).toString('utf8')) as T;
}

function sendJson(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
    Vary: 'Origin',
  });
  response.end(JSON.stringify(value));
}

function broadcast(event: string, data: unknown) {
  for (const response of sseResponses) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

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
        version: 'codex-spec-patch-e2e',
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
      sseResponses.add(response);
      request.on('close', () => sseResponses.delete(response));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/threads') {
      await readJson<unknown>(request).catch(() => undefined);
      sendJson(response, { threadId: 'thread-spec-patch-e2e' }, 201);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/scene-renders') {
      const body = await readRequest(request);
      renderSequence += 1;
      sendJson(
        response,
        {
          render: {
            id: `render-spec-patch-${renderSequence}`,
            sceneId: url.searchParams.get('sceneId') ?? 'missing-scene',
            artifactId: `artifact-render-spec-patch-${renderSequence}`,
            contentHash: `sha256:${String(renderSequence).padStart(64, '0')}`,
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
      const body = await readJson<GenerationRequest>(request);
      generationRequests.push(structuredClone(body));
      turnSequence += 1;
      const turnId = `turn-generation-${turnSequence}`;
      const generationId = `generation-spec-patch-${generationRequests.length}`;
      const now = '2026-08-04T00:00:01.000Z';
      sendJson(
        response,
        {
          turnId,
          generation: {
            id: generationId,
            threadId: body.threadId,
            turnId,
            status: 'inProgress',
            prompt: body.prompt,
            layoutSpec: body.layoutSpec,
            sceneSnapshot: body.sceneSnapshot,
            semanticSceneSpecSnapshot: body.sceneSnapshot.semanticSceneSpec,
            referenceSnapshots: [],
            parentGenerationId: body.parentGenerationId,
            sourceGenerationId: body.sourceGenerationId,
            versionNumber: 1,
            feedback: body.feedback,
            generationMode: body.generationMode,
            layoutRenderId: body.layoutRenderId,
            referenceIds: body.referenceIds,
            attachments: [
              {
                type: 'layout',
                id: body.layoutRenderId,
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
      setTimeout(() => {
        completedGenerationTurns += 1;
        broadcast('codex', {
          method: 'turn/completed',
          params: {
            threadId: body.threadId,
            turn: { id: turnId, status: 'completed', error: null },
          },
        });
      }, 80);
      return;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/spec-patch-proposals'
    ) {
      const body = await readJson<ProposalRequest>(request);
      turnSequence += 1;
      const turnId = `turn-spec-patch-${turnSequence}`;
      sendJson(response, { turnId, requestId: body.requestId }, 202);
      setTimeout(() => {
        const malformed = body.userMessage.includes('잘못된 payload');
        const missingTarget = body.userMessage.includes('없는 object');
        const nextLocation = body.userMessage.includes('다시')
          ? '야외 시장'
          : '골목 치킨집';
        broadcast('spec-patch-proposal', {
          version: 2,
          requestId: body.requestId,
          baseSceneRevision: body.baseSceneRevision,
          baseSpecRevision: body.baseSpecRevision,
          message: malformed
            ? '브라우저가 거부해야 하는 변경안입니다.'
            : '장소를 골목 치킨집으로 변경합니다.',
          specPatch: [
            malformed
              ? {
                  op: 'replace',
                  path: '/__proto__/polluted',
                  value: true,
                }
              : {
                  op: 'replace',
                  path: '/intent/location',
                  value: nextLocation,
                },
          ],
          sceneCommands: malformed
            ? []
            : [
                {
                  type: 'setObjectTransform',
                  objectId: missingTarget
                    ? 'deleted-object'
                    : 'starter-mannequin',
                  transform: {
                    position: { x: 1.25, y: 0.85, z: 0 },
                    rotationDeg: { x: 0, y: 20, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                  },
                },
              ],
          warnings: malformed
            ? []
            : ['마네킹의 위치와 회전을 함께 변경합니다.'],
        });
        broadcast('codex', {
          method: 'turn/completed',
          params: {
            threadId: body.threadId,
            turn: { id: turnId, status: 'completed', error: null },
          },
        });
      }, 30);
      return;
    }
    response.writeHead(404);
    response.end();
  });
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

function parsePromptJsonBlock<T>(prompt: string, heading: string): T {
  const marker = `[${heading}]\n`;
  const start = prompt.indexOf(marker);
  if (start < 0) throw new Error(`prompt block not found: ${heading}`);
  const content = prompt.slice(start + marker.length);
  const nextSection = content.indexOf('\n\n[');
  return JSON.parse(
    nextSection < 0 ? content : content.slice(0, nextSection),
  ) as T;
}

function expectGenerationState(
  request: GenerationRequest,
  expected: {
    location: string;
    positionX: number;
    layoutCenterX: number;
    yawDeg: number;
    sceneRevision: number;
    specRevision: number;
    generationMessage: string;
  },
) {
  const snapshotMannequin = request.sceneSnapshot.objects.find(
    ({ id }) => id === 'starter-mannequin',
  );
  const layoutMannequin = request.layoutSpec.objects.find(
    ({ objectId }) => objectId === 'starter-mannequin',
  );
  expect(request.sceneSnapshot).toMatchObject({
    sceneRevision: expected.sceneRevision,
    specRevision: expected.specRevision,
    semanticSceneSpec: { intent: { location: expected.location } },
  });
  expect(snapshotMannequin?.transform).toMatchObject({
    position: { x: expected.positionX, y: 0.85, z: 0 },
    rotationDeg: { x: 0, y: expected.yawDeg, z: 0 },
  });
  expect(layoutMannequin).toMatchObject({
    worldBounds: { center: { x: expected.layoutCenterX } },
    yawDeg: expected.yawDeg,
  });

  const promptLayout = parsePromptJsonBlock<GenerationRequest['layoutSpec']>(
    request.prompt,
    'LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약',
  );
  const promptScene = parsePromptJsonBlock<
    Omit<GenerationRequest['sceneSnapshot'], 'semanticSceneSpec'>
  >(request.prompt, '현재 SceneDocument');
  expect(promptLayout).toEqual(request.layoutSpec);
  expect(promptScene).toEqual(
    Object.fromEntries(
      Object.entries(request.sceneSnapshot).filter(
        ([key]) => key !== 'semanticSceneSpec',
      ),
    ),
  );
  if (expected.location === '') {
    expect(request.prompt).not.toContain('- 장소:');
  } else {
    expect(request.prompt).toContain(`- 장소: ${expected.location}`);
  }
  expect(request.prompt).not.toContain(expected.generationMessage);
}

test.beforeAll(async () => {
  server = createMockCompanion();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  companionUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  for (const response of sseResponses) response.end();
  sseResponses.clear();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('validated spec patch card cancel/apply/race/reload lifecycle is accessible at 1280×720', async ({
  page,
}) => {
  const browserProblems = browserProblemCollector(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, url: companionUrl, token }),
  ).toString('base64url');
  await page.goto(`/#companion=${encoded}`);
  await expect(page.getByText('연결됨')).toBeVisible();
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );

  const initial = await page.evaluate(() => {
    const state = (
      globalThis as unknown as SpecPatchBrowserGlobal
    ).__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('editor test bridge missing');
    return {
      document: structuredClone(state.document),
      historyPast: state.history.past.length,
      isDirty: state.isDirty,
    };
  });
  const input = page.getByLabel('장면에 대해 말하기');
  const generateAndRead = async (message: string) => {
    const previousCount = generationRequests.length;
    const previousCompletedCount = completedGenerationTurns;
    await expect(input).toBeEnabled();
    await input.fill(message);
    const generate = page.getByRole('button', { name: '이미지 생성' });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect.poll(() => generationRequests.length).toBe(previousCount + 1);
    await expect
      .poll(() => completedGenerationTurns)
      .toBe(previousCompletedCount + 1);
    await expect(input).toBeEnabled();
    return generationRequests.at(-1)!;
  };
  await input.fill('장소를 골목 치킨집으로 바꿔줘.');
  const propose = page.getByRole('button', { name: '변경안 제안' });
  await propose.focus();
  await expect(propose).toBeFocused();
  await page.keyboard.press('Enter');

  const card = page.getByRole('article', {
    name: '장면 변경안',
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText('/intent/location');
  await expect(card).toContainText('골목 치킨집');
  await expect(card).toContainText('starter-mannequin');
  await expect(card).toContainText('위치 (1.25, 0.85, 0)');
  await expect(card).toContainText('마네킹의 위치와 회전을 함께 변경합니다.');
  expect(
    await page.evaluate(() => {
      const state = (
        globalThis as unknown as SpecPatchBrowserGlobal
      ).__I2V_EDITOR_STORE__?.getState();
      if (state === undefined) throw new Error('editor test bridge missing');
      return {
        document: state.document,
        historyPast: state.history.past.length,
        isDirty: state.isDirty,
      };
    }),
  ).toEqual(initial);

  const beforeApplyMessage = '카드 적용 전 입력은 바뀌면 안 돼.';
  const beforeApplyGeneration = await generateAndRead(beforeApplyMessage);
  expectGenerationState(beforeApplyGeneration, {
    location: '',
    positionX: 0,
    layoutCenterX: 0,
    yawDeg: 0,
    sceneRevision: 0,
    specRevision: 0,
    generationMessage: beforeApplyMessage,
  });
  await expect(card).toBeVisible();

  const cancel = card.getByRole('button', { name: '변경안 취소' });
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeHidden();
  expect(
    await page.evaluate(() => {
      const state = (
        globalThis as unknown as SpecPatchBrowserGlobal
      ).__I2V_EDITOR_STORE__?.getState();
      if (state === undefined) throw new Error('editor test bridge missing');
      return {
        document: state.document,
        historyPast: state.history.past.length,
        isDirty: state.isDirty,
      };
    }),
  ).toEqual(initial);

  await input.fill('장소를 골목 치킨집으로 바꿔줘.');
  await propose.click();
  await expect(card).toBeVisible();
  const apply = card.getByRole('button', { name: '변경안 적용' });
  await apply.dblclick();
  await expect(card).toBeHidden();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const state = (
          globalThis as unknown as SpecPatchBrowserGlobal
        ).__I2V_EDITOR_STORE__?.getState();
        if (state === undefined) throw new Error('editor test bridge missing');
        return {
          location: state.document.semanticSceneSpec.intent.location,
          sceneRevision: state.document.sceneRevision,
          specRevision: state.document.specRevision,
          mannequinPositionX: state.document.objects.find(
            ({ id }) => id === 'starter-mannequin',
          )?.transform.position.x,
          historyPast: state.history.past.length,
          isDirty: state.isDirty,
        };
      }),
    )
    .toEqual({
      location: '골목 치킨집',
      sceneRevision: 1,
      specRevision: 1,
      mannequinPositionX: 1.25,
      historyPast: 1,
      isDirty: true,
    });

  const appliedMessage = '적용된 상태로 생성해.';
  const appliedGeneration = await generateAndRead(appliedMessage);
  expectGenerationState(appliedGeneration, {
    location: '골목 치킨집',
    positionX: 1.25,
    layoutCenterX: 1.2339,
    yawDeg: 20,
    sceneRevision: 1,
    specRevision: 1,
    generationMessage: appliedMessage,
  });

  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const document = (
          globalThis as unknown as SpecPatchBrowserGlobal
        ).__I2V_EDITOR_STORE__?.getState().document;
        return {
          location: document?.semanticSceneSpec.intent.location,
          mannequinPositionX: document?.objects.find(
            ({ id }) => id === 'starter-mannequin',
          )?.transform.position.x,
        };
      }),
    )
    .toEqual({ location: '', mannequinPositionX: 0 });
  const undoneMessage = 'undo 상태로 생성해.';
  const undoneGeneration = await generateAndRead(undoneMessage);
  expectGenerationState(undoneGeneration, {
    location: '',
    positionX: 0,
    layoutCenterX: 0,
    yawDeg: 0,
    sceneRevision: 2,
    specRevision: 2,
    generationMessage: undoneMessage,
  });
  await page.getByRole('button', { name: '다시 실행' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const document = (
          globalThis as unknown as SpecPatchBrowserGlobal
        ).__I2V_EDITOR_STORE__?.getState().document;
        return {
          location: document?.semanticSceneSpec.intent.location,
          mannequinPositionX: document?.objects.find(
            ({ id }) => id === 'starter-mannequin',
          )?.transform.position.x,
        };
      }),
    )
    .toEqual({ location: '골목 치킨집', mannequinPositionX: 1.25 });
  const redoneMessage = 'redo 상태로 생성해.';
  const redoneGeneration = await generateAndRead(redoneMessage);
  expectGenerationState(redoneGeneration, {
    location: '골목 치킨집',
    positionX: 1.25,
    layoutCenterX: 1.2339,
    yawDeg: 20,
    sceneRevision: 3,
    specRevision: 3,
    generationMessage: redoneMessage,
  });
  await expect(page.locator('.status-bar')).toContainText(
    '장면을 자동 저장했습니다.',
  );

  const storedBeforeReload = await page.evaluate(
    (key) => localStorage.getItem(key),
    SCENE_STORAGE_KEY,
  );
  expect(JSON.parse(storedBeforeReload!)).toMatchObject({
    sceneRevision: 3,
    specRevision: 3,
    semanticSceneSpec: { intent: { location: '골목 치킨집' } },
    objects: [
      { id: 'starter-floor' },
      {
        id: 'starter-mannequin',
        transform: { position: { x: 1.25, y: 0.85, z: 0 } },
      },
    ],
  });
  await page.reload();
  await expect(page.getByText('연결됨')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (
          globalThis as unknown as SpecPatchBrowserGlobal
        ).__I2V_EDITOR_STORE__?.getState();
        return {
          location: state?.document.semanticSceneSpec.intent.location,
          sceneRevision: state?.document.sceneRevision,
          specRevision: state?.document.specRevision,
          mannequinPositionX: state?.document.objects.find(
            ({ id }) => id === 'starter-mannequin',
          )?.transform.position.x,
          isDirty: state?.isDirty,
        };
      }),
    )
    .toEqual({
      location: '골목 치킨집',
      sceneRevision: 3,
      specRevision: 3,
      mannequinPositionX: 1.25,
      isDirty: false,
    });

  const reloadedInput = page.getByLabel('장면에 대해 말하기');
  await reloadedInput.fill('장소 변경안을 다시 보여줘.');
  await page.getByRole('button', { name: '변경안 제안' }).click();
  await expect(card).toBeVisible();
  await page.evaluate(() => {
    (globalThis as unknown as SpecPatchBrowserGlobal).__I2V_EDITOR_STORE__
      ?.getState()
      .addObject({ kind: 'cube' });
  });
  const racedLocation = await page.evaluate(
    () =>
      (
        globalThis as unknown as SpecPatchBrowserGlobal
      ).__I2V_EDITOR_STORE__?.getState().document.semanticSceneSpec.intent
        .location,
  );
  await card.getByRole('button', { name: '변경안 적용' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'stale scene change proposal',
  );
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as SpecPatchBrowserGlobal
        ).__I2V_EDITOR_STORE__?.getState().document.semanticSceneSpec.intent
          .location,
    ),
  ).toBe(racedLocation);

  await reloadedInput.fill('없는 object를 옮겨줘.');
  await page.getByRole('button', { name: '변경안 제안' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'scene command target does not exist',
  );
  await expect(card).toBeHidden();

  await reloadedInput.fill('잘못된 payload를 보내줘.');
  await page.getByRole('button', { name: '변경안 제안' }).click();
  await expect(page.getByRole('alert')).toContainText('browser schema 검증');
  await expect(card).toBeHidden();

  const layout = await page.evaluate(() => {
    const runtime = globalThis as unknown as SpecPatchBrowserGlobal;
    const cardElement = runtime.document.querySelector(
      '.assistant-spec-patch-card',
    );
    const rect = cardElement?.getBoundingClientRect() ?? null;
    return {
      documentWidth: runtime.document.documentElement.scrollWidth,
      viewportWidth: runtime.innerWidth,
      cardLeft: rect?.left ?? null,
      cardRight: rect?.right ?? null,
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  if (layout.cardLeft !== null && layout.cardRight !== null) {
    expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
    expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth);
  }
  expect(browserProblems).toEqual([]);
});
