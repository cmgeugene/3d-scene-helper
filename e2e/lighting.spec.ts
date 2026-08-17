import { expect, test, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

interface RuntimeLightingSnapshot {
  presetId: string;
  exposure: number;
  environmentIntensity: number;
  key: {
    color: string;
    intensity: number;
    position: [number, number, number];
    castShadow: boolean;
    shadowMapSize: [number, number];
    shadowRadius: number;
  };
  fill: { color: string; intensity: number; castShadow: boolean };
  rim: { color: string; intensity: number; castShadow: boolean };
}

const PRESET_IDS = [
  'neutral-studio',
  'daylight',
  'sunset',
  'night',
  'cinematic-backlight',
] as const;

async function openLighting(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await page.getByRole('button', { name: '조명', exact: true }).click();
  const canvas = page.getByRole('img', { name: '3D 장면 캔버스' });
  await expect(canvas).toBeVisible();
  const runtimeCanvas = page.locator('canvas[data-runtime-camera]');
  await expect(runtimeCanvas).toHaveCount(1);
  return { canvas, runtimeCanvas };
}

async function readRuntimeLighting(runtimeCanvas: Locator) {
  const raw = await runtimeCanvas.getAttribute('data-runtime-lighting');
  if (raw === null) throw new Error('Runtime lighting diagnostic is missing.');
  return JSON.parse(raw) as RuntimeLightingSnapshot;
}

async function readNumericLighting(page: Page) {
  return page.evaluate(() => {
    const editorGlobal = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState: () => {
          document: {
            lighting: {
              exposure: number;
              key: { direction: { x: number } };
            };
          };
        };
      };
    };
    const lighting =
      editorGlobal.__I2V_EDITOR_STORE__?.getState().document.lighting;
    return lighting === undefined
      ? undefined
      : { exposure: lighting.exposure, keyX: lighting.key.direction.x };
  });
}

function frameMetrics(frame: Buffer) {
  const image = PNG.sync.read(frame);
  let red = 0;
  let green = 0;
  let blue = 0;
  let readablePixels = 0;
  const pixelCount = image.width * image.height;

  for (let index = 0; index < image.data.length; index += 4) {
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    red += r;
    green += g;
    blue += b;
    if (0.2126 * r + 0.7152 * g + 0.0722 * b >= 12) readablePixels += 1;
  }

  return {
    average: [red / pixelCount, green / pixelCount, blue / pixelCount],
    readableRatio: readablePixels / pixelCount,
  };
}

function subjectDeltaRatio(visibleFrame: Buffer, hiddenFrame: Buffer) {
  const visible = PNG.sync.read(visibleFrame);
  const hidden = PNG.sync.read(hiddenFrame);
  expect([hidden.width, hidden.height]).toEqual([
    visible.width,
    visible.height,
  ]);
  let comparedPixels = 0;
  let changedPixels = 0;

  for (
    let y = Math.floor(visible.height * 0.2);
    y <= visible.height * 0.8;
    y += 1
  ) {
    for (
      let x = Math.floor(visible.width * 0.35);
      x <= visible.width * 0.65;
      x += 1
    ) {
      const index = (y * visible.width + x) * 4;
      const channelDelta =
        Math.abs(visible.data[index] - hidden.data[index]) +
        Math.abs(visible.data[index + 1] - hidden.data[index + 1]) +
        Math.abs(visible.data[index + 2] - hidden.data[index + 2]);
      comparedPixels += 1;
      if (channelDelta >= 12) changedPixels += 1;
    }
  }

  return changedPixels / comparedPixels;
}

test('lighting rig mirrors neutral preset into actual renderer and bounded lights', async ({
  page,
}) => {
  const { runtimeCanvas } = await openLighting(page);
  await expect(runtimeCanvas).toHaveAttribute(
    'data-runtime-lighting',
    /neutral-studio/,
  );

  const runtime = await readRuntimeLighting(runtimeCanvas);
  expect(runtime).toMatchObject({
    presetId: 'neutral-studio',
    exposure: 1,
    environmentIntensity: 0.35,
    key: {
      color: '#ffffff',
      intensity: 1,
      castShadow: true,
      shadowMapSize: [1024, 1024],
    },
    fill: { color: '#dce7ff', intensity: 0.5, castShadow: false },
    rim: { color: '#ffffff', intensity: 0.35, castShadow: false },
  });
  expect(runtime.key.position).toEqual([3, 6, 3]);
  expect(runtime.key.shadowRadius).toBeGreaterThan(1);
});

