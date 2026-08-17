import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

interface RuntimeDofDiagnostic {
  enabled: boolean;
  focusDistanceM: number;
  focalLengthMm: number;
  fStop: number;
  aperture: number;
  maxBlur: number;
}

interface DofFixtureCamera {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  focalLengthMm: number;
  rollDeg: number;
  depthOfField: {
    enabled: boolean;
    apertureMode: 'auto' | 'manual';
    fStop: number;
  };
}

interface DofFixtureObject {
  id: string;
  name: string;
  transform: {
    position: { x: number; y: number; z: number };
    rotationDeg: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
  };
}

interface DofFixtureState {
  document: {
    objects: DofFixtureObject[];
    lighting: {
      exposure: number;
      environmentIntensity: number;
      shadows: { enabled: boolean; [key: string]: unknown };
      [key: string]: unknown;
    };
    outputCamera: DofFixtureCamera;
  };
  addObject: (input: { kind: 'cube'; name: string }) => string;
  selectObject: (id: string | null) => void;
  setObjectVisibility: (id: string, visible: boolean) => void;
  setObjectColor: (id: string, color: string) => void;
  beginTransform: () => void;
  commitTransform: (transform: DofFixtureObject['transform']) => void;
  setBackgroundColor: (color: string) => void;
  setLighting: (lighting: DofFixtureState['document']['lighting']) => void;
  commitCamera: (camera: DofFixtureCamera) => void;
  setCameraApertureMode: (mode: 'auto' | 'manual') => void;
  setCameraLens: (focalLengthMm: 18 | 24 | 35 | 50 | 85) => void;
}

interface DofFixtureGlobal {
  __I2V_EDITOR_STORE__?: { getState: () => DofFixtureState };
}

async function openDofEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  const canvas = page.locator('canvas[data-engine]');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-runtime-dof', /focusDistanceM/);
  return canvas;
}

async function readRuntimeDof(canvas: Locator) {
  const value = await canvas.getAttribute('data-runtime-dof');
  if (value === null) throw new Error('runtime DOF diagnostic이 없습니다.');
  return JSON.parse(value) as RuntimeDofDiagnostic;
}

async function downloadDofFrame(
  page: Page,
  mode: 'clean' | 'reference' = 'clean',
) {
  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await dialog.getByLabel('해상도').selectOption('1280x720');
  if (mode === 'reference') {
    await dialog.getByRole('radio', { name: '참조 포함' }).check();
  }
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PNG 내보내기' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('DOF PNG download path가 없습니다.');
  return readFile(path);
}

function decodePng(buffer: Buffer) {
  const png = PNG.sync.read(buffer);
  expect([png.width, png.height]).toEqual([1280, 720]);
  return png;
}

function highFrequencyEnergy(
  image: PNG,
  centerX: number,
  centerY: number,
  halfSize: number,
) {
  const luminance = (x: number, y: number) => {
    const offset = (y * image.width + x) * 4;
    return (
      image.data[offset] * 0.2126 +
      image.data[offset + 1] * 0.7152 +
      image.data[offset + 2] * 0.0722
    );
  };
  let energy = 0;
  let samples = 0;
  for (let y = centerY - halfSize; y <= centerY + halfSize; y += 1) {
    for (let x = centerX - halfSize; x <= centerX + halfSize; x += 1) {
      const laplacian =
        luminance(x - 1, y) +
        luminance(x + 1, y) +
        luminance(x, y - 1) +
        luminance(x, y + 1) -
        4 * luminance(x, y);
      energy += laplacian * laplacian;
      samples += 1;
    }
  }
  return energy / samples;
}

function mismatchRatio(left: PNG, right: PNG) {
  expect([right.width, right.height]).toEqual([left.width, left.height]);
  const diff = Buffer.alloc(left.data.length);
  return (
    pixelmatch(left.data, right.data, diff, left.width, left.height, {
      threshold: 0.1,
    }) /
    (left.width * left.height)
  );
}

async function setupDofFixture(page: Page) {
  await page.evaluate(() => {
    const store = (globalThis as unknown as DofFixtureGlobal)
      .__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    const state = store.getState();
    for (const object of state.document.objects) {
      state.setObjectVisibility(object.id, false);
    }
    for (const [name, x] of [
      ['DOF Near', -1.2],
      ['DOF Target', 0],
      ['DOF Far', 1.6],
    ] as const) {
      const id = store.getState().addObject({ kind: 'cube', name });
      store.getState().setObjectColor(id, '#f2f2f2');
      const object = store
        .getState()
        .document.objects.find((candidate) => candidate.id === id);
      if (object === undefined) throw new Error(`${name} fixture가 없습니다.`);
      store.getState().selectObject(id);
      store.getState().beginTransform();
      store.getState().commitTransform({
        ...object.transform,
        position: { x, y: 1.5, z: 0 },
      });
    }
    const latest = store.getState();
    latest.setBackgroundColor('#080808');
    latest.setLighting({
      ...latest.document.lighting,
      exposure: 1,
      environmentIntensity: 0.55,
      shadows: { ...latest.document.lighting.shadows, enabled: false },
    });
    latest.commitCamera({
      ...latest.document.outputCamera,
      position: { x: 0, y: 1.5, z: -8 },
      target: { x: 0, y: 1.5, z: 0 },
      focalLengthMm: 50,
      rollDeg: 0,
      depthOfField: { enabled: true, apertureMode: 'auto', fStop: 2.8 },
    });
    latest.selectObject(null);
  });
}

