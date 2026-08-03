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

test('체형 preset이 포즈와 관절 길이를 유지하며 실제 WebGL 실루엣을 바꾼다', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  const bodyTypeGroup = page.getByRole('group', { name: '마네킹 체형' });
  const readBounds = async () => {
    const value = await runtimeCanvas.getAttribute('data-mannequin-bounds');
    if (value === null) throw new Error('마네킹 runtime bounds가 없습니다.');
    return JSON.parse(value) as {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
      size: { x: number; y: number; z: number };
    };
  };

  await expect(runtimeCanvas).toHaveAttribute(
    'data-mannequin-body-type',
    'standard',
  );
  const standardBounds = await readBounds();
  const standardFrame = await canvas.screenshot();

  await bodyTypeGroup.getByRole('button', { name: '건장한 체형' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-mannequin-body-type',
    'athletic',
  );
  const athleticBounds = await readBounds();
  const athleticFrame = await canvas.screenshot();

  await bodyTypeGroup.getByRole('button', { name: '뚱뚱한 체형' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-mannequin-body-type',
    'heavy',
  );
  const heavyBounds = await readBounds();
  const heavyFrame = await canvas.screenshot();

  expect(athleticBounds.size.x).toBeGreaterThan(standardBounds.size.x + 0.01);
  expect(heavyBounds.size.x).toBeGreaterThan(standardBounds.size.x + 0.01);
  expect(heavyBounds.size.z).toBeGreaterThan(athleticBounds.size.z + 0.03);
  expect(athleticBounds.size.y).toBeCloseTo(1.8, 3);
  expect(athleticBounds.min.y).toBeCloseTo(standardBounds.min.y, 3);
  expect(athleticBounds.max.y).toBeCloseTo(1.8, 3);
  expect(athleticBounds.size.y).toBeGreaterThan(standardBounds.size.y + 0.09);
  expect(heavyBounds.size.y).toBeCloseTo(standardBounds.size.y, 3);
  expect(changedPixelCount(standardFrame, athleticFrame)).toBeGreaterThan(500);
  expect(changedPixelCount(athleticFrame, heavyFrame)).toBeGreaterThan(500);
  expect(
    await page.evaluate(() => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
        document: {
          objects: Array<{
            kind: string;
            mannequinBodyType?: string;
            mannequinPose?: { id: string };
          }>;
        };
      };
      const mannequin = state.document.objects.find(
        ({ kind }) => kind === 'mannequin',
      );
      return {
        bodyType: mannequin?.mannequinBodyType,
        poseId: mannequin?.mannequinPose?.id,
      };
    }),
  ).toEqual({ bodyType: 'heavy', poseId: 'default' });

  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(localStorage).some(
          (value) =>
            value.includes('mannequinBodyType') && value.includes('heavy'),
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-mannequin-body-type',
    'heavy',
  );
  await expect(
    page
      .getByRole('group', { name: '마네킹 체형' })
      .getByRole('button', { name: '뚱뚱한 체형' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('articulated mannequin hierarchy applies pose controls to actual WebGL pixels', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
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
      'neck',
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

test('neck joint exposes only local Y yaw that keeps the head attached', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: 'T 포즈' }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-joint-projections',
    /"neck"/,
  );

  const handleProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as Record<'neck', { x: number; y: number }>;
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(
    box.x + handleProjections.neck.x,
    box.y + handleProjections.neck.y,
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-rotation-handle',
    'neck',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-kind',
    'rotation-origin',
  );
  const ringProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-rotation-ring-projections')) ??
      '{}',
  ) as Record<
    'y',
    { start: { x: number; y: number }; end: { x: number; y: number } }
  >;
  expect(Object.keys(ringProjections)).toEqual(['y']);

  const before = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{ kind: string; mannequinPose?: unknown }>;
      };
      history: { past: unknown[] };
    };
    return {
      pose: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose,
      ),
      historyLength: state.history.past.length,
    };
  });
  await page.mouse.move(
    box.x + ringProjections.y.start.x,
    box.y + ringProjections.y.start.y,
  );
  await expect(runtimeCanvas).toHaveAttribute('data-ik-highlight-axis', 'y');
  await page.mouse.down();
  await expect(runtimeCanvas).toHaveAttribute('data-ik-rotation-axis', 'y');
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-state',
    'drag',
  );
  await page.mouse.move(
    box.x + ringProjections.y.end.x,
    box.y + ringProjections.y.end.y,
    { steps: 12 },
  );
  expect(
    await page.evaluate(() => {
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
    }),
  ).toEqual({
    pose: before.pose,
    historyLength: before.historyLength,
    inProgress: true,
  });

  await page.mouse.up();
  const after = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: {
            id: string;
            headRotationDeg: { x: number; y: number; z: number };
          };
        }>;
      };
      history: { past: unknown[] };
      inProgressMannequinPose: unknown;
    };
    return {
      pose: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose,
      ),
      historyLength: state.history.past.length,
      inProgress: state.inProgressMannequinPose,
    };
  });
  expect(after.pose?.id).toBe('custom');
  expect(Math.abs(after.pose?.headRotationDeg.y ?? 0)).toBeGreaterThan(5);
  expect(after.pose?.headRotationDeg.x).toBe(0);
  expect(after.pose?.headRotationDeg.z).toBe(0);
  const expected = structuredClone(before.pose) as typeof after.pose;
  if (expected === undefined || after.pose === undefined) return;
  expected.id = 'custom';
  expected.headRotationDeg = after.pose.headRotationDeg;
  expect(after.pose).toEqual(expected);
  expect(after.historyLength).toBe(before.historyLength + 1);
  expect(after.inProgress).toBeNull();
});

