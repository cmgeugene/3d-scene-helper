import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

async function openMannequin(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  const canvas = page.getByRole('img', { name: '3D 장면 캔버스' });
  const runtimeCanvas = page.locator('canvas[data-engine]');
  await expect(canvas).toBeVisible();
  await expect(runtimeCanvas).toBeVisible();
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  return { canvas, runtimeCanvas };
}

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

function facingCuePixelCount(screenshot: Buffer) {
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    if (
      image.data[index] > 185 &&
      image.data[index + 1] > 215 &&
      image.data[index + 2] > 225
    ) {
      count += 1;
    }
  }
  return count;
}

test('articulated mannequin hierarchy applies pose controls to actual WebGL pixels', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '정면', exact: true }).click();
  await page.getByRole('button', { name: '장면', exact: true }).click();

  await expect(runtimeCanvas).toHaveAttribute(
    'data-mannequin-rig',
    'articulated',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-mannequin-pivots',
    /left-shoulder.*left-elbow.*right-hip.*right-knee/,
  );
  const standing = await canvas.screenshot();

  await page.getByRole('button', { name: 'T 포즈' }).click();
  await expect(runtimeCanvas).toHaveAttribute('data-mannequin-pose', 't');
  const tPose = await canvas.screenshot();

  expect(changedPixelCount(standing, tPose)).toBeGreaterThan(800);
});

test('direction views follow a rotated mannequin local front axis', async ({
  page,
}) => {
  const { canvas } = await openMannequin(page);
  const rotationY = page.getByRole('spinbutton', { name: '회전 Y' });
  await rotationY.fill('180');
  await rotationY.press('Enter');
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '정면', exact: true }).click();
  const front = await canvas.screenshot();
  await page.getByRole('button', { name: '후면', exact: true }).click();
  const rear = await canvas.screenshot();

  expect(facingCuePixelCount(front)).toBeGreaterThan(
    facingCuePixelCount(rear) + 30,
  );
});

test('custom torso, head, and wrist rotations keep rendered bounds and IK anchors aligned', async ({
  page,
}) => {
  const { runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: 'T 포즈' }).click();
  await page.evaluate(() => {
    const store = globalThis.__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    const state = store.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: {
            id: string;
            torsoRotationDeg: { x: number; y: number; z: number };
            headRotationDeg: { x: number; y: number; z: number };
            arms: Record<
              'left' | 'right',
              { wristRotationDeg: { x: number; y: number; z: number } }
            >;
          };
        }>;
      };
      beginMannequinPose: () => void;
      commitMannequinPose: (pose: unknown) => void;
    };
    const pose = structuredClone(
      state.document.objects.find(({ kind }) => kind === 'mannequin')
        ?.mannequinPose,
    );
    if (pose === undefined) throw new Error('마네킹 포즈가 없습니다.');
    pose.id = 'custom';
    pose.torsoRotationDeg.y = 90;
    pose.headRotationDeg.y = 45;
    pose.arms.left.wristRotationDeg.z = 90;
    pose.arms.right.wristRotationDeg.z = -90;
    state.beginMannequinPose();
    state.commitMannequinPose(pose);
  });
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute('data-mannequin-bounds', /size/);
  await expect(runtimeCanvas).toHaveAttribute('data-ik-hand-positions', /left/);
  const bounds = JSON.parse(
    (await runtimeCanvas.getAttribute('data-mannequin-bounds')) ?? '{}',
  ) as { size: { x: number; z: number } };
  const hands = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-hand-positions')) ?? '{}',
  ) as Record<'left' | 'right', { x: number; z: number }>;

  expect(bounds.size.z).toBeGreaterThan(1.35);
  expect(bounds.size.x).toBeLessThan(0.65);
  expect(Math.abs(hands.left.z - hands.right.z)).toBeGreaterThan(1.45);
  expect(Math.abs(hands.left.x - hands.right.x)).toBeLessThan(0.1);
});

test('IK mode exposes hand, foot, elbow, and knee handles on both sides', async ({
  page,
}) => {
  const { runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: '손 IK' }).click();

  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-joint-projections',
    /left-hand/,
  );
  const projections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as Record<string, { x: number; y: number; depth: number }>;

  expect(Object.keys(projections).sort()).toEqual(
    [
      'left-elbow',
      'left-foot',
      'left-hand',
      'left-knee',
      'right-elbow',
      'right-foot',
      'right-hand',
      'right-knee',
    ].sort(),
  );
  for (const projection of Object.values(projections)) {
    expect(Number.isFinite(projection.x)).toBe(true);
    expect(Number.isFinite(projection.y)).toBe(true);
    expect(Number.isFinite(projection.depth)).toBe(true);
  }
});

