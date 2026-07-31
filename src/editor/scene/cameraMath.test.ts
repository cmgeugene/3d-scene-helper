import { describe, expect, it } from 'vitest';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { FILM_GAUGE_MM } from '../constants';
import { CAMERA_SHOT_PRESETS, CAMERA_VIEW_PRESETS } from '../presets/cameras';
import {
  applyOutputCameraProjection,
  applyViewportCameraProjection,
  computeCameraShot,
  computeCameraView,
  computeFrameSelectedCamera,
  computeLetterbox,
  computeLookAtSelectedCamera,
} from './cameraMath';

const SUBJECT_BOUNDS = {
  min: { x: -0.25, y: 0, z: -0.15 },
  max: { x: 0.25, y: 1.7, z: 0.15 },
  size: { x: 0.5, y: 1.7, z: 0.3 },
  center: { x: 0, y: 0.85, z: 0 },
};

const OUTPUT_CAMERA = {
  position: { x: 0, y: 1.6, z: 5 },
  target: { x: 0, y: 1.6, z: 0 },
  focalLengthMm: 50,
  rollDeg: 0,
};

function projectBounds(
  bounds: typeof SUBJECT_BOUNDS,
  cameraData: typeof OUTPUT_CAMERA,
  aspect: number,
) {
  const camera = new PerspectiveCamera();
  camera.position.set(
    cameraData.position.x,
    cameraData.position.y,
    cameraData.position.z,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(cameraData.target.x, cameraData.target.y, cameraData.target.z);
  camera.rotateZ(MathUtils.degToRad(cameraData.rollDeg));
  applyOutputCameraProjection(camera, aspect, cameraData.focalLengthMm);
  camera.updateMatrixWorld(true);

  return [bounds.min.x, bounds.max.x].flatMap((x) =>
    [bounds.min.y, bounds.max.y].flatMap((y) =>
      [bounds.min.z, bounds.max.z].map((z) =>
        new Vector3(x, y, z).project(camera),
      ),
    ),
  );
}

describe('computeLetterbox', () => {
  it.each([
    ['16:9', 16 / 9, { x: 0, y: 0, width: 1280, height: 720 }],
    ['9:16', 9 / 16, { x: 437.5, y: 0, width: 405, height: 720 }],
    ['1:1', 1, { x: 280, y: 0, width: 720, height: 720 }],
    ['2.39:1', 2.39, { x: 0, y: 92.217573, width: 1280, height: 535.564854 }],
  ])(
    '%s output을 1280×720 viewport 안에 contain한다',
    (_, aspect, expected) => {
      const rectangle = computeLetterbox(1280, 720, aspect);

      expect(rectangle.x).toBeCloseTo(expected.x, 5);
      expect(rectangle.y).toBeCloseTo(expected.y, 5);
      expect(rectangle.width).toBeCloseTo(expected.width, 5);
      expect(rectangle.height).toBeCloseTo(expected.height, 5);
      expect(rectangle.width / rectangle.height).toBeCloseTo(aspect, 10);
    },
  );

  it('유효하지 않은 viewport나 output aspect를 거부한다', () => {
    expect(() => computeLetterbox(0, 720, 16 / 9)).toThrow(RangeError);
    expect(() => computeLetterbox(1280, Number.NaN, 16 / 9)).toThrow(
      RangeError,
    );
    expect(() => computeLetterbox(1280, 720, -1)).toThrow(RangeError);
  });
});

describe('applyOutputCameraProjection', () => {
  it.each([18, 24, 35, 50, 85])(
    'filmGauge 36mm camera에 %imm focal length를 적용한다',
    (focalLengthMm) => {
      const camera = new PerspectiveCamera();

      applyOutputCameraProjection(camera, 9 / 16, focalLengthMm);

      expect(camera.filmGauge).toBe(FILM_GAUGE_MM);
      expect(camera.aspect).toBeCloseTo(9 / 16, 12);
      expect(camera.getFocalLength()).toBeCloseTo(focalLengthMm, 10);
    },
  );
});

describe('applyViewportCameraProjection', () => {
  it.each([16 / 9, 9 / 16, 1, 2.39])(
    '전체 viewport에서 %f 출력 gate 내부가 output projection과 정확히 일치한다',
    (outputAspect) => {
      const viewportWidth = 1280;
      const viewportHeight = 720;
      const frame = computeLetterbox(
        viewportWidth,
        viewportHeight,
        outputAspect,
      );
      const outputCamera = new PerspectiveCamera();
      const viewportCamera = new PerspectiveCamera();

      applyOutputCameraProjection(outputCamera, outputAspect, 50);
      applyViewportCameraProjection(
        viewportCamera,
        viewportWidth,
        viewportHeight,
        outputAspect,
        50,
      );

      const frameScaleX = frame.width / viewportWidth;
      const frameScaleY = frame.height / viewportHeight;
      for (const point of [
        new Vector3(-0.8, -0.5, -5),
        new Vector3(0, 0, -5),
        new Vector3(0.9, 0.7, -5),
      ]) {
        const outputNdc = point.clone().project(outputCamera);
        const viewportNdc = point.clone().project(viewportCamera);
        expect(viewportNdc.x / frameScaleX).toBeCloseTo(outputNdc.x, 10);
        expect(viewportNdc.y / frameScaleY).toBeCloseTo(outputNdc.y, 10);
      }

      expect(viewportCamera.aspect).toBeCloseTo(
        viewportWidth / viewportHeight,
        12,
      );
      expect(viewportCamera.getFocalLength()).toBeCloseTo(50, 10);
    },
  );
});

describe('bounds 기반 camera composition', () => {
  it('6개 방향 view가 -Z 전방 규칙으로 active shot distance, target, lens, roll을 보존한다', () => {
    const activeShot = {
      ...OUTPUT_CAMERA,
      target: { ...SUBJECT_BOUNDS.center },
      focalLengthMm: 85,
      rollDeg: 12,
    };
    const activeDistance = Math.hypot(
      activeShot.position.x - activeShot.target.x,
      activeShot.position.y - activeShot.target.y,
      activeShot.position.z - activeShot.target.z,
    );
    const results = Object.fromEntries(
      CAMERA_VIEW_PRESETS.map((preset) => [
        preset.id,
        computeCameraView(SUBJECT_BOUNDS, activeShot, 16 / 9, preset),
      ]),
    );

    expect(CAMERA_VIEW_PRESETS.map(({ id }) => id)).toEqual([
      'front',
      'rear',
      'left',
      'right',
      'front-three-quarter',
      'rear-three-quarter',
    ]);
    expect(results.front.position.z).toBeLessThan(results.front.target.z);
    expect(results.rear.position.z).toBeGreaterThan(results.rear.target.z);
    expect(results.left.position.x).toBeLessThan(results.left.target.x);
    expect(results.right.position.x).toBeGreaterThan(results.right.target.x);
    expect(results['front-three-quarter'].position.x).toBeGreaterThan(
      results['front-three-quarter'].target.x,
    );
    expect(results['front-three-quarter'].position.z).toBeLessThan(
      results['front-three-quarter'].target.z,
    );
    expect(results['rear-three-quarter'].position.x).toBeLessThan(
      results['rear-three-quarter'].target.x,
    );
    expect(results['rear-three-quarter'].position.z).toBeGreaterThan(
      results['rear-three-quarter'].target.z,
    );
    for (const camera of Object.values(results)) {
      expect(camera.target).toEqual(activeShot.target);
      expect(camera.focalLengthMm).toBe(activeShot.focalLengthMm);
      expect(camera.rollDeg).toBe(activeShot.rollDeg);
      expect(
        Math.hypot(
          camera.position.x - camera.target.x,
          camera.position.y - camera.target.y,
          camera.position.z - camera.target.z,
        ),
      ).toBeCloseTo(activeDistance, 10);
    }
  });

  it('rotates local direction views with the selected subject root', () => {
    const front = CAMERA_VIEW_PRESETS.find(({ id }) => id === 'front');
    if (front === undefined) throw new Error('front view preset이 없습니다.');

    const camera = computeCameraView(
      SUBJECT_BOUNDS,
      { ...OUTPUT_CAMERA, target: { ...SUBJECT_BOUNDS.center } },
      16 / 9,
      front,
      { x: 0, y: 180, z: 0 },
    );

    expect(camera.position.z).toBeGreaterThan(camera.target.z);
    expect(camera.position.x).toBeCloseTo(camera.target.x, 10);
  });

  it('6개 shot preset을 subject bounds에서 계산하고 angle/roll 의미를 보존한다', () => {
    const results = Object.fromEntries(
      CAMERA_SHOT_PRESETS.map((preset) => [
        preset.id,
        computeCameraShot(SUBJECT_BOUNDS, OUTPUT_CAMERA, 16 / 9, preset),
      ]),
    );

    expect(Object.keys(results)).toHaveLength(6);
    expect(results['close-up'].position.z).toBeLessThan(
      results['full-body'].position.z,
    );
    expect(results['low-angle'].position.y).toBeLessThan(
      results['low-angle'].target.y,
    );
    expect(results['high-angle'].position.y).toBeGreaterThan(
      results['high-angle'].target.y,
    );
    expect(results['dutch-angle'].rollDeg).toBe(12);
    for (const camera of Object.values(results)) {
      expect(camera.target.x).toBe(SUBJECT_BOUNDS.center.x);
      expect(camera.target.z).toBe(SUBJECT_BOUNDS.center.z);
      expect(camera.focalLengthMm).toBe(50);
      expect(Number.isFinite(camera.position.z)).toBe(true);
    }
  });

  it('subject bounds가 두 배면 같은 preset framing distance도 두 배가 된다', () => {
    const fullBody = CAMERA_SHOT_PRESETS.find(({ id }) => id === 'full-body');
    expect(fullBody).toBeDefined();
    if (fullBody === undefined) return;
    const base = computeCameraShot(
      SUBJECT_BOUNDS,
      OUTPUT_CAMERA,
      9 / 16,
      fullBody,
    );
    const doubled = computeCameraShot(
      {
        min: { x: -0.5, y: 0, z: -0.3 },
        max: { x: 0.5, y: 3.4, z: 0.3 },
        size: { x: 1, y: 3.4, z: 0.6 },
        center: { x: 0, y: 1.7, z: 0 },
      },
      OUTPUT_CAMERA,
      9 / 16,
      fullBody,
    );

    const baseDistance = Math.hypot(
      base.position.x - base.target.x,
      base.position.y - base.target.y,
      base.position.z - base.target.z,
    );
    const doubledDistance = Math.hypot(
      doubled.position.x - doubled.target.x,
      doubled.position.y - doubled.target.y,
      doubled.position.z - doubled.target.z,
    );
    expect(doubledDistance / baseDistance).toBeCloseTo(2, 10);
  });

  it('bounds가 없으면 1.7m reference height로 shot을 계산한다', () => {
    const preset = CAMERA_SHOT_PRESETS[0];
    const camera = computeCameraShot(null, OUTPUT_CAMERA, 1, preset);

    expect(camera.target).toEqual({ x: 0, y: 1.6, z: 0 });
    expect(camera.position.y).toBeCloseTo(1.6, 10);
    expect(camera.position.z).toBeGreaterThan(0);
  });

  it('full-body preset은 portrait 50mm에서도 subject bounds 전체를 90% frame 안에 contain한다', () => {
    const preset = CAMERA_SHOT_PRESETS.find(({ id }) => id === 'full-body');
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    const camera = computeCameraShot(
      SUBJECT_BOUNDS,
      OUTPUT_CAMERA,
      9 / 16,
      preset,
    );
    const projected = projectBounds(SUBJECT_BOUNDS, camera, 9 / 16);

    for (const corner of projected) {
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(Math.abs(corner.y)).toBeLessThanOrEqual(0.9 + 1e-6);
    }
  });

  it('frame selected는 oblique azimuth와 Dutch roll에서도 bounds를 camera-space로 contain한다', () => {
    const cubeBounds = {
      min: { x: -0.5, y: 0, z: -0.5 },
      max: { x: 0.5, y: 1, z: 0.5 },
      size: { x: 1, y: 1, z: 1 },
      center: { x: 0, y: 0.5, z: 0 },
    };
    const currentCamera = {
      position: { x: 2.5, y: 0.5, z: 4.3301270189 },
      target: cubeBounds.center,
      focalLengthMm: 50,
      rollDeg: 12,
    };

    const framed = computeFrameSelectedCamera(
      cubeBounds,
      currentCamera,
      9 / 16,
    );
    const projected = projectBounds(cubeBounds, framed, 9 / 16);

    for (const corner of projected) {
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(0.85 + 1e-6);
      expect(Math.abs(corner.y)).toBeLessThanOrEqual(0.85 + 1e-6);
    }
  });

  it('frame selected는 bounds 전체를 contain하고 look at은 position을 보존한다', () => {
    const framed = computeFrameSelectedCamera(
      SUBJECT_BOUNDS,
      OUTPUT_CAMERA,
      9 / 16,
    );
    const lookedAt = computeLookAtSelectedCamera(SUBJECT_BOUNDS, OUTPUT_CAMERA);

    expect(framed.target).toEqual(SUBJECT_BOUNDS.center);
    expect(framed.position.z).toBeLessThan(OUTPUT_CAMERA.position.z);
    expect(lookedAt).toEqual({
      ...OUTPUT_CAMERA,
      target: SUBJECT_BOUNDS.center,
    });
  });
});
