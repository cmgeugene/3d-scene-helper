import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function openExportEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect(page.locator('canvas[data-engine]')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'PNG 내보내기' }),
  ).toBeEnabled();
}

async function downloadFrame(
  page: Page,
  options: {
    preset: string;
    mode?: 'clean' | 'reference';
    filename?: string;
  },
) {
  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('해상도').selectOption(options.preset);
  if (options.filename !== undefined) {
    await dialog.getByLabel('파일 이름').fill(options.filename);
  }
  if (options.mode === 'reference') {
    await dialog.getByRole('radio', { name: '참조 포함' }).check();
  }

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PNG 내보내기' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('다운로드된 PNG 경로가 없습니다.');
  await expect(dialog).toBeHidden();
  return {
    buffer: await readFile(path),
    filename: download.suggestedFilename(),
  };
}

function decodePng(buffer: Buffer) {
  expect(buffer.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
  return PNG.sync.read(buffer);
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

function changedPixelRatio(left: PNG, right: PNG, minimumChannelDelta = 8) {
  expect([right.width, right.height]).toEqual([left.width, left.height]);
  let changed = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    const channelDelta = Math.max(
      Math.abs(left.data[index] - right.data[index]),
      Math.abs(left.data[index + 1] - right.data[index + 1]),
      Math.abs(left.data[index + 2] - right.data[index + 2]),
    );
    if (channelDelta >= minimumChannelDelta) changed += 1;
  }
  return changed / (left.width * left.height);
}

function readablePixelRatio(image: PNG) {
  let readable = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance =
      image.data[index] * 0.2126 +
      image.data[index + 1] * 0.7152 +
      image.data[index + 2] * 0.0722;
    if (luminance >= 12) readable += 1;
  }
  return readable / (image.width * image.height);
}

function frontCuePixelCount(image: PNG) {
  let count = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const red = image.data[index];
    const green = image.data[index + 1];
    const blue = image.data[index + 2];
    if (red > 145 && green > 175 && blue > 185 && blue > red) count += 1;
  }
  return count;
}

test('body type presets remain visibly distinct in clean PNG exports', async ({
  page,
}) => {
  await openExportEditor(page);
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  const bodyTypeGroup = page.getByRole('group', { name: '마네킹 체형' });

  const standard = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );
  await bodyTypeGroup.getByRole('button', { name: '건장한 체형' }).click();
  const athletic = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );
  await bodyTypeGroup.getByRole('button', { name: '뚱뚱한 체형' }).click();
  const heavy = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );

  expect(changedPixelRatio(standard, athletic)).toBeGreaterThan(0.0005);
  expect(changedPixelRatio(athletic, heavy)).toBeGreaterThan(0.0005);
});

test('export presets produce sanitized, exact-resolution PNG downloads', async ({
  page,
}) => {
  await openExportEditor(page);

  for (const [preset, width, height] of [
    ['1280x720', 1280, 720],
    ['1920x1080', 1920, 1080],
    ['1080x1920', 1080, 1920],
    ['square', 1080, 1080],
    ['cinematic', 1920, 804],
  ] as const) {
    const download = await downloadFrame(page, {
      preset,
      filename: '../S09 시작 프레임:*?',
    });
    expect(download.filename).toBe('S09-시작-프레임.png');
    const png = decodePng(download.buffer);
    expect([png.width, png.height]).toEqual([width, height]);
  }
});

