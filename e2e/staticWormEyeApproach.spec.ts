import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { createCinematicSubjectProfile } from '../src/editor/cinematography/cinematicSubjectProfile';
import {
  solveStaticWormEyeApproach,
  validateStaticWormEyeApproach,
  type StaticWormEyeApproachProposal,
} from '../src/editor/cinematography/staticWormEyeApproachSolver';
import {
  createSceneObject,
  createStarterSceneDocument,
  type SceneDocument,
  type SceneObject,
} from '../src/editor/persistence/sceneSchema';

const OUTPUT_ASPECT = 16 / 9;
const FLOOR_TOP_Y = 0.05;
const RUNNER_ID = 's16-static-wormeye-runner';
const FLOOR_ID = 's16-static-wormeye-floor';

const runtimeVec = (point: { x: number; y: number; z: number }) => ({
  x: Number(point.x.toFixed(6)),
  y: Number(point.y.toFixed(6)),
  z: Number(point.z.toFixed(6)),
});

function customRunningObject() {
  const runner = createSceneObject(RUNNER_ID, {
    kind: 'mannequin',
    name: 'S16 orange sprint runner',
    position: { x: 0.35, z: 1.1 },
  });
  runner.transform.position.y = 0.85;
  runner.transform.rotationDeg.y = 32;
  runner.color = '#f05a28';
  if (runner.mannequinPose === undefined)
    throw new Error('runner pose required');
  runner.mannequinPose = {
    ...structuredClone(runner.mannequinPose),
    id: 'custom',
    torsoRotationDeg: { x: -22, y: 0, z: -6 },
    headRotationDeg: { x: 14, y: 0, z: 6 },
    arms: {
      left: {
        ...runner.mannequinPose.arms.left,
        shoulderRotationDeg: { x: 38, y: -12, z: -16 },
        elbowBendDeg: 100,
      },
      right: {
        ...runner.mannequinPose.arms.right,
        shoulderRotationDeg: { x: -32, y: 12, z: 16 },
        elbowBendDeg: 105,
      },
    },
    legs: {
      left: {
        ...runner.mannequinPose.legs.left,
        hipRotationDeg: { x: -18, y: -4, z: -3 },
        kneeBendDeg: 22,
        ankleRotationDeg: { x: 18, y: 0, z: 0 },
      },
      right: {
        ...runner.mannequinPose.legs.right,
        hipRotationDeg: { x: 55, y: 10, z: 15 },
        kneeBendDeg: 115,
        ankleRotationDeg: { x: -20, y: 0, z: 0 },
      },
    },
  };
  return runner;
}

function standingObject() {
  const runner = createSceneObject('s16-rejected-standing-runner', {
    kind: 'mannequin',
    name: 'S16 rejected standing control',
    position: { x: 0, z: 0 },
  });
  runner.transform.position.y = 0.85;
  runner.color = '#a33b2b';
  return runner;
}

function solveForObject(object: SceneObject) {
  const profile = createCinematicSubjectProfile(object);
  if (profile === null) throw new Error('cinematic mannequin profile required');
  return solveStaticWormEyeApproach({
    subject: profile,
    motionDirection: { x: 0, y: 0, z: -1 },
    actionPhase: 'support-contact',
    supportFoot: 'left',
    floorTopY: FLOOR_TOP_Y,
    groundClearanceM: 0.006,
    lensMm: 24,
    cameraHeightM: 0.08,
    outputAspect: OUTPUT_ASPECT,
    targetOccupancy: 0.75,
    intensity: 0.72,
    cameraMotion: 'none',
  });
}

function applyProposal(
  object: SceneObject,
  proposal: StaticWormEyeApproachProposal,
) {
  const copy = structuredClone(object);
  copy.transform.rotationDeg.y += proposal.subjectStaging.yawDeltaDeg;
  copy.transform.position.x += proposal.subjectStaging.translationDelta.x;
  copy.transform.position.y += proposal.subjectStaging.translationDelta.y;
  copy.transform.position.z += proposal.subjectStaging.translationDelta.z;
  return copy;
}

function floorObject() {
  const floor = createSceneObject(FLOOR_ID, {
    kind: 'floor',
    name: 'S16 long approach floor',
    position: { x: 0, z: 4 },
  });
  floor.transform.position.y = 0;
  floor.dimensions = { x: 12, y: 0.1, z: 18 };
  floor.color = '#7f93a6';
  return floor;
}