test('articulated hand raycast selects the document root', async ({ page }) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '정면', exact: true }).click();
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: 'T 포즈' }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute('data-mannequin-pose', 't');
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-handle-projections',
    /left/,
  );
  const projections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-handle-projections')) ?? '{}',
  ) as { left: { x: number; y: number } };
  await page.getByRole('button', { name: '오브젝트 변형' }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  const unselected = await canvas.screenshot();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  await page.mouse.click(
    box.x + projections.left.x,
    box.y + projections.left.y + 4,
  );

  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(runtimeCanvas).toHaveAttribute(
    'data-transform-object',
    'scene-object:starter-mannequin',
  );
  expect((await canvas.screenshot()).equals(unselected)).toBe(false);
});

test('frame-selected uses posed articulated bounds in the runtime camera', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('combobox', { name: '화면비' }).selectOption('9:16');
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: 'T 포즈' }).click();
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '정면', exact: true }).click();
  await page.getByRole('button', { name: '선택 프레임 맞춤' }).click();
  const tFrame = await canvas.screenshot();
  const tDistance = await page.evaluate(() => {
    const camera =
      globalThis.__I2V_EDITOR_STORE__?.getState().document.outputCamera;
    if (camera === undefined) throw new Error('output camera가 없습니다.');
    return Math.hypot(
      camera.position.x - camera.target.x,
      camera.position.y - camera.target.y,
      camera.position.z - camera.target.z,
    );
  });
  await expect(runtimeCanvas).toHaveAttribute(
    'data-runtime-camera',
    /position/,
  );

  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: '기본 서기' }).click();
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '선택 프레임 맞춤' }).click();
  const standingDistance = await page.evaluate(() => {
    const camera =
      globalThis.__I2V_EDITOR_STORE__?.getState().document.outputCamera;
    if (camera === undefined) throw new Error('output camera가 없습니다.');
    return Math.hypot(
      camera.position.x - camera.target.x,
      camera.position.y - camera.target.y,
      camera.position.z - camera.target.z,
    );
  });

  expect(tDistance).toBeGreaterThan(standingDistance * 1.4);
  expect((await canvas.screenshot()).equals(tFrame)).toBe(false);
});

for (const side of ['left', 'right'] as const) {
  test(`${side} hand IK drag is runtime-only and commits one pose`, async ({
    page,
  }) => {
    const { canvas, runtimeCanvas } = await openMannequin(page);
    await page.getByRole('button', { name: '카메라' }).click();
    await page.getByRole('button', { name: '정면', exact: true }).click();
    await page.getByRole('button', { name: '장면', exact: true }).click();
    await page.getByRole('button', { name: '손 IK' }).click();

    await expect(runtimeCanvas).not.toHaveAttribute(
      'data-transform-object',
      /.+/,
    );
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-handle-projections',
      /left.*right/,
    );
    const before = await page.evaluate(() => {
      const store = globalThis.__I2V_EDITOR_STORE__;
      if (store === undefined) throw new Error('E2E editor store가 없습니다.');
      const state = store.getState() as unknown as {
        document: {
          objects: Array<{ id: string; kind: string; mannequinPose?: unknown }>;
        };
        history: { past: unknown[] };
      };
      const mannequin = state.document.objects.find(
        ({ kind }) => kind === 'mannequin',
      );
      return {
        pose: structuredClone(mannequin?.mannequinPose),
        historyLength: state.history.past.length,
      };
    });
    const projections = JSON.parse(
      (await runtimeCanvas.getAttribute('data-ik-handle-projections')) ?? '{}',
    ) as Record<'left' | 'right', { x: number; y: number }>;
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    await page.mouse.move(
      box.x + projections[side].x,
      box.y + projections[side].y,
    );
    await page.mouse.down();
    await expect(runtimeCanvas).toHaveAttribute('data-ik-dragging', side);
    await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'false');
    await page.mouse.move(
      box.x + projections[side].x + (side === 'left' ? -64 : 64),
      box.y + projections[side].y - 28,
      { steps: 12 },
    );

    await expect(runtimeCanvas).toHaveAttribute(
      'data-mannequin-pose',
      'custom',
    );
    const during = await page.evaluate(() => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
        document: { objects: Array<{ kind: string; mannequinPose?: unknown }> };
        history: { past: unknown[] };
        inProgressMannequinPose: unknown;
      };
      return {
        pose: structuredClone(
          state.document.objects.find(({ kind }) => kind === 'mannequin')
            ?.mannequinPose,
        ),
        historyLength: state.history.past.length,
        inProgress: state.inProgressMannequinPose !== null,
      };
    });
    expect(during).toEqual({
      pose: before.pose,
      historyLength: before.historyLength,
      inProgress: true,
    });

    await page.mouse.up();
    await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'true');
    await expect(runtimeCanvas).not.toHaveAttribute('data-ik-dragging', /.+/);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const state =
            globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
              document: {
                objects: Array<{
                  kind: string;
                  mannequinPose?: { id: string };
                }>;
              };
              history: { past: unknown[] };
              inProgressMannequinPose: unknown;
            };
          return {
            id: state.document.objects.find(({ kind }) => kind === 'mannequin')
              ?.mannequinPose?.id,
            historyLength: state.history.past.length,
            inProgress: state.inProgressMannequinPose,
          };
        }),
      )
      .toEqual({
        id: 'custom',
        historyLength: before.historyLength + 1,
        inProgress: null,
      });
  });
}

