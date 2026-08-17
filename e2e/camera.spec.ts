import { expect, test, type Locator, type Page } from '@playwright/test';

interface RuntimeCameraDiagnostic {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  focalLengthMm: number;
  filmGaugeMm: number;
  aspect: number;
  outputAspect: number;
  zoom: number;
  rotationZDeg: number;
}

interface BrowserCameraState {
  document: {
    outputCamera: {
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
      focalLengthMm: number;
      rollDeg: number;
    };
  };
  navigation: { isInteracting: boolean };
}

interface CameraBridge {
  __I2V_EDITOR_STORE__?: {
    getState: () => BrowserCameraState;
    subscribe: (
      listener: (
        state: BrowserCameraState,
        previous: BrowserCameraState,
      ) => void,
    ) => () => void;
  };
  __CAMERA_DOCUMENT_CHANGES__?: number;
}

async function openCameraEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect(page.getByRole('img', { name: '3D 장면 캔버스' })).toBeVisible();
  const runtimeCanvas = page.locator('canvas[data-engine]');
  await expect(runtimeCanvas).toBeVisible();
  return runtimeCanvas;
}

async function readRuntimeCamera(canvas: Locator) {
  const value = await canvas.getAttribute('data-runtime-camera');
  return value === null ? null : (JSON.parse(value) as RuntimeCameraDiagnostic);
}

test('camera panel은 방향 뷰 선택 기능을 제공하지 않는다', async ({ page }) => {
  await openCameraEditor(page);
  await page.getByRole('button', { name: '카메라' }).click();

  await expect(page.getByRole('group', { name: '샷 프리셋' })).toBeVisible();
  await expect(page.getByLabel('렌즈')).toBeVisible();
  await expect(page.getByRole('group', { name: '방향 뷰' })).toHaveCount(0);
  for (const label of [
    '정면',
    '후면',
    '좌측',
    '우측',
    '3/4 정면',
    '3/4 후면',
  ]) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
  }
});

test('camera framing contains every output aspect without stretching at 1280×720', async ({
  page,
}) => {
  const runtimeCanvas = await openCameraEditor(page);
  const viewport = page.getByRole('region', { name: '장면 뷰포트' });
  const frame = page.locator('[data-camera-frame]');
  await expect(frame).toBeVisible();
  const viewportBox = await viewport.boundingBox();
  expect(viewportBox).not.toBeNull();
  if (viewportBox === null) throw new Error('Viewport bounds가 없습니다.');

  for (const [id, aspect] of [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
    ['2.39:1', 2.39],
  ] as const) {
    await page.getByLabel('화면비').selectOption(id);
    await expect(frame).toHaveAttribute('data-output-aspect', String(aspect));
    await expect
      .poll(async () => {
        const box = await frame.boundingBox();
        return box === null ? null : box.width / box.height;
      })
      .toBeCloseTo(aspect, 3);

    const frameBox = await frame.boundingBox();
    expect(frameBox).not.toBeNull();
    if (frameBox === null) throw new Error('Camera frame bounds가 없습니다.');
    expect(frameBox.x).toBeCloseTo(
      viewportBox.x + (viewportBox.width - frameBox.width) / 2,
      1,
    );
    expect(frameBox.y).toBeCloseTo(
      viewportBox.y + (viewportBox.height - frameBox.height) / 2,
      1,
    );
    expect(frameBox.width).toBeLessThanOrEqual(viewportBox.width + 0.5);
    expect(frameBox.height).toBeLessThanOrEqual(viewportBox.height + 0.5);

    await expect
      .poll(async () => (await readRuntimeCamera(runtimeCanvas))?.outputAspect)
      .toBeCloseTo(aspect, 5);
    const canvasBox = await runtimeCanvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    if (canvasBox === null) throw new Error('Canvas bounds가 없습니다.');
    await expect
      .poll(async () => (await readRuntimeCamera(runtimeCanvas))?.aspect)
      .toBeCloseTo(canvasBox.width / canvasBox.height, 3);
    await expect
      .poll(async () => (await readRuntimeCamera(runtimeCanvas))?.filmGaugeMm)
      .toBe(36);
  }
});