function documentFor(
  runner: SceneObject,
  proposal: StaticWormEyeApproachProposal,
  documentId: string,
) {
  const document = createStarterSceneDocument({
    documentId,
    floorId: `${documentId}-unused-floor`,
    mannequinId: `${documentId}-unused-runner`,
  });
  document.objects = [floorObject(), applyProposal(runner, proposal)];
  document.outputCamera = proposal.camera;
  document.output = {
    aspectRatioId: '16:9',
    width: 1280,
    height: 720,
    mode: 'clean',
  };
  document.background.color = '#203040';
  return document;
}

async function waitTwoFrames(page: Page) {
  await page.evaluate(() => {
    const browser = globalThis as unknown as {
      requestAnimationFrame: (callback: () => void) => number;
    };
    return new Promise<void>((resolve) =>
      browser.requestAnimationFrame(() =>
        browser.requestAnimationFrame(() => resolve()),
      ),
    );
  });
}

async function replaceDocument(page: Page, document: SceneDocument) {
  await page.evaluate((nextDocument) => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as
      | {
          replaceDocument: (
            document: SceneDocument,
            persisted: boolean,
          ) => void;
        }
      | undefined;
    if (state === undefined) throw new Error('E2E editor store is unavailable');
    state.replaceDocument(nextDocument, false);
  }, document);
  await waitTwoFrames(page);
}

async function setVisibility(page: Page, id: string, visible: boolean) {
  await page.evaluate(
    ({ objectId, nextVisible }) => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState();
      if (state === undefined)
        throw new Error('E2E editor store is unavailable');
      state.setObjectVisibility(objectId, nextVisible);
    },
    { objectId: id, nextVisible: visible },
  );
  await waitTwoFrames(page);
}

async function selectObject(page: Page, id: string | null) {
  await page.evaluate((objectId) => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as
      { selectObject: (id: string | null) => void } | undefined;
    if (state === undefined) throw new Error('E2E editor store is unavailable');
    state.selectObject(objectId);
  }, id);
  await waitTwoFrames(page);
}

