import { describe, expect, it } from 'vitest';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { createSceneObject } from '../persistence/sceneSchema';
import { applyOutputCameraProjection } from '../scene/cameraMath';
import {
  createCinematicSubjectProfile,
  type CinematicSubjectProfile,
  type Vec3,
} from './cinematicSubjectProfile';
import { computeCinematicProjectionMetrics } from './projectionMetrics';

const CAMERA = {
  position: { x: 0, y: 0.85, z: 5 },
  target: { x: 0, y: 0.85, z: 0 },
  focalLengthMm: 50,
  rollDeg: 0,
};

function subjectProfile() {
  const profile = createCinematicSubjectProfile(
    createSceneObject('projection-subject', { kind: 'mannequin' }),
  );
  if (profile === null) throw new Error('profile required');
  return profile;
}

function outputCamera(camera = CAMERA, aspect = 1): PerspectiveCamera {
  const runtime = new PerspectiveCamera(50, aspect, 0.1, 100);
  runtime.position.set(camera.position.x, camera.position.y, camera.position.z);
  runtime.up.set(0, 1, 0);
  runtime.lookAt(camera.target.x, camera.target.y, camera.target.z);
  runtime.rotateZ(MathUtils.degToRad(camera.rollDeg));
  applyOutputCameraProjection(runtime, aspect, camera.focalLengthMm);
  runtime.updateMatrixWorld(true);
  return runtime;
}

function worldAtNdc(x: number, y: number, camera = CAMERA, aspect = 1): Vec3 {
  const point = new Vector3(x, y, 0).unproject(outputCamera(camera, aspect));
  return { x: point.x, y: point.y, z: point.z };
}

function syntheticProfile(
  point: Vec3,
  overrides: Partial<CinematicSubjectProfile['landmarks']> = {},
  outline: readonly Vec3[] = [point],
): CinematicSubjectProfile {
  const base = subjectProfile();
  const landmarks = Object.fromEntries(
    Object.keys(base.landmarks).map((key) => [key, { ...point }]),
  ) as unknown as CinematicSubjectProfile['landmarks'];
  return {
    ...base,
    landmarks: { ...landmarks, ...overrides },
    outline,
  };
}