test('full viewport remains interactive while a dimmed output gate marks the PNG crop', async ({
  page,
}) => {
  const runtimeCanvas = await openCameraEditor(page);
  const frame = page.locator('[data-camera-frame]');

  await page.getByLabel('화면비').selectOption('9:16');
  const canvasBox = await runtimeCanvas.boundingBox();
  const frameBox = await frame.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  if (canvasBox === null || frameBox === null) {
    throw new Error('Viewport/output gate bounds가 없습니다.');
  }

  expect(canvasBox.width).toBeGreaterThan(frameBox.width * 2);
  expect(canvasBox.height).toBeGreaterThanOrEqual(frameBox.height);

  const gateStyle = await frame.evaluate((element) => {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return {
      boxShadow: style?.boxShadow ?? 'none',
      pointerEvents: style?.pointerEvents ?? '',
    };
  });
  expect(gateStyle.boxShadow).not.toBe('none');
  expect(gateStyle.boxShadow).toContain('rgba');
  expect(gateStyle.pointerEvents).toBe('none');

  await expect
    .poll(async () => readRuntimeCamera(runtimeCanvas))
    .toMatchObject({ outputAspect: 9 / 16 });
  const runtime = await readRuntimeCamera(runtimeCanvas);
  expect(runtime?.aspect).toBeCloseTo(canvasBox.width / canvasBox.height, 3);
  expect(runtime?.zoom).toBeLessThan(1);
});