async function setFixtureLens(
  page: Page,
  focalLengthMm: 18 | 50 | 85,
  enabled: boolean,
) {
  await page.evaluate(
    ({ focalLengthMm, enabled }) => {
      const store = (globalThis as unknown as DofFixtureGlobal)
        .__I2V_EDITOR_STORE__;
      if (store === undefined) throw new Error('E2E editor store가 없습니다.');
      store.getState().setCameraApertureMode('auto');
      store.getState().setCameraLens(focalLengthMm);
      const scale = focalLengthMm / 50;
      for (const [name, z] of [
        ['DOF Near', -3 * scale],
        ['DOF Target', 0],
        ['DOF Far', 3 * scale],
      ] as const) {
        const object = store
          .getState()
          .document.objects.find((candidate) => candidate.name === name);
        if (object === undefined)
          throw new Error(`${name} fixture가 없습니다.`);
        store.getState().selectObject(object.id);
        store.getState().beginTransform();
        store.getState().commitTransform({
          ...object.transform,
          position: { ...object.transform.position, z },
          scale: { ...object.transform.scale, z: 0.08 * scale },
        });
      }
      const state = store.getState();
      state.commitCamera({
        ...state.document.outputCamera,
        position: { x: 0, y: 1.5, z: -8 * scale },
        target: { x: 0, y: 1.5, z: 0 },
        rollDeg: 0,
        depthOfField: {
          ...state.document.outputCamera.depthOfField,
          enabled,
        },
      });
      state.selectObject(null);
    },
    { focalLengthMm, enabled },
  );
}

test('serialized target optics drive the actual Canvas DOF after target, lens, resize, shot, frame, and orbit end', async ({
  page,
}) => {
  const canvas = await openDofEditor(page);
  expect(await readRuntimeDof(canvas)).toMatchObject({
    enabled: true,
    focusDistanceM: 5,
    focalLengthMm: 50,
    fStop: 2.8,
  });

  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await page.keyboard.press('t');
  await expect(page.locator('.status-bar')).toContainText(
    'Mannequin을 카메라 타겟·초점으로 설정했습니다.',
  );
  const targetDof = await readRuntimeDof(canvas);
  expect(targetDof.focusDistanceM).toBeGreaterThan(4.9);

  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByLabel('렌즈').selectOption('85');
  await expect.poll(async () => (await readRuntimeDof(canvas)).fStop).toBe(2);
  expect((await readRuntimeDof(canvas)).focalLengthMm).toBe(85);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(async () => (await readRuntimeDof(canvas)).focalLengthMm)
    .toBe(85);

  await page.getByRole('button', { name: '전신' }).click();
  await expect
    .poll(async () => (await readRuntimeDof(canvas)).focusDistanceM)
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '선택 프레임 맞춤' }).click();
  const afterFrame = await readRuntimeDof(canvas);
  expect(afterFrame.focalLengthMm).toBe(85);
  expect(afterFrame.fStop).toBe(2);

  const cameraBeforeOrbit = await page.evaluate(() =>
    structuredClone(
      (
        globalThis as unknown as DofFixtureGlobal
      ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
    ),
  );
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Canvas bounds가 없습니다.');
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.3, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() =>
        structuredClone(
          (
            globalThis as unknown as DofFixtureGlobal
          ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
        ),
      ),
    )
    .not.toEqual(cameraBeforeOrbit);
  const cameraAfterOrbit = await page.evaluate(() =>
    structuredClone(
      (
        globalThis as unknown as DofFixtureGlobal
      ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
    ),
  );
  if (cameraAfterOrbit === undefined) {
    throw new Error('Orbit 후 document camera가 없습니다.');
  }
  const expectedFocusDistance = Math.hypot(
    cameraAfterOrbit.position.x - cameraAfterOrbit.target.x,
    cameraAfterOrbit.position.y - cameraAfterOrbit.target.y,
    cameraAfterOrbit.position.z - cameraAfterOrbit.target.z,
  );
  const afterOrbit = await readRuntimeDof(canvas);
  expect(afterOrbit.focusDistanceM).toBeCloseTo(expectedFocusDistance, 5);
  expect(afterOrbit).toMatchObject({
    focalLengthMm: 85,
    fStop: 2,
    enabled: true,
  });
});

