import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

function collectHandlePixels(screenshot: Buffer, side: 'left' | 'right') {
  const image = PNG.sync.read(screenshot);
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const matches =
        side === 'left'
          ? red > 190 && green < 150 && blue > 170
          : red < 150 && green > 180 && blue > 190;
      if (matches) {
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }
  return { count, sumX, sumY };
}

function findHandleCenter(
  screenshot: Buffer,
  side: 'left' | 'right',
): { x: number; y: number } {
  const { count, sumX, sumY } = collectHandlePixels(screenshot, side);
  expect(count).toBeGreaterThan(100);
  return { x: sumX / count, y: sumY / count };
}

test('ordinary production build accepts a real pointer drag on the visible hand IK handle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  const canvas = page.getByRole('img', { name: '3D 장면 캔버스' });
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: 'T 포즈' }).click();
  await page.getByRole('button', { name: '손 IK' }).click();

  await expect
    .poll(async () => {
      const screenshot = await canvas.screenshot();
      return (
        collectHandlePixels(screenshot, 'left').count > 100 &&
        collectHandlePixels(screenshot, 'right').count > 100
      );
    })
    .toBe(true);
  const before = await canvas.screenshot();
  const center = findHandleCenter(before, 'left');
  const fixedCenter = findHandleCenter(before, 'right');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  await page.mouse.move(box.x + center.x, box.y + center.y);
  await page.mouse.down();
  await page.mouse.move(box.x + center.x - 24, box.y + center.y + 18, {
    steps: 10,
  });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const after = await canvas.screenshot();
      const moved = findHandleCenter(after, 'left');
      const fixed = findHandleCenter(after, 'right');
      return (
        Math.hypot(moved.x - (center.x - 24), moved.y - (center.y + 18)) < 12 &&
        Math.hypot(fixed.x - fixedCenter.x, fixed.y - fixedCenter.y) < 6
      );
    })
    .toBe(true);
  const after = await canvas.screenshot();
  const moved = findHandleCenter(after, 'left');
  const fixed = findHandleCenter(after, 'right');
  expect(
    Math.hypot(moved.x - (center.x - 24), moved.y - (center.y + 18)),
  ).toBeLessThan(12);
  expect(
    Math.hypot(fixed.x - fixedCenter.x, fixed.y - fixedCenter.y),
  ).toBeLessThan(6);
});