test('clean and reference exports use separate pixel paths without editor layer 1', async ({
  page,
}) => {
  await openExportEditor(page);
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await expect(page.locator('canvas[data-facing-helper]')).toBeVisible();

  const selectedClean = decodePng(
    (
      await downloadFrame(page, {
        preset: '1280x720',
        mode: 'clean',
      })
    ).buffer,
  );
  expect(readablePixelRatio(selectedClean)).toBeGreaterThan(0.2);

  await page.keyboard.press('Escape');
  await expect(page.locator('canvas[data-facing-helper]')).toHaveCount(0);
  const deselectedClean = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );
  expect(mismatchRatio(selectedClean, deselectedClean)).toBe(0);

  await page.getByRole('checkbox', { name: '3분할선' }).check();
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  const selectedReference = decodePng(
    (
      await downloadFrame(page, {
        preset: '1280x720',
        mode: 'reference',
      })
    ).buffer,
  );
  await page.keyboard.press('Escape');
  const deselectedReference = decodePng(
    (
      await downloadFrame(page, {
        preset: '1280x720',
        mode: 'reference',
      })
    ).buffer,
  );

  expect(mismatchRatio(selectedReference, deselectedReference)).toBe(0);
  expect(mismatchRatio(selectedClean, selectedReference)).toBeGreaterThan(0);
});

test('IK handles and neck rotation rings stay out of clean and reference PNG exports', async ({
  page,
}) => {
  await openExportEditor(page);
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(
    page.locator('canvas[data-ik-handle-projections]'),
  ).toBeVisible();
  const runtimeCanvas = page.locator('canvas[data-engine]');
  const projections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as { neck: { x: number; y: number } };
  const canvasBox = await runtimeCanvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox === null) return;
  await page.mouse.move(
    canvasBox.x + projections.neck.x,
    canvasBox.y + projections.neck.y,
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-rotation-handle',
    'neck',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-rotation-ring-projections',
    /^\{"y":/,
  );
  const ikClean = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );
  const ikReference = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'reference' }))
      .buffer,
  );

  await page.getByRole('button', { name: '오브젝트 변형' }).click();
  await expect(page.locator('canvas[data-ik-handle-projections]')).toHaveCount(
    0,
  );
  const objectClean = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );
  const objectReference = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'reference' }))
      .buffer,
  );

  expect(mismatchRatio(ikClean, objectClean)).toBe(0);
  expect(mismatchRatio(ikReference, objectReference)).toBe(0);
});

test('front/rear asymmetric mannequin cues remain pixel-readable in both PNG modes', async ({
  page,
}) => {
  await openExportEditor(page);
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store가 없습니다.');
    state.commitCamera({
      ...state.document.outputCamera,
      position: { x: 0, y: 1.6, z: -5 },
      target: { x: 0, y: 1.6, z: 0 },
      rollDeg: 0,
    });
  });
  const frontClean = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );
  const frontReference = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'reference' }))
      .buffer,
  );

  await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store가 없습니다.');
    state.commitCamera({
      ...state.document.outputCamera,
      position: { x: 0, y: 1.6, z: 5 },
      target: { x: 0, y: 1.6, z: 0 },
      rollDeg: 0,
    });
  });
  const rearClean = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );
  const rearReference = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'reference' }))
      .buffer,
  );

  expect(mismatchRatio(frontClean, rearClean)).toBeGreaterThan(0.002);
  expect(mismatchRatio(frontReference, rearReference)).toBeGreaterThan(0.002);
  expect(frontCuePixelCount(frontClean)).toBeGreaterThan(
    frontCuePixelCount(rearClean) + 80,
  );
  expect(frontCuePixelCount(frontClean)).toBeLessThan(2_000);
  expect(frontCuePixelCount(frontReference)).toBeGreaterThan(
    frontCuePixelCount(rearReference) + 80,
  );
});

