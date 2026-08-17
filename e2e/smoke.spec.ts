import { expect, test } from '@playwright/test';

const launchStrategy =
  'Playwright Chromium + SwiftShader (--enable-webgl --enable-unsafe-swiftshader --use-angle=swiftshader --use-gl=angle)';

test('configured Chromium에서 앱 셸과 WebGL available 상태를 표시한다', async ({
  page,
}) => {
  const response = await page.goto('/');

  if (process.env.npm_lifecycle_event === 'test:e2e:external') {
    expect(response?.headers()['x-i2v-preview']).toBe('production');
  }

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'I2V 3D Scene Helper',
    }),
  ).toBeVisible();

  const status = page.locator('[data-webgl-state]');
  await expect(status).toBeVisible();

  try {
    await expect(status).toHaveAttribute('data-webgl-state', 'available', {
      timeout: 5_000,
    });
  } catch {
    throw new Error(
      `configured Chromium에서 WebGL context 생성에 실패했습니다: state=${JSON.stringify(await status.getAttribute('data-webgl-state'))}, text=${JSON.stringify(await status.textContent())}, launchStrategy=${launchStrategy}`,
    );
  }

  await expect(status).toHaveText('WebGL을 사용할 수 있습니다.');
  await page.getByRole('tab', { name: 'Assistant' }).click();
  await expect(
    page.getByRole('heading', { name: 'Scene Assistant' }),
  ).toBeVisible();
  await expect(page.locator('.assistant-connection')).toHaveText('연결 안 됨');
});

test('지원 최소 높이 미만에서는 데스크톱 안내만 표시한다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 719 });
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: '데스크톱 화면이 필요합니다' }),
  ).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: '에셋과 장면' }),
  ).toBeHidden();
});

test('우측 패널을 드래그해 넓히고 접기 상태를 복원한다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const panel = page.getByRole('complementary', { name: '속성' });
  const separator = page.getByRole('separator', {
    name: '우측 패널 너비 조절',
  });
  const initialPanel = await panel.boundingBox();
  const handle = await separator.boundingBox();
  expect(initialPanel).not.toBeNull();
  expect(handle).not.toBeNull();
  if (initialPanel === null || handle === null) return;

  await page.mouse.move(handle.x + handle.width / 2, handle.y + 120);
  await page.mouse.down();
  await page.mouse.move(handle.x - 96, handle.y + 120, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(async () => (await panel.boundingBox())?.width ?? 0)
    .toBeGreaterThan(initialPanel.width + 80);
  const resizedWidth = await separator.getAttribute('aria-valuenow');
  expect(Number(resizedWidth)).toBeGreaterThan(500);

  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', resizedWidth!);

  await page.getByRole('button', { name: '접기' }).click();
  await expect(
    page.getByRole('button', { name: '우측 패널 펼치기' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: '우측 패널 펼치기' }),
  ).toBeVisible();

  await page.getByRole('button', { name: '우측 패널 펼치기' }).click();
  await page.getByRole('tab', { name: 'Assistant' }).click();
  await expect(
    page.getByRole('heading', { name: 'Scene Assistant' }),
  ).toBeVisible();
  await expect(separator).toHaveAttribute('aria-valuenow', resizedWidth!);
});

test('지원 최소 너비 경계와 가로 overflow를 유지한다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');

  await expect(
    page.getByRole('complementary', { name: '에셋과 장면' }),
  ).toBeVisible();
  await expect(page.locator('.unsupported-notice')).toBeHidden();
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 1279, height: 720 });

  await expect(page.locator('.desktop-editor')).toBeHidden();
  await expect(page.locator('.unsupported-notice')).toBeVisible();
  expect(
    await page.evaluate(
      'document.documentElement.scrollWidth <= window.innerWidth',
    ),
  ).toBe(true);
});
