import { expect, test, type Locator, type Page } from '@playwright/test';

interface Transform {
  position: { x: number; y: number; z: number };
  rotationDeg: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

interface BrowserEditorState {
  document: {
    objects: Array<{
      id: string;
      kind: string;
      name: string;
      color: string;
      visible: boolean;
      transform: Transform;
    }>;
    outputCamera: unknown;
  };
  selectedObjectId: string | null;
  transformMode: 'translate' | 'rotate' | 'scale';
  inProgressTransform: unknown;
}

interface BrowserEditorStore {
  getState: () => BrowserEditorState;
  subscribe: (
    listener: (state: BrowserEditorState, previous: BrowserEditorState) => void,
  ) => () => void;
}

interface ManipulationBridge {
  __I2V_EDITOR_STORE__?: BrowserEditorStore;
  __MANIPULATION_DOCUMENT_CHANGES__?: number;
}

async function openManipulation(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await expect(page.getByRole('img', { name: '3D 장면 캔버스' })).toBeVisible();
  const runtimeCanvas = page.locator('canvas[data-engine]');
  await expect(runtimeCanvas).toBeVisible();
  return runtimeCanvas;
}

async function runtimeTransform(canvas: Locator) {
  const value = await canvas.getAttribute('data-runtime-transform');
  return value === null ? null : (JSON.parse(value) as Transform);
}

async function selectedTransform(page: Page) {
  return page.evaluate(() => {
    const state = (
      globalThis as unknown as ManipulationBridge
    ).__I2V_EDITOR_STORE__?.getState();
    const selected = state?.document.objects.find(
      ({ id }) => id === state.selectedObjectId,
    );
    if (selected === undefined) throw new Error('선택 object가 없습니다.');
    return structuredClone(selected.transform);
  });
}

async function dragGizmo(
  page: Page,
  canvas: Locator,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await expect(canvas).toHaveAttribute('data-gizmo-origin', /\d/);
  const origin = JSON.parse(
    (await canvas.getAttribute('data-gizmo-origin')) ?? 'null',
  ) as { x: number; y: number };
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('Canvas bounds가 없습니다.');

  await page.mouse.move(box.x + origin.x + start.x, box.y + origin.y + start.y);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute('data-transform-dragging', 'true');
  await page.mouse.move(box.x + origin.x + end.x, box.y + origin.y + end.y, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-transform-dragging', 'false');
}

async function findGizmoAxis(page: Page, canvas: Locator, axis: 'X' | 'Z') {
  const origin = JSON.parse(
    (await canvas.getAttribute('data-gizmo-origin')) ?? 'null',
  ) as { x: number; y: number };
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('Canvas bounds가 없습니다.');

  for (let radius = 20; radius <= 88; radius += 4) {
    for (let degrees = 0; degrees < 360; degrees += 12) {
      const radians = (degrees * Math.PI) / 180;
      const offset = {
        x: Math.cos(radians) * radius,
        y: Math.sin(radians) * radius,
      };
      await page.mouse.move(
        box.x + origin.x + offset.x,
        box.y + origin.y + offset.y,
      );
      if ((await canvas.getAttribute('data-transform-axis')) === axis) {
        await page.mouse.move(box.x + 2, box.y + 2);
        await expect
          .poll(() => canvas.getAttribute('data-transform-axis'), {
            timeout: 500,
          })
          .not.toBe(axis);
        await page.mouse.move(
          box.x + origin.x + offset.x,
          box.y + origin.y + offset.y,
        );
        await page.waitForTimeout(32);
        if ((await canvas.getAttribute('data-transform-axis')) === axis) {
          return offset;
        }
      }
    }
  }

  throw new Error(
    `${axis} gizmo handle을 찾지 못했습니다. origin=${JSON.stringify(origin)} canvas=${JSON.stringify(box)}`,
  );
}

async function rotateZGizmo(
  page: Page,
  canvas: Locator,
  start: { x: number; y: number },
) {
  const origin = JSON.parse(
    (await canvas.getAttribute('data-gizmo-origin')) ?? 'null',
  ) as { x: number; y: number };
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('Canvas bounds가 없습니다.');
  const radius = Math.hypot(start.x, start.y);
  const startAngle = Math.atan2(start.y, start.x);

  await page.mouse.move(box.x + origin.x + start.x, box.y + origin.y + start.y);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute('data-transform-dragging', 'true');
  for (let step = 1; step <= 12; step += 1) {
    const angle = startAngle + (Math.PI / 2) * (step / 12);
    await page.mouse.move(
      box.x + origin.x + Math.cos(angle) * radius,
      box.y + origin.y + Math.sin(angle) * radius,
    );
  }
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-transform-dragging', 'false');
}

test('manipulation attaches TransformControls to selected root and switches W/E/R modes', async ({
  page,
}) => {
  const canvas = await openManipulation(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('Canvas bounds가 없습니다.');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(canvas).toHaveAttribute(
    'data-transform-object',
    'scene-object:starter-mannequin',
  );
  await expect(canvas).toHaveAttribute('data-transform-mode', 'translate');

  await page.keyboard.press('e');
  await expect(canvas).toHaveAttribute('data-transform-mode', 'rotate');
  await page.keyboard.press('r');
  await expect(canvas).toHaveAttribute('data-transform-mode', 'scale');
  await page.keyboard.press('w');
  await expect(canvas).toHaveAttribute('data-transform-mode', 'translate');
});

test('manipulation gizmo drag mutates runtime only, disables orbit, then commits once', async ({
  page,
}) => {
  const canvas = await openManipulation(page);
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await expect(canvas).toHaveAttribute(
    'data-transform-object',
    /scene-object:/,
  );
  await expect(canvas).toHaveAttribute('data-gizmo-origin', /\d/);
  const runtimeCameraBefore = await canvas.getAttribute('data-runtime-camera');
  const documentCameraBefore = await page.evaluate(() =>
    structuredClone(
      (
        globalThis as unknown as ManipulationBridge
      ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
    ),
  );

  const before = await page.evaluate(() => {
    const global = globalThis as unknown as ManipulationBridge;
    const store = global.__I2V_EDITOR_STORE__;
    if (store === undefined) throw new Error('E2E editor store가 없습니다.');
    global.__MANIPULATION_DOCUMENT_CHANGES__ = 0;
    store.subscribe((state, previous) => {
      const selectedId = state.selectedObjectId ?? previous.selectedObjectId;
      const current = state.document.objects.find(
        ({ id }) => id === selectedId,
      );
      const prior = previous.document.objects.find(
        ({ id }) => id === selectedId,
      );
      if (
        current !== undefined &&
        prior !== undefined &&
        JSON.stringify(current.transform) !== JSON.stringify(prior.transform)
      ) {
        global.__MANIPULATION_DOCUMENT_CHANGES__ =
          (global.__MANIPULATION_DOCUMENT_CHANGES__ ?? 0) + 1;
      }
    });
    const selected = store
      .getState()
      .document.objects.find(
        ({ id }) => id === store.getState().selectedObjectId,
      );
    if (selected === undefined) throw new Error('선택 object가 없습니다.');
    return structuredClone(selected.transform);
  });

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const xAxis = await findGizmoAxis(page, canvas, 'X');
  const origin = JSON.parse(
    (await canvas.getAttribute('data-gizmo-origin')) ?? 'null',
  ) as { x: number; y: number };

  await page.mouse.move(box.x + origin.x + xAxis.x, box.y + origin.y + xAxis.y);
  await page.mouse.down();
  await page.mouse.move(
    box.x + origin.x + xAxis.x + 60,
    box.y + origin.y + xAxis.y,
    { steps: 10 },
  );

  await expect(canvas).toHaveAttribute('data-transform-dragging', 'true');
  await expect(canvas).toHaveAttribute('data-orbit-enabled', 'false');
  expect(
    await page.evaluate(() => {
      const global = globalThis as unknown as ManipulationBridge;
      const state = global.__I2V_EDITOR_STORE__?.getState();
      const selected = state?.document.objects.find(
        ({ id }) => id === state.selectedObjectId,
      );
      return {
        transform: structuredClone(selected?.transform),
        inProgress: state?.inProgressTransform !== null,
      };
    }),
  ).toEqual({ transform: before, inProgress: true });
  expect(
    await page.evaluate(() =>
      structuredClone(
        (
          globalThis as unknown as ManipulationBridge
        ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
      ),
    ),
  ).toEqual(documentCameraBefore);
  expect(await canvas.getAttribute('data-runtime-camera')).toBe(
    runtimeCameraBefore,
  );
  await expect.poll(() => runtimeTransform(canvas)).not.toEqual(before);

  await page.mouse.up();

  await expect(canvas).toHaveAttribute('data-transform-dragging', 'false');
  await expect(canvas).toHaveAttribute('data-orbit-enabled', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const global = globalThis as unknown as ManipulationBridge;
        const state = global.__I2V_EDITOR_STORE__?.getState();
        return state?.document.objects.find(
          ({ id }) => id === state.selectedObjectId,
        )?.transform;
      }),
    )
    .not.toEqual(before);
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as ManipulationBridge)
          .__MANIPULATION_DOCUMENT_CHANGES__,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as ManipulationBridge
        ).__I2V_EDITOR_STORE__?.getState().inProgressTransform,
    ),
  ).toBeNull();
  expect(
    await page.evaluate(() =>
      structuredClone(
        (
          globalThis as unknown as ManipulationBridge
        ).__I2V_EDITOR_STORE__?.getState().document.outputCamera,
      ),
    ),
  ).toEqual(documentCameraBefore);
  expect(await canvas.getAttribute('data-runtime-camera')).toBe(
    runtimeCameraBefore,
  );
});