test('actual viewport and exact clean/reference PNGs show calibrated three-plane DOF with negative controls', async ({
  page,
}, testInfo) => {
  const canvas = await openDofEditor(page);
  await setupDofFixture(page);
  await setFixtureLens(page, 50, true);
  await expect
    .poll(async () => (await readRuntimeDof(canvas)).focalLengthMm)
    .toBe(50);

  const viewportEnabledPath = testInfo.outputPath('viewport-50mm-dof.png');
  await canvas.screenshot({ path: viewportEnabledPath });
  const enabled50Buffer = await downloadDofFrame(page);
  await writeFile(testInfo.outputPath('clean-50mm-dof.png'), enabled50Buffer);

  await setFixtureLens(page, 50, false);
  const viewportDisabledPath = testInfo.outputPath(
    'viewport-50mm-disabled.png',
  );
  await canvas.screenshot({ path: viewportDisabledPath });
  const disabled50Buffer = await downloadDofFrame(page);
  await writeFile(
    testInfo.outputPath('clean-50mm-disabled.png'),
    disabled50Buffer,
  );

  const enabled50 = decodePng(enabled50Buffer);
  const disabled50 = decodePng(disabled50Buffer);
  const regions = {
    near: { x: 1067, y: 360, half: 180 },
    target: { x: 640, y: 360, half: 130 },
    far: { x: 382, y: 360, half: 100 },
  };
  const retention50 = Object.fromEntries(
    Object.entries(regions).map(([name, region]) => [
      name,
      highFrequencyEnergy(enabled50, region.x, region.y, region.half) /
        highFrequencyEnergy(disabled50, region.x, region.y, region.half),
    ]),
  ) as Record<keyof typeof regions, number>;
  console.log('50mm DOF sharpness retention', retention50);
  expect(retention50.target).toBeGreaterThan(retention50.near * 1.15);
  expect(retention50.target).toBeGreaterThan(retention50.far * 1.15);
  expect(mismatchRatio(enabled50, disabled50)).toBeGreaterThan(0.002);

  const viewportEnabled = PNG.sync.read(await readFile(viewportEnabledPath));
  const viewportDisabled = PNG.sync.read(await readFile(viewportDisabledPath));
  const viewportDofDelta = mismatchRatio(viewportEnabled, viewportDisabled);
  console.log('viewport DOF changed-pixel ratio', viewportDofDelta);
  expect(viewportDofDelta).toBeGreaterThan(0.001);

  await setFixtureLens(page, 18, true);
  const enabled18Buffer = await downloadDofFrame(page);
  await writeFile(
    testInfo.outputPath('clean-18mm-auto-dof.png'),
    enabled18Buffer,
  );
  await setFixtureLens(page, 18, false);
  const disabled18Buffer = await downloadDofFrame(page);

  await setFixtureLens(page, 85, true);
  const enabled85Buffer = await downloadDofFrame(page);
  await writeFile(
    testInfo.outputPath('clean-85mm-auto-dof.png'),
    enabled85Buffer,
  );
  await setFixtureLens(page, 85, false);
  const disabled85Buffer = await downloadDofFrame(page);
  await writeFile(
    testInfo.outputPath('clean-85mm-disabled.png'),
    disabled85Buffer,
  );

  const enabled18 = decodePng(enabled18Buffer);
  const disabled18 = decodePng(disabled18Buffer);
  const enabled85 = decodePng(enabled85Buffer);
  const disabled85 = decodePng(disabled85Buffer);
  const offTargetRetention = (enabled: PNG, disabled: PNG) =>
    (highFrequencyEnergy(enabled, regions.near.x, 360, regions.near.half) /
      highFrequencyEnergy(disabled, regions.near.x, 360, regions.near.half) +
      highFrequencyEnergy(enabled, regions.far.x, 360, regions.far.half) /
        highFrequencyEnergy(disabled, regions.far.x, 360, regions.far.half)) /
    2;
  const retention18 = offTargetRetention(enabled18, disabled18);
  const retention85 = offTargetRetention(enabled85, disabled85);
  const disabledLensMismatch = mismatchRatio(disabled18, disabled85);
  console.log('lens DOF off-target retention', {
    retention18,
    retention85,
    disabledLensMismatch,
  });
  expect(retention85).toBeLessThan(retention18 * 0.8);
  expect(disabledLensMismatch).toBeLessThan(0.01);

  await setFixtureLens(page, 50, true);
  await page.getByRole('checkbox', { name: '3분할선' }).check();
  const referenceBuffer = await downloadDofFrame(page, 'reference');
  await writeFile(
    testInfo.outputPath('reference-50mm-dof.png'),
    referenceBuffer,
  );
  const reference = decodePng(referenceBuffer);
  expect(mismatchRatio(enabled50, reference)).toBeGreaterThan(0);
});
