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

test('static offscreen export is viewport-resize deterministic within 0.1%', async ({
  page,
}) => {
  await openExportEditor(page);
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

test('export reports context loss instead of downloading a successful black PNG', async ({
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

  const unexpectedDownload = page.waitForEvent('download', { timeout: 1_000 });
  await dialog.getByRole('button', { name: 'PNG 내보내기' }).click();

  await expect(dialog.getByRole('alert')).toContainText(/WebGL context.*손실/);
  await expect(dialog).toBeVisible();
  await expect(unexpectedDownload).rejects.toThrow();
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
