import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { TEST_LAYOUT_SPEC } from '../shared/layoutSpecTestFixture';
import {
  createSceneObject,
  createStarterSceneDocument,
} from '../src/editor/persistence/sceneSchema';
import { SCENE_STORAGE_KEY } from '../src/editor/constants';
import { PRE_APPLY_RECOVERY_STORAGE_KEY } from '../src/editor/persistence/sceneRecovery';

const token = 'e2e-keyframe-token-'.padEnd(43, 'x');
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const sceneSnapshot = createStarterSceneDocument({
  documentId: 'scene-e2e',
  floorId: 'starter-floor',
  mannequinId: 'starter-mannequin',
});
sceneSnapshot.outputCamera = {
  position: { x: 2, y: 2.4, z: -7 },
  target: { x: 0.5, y: 1.2, z: 0 },
  focalLengthMm: 35,
  rollDeg: 3,
};
sceneSnapshot.objects[1] = {
  ...sceneSnapshot.objects[1]!,
  name: '과거 정민',
  transform: {
    ...sceneSnapshot.objects[1]!.transform,
    position: { x: -1.25, y: 0.85, z: 1.5 },
  },
  semantic: {
    meaning: '문을 바라보는 주인공',
    generationNotes: '실루엣 유지',
  },
};
sceneSnapshot.objects.push(
  createSceneObject('cube-snapshot', {
    kind: 'cube',
    name: '과거 카운터',
    position: { x: 1.5, z: 0.75 },
  }),
);

function generation(
  id: string,
  variant: 'valid' | 'legacy' | 'mismatch' = 'valid',
) {
  const legacy = variant === 'legacy';
  const mismatch = variant === 'mismatch';
  return {
    id,
    threadId: 'thread-e2e',
    turnId: `turn-${id}`,
    status: 'completed',
    prompt: `$imagegen ${id} 지시`,
    layoutSpec: legacy
      ? null
      : {
          ...TEST_LAYOUT_SPEC,
          sceneId: mismatch ? 'scene-other' : sceneSnapshot.id,
          camera: {
            ...TEST_LAYOUT_SPEC.camera,
            ...sceneSnapshot.outputCamera,
          },
        },
    sceneSnapshot: legacy ? null : sceneSnapshot,
    referenceSnapshots: [],
    parentGenerationId: null,
    sourceGenerationId: null,
    versionNumber: 1,
    feedback: null,
    generationMode: 'fresh',
    layoutRenderId: `render-${id}`,
    sceneIntegrity: {
      status: legacy ? 'legacy' : mismatch ? 'mismatch' : 'valid',
      snapshotSceneId: legacy ? null : sceneSnapshot.id,
      layoutSpecSceneId: legacy
        ? null
        : mismatch
          ? 'scene-other'
          : sceneSnapshot.id,
      layoutRenderSceneId: sceneSnapshot.id,
    },
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
    updatedAt:
      variant === 'mismatch'
        ? '2026-08-03T00:03:00.000Z'
        : legacy
          ? '2026-08-03T00:02:00.000Z'
          : '2026-08-03T00:01:00.000Z',
  } as const;
}

const generations = [
  generation('generation-complete'),
  generation('generation-legacy', 'legacy'),
  generation('generation-mismatch', 'mismatch'),
];
const eventResponses = new Set<ServerResponse>();
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

function emitGeneration(value: (typeof generations)[number]) {
  const payload = `event: generation\ndata: ${JSON.stringify(value)}\n\n`;
  for (const response of eventResponses) response.write(payload);
}

