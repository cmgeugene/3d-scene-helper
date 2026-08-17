import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

interface ContourRuntimeEntry {
  objectId: string;
  enabled: boolean;
  eligibleSurfaceCount: number;
  enabledSurfaceCount: number;
  materialUuids: string[];
  programKeys: string[];
}

interface ContourStoreGlobal {
  __I2V_EDITOR_STORE__?: {
    getState: () => {
      document: {
        mannequinAppearance: { focusContoursEnabled: boolean };
      };
    };
  };
}

async function openContourEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  const canvas = page.locator('canvas[data-engine]');
  await expect(canvas).toBeVisible();
  return canvas;
}

async function readContourRuntime(canvas: Locator) {
  const serialized = await canvas.getAttribute('data-mannequin-focus-contours');
  if (serialized === null) {
    throw new Error('마네킹 초점 등고선 runtime diagnostic이 없습니다.');
  }
  return JSON.parse(serialized) as ContourRuntimeEntry[];
}

test('global focus-contour toggle updates every mannequin surface without material reallocation or DOF coupling', async ({
  page,
}) => {
  const canvas = await openContourEditor(page);
  await page.getByRole('button', { name: '마네킹 추가' }).click();
  await expect
    .poll(async () => (await readContourRuntime(canvas)).length)
    .toBe(2);

  const before = await readContourRuntime(canvas);
  expect(before.every(({ enabled }) => !enabled)).toBe(true);
  expect(
    before.every(({ eligibleSurfaceCount }) => eligibleSurfaceCount >= 20),
  ).toBe(true);
  expect(
    before.every(({ enabledSurfaceCount }) => enabledSurfaceCount === 0),
  ).toBe(true);
  expect(before.every(({ materialUuids }) => materialUuids.length === 3)).toBe(
    true,
  );
  const materialIdsBefore = before.map(({ objectId, materialUuids }) => ({
    objectId,
    materialUuids,
  }));

  const cameraBefore = await page.evaluate(() =>
    structuredClone(
      globalThis.__I2V_EDITOR_STORE__?.getState().document.outputCamera,
    ),
  );
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('checkbox', { name: '심도 사용' }).uncheck();
  const cameraWithDofDisabled = await page.evaluate(() =>
    structuredClone(
      globalThis.__I2V_EDITOR_STORE__?.getState().document.outputCamera,
    ),
  );
  expect(cameraWithDofDisabled).not.toEqual(cameraBefore);

  await page.getByRole('checkbox', { name: '마네킹 초점 확인 등고선' }).check();
  await expect
    .poll(async () =>
      (await readContourRuntime(canvas)).every(
        ({ enabled, eligibleSurfaceCount, enabledSurfaceCount }) =>
          enabled && enabledSurfaceCount === eligibleSurfaceCount,
      ),
    )
    .toBe(true);

  const after = await readContourRuntime(canvas);
  expect(
    after.map(({ objectId, materialUuids }) => ({ objectId, materialUuids })),
  ).toEqual(materialIdsBefore);
  expect(after.every(({ programKeys }) => programKeys.length === 2)).toBe(true);
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as ContourStoreGlobal
        ).__I2V_EDITOR_STORE__?.getState().document.mannequinAppearance
          .focusContoursEnabled,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      structuredClone(
        globalThis.__I2V_EDITOR_STORE__?.getState().document.outputCamera,
      ),
    ),
  ).toEqual(cameraWithDofDisabled);

  await page.getByRole('button', { name: '로컬 저장' }).click();
  await page.reload();
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect
    .poll(async () => {
      const entries = await readContourRuntime(canvas);
      return (
        entries.length === 2 &&
        entries.every(
          ({ enabled, eligibleSurfaceCount, enabledSurfaceCount }) =>
            enabled && enabledSurfaceCount === eligibleSurfaceCount,
        )
      );
    })
    .toBe(true);
  await page.getByRole('button', { name: '카메라' }).click();
  await expect(
    page.getByRole('checkbox', { name: '마네킹 초점 확인 등고선' }),
  ).toBeChecked();
});

interface FixtureObject {
  id: string;
  kind: string;
  name: string;
  color: string;
  transform: {
    position: { x: number; y: number; z: number };
    rotationDeg: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
  };
}

