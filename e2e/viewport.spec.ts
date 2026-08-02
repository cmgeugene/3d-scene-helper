import { expect, test, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

interface BrowserEditorState {
  document: {
    objects: Array<{
      id: string;
      kind: string;
      visible: boolean;
      transform: { position: { x: number; y: number; z: number } };
    }>;
    outputCamera: {
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
      focalLengthMm: number;
      rollDeg: number;
    };
    lighting: {
      shadows: { enabled: boolean; mapSize: number };
      [key: string]: unknown;
    };
  };
  navigation: { isInteracting: boolean };
  commitCamera: (
    camera: BrowserEditorState['document']['outputCamera'],
  ) => void;
  setLighting: (lighting: BrowserEditorState['document']['lighting']) => void;
  setObjectColor: (id: string, color: string) => void;
  setObjectVisibility: (id: string, visible: boolean) => void;
}

interface BrowserEditorStore {
  getState: () => BrowserEditorState;
}

declare global {
  var __I2V_EDITOR_STORE__: BrowserEditorStore | undefined;
}

async function openViewport(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  const canvas = page.getByRole('img', { name: '3D 장면 캔버스' });
  await expect(canvas).toBeVisible();
  await expect(page.locator('canvas[data-runtime-camera]')).toHaveCount(1);
  return canvas;
}

async function waitForCanvasChange(canvas: Locator, previousFrame: Buffer) {
  let changedFrame: Buffer | null = null;

  await expect
    .poll(async () => {
      const frame = await canvas.screenshot();
      if (!frame.equals(previousFrame)) changedFrame = frame;
      return changedFrame !== null;
    })
    .toBe(true);

  if (changedFrame === null) throw new Error('Canvas frame did not change.');
  return changedFrame;
}

test('viewport Canvas가 실제 WebGL 장면과 bounded shadow renderer를 시작한다', async ({
  page,
}) => {
  const rendererWarnings: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'warning' &&
      message.text().includes('WebGLShadowMap')
    ) {
      rendererWarnings.push(message.text());
    }
  });
  const canvas = await openViewport(page);
  await expect(canvas).toHaveAttribute('data-color-space', 'srgb');
  await expect(canvas).toHaveAttribute('data-shadow-bounds', '6m');
  await expect(canvas).toHaveAttribute('data-grid-size', '20m');
  await expect(canvas).toHaveAttribute('data-axes-origin', '0,0.025,0');

  const renderedWithShadows = await canvas.screenshot();
  const image = PNG.sync.read(renderedWithShadows);
  const colors = new Set<string>();
  for (let index = 0; index < image.data.length; index += 64) {
    colors.add(
      `${image.data[index] >> 4}:${image.data[index + 1] >> 4}:${image.data[index + 2] >> 4}`,
    );
  }
  expect(colors.size).toBeGreaterThan(10);
  expect(rendererWarnings).toEqual([]);

  await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store가 없습니다.');
    state.setLighting({
      ...state.document.lighting,
      shadows: { ...state.document.lighting.shadows, enabled: false },
    });
  });
  await waitForCanvasChange(canvas, renderedWithShadows);
});

test('viewport 방 세트는 바닥과 두 벽을 렌더링하고 천장·앞·오른쪽을 연다', async ({
  page,
}) => {
  const canvas = await openViewport(page);
  const runtimeCanvas = page.locator('canvas[data-engine]');
  await expect(runtimeCanvas).toHaveAttribute(
    'data-surface-grid-kinds',
    'floor',
  );
  await page.getByRole('button', { name: 'Floor', exact: true }).click();
  const beforeRoom = await canvas.screenshot();

  await page.getByRole('button', { name: '방 세트 추가' }).click();
  await page.getByRole('button', { name: 'Floor', exact: true }).click();

  await expect(runtimeCanvas).toHaveAttribute(
    'data-room-set-parts',
    'floor,back-wall,left-wall',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-room-set-openings',
    'ceiling,front,right',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-surface-grid-kinds',
    'floor,room',
  );
  await waitForCanvasChange(canvas, beforeRoom);
  await expect(
    page.getByRole('button', { name: 'Room Set', exact: true }),
  ).toBeVisible();
});

