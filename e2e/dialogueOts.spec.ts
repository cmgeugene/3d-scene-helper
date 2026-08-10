import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createCinematicSubjectProfile } from '../src/editor/cinematography/cinematicSubjectProfile';
import { solveDialogueOts } from '../src/editor/cinematography/dialogueOtsSolver';
import { computeCinematicProjectionMetrics } from '../src/editor/cinematography/projectionMetrics';
import {
  createSceneObject,
  createStarterSceneDocument,
  type SceneDocument,
} from '../src/editor/persistence/sceneSchema';

function fixture(shoulderSide: 'left' | 'right') {
  const document = createStarterSceneDocument({
    documentId: `dialogue-ots-${shoulderSide}`,
    floorId: `dialogue-floor-${shoulderSide}`,
    mannequinId: `unused-${shoulderSide}`,
  });
  const subject = createSceneObject(`speaker-${shoulderSide}`, {
    kind: 'mannequin',
    name: 'Speaker',
    position: { x: 0.15, z: -0.25 },
  });
  subject.transform.rotationDeg.y = 180;
  subject.color = '#c69b6d';
  const foreground = createSceneObject(`listener-${shoulderSide}`, {
    kind: 'mannequin',
    name: 'Foreground listener',
    position: { x: -0.15, z: 0.75 },
  });
  foreground.color = '#6f5142';
  const subjectProfile = createCinematicSubjectProfile(subject);
  const foregroundProfile = createCinematicSubjectProfile(foreground);
  if (subjectProfile === null || foregroundProfile === null) {
    throw new Error('dialogue profiles are required');
  }
  const result = solveDialogueOts({
    subject: subjectProfile,
    foreground: foregroundProfile,
    shoulderSide,
    axisSidePolicy: {
      mode: 'preserve',
      continuitySign: shoulderSide === 'left' ? 1 : -1,
    },
    shotSize: 'medium-close',
    intensity: 0.55,
    lensMm: 50,
    outputAspect: 16 / 9,
  });
  const candidate = result.candidates[0];
  if (candidate === undefined)
    throw new Error('accepted OTS candidate required');
  document.objects = [document.objects[0], foreground, subject];
  document.outputCamera = candidate.camera;
  document.output = {
    aspectRatioId: '16:9',
    width: 1920,
    height: 1080,
    mode: 'clean',
  };
  return {
    candidate,
    document,
    foreground,
    foregroundMetrics: computeCinematicProjectionMetrics(
      foregroundProfile,
      candidate.camera,
      16 / 9,
    ),
    subject,
    subjectMetrics: computeCinematicProjectionMetrics(
      subjectProfile,
      candidate.camera,
      16 / 9,
    ),
  };
}

async function openFixture(page: Page, document: SceneDocument) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveAttribute(
    'data-webgl-state',
    'available',
  );
  await page.evaluate((nextDocument) => {
    const state = globalThis.__I2V_EDITOR_STORE__?.getState() as unknown as
      | {
          replaceDocument: (
            document: SceneDocument,
            persisted: boolean,
          ) => void;
        }
      | undefined;
    if (state === undefined)
      throw new Error('E2E editor store is unavailable.');
    state.replaceDocument(nextDocument, false);
  }, document);
  const canvas = page.locator('canvas[data-engine]');
  const frame = page.locator('[data-camera-frame]');
  await expect(canvas).toBeVisible();
  await expect(frame).toHaveAttribute('data-output-aspect', String(16 / 9));
  await expect
    .poll(async () => {
      const raw = await canvas.getAttribute('data-runtime-camera');
      if (raw === null) return null;
      const runtime = JSON.parse(raw) as {
        position: { x: number; y: number; z: number };
      };
      return [runtime.position.x, runtime.position.y, runtime.position.z].map(
        (value) => Number(value.toFixed(5)),
      );
    })
    .toEqual(
      [
        document.outputCamera.position.x,
        document.outputCamera.position.y,
        document.outputCamera.position.z,
      ].map((value) => Number(value.toFixed(5))),
    );
  return { canvas, frame };
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