test('surface grid remains visible in clean PNG exports', async ({ page }) => {
  await openExportEditor(page);
  const runtimeCanvas = page.locator('canvas[data-engine]');
  await expect(runtimeCanvas).toHaveAttribute(
    'data-surface-grid-kinds',
    'floor',
  );

  await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store가 없습니다.');
    const floor = state.document.objects.find(({ kind }) => kind === 'floor');
    if (floor === undefined) throw new Error('Floor를 찾지 못했습니다.');
    for (const object of state.document.objects) {
      if (object.id !== floor.id) state.setObjectVisibility(object.id, false);
    }
    state.setObjectColor(floor.id, '#d8d8d8');
    state.setLighting({
      ...state.document.lighting,
      shadows: { ...state.document.lighting.shadows, enabled: false },
    });
    state.commitCamera({
      position: { x: 4, y: 7, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      focalLengthMm: 50,
      rollDeg: 0,
    });
  });

  const withGrid = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );

  await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState();
    if (state === undefined) throw new Error('E2E editor store가 없습니다.');
    const document = structuredClone(state.document);
    const floor = document.objects.find(({ kind }) => kind === 'floor');
    if (floor === undefined) throw new Error('Floor를 찾지 못했습니다.');
    floor.kind = 'cube';
    (
      state as unknown as {
        replaceDocument: (
          nextDocument: typeof document,
          persisted: boolean,
        ) => void;
      }
    ).replaceDocument(document, false);
  });
  await expect(runtimeCanvas).not.toHaveAttribute('data-surface-grid-kinds');
  const withoutGrid = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );

  expect(changedPixelRatio(withGrid, withoutGrid)).toBeGreaterThan(0.008);
});

test('room set transform persists and changes the clean exported frame', async ({
  page,
}) => {
  await openExportEditor(page);
  const baseline = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );

  await page.getByRole('button', { name: '방 세트 추가' }).click();
  await page.getByLabel('위치 X').fill('0.25');
  await page.getByLabel('위치 X').press('Enter');
  await page.getByRole('button', { name: '로컬 저장' }).click();
  await page.reload();

  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect(
    page.getByRole('button', { name: 'Room Set', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Room Set', exact: true }).click();
  await expect(page.getByLabel('위치 X')).toHaveValue('0.25');
  await page.keyboard.press('Escape');

  const withRoom = decodePng(
    (await downloadFrame(page, { preset: '1280x720', mode: 'clean' })).buffer,
  );
  expect(mismatchRatio(baseline, withRoom)).toBeGreaterThan(0.02);
});

test('static offscreen export is viewport-resize deterministic within 0.1%', async ({
  page,
}) => {
  await openExportEditor(page);
  await page.getByRole('button', { name: '로컬 저장' }).click();
  await expect(page.locator('.status-bar')).toContainText(
    '장면을 로컬에 저장했습니다.',
  );
  const before = decodePng(
    (await downloadFrame(page, { preset: '1280x720' })).buffer,
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-camera-frame]')).toHaveAttribute(
    'data-output-aspect',
    String(16 / 9),
  );
  const after = decodePng(
    (await downloadFrame(page, { preset: '1280x720' })).buffer,
  );

  expect(mismatchRatio(before, after)).toBeLessThanOrEqual(0.001);
});

test('an open export dialog closes when WebGL context is lost', async ({
  page,
}) => {
  await openExportEditor(page);
  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await page
    .locator('canvas')
    .first()
    .evaluate((canvas) => {
      const contextProbe = canvas as unknown as {
        getContext: (name: string) => {
          getExtension: (name: string) => { loseContext: () => void } | null;
        } | null;
      };
      const context =
        contextProbe.getContext('webgl2') ?? contextProbe.getContext('webgl');
      const extension = context?.getExtension('WEBGL_lose_context');
      if (extension === null || extension === undefined) {
        throw new Error('WEBGL_lose_context를 사용할 수 없습니다.');
      }
      extension.loseContext();
    });

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toContainText(/WebGL context.*손실/);
  await expect(
    page.getByRole('button', { name: 'PNG 내보내기' }),
  ).toBeDisabled();
});

test('export dialog traps destructive editor shortcuts until it closes', async ({
  page,
}) => {
  await openExportEditor(page);
  const mannequin = page.getByRole('button', {
    name: 'Mannequin',
    exact: true,
  });
  await mannequin.click();
  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await dialog.getByRole('button', { name: '취소' }).focus();

  await page.keyboard.press('Delete');

  await expect(mannequin).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '취소' }).click();
});