test('five lighting presets produce distinct readable actual WebGL frames', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openLighting(page);
  const preset = page.getByLabel('조명 프리셋');
  const signatures = new Set<string>();
  const frames = new Map<(typeof PRESET_IDS)[number], Buffer>();

  for (const presetId of PRESET_IDS) {
    await preset.selectOption(presetId);
    await expect
      .poll(async () => (await readRuntimeLighting(runtimeCanvas)).presetId)
      .toBe(presetId);
    const frame = await canvas.screenshot();
    const metrics = frameMetrics(frame);
    signatures.add(
      metrics.average.map((value) => Math.round(value / 4) * 4).join(':'),
    );
    expect(
      metrics.readableRatio,
      `${presetId} frame is entirely black`,
    ).toBeGreaterThan(0.2);
    frames.set(presetId, frame);
  }

  expect(signatures.size).toBe(5);
  for (let index = 1; index < PRESET_IDS.length; index += 1) {
    const currentFrame = frames.get(PRESET_IDS[index]);
    const previousFrame = frames.get(PRESET_IDS[index - 1]);
    if (currentFrame === undefined || previousFrame === undefined) {
      throw new Error('Preset comparison frame is missing.');
    }
    expect(currentFrame.equals(previousFrame)).toBe(false);
  }

  await page.evaluate(() => {
    const editorGlobal = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState: () => {
          setObjectVisibility: (id: string, visible: boolean) => void;
        };
      };
    };
    const state = editorGlobal.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store is missing.');
    state.setObjectVisibility('starter-mannequin', false);
  });

  for (const presetId of PRESET_IDS) {
    await preset.selectOption(presetId);
    await expect
      .poll(async () => (await readRuntimeLighting(runtimeCanvas)).presetId)
      .toBe(presetId);
    const visibleFrame = frames.get(presetId);
    if (visibleFrame === undefined)
      throw new Error(`${presetId} frame is missing.`);
    expect(
      subjectDeltaRatio(visibleFrame, await canvas.screenshot()),
      `${presetId} mannequin is not visibly distinguishable from an empty frame`,
    ).toBeGreaterThan(0.02);
  }
});

test('lighting controls update actual renderer and reset without changing camera or objects', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openLighting(page);
  const sceneBefore = await page.evaluate(() => {
    const editorGlobal = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState: () => {
          document: { outputCamera: unknown; objects: unknown[] };
        };
      };
    };
    const state = editorGlobal.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store is missing.');
    return structuredClone({
      camera: state.document.outputCamera,
      objects: state.document.objects,
    });
  });

  await page.getByLabel('조명 프리셋').selectOption('cinematic-backlight');
  await expect
    .poll(async () => (await readRuntimeLighting(runtimeCanvas)).presetId)
    .toBe('cinematic-backlight');
  const beforeExposure = await canvas.screenshot();
  await page.getByLabel('노출').fill('1.4');
  await page.getByLabel('노출').press('Enter');
  await expect
    .poll(async () => (await readRuntimeLighting(runtimeCanvas)).exposure)
    .toBe(1.4);
  expect((await canvas.screenshot()).equals(beforeExposure)).toBe(false);
  await page.getByLabel('키 라이트 방향 X').fill('-2');
  await page.getByLabel('키 라이트 방향 X').press('Enter');
  await page.getByRole('checkbox', { name: '그림자' }).uncheck();
  await page.getByLabel('배경 색상').evaluate((element) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      'value',
    )?.set;
    if (valueSetter === undefined) {
      throw new Error('Color input value setter is missing.');
    }
    valueSetter.call(element, '#123456');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editorGlobal = globalThis as unknown as {
          __I2V_EDITOR_STORE__?: {
            getState: () => { document: { background: { color: string } } };
          };
        };
        return editorGlobal.__I2V_EDITOR_STORE__
          ?.getState()
          .document.background.color.toLowerCase();
      }),
    )
    .toBe('#123456');

  await expect
    .poll(async () => readRuntimeLighting(runtimeCanvas))
    .toMatchObject({
      presetId: 'cinematic-backlight',
      exposure: 1.4,
      key: { position: [-6, 3, 3], castShadow: false },
      fill: { castShadow: false },
      rim: { castShadow: false },
    });

  await page.getByRole('button', { name: '프리셋으로 재설정' }).click();
  await expect
    .poll(async () => readRuntimeLighting(runtimeCanvas))
    .toMatchObject({
      presetId: 'cinematic-backlight',
      exposure: 1,
      key: { position: [3, 3, 3], castShadow: true },
    });
  await expect(page.getByLabel('노출')).toHaveValue('1');
  await expect(page.getByLabel('키 라이트 방향 X')).toHaveValue('1');

  const sceneAfter = await page.evaluate(() => {
    const editorGlobal = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState: () => {
          document: {
            outputCamera: unknown;
            objects: unknown[];
            background: { color: string };
          };
        };
      };
    };
    const state = editorGlobal.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store is missing.');
    return {
      camera: state.document.outputCamera,
      objects: state.document.objects,
      background: state.document.background.color,
    };
  });
  expect(sceneAfter.camera).toEqual(sceneBefore.camera);
  expect(sceneAfter.objects).toEqual(sceneBefore.objects);
  expect(sceneAfter.background).toBe('#24232b');
});

test('lighting numeric controls preserve keyboard decimal and negative input', async ({
  page,
}) => {
  await openLighting(page);

  const exposure = page.getByLabel('노출');
  await exposure.clear();
  await exposure.pressSequentially('0.5');
  await expect(exposure).toHaveValue('0.5');
  expect(await readNumericLighting(page)).toEqual({ exposure: 1, keyX: 1 });
  await exposure.press('Enter');

  const keyX = page.getByLabel('키 라이트 방향 X');
  await keyX.clear();
  await keyX.pressSequentially('-2');
  await expect(keyX).toHaveValue('-2');
  expect(await readNumericLighting(page)).toEqual({ exposure: 0.5, keyX: 1 });
  await keyX.press('Enter');

  await expect
    .poll(() => readNumericLighting(page))
    .toEqual({ exposure: 0.5, keyX: -2 });

  await exposure.clear();
  await exposure.pressSequentially('1.4');
  await exposure.press('Escape');
  await expect(exposure).toHaveValue('0.5');

  await keyX.clear();
  await keyX.pressSequentially('2');
  await keyX.press('Escape');
  await expect(keyX).toHaveValue('-2');
  expect(await readNumericLighting(page)).toEqual({ exposure: 0.5, keyX: -2 });
});