test('hovered hand IK handle exposes local rotation rings that preview and commit once', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: 'T 포즈' }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-joint-projections',
    /left-hand/,
  );

  const handleProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as Record<'left-hand', { x: number; y: number }>;
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(
    box.x + handleProjections['left-hand'].x,
    box.y + handleProjections['left-hand'].y,
  );

  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-rotation-handle',
    'left-hand',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-state',
    'hover',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-handle',
    'left-hand',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-kind',
    'position',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-color',
    /^#[0-9a-f]{6}$/,
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-rotation-ring-projections',
    /"z"/,
  );
  const ringProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-rotation-ring-projections')) ??
      '{}',
  ) as Record<
    'x' | 'y' | 'z',
    { start: { x: number; y: number }; end: { x: number; y: number } }
  >;
  const before = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: {
            arms: {
              left: {
                wristRotationDeg: { x: number; y: number; z: number };
              };
            };
          };
        }>;
      };
      history: { past: unknown[] };
    };
    return {
      wrist: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose?.arms.left.wristRotationDeg,
      ),
      historyLength: state.history.past.length,
    };
  });

  await page.mouse.move(
    box.x + ringProjections.z.start.x,
    box.y + ringProjections.z.start.y,
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-state',
    'hover',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-kind',
    'rotation',
  );
  await expect(runtimeCanvas).toHaveAttribute('data-ik-highlight-axis', 'z');
  await page.mouse.down();
  await expect(runtimeCanvas).toHaveAttribute('data-ik-rotation-axis', 'z');
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-state',
    'drag',
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-highlight-kind',
    'rotation',
  );
  await expect(runtimeCanvas).toHaveAttribute('data-ik-highlight-axis', 'z');
  await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'false');
  await page.mouse.move(
    box.x + ringProjections.z.end.x,
    box.y + ringProjections.z.end.y,
    { steps: 12 },
  );
  await expect(runtimeCanvas).toHaveAttribute('data-mannequin-pose', 'custom');
  expect(
    await page.evaluate(() => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
        document: {
          objects: Array<{
            kind: string;
            mannequinPose?: { arms: { left: { wristRotationDeg: unknown } } };
          }>;
        };
        history: { past: unknown[] };
        inProgressMannequinPose: unknown;
      };
      return {
        wrist: structuredClone(
          state.document.objects.find(({ kind }) => kind === 'mannequin')
            ?.mannequinPose?.arms.left.wristRotationDeg,
        ),
        historyLength: state.history.past.length,
        inProgress: state.inProgressMannequinPose !== null,
      };
    }),
  ).toEqual({
    wrist: before.wrist,
    historyLength: before.historyLength,
    inProgress: true,
  });

  await page.mouse.up();
  await expect(runtimeCanvas).not.toHaveAttribute(
    'data-ik-rotation-axis',
    /.+/,
  );
  await expect(runtimeCanvas).toHaveAttribute('data-orbit-enabled', 'true');
  const after = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: { arms: { left: { wristRotationDeg: unknown } } };
        }>;
      };
      history: { past: unknown[] };
      inProgressMannequinPose: unknown;
    };
    return {
      wrist: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose?.arms.left.wristRotationDeg,
      ),
      historyLength: state.history.past.length,
      inProgress: state.inProgressMannequinPose,
    };
  });
  expect(after.wrist).not.toEqual(before.wrist);
  expect(after.historyLength).toBe(before.historyLength + 1);
  expect(after.inProgress).toBeNull();
});