interface FixtureStoreGlobal {
  __I2V_EDITOR_STORE__?: {
    getState: () => {
      document: {
        objects: FixtureObject[];
        outputCamera: {
          position: { x: number; y: number; z: number };
          target: { x: number; y: number; z: number };
          focalLengthMm: number;
          rollDeg: number;
          depthOfField: {
            enabled: boolean;
            apertureMode: 'auto' | 'manual';
            fStop: number;
          };
        };
        lighting: {
          exposure: number;
          environmentIntensity: number;
          shadows: { enabled: boolean; [key: string]: unknown };
          [key: string]: unknown;
        };
      };
      addObject: (input: { kind: 'mannequin'; name: string }) => string;
      setObjectVisibility: (id: string, visible: boolean) => void;
      setObjectColor: (id: string, color: string) => void;
      selectObject: (id: string | null) => void;
      beginTransform: () => void;
      commitTransform: (transform: FixtureObject['transform']) => void;
      setBackgroundColor: (color: string) => void;
      setLighting: (lighting: {
        exposure: number;
        environmentIntensity: number;
        shadows: { enabled: boolean; [key: string]: unknown };
        [key: string]: unknown;
      }) => void;
      commitCamera: (camera: {
        position: { x: number; y: number; z: number };
        target: { x: number; y: number; z: number };
        focalLengthMm: number;
        rollDeg: number;
        depthOfField: {
          enabled: boolean;
          apertureMode: 'auto' | 'manual';
          fStop: number;
        };
      }) => void;
      setMannequinFocusContoursEnabled: (enabled: boolean) => void;
    };
  };
}

const EVIDENCE_DIRECTORY = '/tmp/3d-scene-helper-mannequin-focus-contours';

async function setUpOtsFixture(page: Page) {
  return page.evaluate(() => {
    const store = (globalThis as unknown as FixtureStoreGlobal)
      .__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    let state = store.getState();
    const gray = state.document.objects.find(
      ({ kind }) => kind === 'mannequin',
    );
    if (gray === undefined)
      throw new Error('gray target mannequin이 없습니다.');
    const redId = state.addObject({
      kind: 'mannequin',
      name: 'Red foreground',
    });
    state = store.getState();
    const red = state.document.objects.find(({ id }) => id === redId);
    if (red === undefined)
      throw new Error('red foreground mannequin이 없습니다.');

    for (const object of state.document.objects) {
      state.setObjectVisibility(
        object.id,
        object.id === gray.id || object.id === red.id,
      );
    }
    state.setObjectColor(gray.id, '#a8a8a8');
    state.setObjectColor(red.id, '#c43a3a');

    const place = (
      objectId: string,
      position: { x: number; y: number; z: number },
      rotationY: number,
    ) => {
      const latest = store
        .getState()
        .document.objects.find(({ id }) => id === objectId);
      if (latest === undefined) throw new Error(`${objectId}가 없습니다.`);
      store.getState().selectObject(objectId);
      store.getState().beginTransform();
      store.getState().commitTransform({
        ...latest.transform,
        position,
        rotationDeg: { ...latest.transform.rotationDeg, y: rotationY },
      });
    };
    place(gray.id, { x: 0.28, y: 0.85, z: 0 }, 0);
    place(red.id, { x: -0.48, y: 0.85, z: -4.9 }, 180);

    state = store.getState();
    state.setBackgroundColor('#20242a');
    state.setLighting({
      ...state.document.lighting,
      exposure: 1.08,
      environmentIntensity: 0.55,
      shadows: { ...state.document.lighting.shadows, enabled: false },
    });
    state = store.getState();
    state.commitCamera({
      ...state.document.outputCamera,
      position: { x: 0, y: 1.38, z: -7.5 },
      target: { x: 0.28, y: 0.85, z: -0.047 },
      focalLengthMm: 85,
      rollDeg: 0,
      depthOfField: {
        enabled: true,
        apertureMode: 'manual',
        fStop: 1.6,
      },
    });
    state = store.getState();
    state.selectObject(gray.id);
    state.setMannequinFocusContoursEnabled(true);
    return { grayId: gray.id, redId };
  });
}