function changedBounds(
  visible: Buffer,
  hidden: Buffer,
  region: { x: number; y: number; width: number; height: number },
) {
  const first = PNG.sync.read(visible);
  const second = PNG.sync.read(hidden);
  expect([second.width, second.height]).toEqual([first.width, first.height]);
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

async function setVisibility(page: Page, id: string, visible: boolean) {
  await page.evaluate(
    ({ objectId, nextVisible }) => {
      const state = globalThis.__I2V_EDITOR_STORE__?.getState();
      if (state === undefined)
        throw new Error('E2E editor store is unavailable.');
      state.setObjectVisibility(objectId, nextVisible);
    },
    { objectId: id, nextVisible: visible },
  );
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

test.describe
  .serial('deterministic dialogue OTS output-camera evidence', () => {
  for (const shoulderSide of ['left', 'right'] as const) {
    test(`${shoulderSide} shoulder reads as a real WebGL OTS`, async ({
      page,
    }, testInfo) => {
      const current = fixture(shoulderSide);
      const { canvas, frame } = await openFixture(page, current.document);
      const canvasBox = await canvas.boundingBox();
      const frameBox = await frame.boundingBox();
      if (canvasBox === null || frameBox === null) {
        throw new Error('Canvas/output frame bounds are unavailable.');
      }
      const visible = await canvas.screenshot();
      await page.screenshot({
        path: testInfo.outputPath(
          `dialogue-ots-${shoulderSide}-candidate-before-assertions-1280x720.png`,
        ),
      });

      await setVisibility(page, current.foreground.id, false);
      const foregroundHidden = await canvas.screenshot();
      await setVisibility(page, current.foreground.id, true);
      const fgHead = toCanvasPoint(
        current.foregroundMetrics.landmarks.headTop.ndc,
        canvasBox,
        frameBox,
      );
      const fgChest = toCanvasPoint(
        current.foregroundMetrics.landmarks.chest.ndc,
        canvasBox,
        frameBox,
      );
      const frameX = frameBox.x - canvasBox.x;
      const frameY = frameBox.y - canvasBox.y;
      const foregroundPixels = changedBounds(visible, foregroundHidden, {
        x: frameX,
        y: Math.max(frameY, Math.min(fgHead.y, fgChest.y) - 24),
        width: frameBox.width,
        height: Math.abs(fgChest.y - fgHead.y) + 80,
      });
      const foregroundWidth =
        (foregroundPixels.maxX - foregroundPixels.minX + 1) / frameBox.width;
      const expectedFrameEdge =
        shoulderSide === 'left' ? frameX + frameBox.width : frameX;
      const foregroundEdgeDistance =
        shoulderSide === 'left'
          ? Math.abs(expectedFrameEdge - foregroundPixels.maxX)
          : Math.abs(foregroundPixels.minX - expectedFrameEdge);

      expect(foregroundPixels.count).toBeGreaterThan(700);
      expect(foregroundEdgeDistance).toBeLessThan(12);
      expect(foregroundWidth).toBeGreaterThanOrEqual(0.15);
      expect(foregroundWidth).toBeLessThanOrEqual(0.3);

      await setVisibility(page, current.subject.id, false);
      const subjectHidden = await canvas.screenshot();
      await setVisibility(page, current.subject.id, true);
      const faceTop = toCanvasPoint(
        current.subjectMetrics.landmarks.headTop.ndc,
        canvasBox,
        frameBox,
      );
      const faceBottom = toCanvasPoint(
        current.subjectMetrics.landmarks.neck.ndc,
        canvasBox,
        frameBox,
      );
      const faceLeft = toCanvasPoint(
        current.subjectMetrics.landmarks.headLeft.ndc,
        canvasBox,
        frameBox,
      );
      const faceRight = toCanvasPoint(
        current.subjectMetrics.landmarks.headRight.ndc,
        canvasBox,
        frameBox,
      );
      const facePixels = changedBounds(visible, subjectHidden, {
        x: Math.min(faceLeft.x, faceRight.x) - 10,
        y: Math.min(faceTop.y, faceBottom.y) - 10,
        width: Math.abs(faceRight.x - faceLeft.x) + 20,
        height: Math.abs(faceBottom.y - faceTop.y) + 20,
      });
      expect(facePixels.count).toBeGreaterThan(180);
      expect(current.candidate.diagnostics).toMatchObject({
        accepted: true,
        foregroundEdge: shoulderSide === 'left' ? 'right' : 'left',
        foregroundTorsoWall: false,
        nearPlaneSafe: true,
        axisContinuity: true,
      });
      expect(current.candidate.diagnostics.faceOcclusion).toBeLessThanOrEqual(
        0.18,
      );
      expect(current.candidate.diagnostics.subjectHeadroom).toBeGreaterThan(0);
      expect(current.candidate.diagnostics.subjectLookRoom).toBeGreaterThan(0);

      await page.evaluate(
        ({ side, score, occupancy }) => {
          type EvidenceElement = {
            dataset: Record<string, string>;
            style: Record<string, string>;
            textContent: string | null;
            append: (...nodes: EvidenceElement[]) => void;
          };
          const browser = globalThis as unknown as {
            document: {
              querySelector: (selector: string) => EvidenceElement | null;
              createElement: (tagName: string) => EvidenceElement;
            };
          };
          const outputFrame = browser.document.querySelector(
            '[data-camera-frame]',
          );
          if (outputFrame === null)
            throw new Error('Output frame is unavailable.');
          const label = browser.document.createElement('div');
          label.dataset.dialogueOtsEvidence = side;
          label.textContent = `${side.toUpperCase()} SHOULDER OTS · SCORE ${score.toFixed(2)} · FOREGROUND ${Math.round(occupancy * 100)}%`;
          Object.assign(label.style, {
            position: 'absolute',
            left: '8px',
            top: '8px',
            zIndex: '5',
            color: '#ffffff',
            background: 'rgb(0 0 0 / 78%)',
            border: '1px solid #57e3ff',
            padding: '5px 8px',
            font: '700 10px/1.2 monospace',
            pointerEvents: 'none',
          });
          outputFrame.append(label);
        },
        {
          side: shoulderSide,
          score: current.candidate.score,
          occupancy: current.candidate.diagnostics.foregroundWidthOccupancy,
        },
      );
      await page.screenshot({
        path: testInfo.outputPath(
          `dialogue-ots-${shoulderSide}-output-camera-1280x720.png`,
        ),
      });
      expect(await page.locator('body').screenshot()).not.toEqual(
        Buffer.alloc(0),
      );
    });
  }
});