test('elbow IK exposes constrained bend and lateral rotation rings', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: 'A 포즈' }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-joint-projections',
    /left-elbow/,
  );

  const handleProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as Record<'left-elbow', { x: number; y: number }>;
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(
    box.x + handleProjections['left-elbow'].x,
    box.y + handleProjections['left-elbow'].y,
  );

  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-rotation-handle',
    'left-elbow',
  );
  const ringProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-rotation-ring-projections')) ??
      '{}',
  ) as Partial<
    Record<
      'x' | 'y' | 'z',
      { start: { x: number; y: number }; end: { x: number; y: number } }
    >
  >;
  expect(Object.keys(ringProjections).sort()).toEqual(['x', 'z']);
  expect(ringProjections.z).toBeDefined();
  if (ringProjections.z === undefined) return;
  const before = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: {
            arms: {
              left: {
                shoulderRotationDeg: unknown;
                elbowBendDeg: number;
                elbowDeviationDeg: number;
              };
            };
          };
        }>;
      };
      history: { past: unknown[] };
    };
    const arm = state.document.objects.find(({ kind }) => kind === 'mannequin')
      ?.mannequinPose?.arms.left;
    return {
      arm: structuredClone(arm),
      historyLength: state.history.past.length,
    };
  });

  await page.mouse.move(
    box.x + ringProjections.z.start.x,
    box.y + ringProjections.z.start.y,
  );
  await page.mouse.down();
  await expect(runtimeCanvas).toHaveAttribute('data-ik-rotation-axis', 'z');
  await page.mouse.move(
    box.x + ringProjections.z.end.x,
    box.y + ringProjections.z.end.y,
    { steps: 12 },
  );
  await page.mouse.up();

  const after = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: {
            arms: {
              left: {
                shoulderRotationDeg: unknown;
                elbowBendDeg: number;
                elbowDeviationDeg: number;
              };
            };
          };
        }>;
      };
      history: { past: unknown[] };
    };
    return {
      arm: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose?.arms.left,
      ),
      historyLength: state.history.past.length,
    };
  });
  expect(after.arm?.elbowDeviationDeg).toBe(8);
  expect(after.arm?.elbowBendDeg).toBe(before.arm?.elbowBendDeg);
  expect(after.arm?.shoulderRotationDeg).toEqual(
    before.arm?.shoulderRotationDeg,
  );
  expect(after.historyLength).toBe(before.historyLength + 1);

  const posedProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as Record<'left-hand', { x: number; y: number }>;
  const handStart = posedProjections['left-hand'];
  const handTarget = { x: handStart.x - 12, y: handStart.y + 4 };
  await page.mouse.move(box.x + handStart.x, box.y + handStart.y);
  await page.mouse.down();
  await page.mouse.move(box.x + handTarget.x, box.y + handTarget.y, {
    steps: 10,
  });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const finalProjections = JSON.parse(
        (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
      ) as Record<'left-hand', { x: number; y: number }>;
      return Math.hypot(
        finalProjections['left-hand'].x - handTarget.x,
        finalProjections['left-hand'].y - handTarget.y,
      );
    })
    .toBeLessThan(0.5);
  const afterHandDrag = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: {
            arms: { left: { elbowDeviationDeg: number } };
          };
        }>;
      };
      history: { past: unknown[] };
    };
    return {
      elbowDeviationDeg: state.document.objects.find(
        ({ kind }) => kind === 'mannequin',
      )?.mannequinPose?.arms.left.elbowDeviationDeg,
      historyLength: state.history.past.length,
    };
  });
  expect(afterHandDrag.elbowDeviationDeg).toBe(8);
  expect(afterHandDrag.historyLength).toBe(before.historyLength + 2);
});