test('foot IK drag previews at runtime and commits exactly once', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '정면', exact: true }).click();
  await page.getByRole('button', { name: '선택 프레임 맞춤' }).click();
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-joint-projections',
    /left-foot/,
  );

  const before = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: { legs: { left: unknown } };
        }>;
      };
      history: { past: unknown[] };
    };
    return {
      leg: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose?.legs.left,
      ),
      historyLength: state.history.past.length,
    };
  });
  const projections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as Record<'left-foot', { x: number; y: number }>;
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  await page.mouse.move(
    box.x + projections['left-foot'].x,
    box.y + projections['left-foot'].y,
  );
  await page.mouse.down();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-active-handle',
    'left-foot',
  );
  await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'false');
  await page.mouse.move(
    box.x + projections['left-foot'].x - 44,
    box.y + projections['left-foot'].y - 38,
    { steps: 10 },
  );
  await expect(runtimeCanvas).toHaveAttribute('data-mannequin-pose', 'custom');
  expect(
    await page.evaluate(() => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
        document: {
          objects: Array<{
            kind: string;
            mannequinPose?: { legs: { left: unknown } };
          }>;
        };
        history: { past: unknown[] };
        inProgressMannequinPose: unknown;
      };
      return {
        leg: structuredClone(
          state.document.objects.find(({ kind }) => kind === 'mannequin')
            ?.mannequinPose?.legs.left,
        ),
        historyLength: state.history.past.length,
        inProgress: state.inProgressMannequinPose !== null,
      };
    }),
  ).toEqual({
    leg: before.leg,
    historyLength: before.historyLength,
    inProgress: true,
  });

  await page.mouse.up();
  await expect(runtimeCanvas).not.toHaveAttribute(
    'data-ik-active-handle',
    /.+/,
  );
  await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'true');
  const after = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: { legs: { left: unknown } };
        }>;
      };
      history: { past: unknown[] };
      inProgressMannequinPose: unknown;
    };
    return {
      leg: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose?.legs.left,
      ),
      historyLength: state.history.past.length,
      inProgress: state.inProgressMannequinPose,
    };
  });
  expect(after.leg).not.toEqual(before.leg);
  expect(after.historyLength).toBe(before.historyLength + 1);
  expect(after.inProgress).toBeNull();
});

test('elbow and knee targets each commit one direct-joint pose', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '정면', exact: true }).click();
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  for (const handle of ['left-elbow', 'right-knee'] as const) {
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-joint-projections',
      new RegExp(handle),
    );
    const projections = JSON.parse(
      (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
    ) as Record<typeof handle, { x: number; y: number }>;
    const beforeHistoryLength = await page.evaluate(() => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
        history: { past: unknown[] };
      };
      return state.history.past.length;
    });

    await page.mouse.move(
      box.x + projections[handle].x,
      box.y + projections[handle].y,
    );
    await page.mouse.down();
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-active-handle',
      handle,
    );
    await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'false');
    await page.mouse.move(
      box.x + projections[handle].x + (handle === 'left-elbow' ? -42 : 38),
      box.y + projections[handle].y - 26,
      { steps: 8 },
    );
    await expect(runtimeCanvas).toHaveAttribute(
      'data-mannequin-pose',
      'custom',
    );
    await page.mouse.up();
    await expect(runtimeCanvas).not.toHaveAttribute(
      'data-ik-active-handle',
      /.+/,
    );
    await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'true');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const state =
            globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
              history: { past: unknown[] };
              inProgressMannequinPose: unknown;
            };
          return {
            historyLength: state.history.past.length,
            inProgress: state.inProgressMannequinPose,
          };
        }),
      )
      .toEqual({
        historyLength: beforeHistoryLength + 1,
        inProgress: null,
      });
  }
});