function createMockCompanionServer() {
  return createServer((request, response) => {
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
      eventResponses.add(response);
      request.on('close', () => eventResponses.delete(response));
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
}

async function listenMockCompanion(port = 0) {
  server = createMockCompanionServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function closeMockCompanion() {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test.beforeAll(async () => {
  const port = await listenMockCompanion();
  companionUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await closeMockCompanion();
});

test('sceneSnapshot preview가 과거 구도를 재현하고 live scene 상태를 절대 변경하지 않는다', async ({
  page,
}) => {
  const browserProblems: string[] = [];
  page.on('pageerror', (error) =>
    browserProblems.push(`pageerror: ${error.message}`),
  );
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
      browserProblems.push(`${message.type()}: ${text}`);
    }
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, url: companionUrl, token }),
  ).toString('base64url');
  await page.goto(`/#companion=${encoded}`);

  const readEditorEvidence = () =>
    page.evaluate((storageKey) => {
      const runtime = globalThis as unknown as {
        __I2V_EDITOR_STORE__?: {
          getState(): {
            document: unknown;
            history: unknown;
            selectedObjectId: string | null;
            isDirty: boolean;
          };
        };
      };
      const state = runtime.__I2V_EDITOR_STORE__?.getState();
      if (state === undefined) throw new Error('editor test bridge missing');
      const stored = (
        globalThis as unknown as {
          localStorage: { getItem(key: string): string | null };
        }
      ).localStorage.getItem(storageKey);
      return {
        document: JSON.stringify(state.document),
        history: JSON.stringify(state.history),
        selectedObjectId: state.selectedObjectId,
        isDirty: state.isDirty,
        autosave: stored === null ? null : JSON.stringify(JSON.parse(stored)),
      };
    }, SCENE_STORAGE_KEY);

  await page.evaluate(() => {
    const runtime = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState(): {
          document: {
            objects: Array<{ id: string; kind: string }>;
          };
          addObject(input: { kind: 'cube'; name: string }): string;
          selectObject(id: string | null): void;
        };
      };
    };
    const state = runtime.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('editor test bridge missing');
    state.addObject({ kind: 'cube', name: '현재 편집 큐브' });
    state.selectObject(
      state.document.objects.find(({ kind }) => kind === 'mannequin')?.id ??
        null,
    );
  });
  await expect
    .poll(async () => (await readEditorEvidence()).isDirty)
    .toBe(false);
  const beforePreview = await readEditorEvidence();
  expect(beforePreview.autosave).toBe(beforePreview.document);

  await page.getByRole('button', { name: '키프레임' }).click();
  await expect(
    page.getByRole('heading', { name: '키프레임 작업 공간' }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Generation 이력' }).getByRole('button'),
  ).toHaveCount(3);

  const complete = page.getByRole('button', { name: /generation-complete/ });
  await complete.click();
  await expect(page.getByText('현재 씬과 변경 있음')).toBeVisible();
  await expect(page.getByText(/과거 정민.*변형/)).toBeVisible();
  await expect(page.getByText(/과거 카운터.*현재 씬에서 삭제/)).toBeVisible();

  const previewButton = page.getByRole('button', {
    name: '생성 당시 3D 씬 미리보기',
  });
  await previewButton.click();
  const preview = page.getByRole('img', {
    name: '생성 당시 3D 씬 읽기 전용 미리보기',
  });
  await expect(preview).toBeVisible();
  const previewSurface = preview.getByRole('img', {
    name: '3D 장면 캔버스',
  });
  await expect(previewSurface).toHaveAttribute('data-scene-preview', 'true');
  const previewCanvas = previewSurface.locator('canvas');
  await expect(previewCanvas).toBeVisible();
  await expect
    .poll(() => previewCanvas.getAttribute('data-runtime-camera'))
    .not.toBeNull();
  const runtimeCamera = JSON.parse(
    (await previewCanvas.getAttribute('data-runtime-camera'))!,
  ) as { position: { x: number; y: number; z: number }; focalLengthMm: number };
  expect(runtimeCamera).toMatchObject({
    position: { x: 2, y: 2.4, z: -7 },
    focalLengthMm: 35,
  });
  const previewObjects = JSON.parse(
    (await previewCanvas.getAttribute('data-preview-objects'))!,
  ) as Array<{ id: string; position: { x: number; y: number; z: number } }>;
  expect(previewObjects).toContainEqual(
    expect.objectContaining({
      id: 'starter-mannequin',
      position: { x: -1.25, y: 0.85, z: 1.5 },
    }),
  );

  const mismatch = page.getByRole('button', { name: /generation-mismatch/ });
  await mismatch.click();
  await expect(
    page.getByRole('alert', { name: '장면 ID 무결성 오류' }),
  ).toContainText('scene-other');
  await expect(previewButton).toBeDisabled();

  const legacy = page.getByRole('button', { name: /generation-legacy/ });
  await legacy.click();
  await expect(page.getByText('구형 기록 · 3D 장면 복원 제한')).toBeVisible();
  await expect(previewButton).toBeDisabled();

  await complete.click();
  await previewButton.click();
  expect(await readEditorEvidence()).toEqual(beforePreview);
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);

  const companionPort = Number(new URL(companionUrl).port);
  await closeMockCompanion();
  await listenMockCompanion(companionPort);
  await expect.poll(readEditorEvidence).toEqual(beforePreview);

  await page.reload();
  await expect(
    page.getByRole('heading', { name: '키프레임 작업 공간' }),
  ).toBeVisible();
  await expect(complete).toHaveAttribute('aria-pressed', 'true');
  const afterRefreshBaseline = await readEditorEvidence();
  expect(afterRefreshBaseline.document).toBe(beforePreview.document);
  expect(afterRefreshBaseline.autosave).toBe(beforePreview.autosave);
  await previewButton.click();
  await expect(
    page
      .getByRole('img', { name: '생성 당시 3D 씬 읽기 전용 미리보기' })
      .getByRole('img', { name: '3D 장면 캔버스' })
      .locator('canvas'),
  ).toBeVisible();
  expect(await readEditorEvidence()).toEqual(afterRefreshBaseline);

  await page.getByRole('button', { name: '선택 결과로 보정' }).click();
  await expect(page.getByRole('button', { name: '3D 씬' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('키프레임 보정 모드')).toBeVisible();
  expect(await readEditorEvidence()).toEqual(afterRefreshBaseline);
  expect(browserProblems).toEqual([]);
});