test('manipulation Escape cancels an active gizmo drag and restores orbit', async ({
  page,
}) => {
  const canvas = await openManipulation(page);
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-gizmo-origin', /\d/);
  const before = await selectedTransform(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const xAxis = await findGizmoAxis(page, canvas, 'X');
  const origin = JSON.parse(
    (await canvas.getAttribute('data-gizmo-origin')) ?? 'null',
  ) as { x: number; y: number };

  await page.mouse.move(box.x + origin.x + xAxis.x, box.y + origin.y + xAxis.y);
  await page.mouse.down();
  await page.mouse.move(
    box.x + origin.x + xAxis.x + 40,
    box.y + origin.y + xAxis.y,
    { steps: 6 },
  );
  await expect(canvas).toHaveAttribute('data-transform-dragging', 'true');
  await expect.poll(() => runtimeTransform(canvas)).not.toEqual(before);
  await page.keyboard.press('Escape');

  await expect(
    page.getByRole('button', { name: 'Mannequin', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(canvas).toHaveAttribute('data-orbit-enabled', 'true');
  expect(
    await page.evaluate(
      () =>
        (
          globalThis as unknown as ManipulationBridge
        ).__I2V_EDITOR_STORE__?.getState().inProgressTransform,
    ),
  ).toBeNull();
  await page.mouse.up();
  await page.getByRole('button', { name: 'Mannequin', exact: true }).click();
  await expect.poll(() => runtimeTransform(canvas)).toEqual(before);
  expect(await selectedTransform(page)).toEqual(before);
});

for (const subject of [
  { label: 'Cube', addLabel: '큐브 추가', root: /scene-object:/ },
  {
    label: 'Mannequin',
    addLabel: null,
    root: 'scene-object:starter-mannequin',
  },
] as const) {
  test(`manipulation ${subject.label} root를 실제 translate/scale/rotate하고 Inspector와 동기화한다`, async ({
    page,
  }) => {
    const canvas = await openManipulation(page);
    if (subject.addLabel === null) {
      await page
        .getByRole('button', { name: subject.label, exact: true })
        .click();
    } else {
      await page.getByRole('button', { name: subject.addLabel }).click();
    }
    await expect(canvas).toHaveAttribute('data-transform-object', subject.root);
    await page.getByRole('button', { name: '카메라' }).click();
    await page.getByRole('button', { name: '선택 프레임 맞춤' }).click();
    await expect(page.locator('.status-bar')).toContainText(
      `${subject.label}을 프레임에 맞췄습니다.`,
    );
    await expect
      .poll(async () => {
        const origin = JSON.parse(
          (await canvas.getAttribute('data-gizmo-origin')) ?? 'null',
        ) as { x: number; y: number } | null;
        const box = await canvas.boundingBox();
        return (
          origin !== null &&
          box !== null &&
          origin.x >= 0 &&
          origin.x <= box.width &&
          origin.y >= 0 &&
          origin.y <= box.height
        );
      })
      .toBe(true);
    await page.getByRole('button', { name: '장면', exact: true }).click();

    const beforeTranslate = await selectedTransform(page);
    await page.keyboard.press('w');
    const translateHandle = await findGizmoAxis(page, canvas, 'X');
    await dragGizmo(page, canvas, translateHandle, {
      x: translateHandle.x + Math.sign(translateHandle.x || 1) * 40,
      y: translateHandle.y,
    });
    const translated = await selectedTransform(page);
    expect(translated.position.x).not.toBeCloseTo(beforeTranslate.position.x);
    await expect(page.getByLabel('위치 X')).toHaveValue(
      String(translated.position.x),
    );

    await page.keyboard.press('r');
    const beforeScale = await selectedTransform(page);
    const scaleHandle = await findGizmoAxis(page, canvas, 'X');
    await dragGizmo(page, canvas, scaleHandle, {
      x: scaleHandle.x + Math.sign(scaleHandle.x || 1) * 30,
      y: scaleHandle.y,
    });
    const scaled = await selectedTransform(page);
    expect(scaled.scale.x).not.toBeCloseTo(beforeScale.scale.x);
    expect(scaled.scale.x).toBeGreaterThan(0);
    await expect(page.getByLabel('크기 X')).toHaveValue(String(scaled.scale.x));

    await page.keyboard.press('e');
    const beforeRotate = await selectedTransform(page);
    const rotateHandle = await findGizmoAxis(page, canvas, 'Z');
    await rotateZGizmo(page, canvas, rotateHandle);
    const rotated = await selectedTransform(page);
    expect(rotated.rotationDeg).not.toEqual(beforeRotate.rotationDeg);
    await expect(page.getByLabel('회전 Z')).toHaveValue(
      String(rotated.rotationDeg.z),
    );
  });
}

test('manipulation object controls, duplicate/delete shortcuts, and focus guards work in the browser', async ({
  page,
}) => {
  await openManipulation(page);
  await page.getByRole('button', { name: '큐브 추가' }).click();
  const cubeRow = page.getByRole('button', { name: 'Cube', exact: true });
  await expect(cubeRow).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('색상').evaluate((input) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as object,
      'value',
    )?.set;
    valueSetter?.call(input, '#123456');
    const EventConstructor = input.ownerDocument.defaultView?.Event;
    if (EventConstructor === undefined)
      throw new Error('Event constructor가 없습니다.');
    input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    input.dispatchEvent(new EventConstructor('change', { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis as unknown as ManipulationBridge).__I2V_EDITOR_STORE__
            ?.getState()
            .document.objects.find(({ kind }) => kind === 'cube')?.color,
      ),
    )
    .toBe('#123456');
  await page.getByRole('checkbox', { name: '표시' }).click();
  await expect(cubeRow).toContainText('○');

  const positionX = page.getByLabel('위치 X');
  await positionX.focus();
  await page.keyboard.press('e');
  await page.keyboard.press('Delete');
  await expect(cubeRow).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '이동 (W)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  for (const target of ['textarea', 'contenteditable'] as const) {
    await page.locator('body').evaluate((body, kind) => {
      const element = body.ownerDocument.createElement(
        kind === 'textarea' ? 'textarea' : 'div',
      );
      if (kind === 'contenteditable') element.contentEditable = 'true';
      element.dataset.focusGuardProbe = kind;
      body.append(element);
      element.focus();
    }, target);
    await page.keyboard.press('Delete');
    await expect(cubeRow).toHaveAttribute('aria-pressed', 'true');
  }

  await page.getByLabel('화면비').focus();
  await page.keyboard.press('r');
  await expect(page.getByRole('button', { name: '이동 (W)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await cubeRow.click();
  await page.keyboard.press('Control+d');
  const copyRow = page.getByRole('button', { name: 'Cube copy', exact: true });
  await expect(copyRow).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Delete');
  await expect(copyRow).toHaveCount(0);

  const cube = await page.evaluate(() =>
    (globalThis as unknown as ManipulationBridge).__I2V_EDITOR_STORE__
      ?.getState()
      .document.objects.find(({ kind }) => kind === 'cube'),
  );
  expect(cube).toMatchObject({ color: '#123456', visible: false });
});
