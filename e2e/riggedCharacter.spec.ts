import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import type { SceneObject } from '../src/editor/persistence/sceneSchema';

function changedPixelCount(before: Buffer, after: Buffer) {
  const first = PNG.sync.read(before);
  const second = PNG.sync.read(after);
  let changed = 0;
  for (let index = 0; index < first.data.length; index += 4) {
    const delta =
      Math.abs(first.data[index] - second.data[index]) +
      Math.abs(first.data[index + 1] - second.data[index + 1]) +
      Math.abs(first.data[index + 2] - second.data[index + 2]);
    if (delta > 24) changed += 1;
  }
  return changed;
}

test('Meshy rigged GLB를 미터 크기로 렌더하고 Idle preview를 재생한다', async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  const canvas = page.getByRole('img', { name: '3D 장면 캔버스' });
  const runtimeCanvas = page.locator('canvas[data-engine]');
  const before = await canvas.screenshot();

  await page.getByRole('button', { name: 'Meshy Idle 캐릭터 추가' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-rigged-character-asset',
    'meshy-idle-3',
    { timeout: 15_000 },
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-rigged-character-bones',
    '24',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-rigged-character-clip',
    'Armature|Idle_3|baselayer',
  );
  const loaded = await canvas.screenshot();
  expect(changedPixelCount(before, loaded)).toBeGreaterThan(1_000);

  const initialTime = Number(
    await runtimeCanvas.getAttribute('data-rigged-character-time'),
  );
  await page.getByRole('button', { name: 'Idle 미리보기 재생' }).click();
  await expect
    .poll(async () =>
      Number(await runtimeCanvas.getAttribute('data-rigged-character-time')),
    )
    .toBeGreaterThan(initialTime + 0.2);

  await page.getByRole('button', { name: '미리보기 중지' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-rigged-character-time',
    /^0\.000$/,
  );
  await expect(page.getByLabel('캐릭터 키')).toHaveValue('1.7');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = globalThis.__I2V_EDITOR_STORE__?.getState() as
          { document: { objects: SceneObject[] } } | undefined;
        const character = state?.document.objects.find(
          ({ kind }) => kind === 'character-glb',
        );
        return {
          height: character?.dimensions.y,
          floorY:
            character === undefined
              ? null
              : character.transform.position.y - character.dimensions.y / 2,
        };
      }),
    )
    .toEqual({ height: 1.7, floorY: 0 });

  const beforeIk = await canvas.screenshot();
  await page.getByRole('button', { name: '손·발 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-character-ik-projections',
    /leftHand/,
  );
  const leftHandProjection = await runtimeCanvas.evaluate((element) => {
    const projections = JSON.parse(
      element.dataset.characterIkProjections ?? '{}',
    ) as { leftHand: { x: number; y: number } };
    return projections.leftHand;
  });
  const canvasBounds = await runtimeCanvas.boundingBox();
  if (canvasBounds === null) throw new Error('3D canvas bounds are missing');
  await page.mouse.move(
    canvasBounds.x + leftHandProjection.x,
    canvasBounds.y + leftHandProjection.y,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBounds.x + leftHandProjection.x + 55,
    canvasBounds.y + leftHandProjection.y - 25,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = globalThis.__I2V_EDITOR_STORE__?.getState() as
          { document: { objects: SceneObject[] } } | undefined;
        return state?.document.objects.find(
          ({ kind }) => kind === 'character-glb',
        )?.characterIkTargets?.leftHand;
      }),
    )
    .toBeTruthy();
  await page.getByRole('button', { name: '오브젝트 변형' }).click();
  const afterIk = await canvas.screenshot();
  expect(changedPixelCount(beforeIk, afterIk)).toBeGreaterThan(150);

  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await dialog.getByLabel('해상도').selectOption('1280x720');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PNG 내보내기' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (downloadPath === null) throw new Error('PNG download path is missing');
  const exported = PNG.sync.read(await readFile(downloadPath));
  expect([exported.width, exported.height]).toEqual([1280, 720]);

  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(localStorage).some((value) =>
          value.includes('meshy-idle-3'),
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-rigged-character-asset',
    'meshy-idle-3',
    { timeout: 15_000 },
  );
  await expect(
    page.getByRole('button', { name: 'Meshy Idle Character', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = globalThis.__I2V_EDITOR_STORE__?.getState() as
          { document: { objects: SceneObject[] } } | undefined;
        return state?.document.objects.find(
          ({ kind }) => kind === 'character-glb',
        )?.characterIkTargets?.leftHand;
      }),
    )
    .toBeTruthy();
});

test('Rodin/Meshy 리깅 GLB를 가져와 프로젝트 자산으로 복원한다', async ({
  page,
}) => {
  test.slow();
  const token = 'test-token-that-is-at-least-thirty-two-characters';
  const assetId = 'character_imported_meshy';
  const glb = await readFile('assets/Meshy_AI_Animation_Idle_3_withSkin.glb');
  let importedAnalysis: unknown = null;

  await page.route('**/__i2v/companion-connection', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        url: 'http://127.0.0.1:61234',
        token,
      }),
    }),
  );
  await page.route('http://127.0.0.1:61234/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === 'POST' &&
      url.pathname === '/api/rigged-characters'
    ) {
      importedAnalysis = JSON.parse(url.searchParams.get('analysis') ?? 'null');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          asset: {
            id: assetId,
            name: 'Meshy_AI_Animation_Idle_3_withSkin',
            artifactId: 'artifact_imported_meshy',
            contentHash: `sha256:${'a'.repeat(64)}`,
            mimeType: 'model/gltf-binary',
            originalFileName: 'Meshy_AI_Animation_Idle_3_withSkin.glb',
            byteLength: glb.byteLength,
            createdAt: new Date().toISOString(),
            analysis: importedAnalysis,
          },
        }),
      });
      return;
    }
    if (
      request.method() === 'GET' &&
      url.pathname === `/api/rigged-characters/${assetId}/content`
    ) {
      await route.fulfill({
        contentType: 'model/gltf-binary',
        body: glb,
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not found' }),
    });
  });

  await page.goto('/');
  const input = page.locator('input[type="file"][accept*=".glb"]');
  await expect(input).toBeEnabled();
  await input.setInputFiles('assets/Meshy_AI_Animation_Idle_3_withSkin.glb');

  const runtimeCanvas = page.locator('canvas[data-engine]');
  await expect(runtimeCanvas).toHaveAttribute(
    'data-rigged-character-asset',
    assetId,
    { timeout: 15_000 },
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-rigged-character-bones',
    '24',
  );
  await expect(page.locator('.asset-import-status')).toContainText('24본');
  expect(importedAnalysis).toMatchObject({
    dimensions: { y: expect.any(Number) },
    boneCount: 24,
    skinnedMeshCount: expect.any(Number),
    animation: { clipName: 'Armature|Idle_3|baselayer' },
  });
  expect(
    (importedAnalysis as { dimensions: { y: number } }).dimensions.y,
  ).toBeCloseTo(1.7, 2);

  await page.reload();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-rigged-character-asset',
    assetId,
    { timeout: 15_000 },
  );
});