test('viewport asset 여섯 종류를 deterministic meter 위치에 추가한다', async ({
  page,
}) => {
  await openViewport(page);

  for (const label of ['큐브', '구', '원기둥', '평면', '마네킹', '방 세트']) {
    await page.getByRole('button', { name: `${label} 추가` }).click();
  }

  const objects = await page.evaluate(() =>
    globalThis.__I2V_EDITOR_STORE__
      ?.getState()
      .document.objects.map((object) => ({
        kind: object.kind,
        position: object.transform.position,
        visible: object.visible,
      })),
  );
  expect(objects).toEqual([
    { kind: 'floor', position: { x: 0, y: -0.01, z: 0 }, visible: true },
    { kind: 'mannequin', position: { x: 0, y: 0.85, z: 0 }, visible: true },
    { kind: 'cube', position: { x: -1.1, y: 0.5, z: 0 }, visible: true },
    { kind: 'sphere', position: { x: 1.1, y: 0.5, z: 0 }, visible: true },
    {
      kind: 'cylinder',
      position: { x: -1.35, y: 0.5, z: -1.2 },
      visible: true,
    },
    { kind: 'plane', position: { x: 0, y: 0.01, z: -1.2 }, visible: true },
    {
      kind: 'mannequin',
      position: { x: 1.35, y: 0.85, z: -1.2 },
      visible: true,
    },
    { kind: 'room', position: { x: 0, y: 1.35, z: 0 }, visible: true },
  ]);
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sphere', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cylinder', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Plane', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Room Set', exact: true }),
  ).toBeVisible();
});

test('viewport mannequin child raycast를 root selection으로 만들고 empty space에서 지운다', async ({
  page,
}) => {
  const canvas = await openViewport(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  const unselectedFrame = await canvas.screenshot();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const selectedFrame = await canvas.screenshot();
  expect(selectedFrame.equals(unselectedFrame)).toBe(false);

  await page.mouse.click(box.x + box.width * 0.92, box.y + box.height * 0.08);
  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  expect((await canvas.screenshot()).equals(selectedFrame)).toBe(false);
});

test('viewport color와 visibility가 실제 Canvas draw와 outliner를 함께 갱신한다', async ({
  page,
}) => {
  const canvas = await openViewport(page);
  const emptyFrame = await canvas.screenshot();
  await page.getByRole('button', { name: '큐브 추가' }).click();
  const initialFrame = await waitForCanvasChange(canvas, emptyFrame);

  const cubeId = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    const cube = state?.document.objects.find(
      (object) => object.kind === 'cube',
    );
    if (state === undefined || cube === undefined) {
      throw new Error('E2E editor store에서 cube를 찾지 못했습니다.');
    }
    state.setObjectColor(cube.id, '#d11f3f');
    return cube.id;
  });
  const coloredFrame = await waitForCanvasChange(canvas, initialFrame);

  await page.evaluate((id) => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store가 없습니다.');
    state.setObjectVisibility(id, false);
  }, cubeId);

  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toContainText('○');
  await waitForCanvasChange(canvas, coloredFrame);
  expect(cubeId).toBeTruthy();
});

test('viewport orbit navigation은 pointer end 전 document camera를 commit하지 않는다', async ({
  page,
}) => {
  const canvas = await openViewport(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  const cameraBefore = await page.evaluate(() =>
    structuredClone(
      globalThis.__I2V_EDITOR_STORE__?.getState().document.outputCamera,
    ),
  );
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.25, {
    steps: 8,
  });

  const duringDrag = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    return {
      camera: structuredClone(state?.document.outputCamera),
      isInteracting: state?.navigation.isInteracting,
    };
  });
  expect(duringDrag.camera).toEqual(cameraBefore);
  expect(duringDrag.isInteracting).toBe(true);

  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() =>
        structuredClone(
          globalThis.__I2V_EDITOR_STORE__?.getState().document.outputCamera,
        ),
      ),
    )
    .not.toEqual(cameraBefore);
  expect(
    await page.evaluate(
      () =>
        globalThis.__I2V_EDITOR_STORE__?.getState().navigation.isInteracting,
    ),
  ).toBe(false);
});

test('viewport OutputCamera runtime mirror가 controls 동기화 뒤에도 document roll을 보존한다', async ({
  page,
}) => {
  await openViewport(page);

  await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store가 없습니다.');
    state.commitCamera({
      position: { x: 0, y: 1.6, z: 5 },
      target: { x: 0, y: 1.6, z: 0 },
      focalLengthMm: 35,
      rollDeg: 30,
    });
  });

  const runtimeCanvas = page.locator('canvas[data-engine]');
  await expect
    .poll(async () => {
      const value = await runtimeCanvas.getAttribute('data-runtime-camera');
      return value === null ? null : JSON.parse(value);
    })
    .toMatchObject({
      position: { x: 0, y: 1.6, z: 5 },
      focalLengthMm: 35,
      rotationZDeg: 30,
    });
});