describe('computeCinematicProjectionMetrics', () => {
  it('projects the serialized camera target to output-frame NDC center', () => {
    const profile = syntheticProfile(CAMERA.target);

    const metrics = computeCinematicProjectionMetrics(profile, CAMERA, 1);

    expect(metrics.landmarks.faceCenter.ndc.x).toBeCloseTo(0, 10);
    expect(metrics.landmarks.faceCenter.ndc.y).toBeCloseTo(0, 10);
    expect(metrics.landmarks.faceCenter.inFront).toBe(true);
    expect(metrics.landmarks.faceCenter.insideFrame).toBe(true);
  });

  it('changes subject occupancy predictably with focal length and output aspect', () => {
    const profile = subjectProfile();
    const wideLens = computeCinematicProjectionMetrics(
      profile,
      { ...CAMERA, focalLengthMm: 35 },
      16 / 9,
    );
    const longLens = computeCinematicProjectionMetrics(
      profile,
      { ...CAMERA, focalLengthMm: 85 },
      16 / 9,
    );
    const portrait = computeCinematicProjectionMetrics(
      profile,
      { ...CAMERA, focalLengthMm: 35 },
      9 / 16,
    );

    expect(longLens.occupancy.width).toBeGreaterThan(wideLens.occupancy.width);
    expect(longLens.occupancy.height).toBeGreaterThan(
      wideLens.occupancy.height,
    );
    expect(portrait.occupancy.width).toBeGreaterThan(wideLens.occupancy.width);
    expect(portrait.occupancy.height).toBeLessThan(wideLens.occupancy.height);
  });

  it('marks behind-camera points even when their NDC values are finite', () => {
    const behind = { x: 0, y: 0.85, z: 8 };
    const metrics = computeCinematicProjectionMetrics(
      syntheticProfile(behind),
      CAMERA,
      1,
    );

    expect(
      Object.values(metrics.landmarks).every(({ ndc }) =>
        Object.values(ndc).every(Number.isFinite),
      ),
    ).toBe(true);
    expect(metrics.landmarks.faceCenter.inFront).toBe(false);
    expect(metrics.landmarks.faceCenter.insideFrame).toBe(false);
    expect(metrics.allInFront).toBe(false);
  });

  it('uses [-1, 1] frame bounds and the existing 5% action-safe inset', () => {
    const safeEdge = computeCinematicProjectionMetrics(
      syntheticProfile(worldAtNdc(0.9, 0)),
      CAMERA,
      1,
    );
    const betweenSafeAndFrame = computeCinematicProjectionMetrics(
      syntheticProfile(worldAtNdc(0.95, 0)),
      CAMERA,
      1,
    );
    const clipped = computeCinematicProjectionMetrics(
      syntheticProfile(worldAtNdc(1.05, 0)),
      CAMERA,
      1,
    );

    expect(safeEdge.landmarks.faceCenter.insideActionSafe).toBe(true);
    expect(betweenSafeAndFrame.landmarks.faceCenter.insideFrame).toBe(true);
    expect(betweenSafeAndFrame.landmarks.faceCenter.insideActionSafe).toBe(
      false,
    );
    expect(clipped.landmarks.faceCenter.insideFrame).toBe(false);
  });

  it('ignores behind-camera outline points but retains clipped in-front points in the envelope', () => {
    const center = worldAtNdc(0, 0);
    const clipped = worldAtNdc(1.3, 0.4);
    const behind = { x: 0, y: 0.85, z: 8 };
    const metrics = computeCinematicProjectionMetrics(
      syntheticProfile(center, {}, [behind, center, clipped]),
      CAMERA,
      1,
    );

    expect(metrics.visibleRect).not.toBeNull();
    expect(metrics.visibleRect?.minX).toBeCloseTo(0, 10);
    expect(metrics.visibleRect?.maxX).toBeCloseTo(1.3, 10);
    expect(metrics.visibleRect?.maxY).toBeCloseTo(0.4, 10);
    expect(metrics.occupancy.width).toBeCloseTo(0.65, 10);
  });

  it('reports named clipped landmarks outside the output frame', () => {
    const center = worldAtNdc(0, 0);
    const clippedHead = worldAtNdc(-1.1, 0.2);
    const metrics = computeCinematicProjectionMetrics(
      syntheticProfile(center, { headTop: clippedHead }),
      CAMERA,
      1,
    );

    expect(metrics.clippedLandmarks).toEqual(['headTop']);
  });

  it('returns mixed safe, unsafe, and cropped landmarks as measurements without applying shot policy', () => {
    const center = worldAtNdc(0, 0);
    const unsafeFace = worldAtNdc(0.95, 0.2);
    const croppedHead = worldAtNdc(-1.1, 0.4);
    const safeFoot = worldAtNdc(0.7, -0.75);

    const metrics = computeCinematicProjectionMetrics(
      syntheticProfile(center, {
        faceCenter: unsafeFace,
        headTop: croppedHead,
        leftFoot: safeFoot,
      }),
      CAMERA,
      1,
    );

    expect(metrics.landmarks.faceCenter).toMatchObject({
      inFront: true,
      insideFrame: true,
      insideActionSafe: false,
    });
    expect(metrics.landmarks.headTop).toMatchObject({
      inFront: true,
      insideFrame: false,
      insideActionSafe: false,
    });
    expect(metrics.landmarks.leftFoot).toMatchObject({
      inFront: true,
      insideFrame: true,
      insideActionSafe: true,
    });
    expect(metrics.clippedLandmarks).toEqual(['headTop']);
    expect(metrics).not.toHaveProperty('passed');
    expect(metrics).not.toHaveProperty('requiredLandmarks');
  });

  it('derives normalized headroom from projected headTop rather than world Y', () => {
    const center = worldAtNdc(0, 0);
    const projectedHeadTop = worldAtNdc(0, 0.6);
    projectedHeadTop.y = worldAtNdc(0, 0.6).y;
    const metrics = computeCinematicProjectionMetrics(
      syntheticProfile(center, { headTop: projectedHeadTop }),
      CAMERA,
      1,
    );

    expect(metrics.headroom).toBeCloseTo(0.2, 10);
  });

  it('rejects invalid aspect, focal length, and zero camera distance with clear range errors', () => {
    const profile = subjectProfile();

    expect(() => computeCinematicProjectionMetrics(profile, CAMERA, 0)).toThrow(
      /outputAspect.*positive finite/i,
    );
    expect(() =>
      computeCinematicProjectionMetrics(
        profile,
        { ...CAMERA, focalLengthMm: Number.NaN },
        1,
      ),
    ).toThrow(/focalLengthMm.*positive finite/i);
    expect(() =>
      computeCinematicProjectionMetrics(
        profile,
        { ...CAMERA, position: { ...CAMERA.target } },
        1,
      ),
    ).toThrow(/camera distance.*positive finite/i);
  });
});