test('mouse wheel dollies the output camera without changing its lens or target', async ({
  page,
}) => {
  const runtimeCanvas = await openCameraEditor(page);
  const cameraBefore = await page.evaluate(() =>
    structuredClone(
      (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
        .document.outputCamera,
    ),
  );
  expect(cameraBefore).toBeDefined();
  if (cameraBefore === undefined) {
    throw new Error('Wheel dolly 전 document camera가 없습니다.');
  }

  await page.evaluate(() => {
    const global = globalThis as unknown as CameraBridge;
    const store = global.__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    global.__CAMERA_DOCUMENT_CHANGES__ = 0;
    store.subscribe((state, previous) => {
      if (state.document.outputCamera !== previous.document.outputCamera) {
        global.__CAMERA_DOCUMENT_CHANGES__ =
          (global.__CAMERA_DOCUMENT_CHANGES__ ?? 0) + 1;
      }
    });
  });

  const canvasBox = await runtimeCanvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox === null) throw new Error('Canvas bounds가 없습니다.');
  await page.mouse.move(
    canvasBox.x + canvasBox.width / 2,
    canvasBox.y + canvasBox.height / 2,
  );
  await page.mouse.wheel(0, -300);

  await expect
    .poll(() =>
      page.evaluate(() =>
        structuredClone(
          (
            globalThis as unknown as CameraBridge
          ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
        ),
      ),
    )
    .not.toEqual(cameraBefore);
  const cameraAfter = await page.evaluate(() =>
    structuredClone(
      (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
        .document.outputCamera,
    ),
  );
  expect(cameraAfter).toBeDefined();
  if (cameraAfter === undefined) {
    throw new Error('Wheel dolly 후 document camera가 없습니다.');
  }

  const distanceToTarget = (camera: typeof cameraBefore) =>
    Math.hypot(
      camera.position.x - camera.target.x,
      camera.position.y - camera.target.y,
      camera.position.z - camera.target.z,
    );
  expect(distanceToTarget(cameraAfter)).toBeLessThan(
    distanceToTarget(cameraBefore),
  );
  expect(cameraAfter.target).toEqual(cameraBefore.target);
  expect(cameraAfter.focalLengthMm).toBe(cameraBefore.focalLengthMm);
  expect(cameraAfter.rollDeg).toBe(cameraBefore.rollDeg);
  expect(
    await page.evaluate(
      () => (globalThis as unknown as CameraBridge).__CAMERA_DOCUMENT_CHANGES__,
    ),
  ).toBe(1);

  await expect
    .poll(async () => {
      const runtime = await readRuntimeCamera(runtimeCanvas);
      return (
        runtime !== null &&
        runtime.focalLengthMm === cameraAfter.focalLengthMm &&
        (['x', 'y', 'z'] as const).every(
          (axis) =>
            Math.abs(runtime.position[axis] - cameraAfter.position[axis]) <
              1e-5 &&
            Math.abs(runtime.target[axis] - cameraAfter.target[axis]) < 1e-5,
        )
      );
    })
    .toBe(true);
});

test('camera lens, shot actions, selected helper, and no-selection status use explicit commits', async ({
  page,
}) => {
  const runtimeCanvas = await openCameraEditor(page);
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-facing-helper',
    'scene-object:starter-mannequin',
  );

  await page.getByRole('button', { name: '카메라' }).click();
  await page.evaluate(() => {
    const global = globalThis as unknown as CameraBridge;
    const store = global.__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    global.__CAMERA_DOCUMENT_CHANGES__ = 0;
    store.subscribe((state, previous) => {
      if (state.document.outputCamera !== previous.document.outputCamera) {
        global.__CAMERA_DOCUMENT_CHANGES__ =
          (global.__CAMERA_DOCUMENT_CHANGES__ ?? 0) + 1;
      }
    });
  });

  const resetCommitCount = () =>
    page.evaluate(() => {
      (globalThis as unknown as CameraBridge).__CAMERA_DOCUMENT_CHANGES__ = 0;
    });
  const commitCount = () =>
    page.evaluate(
      () => (globalThis as unknown as CameraBridge).__CAMERA_DOCUMENT_CHANGES__,
    );

  for (const focalLengthMm of [18, 24, 35, 50, 85]) {
    await resetCommitCount();
    await page.getByLabel('렌즈').selectOption(String(focalLengthMm));
    await expect
      .poll(async () => (await readRuntimeCamera(runtimeCanvas))?.focalLengthMm)
      .toBe(focalLengthMm);
    expect(await commitCount()).toBe(1);
  }

  for (const preset of [
    { label: '눈높이 미디엄', elevation: 'level', roll: 0 },
    { label: '전신', elevation: 'level', roll: 0 },
    { label: '로우 앵글', elevation: 'low', roll: 0 },
    { label: '하이 앵글', elevation: 'high', roll: 0 },
    { label: '클로즈업', elevation: 'level', roll: 0 },
    { label: '더치 앵글', elevation: 'level', roll: 12 },
  ] as const) {
    await resetCommitCount();
    await page.getByRole('button', { name: preset.label }).click();
    await expect
      .poll(async () => {
        const runtime = await readRuntimeCamera(runtimeCanvas);
        const documentCamera = await page.evaluate(() =>
          structuredClone(
            (
              globalThis as unknown as CameraBridge
            ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
          ),
        );
        return runtime === null
          ? null
          : {
              focalLengthMm: runtime.focalLengthMm,
              rollDeg: runtime.rotationZDeg,
              documentCamera,
              mirrored:
                documentCamera !== undefined &&
                (['x', 'y', 'z'] as const).every(
                  (axis) =>
                    Math.abs(
                      runtime.position[axis] - documentCamera.position[axis],
                    ) < 1e-5 &&
                    Math.abs(
                      runtime.target[axis] - documentCamera.target[axis],
                    ) < 1e-5,
                ),
            };
      })
      .toMatchObject({
        focalLengthMm: 85,
        rollDeg: preset.roll,
        documentCamera: { focalLengthMm: 85, rollDeg: preset.roll },
        mirrored: true,
      });
    const runtime = await readRuntimeCamera(runtimeCanvas);
    expect(runtime).not.toBeNull();
    const documentCamera = await page.evaluate(() =>
      structuredClone(
        (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
          .document.outputCamera,
      ),
    );
    expect(documentCamera).toBeDefined();
    if (runtime !== null && documentCamera !== undefined) {
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(runtime.position[axis]).toBeCloseTo(
          documentCamera.position[axis],
          5,
        );
        expect(runtime.target[axis]).toBeCloseTo(
          documentCamera.target[axis],
          5,
        );
      }
    }
    if (runtime !== null && preset.elevation === 'low') {
      expect(runtime.position.y).toBeLessThan(runtime.target.y);
    }
    if (runtime !== null && preset.elevation === 'high') {
      expect(runtime.position.y).toBeGreaterThan(runtime.target.y);
    }
    expect(await commitCount()).toBe(1);
  }

  await resetCommitCount();
  await page.getByRole('button', { name: '선택 프레임 맞춤' }).click();
  await expect(page.locator('.status-bar')).toContainText(
    'Mannequin을 프레임에 맞췄습니다.',
  );
  expect(await commitCount()).toBe(1);
  await resetCommitCount();
  await page.getByRole('button', { name: '선택을 타겟·초점으로 (T)' }).click();
  await expect(page.locator('.status-bar')).toContainText(
    'Mannequin을 카메라 타겟·초점으로 설정했습니다.',
  );
  expect(await commitCount()).toBe(1);
  const cameraAfterButton = await page.evaluate(() =>
    structuredClone(
      (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
        .document.outputCamera,
    ),
  );
  await resetCommitCount();
  await page.keyboard.press('t');
  expect(
    await page.evaluate(() =>
      structuredClone(
        (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
          .document.outputCamera,
      ),
    ),
  ).toEqual(cameraAfterButton);
  expect(await commitCount()).toBe(1);

  await page.keyboard.press('Escape');
  const cameraBeforeNoSelection = await page.evaluate(() =>
    structuredClone(
      (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
        .document.outputCamera,
    ),
  );
  await resetCommitCount();
  await page.getByRole('button', { name: '선택 프레임 맞춤' }).click();
  await expect(page.locator('.status-bar')).toContainText(
    '프레임에 맞출 오브젝트를 먼저 선택하세요.',
  );
  expect(
    await page.evaluate(() =>
      structuredClone(
        (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
          .document.outputCamera,
      ),
    ),
  ).toEqual(cameraBeforeNoSelection);
  await page.getByRole('button', { name: '선택을 타겟·초점으로 (T)' }).click();
  await expect(page.locator('.status-bar')).toContainText(
    '카메라 타겟·초점으로 설정할 오브젝트를 먼저 선택하세요.',
  );
  expect(await commitCount()).toBe(0);
  await resetCommitCount();
  await page.keyboard.press('t');
  await expect(page.locator('.status-bar')).toContainText(
    '카메라 타겟·초점으로 설정할 오브젝트를 먼저 선택하세요.',
  );
  expect(await commitCount()).toBe(0);
});

test('camera DOM guides render thirds, center, 5%/10% safe areas and hide all', async ({
  page,
}) => {
  await openCameraEditor(page);
  const frame = page.locator('[data-camera-frame]');
  for (const label of [
    '3분할선',
    '중앙 십자선',
    '액션 안전 영역',
    '타이틀 안전 영역',
  ]) {
    await page.getByRole('checkbox', { name: label }).check();
  }

  const actionSafe = page.getByTestId('action-safe');
  const titleSafe = page.getByTestId('title-safe');
  await expect(page.getByTestId('thirds-vertical-1')).toBeVisible();
  await expect(page.getByTestId('center-horizontal')).toBeVisible();
  await expect(actionSafe).toBeVisible();
  await expect(titleSafe).toBeVisible();
  expect(await actionSafe.evaluate((element) => element.tagName)).toBe('SPAN');
  expect(
    await actionSafe.evaluate((element) => element.closest('canvas')),
  ).toBeNull();

  const frameBox = await frame.boundingBox();
  const actionBox = await actionSafe.boundingBox();
  const titleBox = await titleSafe.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  if (frameBox === null || actionBox === null || titleBox === null) {
    throw new Error('Guide bounds가 없습니다.');
  }
  expect(actionBox.x - frameBox.x).toBeCloseTo(frameBox.width * 0.05, 1);
  expect(actionBox.y - frameBox.y).toBeCloseTo(frameBox.height * 0.05, 1);
  expect(titleBox.x - frameBox.x).toBeCloseTo(frameBox.width * 0.1, 1);
  expect(titleBox.y - frameBox.y).toBeCloseTo(frameBox.height * 0.1, 1);

  await page.getByRole('button', { name: '모든 가이드 숨기기' }).click();
  await expect(page.locator('.composition-guides > *')).toHaveCount(0);
});

test('camera resize preserves crop projection and orbit commits only on pointer end', async ({
  page,
}) => {
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.push(error.message));
  const runtimeCanvas = await openCameraEditor(page);
  await page.getByLabel('화면비').selectOption('9:16');
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByLabel('렌즈').selectOption('35');
  await page.getByRole('button', { name: '전신' }).click();
  await expect
    .poll(async () => {
      const runtime = await readRuntimeCamera(runtimeCanvas);
      const documentCamera = await page.evaluate(() =>
        structuredClone(
          (
            globalThis as unknown as CameraBridge
          ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
        ),
      );
      return (
        runtime !== null &&
        documentCamera !== undefined &&
        (['x', 'y', 'z'] as const).every(
          (axis) =>
            Math.abs(runtime.position[axis] - documentCamera.position[axis]) <
              1e-5 &&
            Math.abs(runtime.target[axis] - documentCamera.target[axis]) < 1e-5,
        )
      );
    })
    .toBe(true);
  const documentBeforeResize = await page.evaluate(() =>
    structuredClone(
      (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
        .document.outputCamera,
    ),
  );
  const runtimeBeforeResize = await readRuntimeCamera(runtimeCanvas);
  expect(runtimeBeforeResize).not.toBeNull();
  if (runtimeBeforeResize === null) {
    throw new Error('Resize 전 runtime camera가 없습니다.');
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const frame = page.locator('[data-camera-frame]');
  await expect
    .poll(async () => {
      const box = await frame.boundingBox();
      return box === null ? null : box.width / box.height;
    })
    .toBeCloseTo(9 / 16, 3);
  expect(
    await page.evaluate(() =>
      structuredClone(
        (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
          .document.outputCamera,
      ),
    ),
  ).toEqual(documentBeforeResize);
  await expect
    .poll(() => readRuntimeCamera(runtimeCanvas))
    .toMatchObject({
      position: runtimeBeforeResize.position,
      target: runtimeBeforeResize.target,
      focalLengthMm: runtimeBeforeResize.focalLengthMm,
      outputAspect: 9 / 16,
    });
  const resizedCanvasBox = await runtimeCanvas.boundingBox();
  expect(resizedCanvasBox).not.toBeNull();
  if (resizedCanvasBox === null) {
    throw new Error('Resize 후 Canvas bounds가 없습니다.');
  }
  await expect
    .poll(async () => (await readRuntimeCamera(runtimeCanvas))?.aspect)
    .toBeCloseTo(resizedCanvasBox.width / resizedCanvasBox.height, 3);

  await page.getByLabel('화면비').selectOption('16:9');
  await expect
    .poll(async () => (await readRuntimeCamera(runtimeCanvas))?.outputAspect)
    .toBeCloseTo(16 / 9, 5);
  const cameraBeforeOrbit = await page.evaluate(() =>
    structuredClone(
      (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
        .document.outputCamera,
    ),
  );
  const runtimeBeforeOrbit = await readRuntimeCamera(runtimeCanvas);
  await page.evaluate(() => {
    const global = globalThis as unknown as CameraBridge;
    const store = global.__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    global.__CAMERA_DOCUMENT_CHANGES__ = 0;
    store.subscribe((state, previous) => {
      if (state.document.outputCamera !== previous.document.outputCamera) {
        global.__CAMERA_DOCUMENT_CHANGES__ =
          (global.__CAMERA_DOCUMENT_CHANGES__ ?? 0) + 1;
      }
    });
  });
  const canvasBox = await runtimeCanvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox === null) throw new Error('Canvas bounds가 없습니다.');
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.8,
    canvasBox.y + canvasBox.height * 0.2,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.62,
    canvasBox.y + canvasBox.height * 0.3,
    { steps: 8 },
  );
  expect(
    await page.evaluate(() => ({
      camera: structuredClone(
        (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
          .document.outputCamera,
      ),
      isInteracting: (
        globalThis as unknown as CameraBridge
      ).__I2V_EDITOR_STORE__?.getState().navigation.isInteracting,
    })),
  ).toEqual({ camera: cameraBeforeOrbit, isInteracting: true });
  await expect
    .poll(() => readRuntimeCamera(runtimeCanvas))
    .not.toEqual(runtimeBeforeOrbit);

  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() =>
        structuredClone(
          (
            globalThis as unknown as CameraBridge
          ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
        ),
      ),
    )
    .not.toEqual(cameraBeforeOrbit);
  expect(
    await page.evaluate(() => ({
      commits: (globalThis as unknown as CameraBridge)
        .__CAMERA_DOCUMENT_CHANGES__,
      isInteracting: (
        globalThis as unknown as CameraBridge
      ).__I2V_EDITOR_STORE__?.getState().navigation.isInteracting,
    })),
  ).toEqual({ commits: 1, isInteracting: false });
  const runtimeAfterOrbit = await readRuntimeCamera(runtimeCanvas);
  const documentAfterOrbit = await page.evaluate(() =>
    structuredClone(
      (globalThis as unknown as CameraBridge).__I2V_EDITOR_STORE__?.getState()
        .document.outputCamera,
    ),
  );
  expect(runtimeAfterOrbit).not.toBeNull();
  if (runtimeAfterOrbit !== null && documentAfterOrbit !== undefined) {
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(runtimeAfterOrbit.position[axis]).toBeCloseTo(
        documentAfterOrbit.position[axis],
        5,
      );
      expect(runtimeAfterOrbit.target[axis]).toBeCloseTo(
        documentAfterOrbit.target[axis],
        5,
      );
    }
  }
  expect(diagnostics).toEqual([]);
});