async function setContours(page: Page, enabled: boolean) {
  await page.evaluate((nextEnabled) => {
    const store = (globalThis as unknown as FixtureStoreGlobal)
      .__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    store.getState().setMannequinFocusContoursEnabled(nextEnabled);
  }, enabled);
}

async function setDof(page: Page, enabled: boolean) {
  await page.evaluate((nextEnabled) => {
    const store = (globalThis as unknown as FixtureStoreGlobal)
      .__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    const state = store.getState();
    state.commitCamera({
      ...state.document.outputCamera,
      depthOfField: {
        ...state.document.outputCamera.depthOfField,
        enabled: nextEnabled,
      },
    });
  }, enabled);
}

async function downloadFrame(page: Page, mode: 'clean' | 'reference') {
  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await dialog.getByLabel('해상도').selectOption('1280x720');
  if (mode === 'clean') {
    await dialog.getByRole('radio', { name: '깨끗한 프레임' }).check();
  } else {
    await dialog.getByRole('radio', { name: '참조 포함' }).check();
  }
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PNG 내보내기' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('PNG download path가 없습니다.');
  const buffer = await readFile(path);
  const png = PNG.sync.read(buffer);
  expect([png.width, png.height]).toEqual([1280, 720]);
  return { buffer, png };
}

function mismatchRatio(left: PNG, right: PNG) {
  const diff = Buffer.alloc(left.data.length);
  return (
    pixelmatch(left.data, right.data, diff, left.width, left.height, {
      threshold: 0.1,
    }) /
    (left.width * left.height)
  );
}

function changedPixelRatio(left: PNG, right: PNG, minimumChannelDelta = 6) {
  let changed = 0;
  for (let offset = 0; offset < left.data.length; offset += 4) {
    const delta = Math.max(
      Math.abs(left.data[offset] - right.data[offset]),
      Math.abs(left.data[offset + 1] - right.data[offset + 1]),
      Math.abs(left.data[offset + 2] - right.data[offset + 2]),
    );
    if (delta >= minimumChannelDelta) changed += 1;
  }
  return changed / (left.width * left.height);
}

type SubjectKind = 'red' | 'gray';

function isSubjectPixel(image: PNG, offset: number, subject: SubjectKind) {
  const red = image.data[offset];
  const green = image.data[offset + 1];
  const blue = image.data[offset + 2];
  if (subject === 'red') {
    return red > 48 && red > green * 1.22 && red > blue * 1.12;
  }
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return (
    luminance > 58 && Math.abs(red - green) < 18 && Math.abs(green - blue) < 18
  );
}

function contourSharpness(enabled: PNG, disabled: PNG, subject: SubjectKind) {
  const width = enabled.width;
  const height = enabled.height;
  const delta = new Float64Array(width * height);
  const mask = new Uint8Array(width * height);
  let maskPixels = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    if (!isSubjectPixel(disabled, offset, subject)) continue;
    mask[pixel] = 1;
    maskPixels += 1;
    delta[pixel] =
      (Math.abs(enabled.data[offset] - disabled.data[offset]) +
        Math.abs(enabled.data[offset + 1] - disabled.data[offset + 1]) +
        Math.abs(enabled.data[offset + 2] - disabled.data[offset + 2])) /
      3;
  }

  let laplacianEnergy = 0;
  let signalEnergy = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (
        mask[index] === 0 ||
        mask[index - 1] === 0 ||
        mask[index + 1] === 0 ||
        mask[index - width] === 0 ||
        mask[index + width] === 0
      ) {
        continue;
      }
      const value = delta[index];
      const laplacian =
        delta[index - 1] +
        delta[index + 1] +
        delta[index - width] +
        delta[index + width] -
        4 * value;
      laplacianEnergy += laplacian * laplacian;
      signalEnergy += value * value;
      samples += 1;
    }
  }
  return {
    maskPixels,
    samples,
    score: laplacianEnergy / Math.max(signalEnergy, 1),
  };
}