test('knee IK exposes constrained bend and lateral rotation rings', async ({
  page,
}) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
  await page.getByRole('button', { name: '장면', exact: true }).click();
  await page.getByRole('button', { name: '걷기 준비' }).click();
  await page.getByRole('button', { name: '손 IK' }).click();
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-joint-projections',
    /right-knee/,
  );

  const handleProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as Record<'right-knee', { x: number; y: number }>;
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(
    box.x + handleProjections['right-knee'].x,
    box.y + handleProjections['right-knee'].y,
  );
  await expect(runtimeCanvas).toHaveAttribute(
    'data-ik-rotation-handle',
    'right-knee',
  );
  const ringProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-rotation-ring-projections')) ??
      '{}',
  ) as Partial<
    Record<
      'x' | 'y' | 'z',
      { start: { x: number; y: number }; end: { x: number; y: number } }
    >
  >;
  expect(Object.keys(ringProjections).sort()).toEqual(['x', 'z']);
  expect(ringProjections.z).toBeDefined();
  if (ringProjections.z === undefined) return;
  const before = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: {
            legs: {
              right: {
                hipRotationDeg: unknown;
                kneeBendDeg: number;
                kneeDeviationDeg: number;
                ankleRotationDeg: unknown;
              };
            };
          };
        }>;
      };
      history: { past: unknown[] };
    };
    return {
      leg: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose?.legs.right,
      ),
      historyLength: state.history.past.length,
    };
  });

  await page.mouse.move(
    box.x + ringProjections.z.start.x,
    box.y + ringProjections.z.start.y,
  );
  await page.mouse.down();
  await expect(runtimeCanvas).toHaveAttribute('data-ik-rotation-axis', 'z');
  await page.mouse.move(
    box.x + ringProjections.z.end.x,
    box.y + ringProjections.z.end.y,
    { steps: 12 },
  );
  await page.mouse.up();

  const after = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: { legs: { right: unknown } };
        }>;
      };
      history: { past: unknown[] };
    };
    return {
      leg: structuredClone(
        state.document.objects.find(({ kind }) => kind === 'mannequin')
          ?.mannequinPose?.legs.right,
      ) as {
        hipRotationDeg: unknown;
        kneeBendDeg: number;
        kneeDeviationDeg: number;
        ankleRotationDeg: unknown;
      },
      historyLength: state.history.past.length,
    };
  });
  expect(Math.abs(after.leg.kneeDeviationDeg)).toBe(5);
  expect({
    ...after.leg,
    kneeDeviationDeg: before.leg?.kneeDeviationDeg,
  }).toEqual(before.leg);
  expect(after.historyLength).toBe(before.historyLength + 1);

  const posedProjections = JSON.parse(
    (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
  ) as Record<'right-foot' | 'right-knee', { x: number; y: number }>;
  const footStart = posedProjections['right-foot'];
  const knee = posedProjections['right-knee'];
  const towardKnee = {
    x: knee.x - footStart.x,
    y: knee.y - footStart.y,
  };
  const towardKneeLength = Math.hypot(towardKnee.x, towardKnee.y);
  const footTarget = {
    x: footStart.x + (towardKnee.x / towardKneeLength) * 12,
    y: footStart.y + (towardKnee.y / towardKneeLength) * 12,
  };
  await page.mouse.move(box.x + footStart.x, box.y + footStart.y);
  await page.mouse.down();
  await page.mouse.move(box.x + footTarget.x, box.y + footTarget.y, {
    steps: 10,
  });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const finalProjections = JSON.parse(
        (await runtimeCanvas.getAttribute('data-ik-joint-projections')) ?? '{}',
      ) as Record<'right-foot', { x: number; y: number }>;
      return Math.hypot(
        finalProjections['right-foot'].x - footTarget.x,
        finalProjections['right-foot'].y - footTarget.y,
      );
    })
    .toBeLessThan(0.5);
  const afterFootDrag = await page.evaluate(() => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as {
      document: {
        objects: Array<{
          kind: string;
          mannequinPose?: {
            legs: { right: { kneeDeviationDeg: number } };
          };
        }>;
      };
      history: { past: unknown[] };
    };
    return {
      kneeDeviationDeg: state.document.objects.find(
        ({ kind }) => kind === 'mannequin',
      )?.mannequinPose?.legs.right.kneeDeviationDeg,
      historyLength: state.history.past.length,
    };
  });
  expect(Math.abs(afterFootDrag.kneeDeviationDeg ?? 0)).toBe(5);
  expect(afterFootDrag.historyLength).toBe(before.historyLength + 2);
});

test('articulated hand raycast selects the document root', async ({ page }) => {
  const { canvas, runtimeCanvas } = await openMannequin(page);
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
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-highlight-handle',
      `${side}-hand`,
    );
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-highlight-kind',
      'position',
    );
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-highlight-state',
      'hover',
    );
    await page.mouse.down();
    await expect(runtimeCanvas).toHaveAttribute('data-ik-dragging', side);
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-highlight-state',
      'drag',
    );
    await expect(runtimeCanvas).toHaveAttribute(
      'data-ik-highlight-kind',
      'position',
    );
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

for (const { profile, side, cameraX } of [
  { profile: 'left', side: 'left', cameraX: -5 },
  { profile: 'right', side: 'right', cameraX: 5 },
] as const) {
  test(`${profile} profile chooses the nearest ${side} hand IK handle`, async ({
    page,
  }) => {
    const { canvas, runtimeCanvas } = await openMannequin(page);
    await page.getByRole('button', { name: '장면', exact: true }).click();
    await page.getByRole('button', { name: 'T 포즈' }).click();
    await page.evaluate((x) => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState();
      if (state === undefined) throw new Error('E2E editor store가 없습니다.');
      state.commitCamera({
        ...state.document.outputCamera,
        position: { x, y: 1.6, z: 0 },
        target: { x: 0, y: 1.6, z: 0 },
        rollDeg: 0,
      });
    }, cameraX);
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
