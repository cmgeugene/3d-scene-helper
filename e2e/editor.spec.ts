import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const STORAGE_KEY = 'i2v-3d-scene-helper:scene:v3';

interface GoldenPathState {
  document: {
    objects: Array<{
      kind: string;
      transform: { position: { x: number; y: number; z: number } };
    }>;
    output: { aspectRatioId: string; width: number; height: number };
    outputCamera: { focalLengthMm: number };
    lighting: { presetId: string };
    subjectMotionGuide?: { label: string };
    cameraMotionGuide?: { label: string };
  };
  isDirty: boolean;
}

interface GoldenPathGlobal {
  __I2V_EDITOR_STORE__?: { getState: () => GoldenPathState };
  localStorage: Storage;
}

async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect(page.locator('canvas[data-engine]')).toBeVisible();
}

async function readEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (globalThis as unknown as GoldenPathGlobal)
      .__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    const state = store.getState();
    return structuredClone({
      document: state.document,
      isDirty: state.isDirty,
    });
  });
}

async function tabTo(page: Page, target: ReturnType<Page['locator']>) {
  for (let index = 0; index < 80; index += 1) {
    if (
      await target.evaluate(
        (element) => element === element.ownerDocument.activeElement,
      )
    ) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('키보드 Tab으로 목표 control에 도달하지 못했습니다.');
}

test('golden path completes starter scene to saved 1080×1920 clean PNG without console errors', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await openEditor(page);

  await expect(
    page.getByRole('button', { name: 'Floor', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toBeVisible();
  expect(await readEditorState(page)).toMatchObject({
    document: {
      outputCamera: { focalLengthMm: 50 },
      lighting: { presetId: 'neutral-studio' },
    },
  });

  await page.getByRole('button', { name: '큐브 추가' }).click();
  await page.getByLabel('위치 X').fill('1.25');
  await page.getByLabel('위치 X').press('Enter');
  await page.getByLabel('화면비').selectOption('9:16');
  await page.getByRole('checkbox', { name: '3분할선' }).check();
  await page.getByRole('checkbox', { name: '모션 가이드' }).check();
  await page.getByLabel('피사체 이동 방향').selectOption('right');

  await page.getByRole('button', { name: '카메라', exact: true }).click();
  await page.getByLabel('렌즈').selectOption('35');
  await page.getByRole('button', { name: '전신', exact: true }).click();
  await page.getByLabel('카메라 이동 방향').selectOption('dolly');

  await page.getByRole('button', { name: '조명', exact: true }).click();
  await page.getByLabel('조명 프리셋').selectOption('sunset');
  await page.getByRole('button', { name: '로컬 저장' }).click();
  await expect(page.locator('.status-bar')).toContainText(
    '장면을 로컬에 저장했습니다.',
  );
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          (globalThis as unknown as GoldenPathGlobal).localStorage.getItem(key),
        STORAGE_KEY,
      ),
    )
    .not.toBeNull();

  await page.reload();
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();
  const restored = await readEditorState(page);
  expect(restored).toMatchObject({
    document: {
      output: { aspectRatioId: '9:16', width: 1080, height: 1920 },
      outputCamera: { focalLengthMm: 35 },
      lighting: { presetId: 'sunset' },
      subjectMotionGuide: { label: '오른쪽' },
      cameraMotionGuide: { label: '돌리 인' },
    },
    isDirty: false,
  });
  expect(
    restored.document.objects.find(({ kind }) => kind === 'cube'),
  ).toMatchObject({ transform: { position: { x: 1.25, y: 0.5, z: 0 } } });

  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await dialog.getByLabel('해상도').selectOption('1080x1920');
  await expect(
    dialog.getByRole('radio', { name: '깨끗한 프레임' }),
  ).toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PNG 내보내기' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('다운로드된 PNG 경로가 없습니다.');
  const png = PNG.sync.read(await readFile(path));
  expect([png.width, png.height]).toEqual([1080, 1920]);
  expect(consoleErrors).toEqual([]);
});

test('keyboard-only flow, focus guards, labels, contrast, modal trap, and live feedback are accessible', async ({
  page,
}) => {
  await openEditor(page);
  const status = page.locator('.status-bar');
  await expect(status).toHaveAttribute('aria-live', 'polite');

  const unlabeledControls = await page
    .locator('button, input:not([type="hidden"]), select, textarea')
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const element = control as unknown as {
            getAttribute: (name: string) => string | null;
            labels?: { length: number };
            textContent: string | null;
            title: string;
          };
          return !(
            element.getAttribute('aria-label') ||
            element.getAttribute('aria-labelledby') ||
            element.labels?.length ||
            element.textContent?.trim() ||
            element.title
          );
        })
        .map((control) => control.outerHTML),
    );
  expect(unlabeledControls).toEqual([]);

  const contrastRatios = await page.evaluate(() => {
    interface BrowserElement {
      parentElement: BrowserElement | null;
    }
    const browser = globalThis as unknown as {
      document: { querySelector: (selector: string) => BrowserElement | null };
      getComputedStyle: (element: BrowserElement) => {
        color: string;
        backgroundColor: string;
      };
    };
    const parse = (value: string) =>
      (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = ([red, green, blue]: number[]) => {
      const linear = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const background = (element: BrowserElement) => {
      let current: BrowserElement | null = element;
      while (current !== null) {
        const color = browser.getComputedStyle(current).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)') return color;
        current = current.parentElement;
      }
      return 'rgb(9, 13, 20)';
    };
    return ['.panel-description', '.toolbar-field', '.status-bar'].map(
      (selector) => {
        const element = browser.document.querySelector(selector);
        if (element === null) throw new Error(`${selector}가 없습니다.`);
        const foregroundLuminance = luminance(
          parse(browser.getComputedStyle(element).color),
        );
        const backgroundLuminance = luminance(parse(background(element)));
        return (
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        );
      },
    );
  });
  for (const ratio of contrastRatios) expect(ratio).toBeGreaterThanOrEqual(4.5);

  await page.locator('body').focus();
  const addCube = page.getByRole('button', { name: '큐브 추가' });
  await tabTo(page, addCube);
  const focusStyle = await addCube.evaluate((element) => {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style === undefined)
      throw new Error('computed focus style이 없습니다.');
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ style: 'solid', width: '3px' });
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const cubeRow = page.getByRole('button', { name: 'Cube', exact: true });
  await tabTo(page, cubeRow);
  await page.keyboard.press('Enter');
  await expect(cubeRow).toHaveAttribute('aria-pressed', 'true');

  const positionX = page.getByLabel('위치 X');
  await tabTo(page, positionX);
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('2');
  await page.keyboard.press('e');
  await page.keyboard.press('Delete');
  await expect(cubeRow).toHaveCount(1);
  await expect(page.getByRole('button', { name: '이동 (W)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await expect(positionX).toHaveValue('2');

  await page.locator('body').evaluate((body) => {
    const editable = body.ownerDocument.createElement('div');
    editable.contentEditable = 'true';
    editable.tabIndex = 0;
    editable.setAttribute('aria-label', 'contenteditable focus guard');
    body.append(editable);
  });
  const editable = page.getByLabel('contenteditable focus guard');
  await tabTo(page, editable);
  await page.keyboard.press('Delete');
  await expect(cubeRow).toHaveCount(1);

  const exportButton = page.getByRole('button', { name: 'PNG 내보내기' });
  await tabTo(page, exportButton);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await expect(dialog.getByLabel('파일 이름')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'PNG 내보내기' }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('파일 이름')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(exportButton).toBeFocused();

  await page.keyboard.press('e');
  await expect(status).toContainText('회전 모드');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '카메라', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '선택 프레임 맞춤' }).focus();
  await page.keyboard.press('Enter');
  await expect(status).toContainText(
    '프레임에 맞출 오브젝트를 먼저 선택하세요.',
  );
});