test('hand IK pointer cancellation restores the document without history', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '정면', exact: true }).click();
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-handle-projections',
    /left/,
  );

  const beforeHistoryLength = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      history: { past: unknown[] };
    };
    return state.history.past.length;
  });
  const projections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-handle-projections')) ?? '{}',
  ) as { left: { x: number; y: number } };
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  await page.mouse.move(box.x + projections.left.x, box.y + projections.left.y);
  await page.mouse.down();
  await expect(runtimeCanvas).toHaveAttribute('data-ik-dragging', 'left');
  await page.mouse.move(
    box.x + projections.left.x - 48,
    box.y + projections.left.y - 36,
    { steps: 8 },
  );
  await expect(runtimeCanvas).toHaveAttribute('data-mannequin-pose', 'custom');

  await runtimeCanvas.dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect(runtimeCanvas).not.toHaveAttribute('data-ik-dragging', /.+/);
  await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state =
          globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
            document: {
              objects: Array<{
                kind: string;
                mannequinPose?: { id: string };
              }>;
            };
            history: { past: unknown[] };
            inProgressMannequinPose: unknown;
          };
        return {
          id: state.document.objects.find(({ kind }) => kind === 'mannequin')
            ?.mannequinPose?.id,
          historyLength: state.history.past.length,
          inProgress: state.inProgressMannequinPose,
        };
      }),
    )
    .toEqual({
      id: 'default',
      historyLength: beforeHistoryLength,
      inProgress: null,
    });

  await runtimeCanvas.dispatchEvent('pointercancel', { pointerId: 1 });
  expect(
    await page.evaluate(() => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
        history: { past: unknown[] };
      };
      return state.history.past.length;
    }),
  ).toBe(beforeHistoryLength);
});

test('hand IK restores transient interaction state when pose commit throws', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '카메라' }).click();
  await page.getByRole('button', { name: '정면', exact: true }).click();
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-handle-projections',
    /left/,
  );
  await page.evaluate(() => {
    const browserStore = globalThis.__I2V_EDITOR_STORE__;
    if (browserStore === undefined)
      throw new Error('E2E editor store가 없습니다.');
    const store = browserStore as unknown as {
      setState: (partial: { commitMannequinPose: () => never }) => void;
    };
    store.setState({
      commitMannequinPose: () => {
        throw new Error('forced mannequin pose commit failure');
      },
    });
  });
  const projections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-handle-projections')) ?? '{}',
  ) as { left: { x: number; y: number } };
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  await page.mouse.move(box.x + projections.left.x, box.y + projections.left.y);
  await page.mouse.down();
  await page.mouse.move(
    box.x + projections.left.x - 36,
    box.y + projections.left.y - 24,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect(runtimeCanvas).not.toHaveAttribute('data-ik-dragging', /.+/);
  await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'true');
  expect(
    await page.evaluate(() => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
        inProgressMannequinPose: unknown;
      };
      return state.inProgressMannequinPose;
    }),
  ).toBeNull();
  expect(pageErrors).toContain('forced mannequin pose commit failure');
});

for (const { view, side } of [
  { view: '좌측', side: 'left' },
  { view: '우측', side: 'right' },
] as const) {
  test(`${view} profile chooses the nearest ${side} hand IK handle`, async ({
    page,
  }) => {
    const { canvas, runtimeCanvas } = await openMannequin(page);
    await page.getByRole('button', { name: '장면', exact: true }).click();
    await page.getByRole('button', { name: 'T 포즈' }).click();
    await page.getByRole('button', { name: '카메라' }).click();
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.getByRole('button', { name: '장면', exact: true }).click();
    await page.getByRole('button', { name: '손 IK' }).click();
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-handle-projections',
      /left.*right/,
    );
    const projections = JSON.parse(
      (await runtimeCanvas.getAttribute('data-ik-handle-projections')) ?? '{}',
    ) as Record<'left' | 'right', { x: number; y: number }>;
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    await page.mouse.move(
      box.x + projections[side].x,
      box.y + projections[side].y,
    );
    await page.mouse.down();
    await expect(runtimeCanvas).toHaveAttribute('data-ik-dragging', side);
    await page.mouse.up();
  });
}
