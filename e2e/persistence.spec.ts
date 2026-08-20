import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'i2v-3d-scene-helper:scene:v4';

interface BrowserStorageGlobal {
  localStorage: {
    getItem: (key: string) => string | null;
  };
}

async function openPersistence(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
}

async function waitForAutosave(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          (globalThis as unknown as BrowserStorageGlobal).localStorage.getItem(
            key,
          ),
        STORAGE_KEY,
      ),
    )
    .not.toBeNull();
  await expect(page.locator('.status-bar')).toContainText(
    '장면을 자동 저장했습니다.',
  );
}

test('persistence refresh restores the latest autosaved scene', async ({
  page,
}) => {
  await openPersistence(page);
  await page.getByRole('button', { name: '큐브 추가', exact: true }).click();
  await page.getByRole('button', { name: '평면 추가' }).click();
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Plane', exact: true }),
  ).toBeVisible();
  const cubeLock = page.getByRole('button', {
    name: 'Cube 뷰포트 선택 잠금',
  });
  await cubeLock.click();
  await expect(cubeLock).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('canvas[data-engine]')).toHaveAttribute(
    'data-surface-grid-kinds',
    'floor,cube,plane',
  );
  await waitForAutosave(page);

  const serializedBeforeReload = await page.evaluate(
    (key) =>
      (globalThis as unknown as BrowserStorageGlobal).localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(serializedBeforeReload).not.toBeNull();
  expect(JSON.parse(serializedBeforeReload!).version).toBe(4);

  await page.reload();
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Plane', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cube 뷰포트 선택 잠금' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('canvas[data-engine]')).toHaveAttribute(
    'data-surface-grid-kinds',
    'floor,cube,plane',
  );
  expect(
    await page.evaluate(
      (key) =>
        (globalThis as unknown as BrowserStorageGlobal).localStorage.getItem(
          key,
        ),
      STORAGE_KEY,
    ),
  ).toBe(serializedBeforeReload);
});

test('restored autosave is not reused by new scene or starter reset', async ({
  page,
}) => {
  await openPersistence(page);
  await page.getByRole('button', { name: '큐브 추가', exact: true }).click();
  await waitForAutosave(page);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '새 장면' }).click();
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Floor', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled();
  await waitForAutosave(page);

  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Floor', exact: true }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: '큐브 추가', exact: true }).click();
  await waitForAutosave(page);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '기본 장면으로 초기화' }).click();
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Floor', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeDisabled();
  await waitForAutosave(page);

  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Floor', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toBeVisible();
});

test('persistence malformed import preserves the live scene and valid autosave', async ({
  page,
}) => {
  await openPersistence(page);
  await page.getByRole('button', { name: '큐브 추가', exact: true }).click();
  await waitForAutosave(page);

  const before = await page.evaluate((key) => {
    const global = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState: () => { document: unknown };
      };
    };
    return {
      document: structuredClone(
        global.__I2V_EDITOR_STORE__?.getState().document,
      ),
      autosave: (
        globalThis as unknown as BrowserStorageGlobal
      ).localStorage.getItem(key),
    };
  }, STORAGE_KEY);

  await page.getByLabel('장면 JSON 파일').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":1}'),
  });
  await expect(page.locator('.status-bar')).toContainText(
    '유효하지 않은 장면 데이터',
  );

  const after = await page.evaluate((key) => {
    const global = globalThis as unknown as {
      __I2V_EDITOR_STORE__?: {
        getState: () => { document: unknown };
      };
    };
    return {
      document: structuredClone(
        global.__I2V_EDITOR_STORE__?.getState().document,
      ),
      autosave: (
        globalThis as unknown as BrowserStorageGlobal
      ).localStorage.getItem(key),
    };
  }, STORAGE_KEY);
  expect(after).toEqual(before);
});

test('persistence exports validated scene JSON and undo shortcuts respect input focus', async ({
  page,
}) => {
  await openPersistence(page);
  await page.getByRole('button', { name: '큐브 추가', exact: true }).click();

  const screenRatio = page.getByLabel('화면비');
  await screenRatio.focus();
  await page.keyboard.press('Meta+z');
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();

  await screenRatio.evaluate((input) =>
    (input as unknown as { blur: () => void }).blur(),
  );
  await page.keyboard.press('Meta+z');
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Meta+Shift+z');
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 내보내기' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Untitled-scene.json');
  const path = await download.path();
  expect(path).not.toBeNull();
  if (path === null) throw new Error('JSON download path가 없습니다.');
  const exported = JSON.parse(await readFile(path, 'utf8')) as {
    version: number;
    objects: Array<{ kind: string }>;
  };
  expect(exported.version).toBe(4);
  expect(exported.objects.some(({ kind }) => kind === 'cube')).toBe(true);
});