test('WebGL context loss shows a fallback while preserving the serialized scene', async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole('button', { name: '큐브 추가' }).click();
  const before = (await readEditorState(page)).document;

  await page.locator('canvas[data-engine]').dispatchEvent('webglcontextlost');

  await expect(page.getByRole('alert')).toContainText(
    'WebGL context가 손실되었습니다. 직렬화된 장면 데이터는 보존되었습니다.',
  );
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'fallback',
  );
  await expect(
    page.getByRole('button', { name: 'PNG 내보내기' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'JSON 내보내기' }),
  ).toBeEnabled();
  expect((await readEditorState(page)).document).toEqual(before);
});

test('50 added primitives record orbit response and export 1080p within three seconds', async ({
  page,
}) => {
  await openEditor(page);
  await page.evaluate(() => {
    const store = (
      globalThis as unknown as {
        __I2V_EDITOR_STORE__?: {
          getState: () => {
            addObject: (input: {
              kind: 'cube';
              position: { x: number; y: number; z: number };
            }) => string;
            selectObject: (id: null) => void;
          };
        };
      }
    ).__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    const state = store.getState();
    for (let index = 0; index < 50; index += 1) {
      state.addObject({
        kind: 'cube',
        position: {
          x: (index % 10) - 4.5,
          y: 0.5,
          z: Math.floor(index / 10) - 2,
        },
      });
    }
    store.getState().selectObject(null);
  });
  await expect(
    page.getByRole('button', { name: 'Cube', exact: true }),
  ).toHaveCount(50);

  const canvas = page.locator('canvas[data-engine]');
  const beforeOrbit = await canvas.getAttribute('data-runtime-camera');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Canvas bounds가 없습니다.');
  const orbitStartedAt = Date.now();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.35, {
    steps: 8,
  });
  await expect
    .poll(() => canvas.getAttribute('data-runtime-camera'))
    .not.toBe(beforeOrbit);
  const orbitResponseMs = Date.now() - orbitStartedAt;
  await page.mouse.up();

  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await dialog.getByLabel('해상도').selectOption('1920x1080');
  const downloadPromise = page.waitForEvent('download');
  const exportStartedAt = Date.now();
  await dialog.getByRole('button', { name: 'PNG 내보내기' }).click();
  const download = await downloadPromise;
  const exportMs = Date.now() - exportStartedAt;
  const path = await download.path();
  if (path === null) throw new Error('다운로드된 PNG 경로가 없습니다.');
  const png = PNG.sync.read(await readFile(path));
  expect([png.width, png.height]).toEqual([1920, 1080]);
  expect(exportMs).toBeLessThanOrEqual(3_000);
  console.log(
    `S11_PERFORMANCE primitives=50 sceneObjects=52 orbitResponseMs=${orbitResponseMs} export1080pMs=${exportMs}`,
  );
});