async function downloadFrame(
  page: Page,
  mode: 'clean' | 'reference',
  filename: string,
) {
  await page.getByRole('button', { name: 'PNG 내보내기' }).click();
  const dialog = page.getByRole('dialog', { name: 'PNG 내보내기' });
  await dialog.getByLabel('해상도').selectOption('1280x720');
  await dialog.getByLabel('파일 이름').fill(filename);
  if (mode === 'reference') {
    await dialog.getByRole('radio', { name: '참조 포함' }).check();
  }
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'PNG 내보내기' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('PNG download path is missing');
  return readFile(path);
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

function changedBounds(
  visible: Buffer,
  hidden: Buffer,
  region: { x: number; y: number; width: number; height: number },
) {
  const first = PNG.sync.read(visible);
  const second = PNG.sync.read(hidden);
  const minRegionX = Math.max(0, Math.floor(region.x));
  const minRegionY = Math.max(0, Math.floor(region.y));
  const maxRegionX = Math.min(first.width, Math.ceil(region.x + region.width));
  const maxRegionY = Math.min(
    first.height,
    Math.ceil(region.y + region.height),
  );
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (let y = minRegionY; y < maxRegionY; y += 1) {
    for (let x = minRegionX; x < maxRegionX; x += 1) {
      const index = (y * first.width + x) * 4;
      const delta =
        Math.abs(first.data[index] - second.data[index]) +
        Math.abs(first.data[index + 1] - second.data[index + 1]) +
        Math.abs(first.data[index + 2] - second.data[index + 2]);
      if (delta <= 30) continue;
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { count, minX, maxX, minY, maxY };
}

function toCanvasPoint(
  ndc: { x: number; y: number },
  canvasBox: { x: number; y: number },
  frameBox: { x: number; y: number; width: number; height: number },
) {
  return {
    x: frameBox.x - canvasBox.x + ((ndc.x + 1) / 2) * frameBox.width,
    y: frameBox.y - canvasBox.y + ((1 - ndc.y) / 2) * frameBox.height,
  };
}

test('production solver renders an unmistakable static worm-eye running approach in actual WebGL', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const runner = customRunningObject();
  const solved = solveForObject(runner);
  const proposal = solved.proposal;
  expect(solved.accepted).toBe(true);
  expect(validateStaticWormEyeApproach(solved)).toEqual({
    valid: true,
    reasons: [],
  });
  if (proposal === null) throw new Error('accepted worm-eye proposal required');

  const stagedRunner = applyProposal(runner, proposal);
  const stagedProfile = createCinematicSubjectProfile(stagedRunner);
  if (stagedProfile === null) throw new Error('staged runner profile required');
  for (const key of [
    'faceCenter',
    'pelvis',
    'leftFoot',
    'rightKnee',
  ] as const) {
    expect(stagedProfile.landmarks[key].x).toBeCloseTo(
      proposal.transformedSubject.landmarks[key].x,
      6,
    );
    expect(stagedProfile.landmarks[key].y).toBeCloseTo(
      proposal.transformedSubject.landmarks[key].y,
      6,
    );
    expect(stagedProfile.landmarks[key].z).toBeCloseTo(
      proposal.transformedSubject.landmarks[key].z,
      6,
    );
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  const canvas = page.locator('canvas[data-engine]');
  const frame = page.locator('[data-camera-frame]');
  await expect(canvas).toBeVisible();

  const standing = standingObject();
  const rejected = solveForObject(standing);
  expect(rejected.accepted).toBe(false);
  expect(rejected.diagnostics.failureReasons).toContain(
    'invalid-action-silhouette',
  );
  const rejectedCandidate = rejected.diagnostics.rejected[0];
  if (rejectedCandidate === undefined)
    throw new Error('rejected standing candidate required');
  await replaceDocument(
    page,
    documentFor(standing, rejectedCandidate, 's16-rejected-standing-document'),
  );
  await page.screenshot({
    path: testInfo.outputPath(
      'S16-static-wormeye-approach-rejected-standing-output-camera-1280x720.png',
    ),
  });

  const document = documentFor(
    runner,
    proposal,
    's16-accepted-wormeye-document',
  );
  await replaceDocument(page, document);
  await expect(frame).toHaveAttribute(
    'data-output-aspect',
    String(OUTPUT_ASPECT),
  );
  await expect
    .poll(async () => {
      const raw = await canvas.getAttribute('data-runtime-camera');
      return raw === null ? null : JSON.parse(raw);
    })
    .toMatchObject({
      position: runtimeVec(proposal.camera.position),
      target: runtimeVec(proposal.camera.target),
      focalLengthMm: 24,
      outputAspect: Number(OUTPUT_ASPECT.toFixed(6)),
      rotationZDeg: 0,
    });
  expect(proposal.camera.position.y).toBe(0.08);
  expect(proposal.cameraMotion).toBe('none');

  const canvasBox = await canvas.boundingBox();
  const frameBox = await frame.boundingBox();
  if (canvasBox === null || frameBox === null) {
    throw new Error('Canvas/output-frame bounds are unavailable');
  }
  const frameRegion = {
    x: frameBox.x - canvasBox.x,
    y: frameBox.y - canvasBox.y,
    width: frameBox.width,
    height: frameBox.height,
  };
  const visible = await canvas.screenshot();
  await setVisibility(page, RUNNER_ID, false);
  const subjectHidden = await canvas.screenshot();
  await setVisibility(page, RUNNER_ID, true);
  const subjectPixels = changedBounds(visible, subjectHidden, frameRegion);
  const subjectHeight =
    (subjectPixels.maxY - subjectPixels.minY + 1) / frameRegion.height;
  expect(subjectPixels.count).toBeGreaterThan(4_000);
  expect(subjectHeight).toBeGreaterThanOrEqual(0.55);
  expect(subjectHeight).toBeLessThanOrEqual(0.9);

  for (const [name, y, height] of [
    ['upper', frameRegion.y, frameRegion.height * 0.4],
    [
      'middle',
      frameRegion.y + frameRegion.height * 0.3,
      frameRegion.height * 0.4,
    ],
    [
      'lower',
      frameRegion.y + frameRegion.height * 0.6,
      frameRegion.height * 0.4,
    ],
  ] as const) {
    expect(
      changedBounds(visible, subjectHidden, {
        x: frameRegion.x,
        y,
        width: frameRegion.width,
        height,
      }).count,
      `${name} running-silhouette band must contain isolated subject pixels`,
    ).toBeGreaterThan(250);
  }

  await setVisibility(page, FLOOR_ID, false);
  const floorHidden = await canvas.screenshot();
  await setVisibility(page, FLOOR_ID, true);
  const floorPixels = changedBounds(visible, floorHidden, {
    x: frameRegion.x,
    y: frameRegion.y + frameRegion.height * 0.55,
    width: frameRegion.width,
    height: frameRegion.height * 0.45,
  });
  expect(floorPixels.count).toBeGreaterThan(2_000);

  const supportPoint = toCanvasPoint(
    proposal.metrics.landmarks.leftFoot.ndc,
    canvasBox,
    frameBox,
  );
  expect(
    changedBounds(visible, subjectHidden, {
      x: supportPoint.x - 26,
      y: supportPoint.y - 26,
      width: 52,
      height: 52,
    }).count,
  ).toBeGreaterThan(30);
  expect(proposal.diagnostics.supportFootWorldY).toBeCloseTo(0.056, 6);
  expect(proposal.diagnostics.supportContactErrorM).toBe(0);
  expect(proposal.diagnostics.freeFootClearanceM).toBeGreaterThanOrEqual(0.12);

  await selectObject(page, RUNNER_ID);
  await expect(canvas).toHaveAttribute('data-mannequin-pose', 'custom');
  const outputCameraPath = testInfo.outputPath(
    'S16-static-wormeye-approach-accepted-output-camera-1280x720.png',
  );
  const outputCameraScreenshot = PNG.sync.read(
    await page.screenshot({ path: outputCameraPath }),
  );
  expect([outputCameraScreenshot.width, outputCameraScreenshot.height]).toEqual(
    [1280, 720],
  );

  const selectedCleanBuffer = await downloadFrame(
    page,
    'clean',
    'S16-static-wormeye-approach-accepted-clean',
  );
  const selectedClean = PNG.sync.read(selectedCleanBuffer);
  expect([selectedClean.width, selectedClean.height]).toEqual([1280, 720]);
  await selectObject(page, null);
  const deselectedClean = PNG.sync.read(
    await downloadFrame(page, 'clean', 'S16-static-wormeye-deselected-control'),
  );
  expect(mismatchRatio(selectedClean, deselectedClean)).toBe(0);

  await page.getByRole('checkbox', { name: '3분할선' }).check();
  const reference = PNG.sync.read(
    await downloadFrame(
      page,
      'reference',
      'S16-static-wormeye-reference-control',
    ),
  );
  expect(mismatchRatio(selectedClean, reference)).toBeGreaterThan(0.001);
  const cleanPath = testInfo.outputPath(
    'S16-static-wormeye-approach-accepted-clean-1280x720.png',
  );
  await writeFile(cleanPath, selectedCleanBuffer);

  expect(proposal.metrics.occupancy.height).toBeGreaterThanOrEqual(0.65);
  expect(proposal.metrics.occupancy.height).toBeLessThanOrEqual(0.85);
  expect(proposal.diagnostics.approachAlignment).toBeGreaterThanOrEqual(0.985);
  expect(proposal.diagnostics.upwardPitchDeg).toBeGreaterThanOrEqual(12);
  expect(proposal.diagnostics.groundRoom).toBeGreaterThanOrEqual(0.025);
  expect(proposal.diagnostics.opposingLimbPhase).toBe(true);
  expect(proposal.diagnostics.pelvisDominanceRatio).toBeLessThanOrEqual(1.5);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  console.info(
    'S16_STATIC_WORMEYE_APPROACH_EVIDENCE',
    JSON.stringify({
      candidateId: proposal.id,
      score: proposal.score,
      camera: proposal.camera,
      cameraMotion: proposal.cameraMotion,
      subjectStaging: proposal.subjectStaging,
      diagnostics: proposal.diagnostics,
      projectedOccupancy: proposal.metrics.occupancy,
      subjectPixelCount: subjectPixels.count,
      subjectPixelHeight: subjectHeight,
      floorBottomPixelCount: floorPixels.count,
    }),
  );
});