test('85mm OTS contours are pre-DOF surface pixels in live, Clean, and Reference exports', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const canvas = await openContourEditor(page);
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const fixture = await setUpOtsFixture(page);
  await expect
    .poll(async () =>
      (await readContourRuntime(canvas)).every(({ enabled }) => enabled),
    )
    .toBe(true);

  const livePath = `${EVIDENCE_DIRECTORY}/viewport-85mm-ots-contours.png`;
  await canvas.screenshot({ path: livePath });

  const selectedCleanEnabled = await downloadFrame(page, 'clean');
  await writeFile(
    `${EVIDENCE_DIRECTORY}/clean-85mm-ots-contours-dof.png`,
    selectedCleanEnabled.buffer,
  );
  const referenceEnabled = await downloadFrame(page, 'reference');
  await writeFile(
    `${EVIDENCE_DIRECTORY}/reference-85mm-ots-contours-dof.png`,
    referenceEnabled.buffer,
  );

  await page.evaluate(() => {
    const store = (globalThis as unknown as FixtureStoreGlobal)
      .__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    store.getState().selectObject(null);
  });
  const deselectedCleanEnabled = await downloadFrame(page, 'clean');
  expect(
    mismatchRatio(selectedCleanEnabled.png, deselectedCleanEnabled.png),
  ).toBe(0);

  await setContours(page, false);
  const cleanDisabled = await downloadFrame(page, 'clean');
  await writeFile(
    `${EVIDENCE_DIRECTORY}/clean-85mm-ots-no-contours-dof.png`,
    cleanDisabled.buffer,
  );
  const referenceDisabled = await downloadFrame(page, 'reference');
  await writeFile(
    `${EVIDENCE_DIRECTORY}/reference-85mm-ots-no-contours-dof.png`,
    referenceDisabled.buffer,
  );

  const cleanContourDelta = changedPixelRatio(
    deselectedCleanEnabled.png,
    cleanDisabled.png,
  );
  const referenceContourDelta = changedPixelRatio(
    referenceEnabled.png,
    referenceDisabled.png,
  );
  const cleanReferenceEnabledMismatch = mismatchRatio(
    selectedCleanEnabled.png,
    referenceEnabled.png,
  );
  const cleanReferenceDisabledMismatch = mismatchRatio(
    cleanDisabled.png,
    referenceDisabled.png,
  );
  expect(cleanContourDelta).toBeGreaterThan(0.001);
  expect(referenceContourDelta).toBeGreaterThan(0.001);
  expect(cleanReferenceEnabledMismatch).toBe(0);
  expect(cleanReferenceDisabledMismatch).toBe(0);

  await setContours(page, true);
  await setDof(page, false);
  const cleanEnabledNoDof = await downloadFrame(page, 'clean');
  await writeFile(
    `${EVIDENCE_DIRECTORY}/clean-85mm-ots-contours-no-dof.png`,
    cleanEnabledNoDof.buffer,
  );
  await setContours(page, false);
  const cleanDisabledNoDof = await downloadFrame(page, 'clean');
  await writeFile(
    `${EVIDENCE_DIRECTORY}/clean-85mm-ots-no-contours-no-dof.png`,
    cleanDisabledNoDof.buffer,
  );

  const dofGray = contourSharpness(
    deselectedCleanEnabled.png,
    cleanDisabled.png,
    'gray',
  );
  const dofRed = contourSharpness(
    deselectedCleanEnabled.png,
    cleanDisabled.png,
    'red',
  );
  const noDofGray = contourSharpness(
    cleanEnabledNoDof.png,
    cleanDisabledNoDof.png,
    'gray',
  );
  const noDofRed = contourSharpness(
    cleanEnabledNoDof.png,
    cleanDisabledNoDof.png,
    'red',
  );
  console.log('mannequin focus contour evidence', {
    fixture,
    cleanContourDelta,
    referenceContourDelta,
    cleanReferenceEnabledMismatch,
    cleanReferenceDisabledMismatch,
    dofGray,
    dofRed,
    noDofGray,
    noDofRed,
    evidenceDirectory: EVIDENCE_DIRECTORY,
  });
  expect(dofGray.maskPixels).toBeGreaterThan(4_000);
  expect(dofRed.maskPixels).toBeGreaterThan(4_000);
  expect(dofGray.score).toBeGreaterThan(dofRed.score * 1.1);
  expect(noDofRed.score).toBeGreaterThan(dofRed.score * 1.1);
  expect(dofGray.score / dofRed.score).toBeGreaterThan(
    (noDofGray.score / noDofRed.score) * 1.05,
  );
});
