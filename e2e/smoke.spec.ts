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

  const status = page.getByRole('status');
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