test('sceneSnapshot apply는 cancel/save 실패/race를 닫고 undo와 durable recovery를 실제 Chromium에서 보존한다', async ({
  page,
}) => {
  const browserProblems: string[] = [];
  page.on('pageerror', (error) =>
    browserProblems.push(`pageerror: ${error.message}`),
  );
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
      browserProblems.push(`${message.type()}: ${text}`);
    }
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, url: companionUrl, token }),
  ).toString('base64url');
  await page.goto(`/#companion=${encoded}`);

  const readEvidence = () =>
    page.evaluate(
      ({ recoveryKey, sceneKey }) => {
        const runtime = globalThis as unknown as {
          __I2V_EDITOR_STORE__?: {
            getState(): {
              document: unknown;
              history: { past: unknown[]; future: unknown[] };
              selectedObjectId: string | null;
              isDirty: boolean;
            };
          };
        };
        const state = runtime.__I2V_EDITOR_STORE__?.getState();
        if (state === undefined) throw new Error('editor test bridge missing');
        const autosave = localStorage.getItem(sceneKey);
        return {
          document: JSON.stringify(state.document),
          history: JSON.stringify(state.history),
          pastCount: state.history.past.length,
          selectedObjectId: state.selectedObjectId,
          isDirty: state.isDirty,
          autosave:
            autosave === null ? null : JSON.stringify(JSON.parse(autosave)),
          recovery: localStorage.getItem(recoveryKey),
        };
      },
      {
        recoveryKey: PRE_APPLY_RECOVERY_STORAGE_KEY,
        sceneKey: SCENE_STORAGE_KEY,
      },
    );

  await page.evaluate(() => {
    const runtime = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState(): {
          document: { objects: Array<{ id: string; kind: string }> };
          addObject(input: { kind: 'cube'; name: string }): string;
          selectObject(id: string | null): void;
        };
      };
    };
    const state = runtime.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('editor test bridge missing');
    state.addObject({ kind: 'cube', name: '적용 직전 큐브' });
    state.selectObject(
      state.document.objects.find(({ kind }) => kind === 'mannequin')?.id ??
        null,
    );
  });
  await expect.poll(async () => (await readEvidence()).isDirty).toBe(false);
  const beforeApply = await readEvidence();
  expect(beforeApply.autosave).not.toBeNull();
  expect(beforeApply.recovery).toBeNull();

  await page.getByRole('button', { name: '키프레임' }).click();
  const complete = page.getByRole('button', { name: /generation-complete/ });
  await complete.click();
  const openApply = page.getByRole('button', { name: '현재 씬으로 불러오기' });
  await openApply.click();
  const dialog = page.getByRole('dialog', { name: '현재 씬 덮어쓰기 확인' });
  await expect(dialog).toContainText('generation-complete');
  await expect(dialog).toContainText('과거 정민');
  const cancel = dialog.getByRole('button', { name: '취소' });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: '현재 씬으로 적용' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await readEvidence()).toEqual(beforeApply);

  await page.evaluate((recoveryKey) => {
    const target = globalThis as typeof globalThis & {
      __originalStorageSetItem__?: typeof Storage.prototype.setItem;
    };
    target.__originalStorageSetItem__ = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === recoveryKey)
        throw new DOMException('quota e2e', 'QuotaExceededError');
      return target.__originalStorageSetItem__!.call(this, key, value);
    };
  }, PRE_APPLY_RECOVERY_STORAGE_KEY);
  await openApply.click();
  await dialog.getByRole('button', { name: '현재 씬으로 적용' }).click();
  await expect(dialog.getByRole('alert')).toContainText('저장하지 못했습니다');
  expect(await readEvidence()).toEqual(beforeApply);
  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __originalStorageSetItem__?: typeof Storage.prototype.setItem;
    };
    if (target.__originalStorageSetItem__ !== undefined) {
      Storage.prototype.setItem = target.__originalStorageSetItem__;
      delete target.__originalStorageSetItem__;
    }
  });
  await cancel.click();

  await openApply.click();
  const raced = generation('generation-complete', 'mismatch');
  generations[0] = raced;
  emitGeneration(raced);
  await dialog.getByRole('button', { name: '현재 씬으로 적용' }).click();
  await expect(dialog.getByRole('alert')).toContainText('무결성');
  expect(await readEvidence()).toEqual(beforeApply);
  await cancel.click();
  const restored = generation('generation-complete');
  generations[0] = restored;
  emitGeneration(restored);
  await expect(openApply).toBeEnabled();

  await openApply.click();
  await dialog.getByRole('button', { name: '현재 씬으로 적용' }).dblclick();
  await expect(page.getByRole('button', { name: '3D 씬' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('status', { name: '적용된 generation 출처' }),
  ).toContainText('generation-complete · v1 · fresh');
  const applied = await readEvidence();
  expect(applied.pastCount).toBe(beforeApply.pastCount + 1);
  expect(applied.selectedObjectId).toBeNull();
  expect(applied.recovery).not.toBeNull();
  expect(JSON.parse(applied.document)).toMatchObject({
    id: 'scene-e2e',
    generationSource: {
      generationId: 'generation-complete',
      versionNumber: 1,
    },
  });

  const liveCanvas = page
    .getByRole('img', { name: '3D 장면 캔버스' })
    .locator('canvas');
  await expect(liveCanvas).toBeVisible();
  await expect
    .poll(() => liveCanvas.getAttribute('data-runtime-camera'))
    .not.toBeNull();
  expect(
    JSON.parse((await liveCanvas.getAttribute('data-runtime-camera'))!),
  ).toMatchObject({
    position: { x: 2, y: 2.4, z: -7 },
    focalLengthMm: 35,
  });
  expect(
    JSON.parse((await liveCanvas.getAttribute('data-preview-objects'))!),
  ).toContainEqual(
    expect.objectContaining({
      id: 'starter-mannequin',
      position: { x: -1.25, y: 0.85, z: 1.5 },
    }),
  );

  await page.getByRole('button', { name: '실행 취소' }).click();
  const afterUndo = await readEvidence();
  expect(afterUndo.document).toBe(beforeApply.document);
  expect(afterUndo.selectedObjectId).toBe(beforeApply.selectedObjectId);

  await page.getByRole('button', { name: '다시 실행' }).click();
  await expect
    .poll(async () => {
      const state = await readEvidence();
      return state.autosave === state.document && !state.isDirty;
    })
    .toBe(true);
  const appliedBeforeReload = await readEvidence();
  expect(appliedBeforeReload.recovery).not.toBeNull();

  const companionPort = Number(new URL(companionUrl).port);
  await closeMockCompanion();
  await listenMockCompanion(companionPort);
  await page.reload();
  await expect(
    page.getByRole('status', { name: '적용된 generation 출처' }),
  ).toContainText('generation-complete');
  await page.getByRole('button', { name: '적용 전 씬 복구' }).click();
  await expect
    .poll(async () => {
      const state = await readEvidence();
      return state.autosave === state.document && !state.isDirty;
    })
    .toBe(true);
  const recovered = await readEvidence();
  expect(recovered.document).toBe(beforeApply.document);
  expect(recovered.selectedObjectId).toBe(beforeApply.selectedObjectId);
  expect(recovered.recovery).toBeNull();
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);
  expect(browserProblems).toEqual([]);
});
