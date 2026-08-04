import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { TEST_LAYOUT_SPEC } from '../shared/layoutSpecTestFixture';
import {
  createSceneObject,
  createStarterSceneDocument,
} from '../src/editor/persistence/sceneSchema';
import {
  KEYFRAME_COMPARISON_STORAGE_KEY,
  KEYFRAME_SELECTION_STORAGE_KEY,
} from '../src/assistant/keyframeStorage';

const token = 'e2e-version-comparison-token-'.padEnd(43, 'x');
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const parentScene = createStarterSceneDocument({
  documentId: 'scene-comparison-e2e',
  floorId: 'floor-comparison-e2e',
  mannequinId: 'mannequin-comparison-e2e',
});
parentScene.semanticSceneSpec.intent.mood = '조용한 저녁';

const selectedScene = structuredClone(parentScene);
selectedScene.sceneRevision = 2;
selectedScene.specRevision = 1;
selectedScene.outputCamera.focalLengthMm = 35;
selectedScene.semanticSceneSpec.intent.mood = '비 오는 긴장된 저녁';
selectedScene.objects.push(
  createSceneObject('counter-comparison-e2e', {
    kind: 'cube',
    name: '선택 버전 카운터',
    position: { x: 1.4, z: 0.5 },
  }),
);

const siblingScene = structuredClone(parentScene);
siblingScene.sceneRevision = 3;
siblingScene.specRevision = 1;
siblingScene.outputCamera.focalLengthMm = 70;
siblingScene.semanticSceneSpec.intent.mood = '밝고 따뜻한 저녁';

function generation(
  id: string,
  input: {
    scene: typeof parentScene;
    parentGenerationId: string | null;
    versionNumber: number;
    generationMode: 'fresh' | 'edit';
    refinementDirective: {
      version: 1;
      preserve: string[];
      change: string[];
    } | null;
  },
) {
  return {
    id,
    threadId: 'thread-comparison-e2e',
    turnId: `turn-${id}`,
    status: 'completed',
    prompt: `$imagegen ${id}`,
    layoutSpec: {
      ...structuredClone(TEST_LAYOUT_SPEC),
      sceneId: input.scene.id,
      camera: {
        ...structuredClone(TEST_LAYOUT_SPEC.camera),
        focalLengthMm: input.scene.outputCamera.focalLengthMm,
      },
    },
    sceneSnapshot: input.scene,
    semanticSceneSpecSnapshot: input.scene.semanticSceneSpec,
    referenceSnapshots: [],
    parentGenerationId: input.parentGenerationId,
    sourceGenerationId: null,
    versionNumber: input.versionNumber,
    feedback: input.refinementDirective?.change.join('\n') ?? null,
    refinementDirective: input.refinementDirective,
    generationMode: input.generationMode,
    layoutRenderId: `render-${id}`,
    sceneIntegrity: {
      status: 'valid',
      snapshotSceneId: input.scene.id,
      layoutSpecSceneId: input.scene.id,
      layoutRenderSceneId: input.scene.id,
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
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: `2026-08-04T00:0${input.versionNumber}:00.000Z`,
  } as const;
}

const parent = generation('generation-comparison-parent', {
  scene: parentScene,
  parentGenerationId: null,
  versionNumber: 1,
  generationMode: 'fresh',
  refinementDirective: null,
});
const selected = generation('generation-comparison-selected', {
  scene: selectedScene,
  parentGenerationId: parent.id,
  versionNumber: 2,
  generationMode: 'edit',
  refinementDirective: {
    version: 1,
    preserve: ['카메라 방향', '인물 의상'],
    change: ['표정을 긴장되게 바꿔줘'],
  },
});
const sibling = generation('generation-comparison-sibling', {
  scene: siblingScene,
  parentGenerationId: parent.id,
  versionNumber: 3,
  generationMode: 'edit',
  refinementDirective: {
    version: 1,
    preserve: ['인물 의상'],
    change: ['배경 조명을 밝게 바꿔줘'],
  },
});
const generations = [parent, selected, sibling];

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
    if (request.url === '/api/conversation-session') {
      sendJson(response, {
        version: 1,
        activeTask: null,
        archivedTaskCount: 0,
      });
      return;
    }
    if (request.url === '/api/runtime-requests') {
      sendJson(response, { version: 1, requests: [] });
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

test('부모·형제 generation 비교 선택과 두 결과·계약 차이가 reload 왕복한다', async ({
  page,
}) => {
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
      browserProblems.push(`${message.type()}: ${text}`);
    }
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, url: companionUrl, token }),
  ).toString('base64url');
  await page.goto(`/#companion=${encoded}`);
  await page.getByRole('button', { name: '키프레임' }).click();
  await page
    .getByRole('button', { name: /generation-comparison-selected/ })
    .click();

  const region = page.getByRole('region', {
    name: '부모·형제 generation 비교',
  });
  const target = region.getByRole('combobox', {
    name: '비교 대상 generation',
  });
  await expect(target).toHaveValue(parent.id);
  await expect(target.getByRole('option')).toHaveCount(2);
  await expect(
    region.getByRole('img', { name: '선택 generation 비교 결과' }),
  ).toBeVisible();
  await expect(
    region.getByRole('img', { name: '비교 generation 결과' }),
  ).toBeVisible();
  await expect(region).toContainText('v2 · edit');
  await expect(region).toContainText('v1 · fresh');
  await expect(region).toContainText('표정을 긴장되게 바꿔줘');
  await expect(region).toContainText('SceneDocument · 변경 있음');
  await expect(region).toContainText('Semantic Scene Spec');
  await expect(region).toContainText('오브젝트 추가');
  await expect(region).toContainText('LayoutSpec · 변경 있음');
  await expect(region).toContainText('카메라 분석');

  await target.selectOption(sibling.id);
  await expect(target).toHaveValue(sibling.id);
  await expect(region).toContainText('v3 · edit');
  await expect(region).toContainText('배경 조명을 밝게 바꿔줘');
  await expect
    .poll(() =>
      page.evaluate(
        ({ comparisonKey, selectionKey }) => ({
          comparison: localStorage.getItem(comparisonKey),
          selection: localStorage.getItem(selectionKey),
        }),
        {
          comparisonKey: KEYFRAME_COMPARISON_STORAGE_KEY,
          selectionKey: KEYFRAME_SELECTION_STORAGE_KEY,
        },
      ),
    )
    .toEqual({ comparison: sibling.id, selection: selected.id });

  await page.reload();
  await expect(
    page.getByRole('heading', { name: '키프레임 작업 공간' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /generation-comparison-selected/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('combobox', { name: '비교 대상 generation' }),
  ).toHaveValue(sibling.id);
  await expect(
    page.getByRole('img', { name: '선택 generation 비교 결과' }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: '비교 generation 결과' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);
  expect(browserProblems).toEqual([]);
});
