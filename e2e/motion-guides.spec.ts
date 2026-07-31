import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  const canvas = page.getByRole('img', { name: '3D 장면 캔버스' });
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'PNG 내보내기' }),
  ).toBeEnabled();
  return canvas;
}

async function downloadFrame(page: Page, mode: 'clean' | 'reference') {
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
  if (path === null) throw new Error('다운로드된 PNG 경로가 없습니다.');
  return PNG.sync.read(await readFile(path));
}

function mismatchPixels(left: PNG, right: PNG) {
  expect([right.width, right.height]).toEqual([left.width, left.height]);
  return pixelmatch(
    left.data,
    right.data,
    Buffer.alloc(left.data.length),
    left.width,
    left.height,
    { threshold: 0.1 },
  );
}

function countPixelsNearColor(
  image: PNG,
  target: readonly [number, number, number],
  tolerance: number,
) {
  let count = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const distance = Math.max(
      Math.abs(image.data[index] - target[0]),
      Math.abs(image.data[index + 1] - target[1]),
      Math.abs(image.data[index + 2] - target[2]),
    );
    if (distance <= tolerance) count += 1;
  }
  return count;
}

test('motion guides render one selected-subject arrow and one camera arrow while only reference export includes them', async ({
  page,
}) => {
  const canvas = await openEditor(page);
  const baselineViewport = await canvas.screenshot();
  const baselineClean = await downloadFrame(page, 'clean');

  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await page.getByLabel('피사체 이동 방향').selectOption('right');

  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByLabel('카메라 이동 방향').selectOption('dolly');

  const motionVisibility = page.getByRole('checkbox', { name: '모션 가이드' });
  await expect(motionVisibility).toBeChecked();

  const runtimeCanvas = page.locator('canvas[data-motion-guides]');
  await expect
    .poll(async () => {
      const value = await runtimeCanvas.getAttribute('data-motion-guides');
      return value === null ? null : JSON.parse(value);
    })
    .toMatchObject([
      { kind: 'subject', label: '오른쪽', layer: 2 },
      { kind: 'camera', label: '돌리 인', layer: 2 },
    ]);
  const diagnostics = JSON.parse(
    (await runtimeCanvas.getAttribute('data-motion-guides')) ?? '[]',
  ) as Array<{
    labelNdc?: { x: number; y: number };
    originNdc?: { x: number; y: number };
    tipNdc?: { x: number; y: number };
  }>;
  const canvasBounds = await runtimeCanvas.boundingBox();
  const frameBounds = await page.locator('[data-camera-frame]').boundingBox();
  expect(canvasBounds).not.toBeNull();
  expect(frameBounds).not.toBeNull();
  if (canvasBounds === null || frameBounds === null) {
    throw new Error('Motion guide frame bounds가 없습니다.');
  }
  const frameScaleX = frameBounds.width / canvasBounds.width;
  const frameScaleY = frameBounds.height / canvasBounds.height;
  for (const guide of diagnostics) {
    expect(guide.originNdc).toBeDefined();
    expect(
      Math.abs(guide.labelNdc?.x ?? Number.POSITIVE_INFINITY),
    ).toBeLessThan(0.85);
    expect(
      Math.abs(guide.labelNdc?.y ?? Number.POSITIVE_INFINITY),
    ).toBeLessThan(0.85);
    expect(
      Math.hypot(
        (guide.labelNdc?.x ?? Number.POSITIVE_INFINITY) -
          (guide.tipNdc?.x ?? 0),
        (guide.labelNdc?.y ?? Number.POSITIVE_INFINITY) -
          (guide.tipNdc?.y ?? 0),
      ),
    ).toBeLessThan(0.4);
    expect(
      Math.hypot(
        ((guide.tipNdc?.x ?? Number.POSITIVE_INFINITY) -
          (guide.originNdc?.x ?? 0)) /
          frameScaleX,
        ((guide.tipNdc?.y ?? Number.POSITIVE_INFINITY) -
          (guide.originNdc?.y ?? 0)) /
          frameScaleY,
      ),
    ).toBeGreaterThan(0.08);
  }
  expect((await canvas.screenshot()).equals(baselineViewport)).toBe(false);

  const guidedClean = await downloadFrame(page, 'clean');
  await motionVisibility.uncheck();
  await expect(page.locator('canvas[data-motion-guides]')).toHaveCount(0);
  const hiddenReference = await downloadFrame(page, 'reference');
  expect(mismatchPixels(baselineClean, hiddenReference)).toBe(0);

  await motionVisibility.check();
  await expect(page.locator('canvas[data-motion-guides]')).toHaveCount(1);
  const guidedReference = await downloadFrame(page, 'reference');
  expect(mismatchPixels(baselineClean, guidedClean)).toBe(0);
  expect(mismatchPixels(guidedClean, guidedReference)).toBeGreaterThan(0);
  expect(
    countPixelsNearColor(guidedReference, [36, 212, 255], 25),
  ).toBeGreaterThan(50);
  expect(
    countPixelsNearColor(guidedReference, [255, 179, 71], 25),
  ).toBeGreaterThan(50);
  expect(
    countPixelsNearColor(guidedReference, [8, 14, 24], 10),
  ).toBeGreaterThan(100);
  expect(
    countPixelsNearColor(guidedReference, [255, 255, 255], 10),
  ).toBeGreaterThan(10);
});
