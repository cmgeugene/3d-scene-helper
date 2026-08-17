import { describe, expect, it } from 'vitest';
import { Euler, MathUtils, Vector3 } from 'three';
import { computeMannequinCinematicLandmarks } from '../mannequin/mannequinRig';
import {
  createSceneObject,
  type SceneObject,
} from '../persistence/sceneSchema';
import { getSceneObjectBounds } from '../scene/sceneObjectModel';
import { createCinematicSubjectProfile } from './cinematicSubjectProfile';

const distance = (
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

function expectUnit(vector: { x: number; y: number; z: number }) {
  expect(Math.hypot(vector.x, vector.y, vector.z)).toBeCloseTo(1, 10);
}

function expectedWorldPoint(
  object: SceneObject,
  local: { x: number; y: number; z: number },
) {
  return new Vector3(
    local.x * (object.dimensions.x / 0.5) * object.transform.scale.x,
    local.y * (object.dimensions.y / 1.7) * object.transform.scale.y,
    local.z * (object.dimensions.z / 0.3) * object.transform.scale.z,
  )
    .applyEuler(
      new Euler(
        MathUtils.degToRad(object.transform.rotationDeg.x),
        MathUtils.degToRad(object.transform.rotationDeg.y),
        MathUtils.degToRad(object.transform.rotationDeg.z),
        'XYZ',
      ),
    )
    .add(
      new Vector3(
        object.transform.position.x,
        object.transform.position.y,
        object.transform.position.z,
      ),
    );
}

describe('createCinematicSubjectProfile', () => {
  it('returns null for a non-mannequin without mutating it', () => {
    const cube = createSceneObject('cube-profile', { kind: 'cube' });
    const before = structuredClone(cube);

    expect(createCinematicSubjectProfile(cube)).toBeNull();
    expect(cube).toEqual(before);
  });

  it.each(['standard', 'athletic', 'heavy'] as const)(
    'creates a JSON-safe %s mannequin profile with shared bounds',
    (bodyType) => {
      const mannequin = createSceneObject(`${bodyType}-profile`, {
        kind: 'mannequin',
      });
      mannequin.mannequinBodyType = bodyType;
      if (bodyType === 'athletic') mannequin.dimensions.y = 1.8;
      const before = structuredClone(mannequin);

      const profile = createCinematicSubjectProfile(mannequin);

      expect(profile).not.toBeNull();
      if (profile === null) return;
      expect(profile.objectId).toBe(mannequin.id);
      expect(profile.bounds).toEqual(getSceneObjectBounds(mannequin));
      expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
      expect(mannequin).toEqual(before);
    },
  );

  it('applies dimensions, root scale, XYZ rotation, then translation to posed landmarks', () => {
    const mannequin = createSceneObject('ordered-profile', {
      kind: 'mannequin',
    });
    mannequin.mannequinBodyType = 'heavy';
    mannequin.dimensions = { x: 0.75, y: 1.9, z: 0.42 };
    mannequin.transform = {
      position: { x: 2.4, y: -0.3, z: 1.7 },
      rotationDeg: { x: 23, y: 41, z: -17 },
      scale: { x: 1.3, y: 0.8, z: 1.6 },
    };
    if (mannequin.mannequinPose === undefined) throw new Error('pose required');
    mannequin.mannequinPose = structuredClone(
      createSceneObject('walk-source', { kind: 'mannequin' }).mannequinPose,
    );
    if (mannequin.mannequinPose === undefined) throw new Error('pose required');
    mannequin.mannequinPose.id = 'walk-ready';
    mannequin.mannequinPose.arms.left.shoulderRotationDeg.x = -24;
    mannequin.mannequinPose.legs.right.hipRotationDeg.x = -18;
    mannequin.mannequinPose.legs.right.kneeBendDeg = 18;
    const local = computeMannequinCinematicLandmarks(
      mannequin.mannequinPose,
      'heavy',
    );

    const profile = createCinematicSubjectProfile(mannequin);

    expect(profile).not.toBeNull();
    if (profile === null) return;
    for (const key of ['faceCenter', 'leftHand', 'rightFoot'] as const) {
      const expected = expectedWorldPoint(mannequin, local[key]);
      expect(profile.landmarks[key].x).toBeCloseTo(expected.x, 10);
      expect(profile.landmarks[key].y).toBeCloseTo(expected.y, 10);
      expect(profile.landmarks[key].z).toBeCloseTo(expected.z, 10);
    }
  });

  it('flips local -Z body forward to world +Z under a 180 degree yaw', () => {
    const mannequin = createSceneObject('yaw-profile', { kind: 'mannequin' });
    mannequin.transform.rotationDeg.y = 180;

    const profile = createCinematicSubjectProfile(mannequin);

    expect(profile).not.toBeNull();
    if (profile === null) return;
    expect(profile.basis.forward.x).toBeCloseTo(0, 10);
    expect(profile.basis.forward.y).toBeCloseTo(0, 10);
    expect(profile.basis.forward.z).toBeCloseTo(1, 10);
  });

  it('keeps direction bases normalized and orthogonal under non-uniform scale', () => {
    const mannequin = createSceneObject('scaled-profile', {
      kind: 'mannequin',
    });
    mannequin.dimensions = { x: 0.8, y: 1.9, z: 0.65 };
    mannequin.transform.scale = { x: 2.4, y: 0.55, z: 1.7 };
    mannequin.transform.rotationDeg = { x: 31, y: -47, z: 19 };

    const profile = createCinematicSubjectProfile(mannequin);

    expect(profile).not.toBeNull();
    if (profile === null) return;
    const { forward, right, up, faceForward } = profile.basis;
    for (const direction of [forward, right, up, faceForward]) {
      expectUnit(direction);
    }
    const dot = (
      left: { x: number; y: number; z: number },
      rightVector: { x: number; y: number; z: number },
    ) =>
      left.x * rightVector.x + left.y * rightVector.y + left.z * rightVector.z;
    expect(dot(forward, right)).toBeCloseTo(0, 10);
    expect(dot(forward, up)).toBeCloseTo(0, 10);
    expect(dot(right, up)).toBeCloseTo(0, 10);
    expect(distance(faceForward, forward)).toBeLessThan(1e-10);
  });

  it('includes the landmark silhouette anchors required by later solvers', () => {
    const mannequin = createSceneObject('outline-profile', {
      kind: 'mannequin',
    });
    if (mannequin.mannequinPose === undefined) throw new Error('pose required');
    mannequin.mannequinPose.id = 'walk-ready';
    mannequin.mannequinPose.arms.left.shoulderRotationDeg.x = -24;
    mannequin.mannequinPose.arms.right.shoulderRotationDeg.x = 24;
    mannequin.mannequinPose.legs.left.hipRotationDeg.x = 18;
    mannequin.mannequinPose.legs.right.hipRotationDeg.x = -18;
    mannequin.mannequinPose.legs.left.kneeBendDeg = 8;
    mannequin.mannequinPose.legs.right.kneeBendDeg = 18;

    const profile = createCinematicSubjectProfile(mannequin);

    expect(profile).not.toBeNull();
    if (profile === null) return;
    const outline = new Set(
      profile.outline.map((point) => JSON.stringify(point)),
    );
    for (const key of [
      'headTop',
      'headLeft',
      'headRight',
      'leftShoulder',
      'rightShoulder',
      'leftHand',
      'rightHand',
      'leftHip',
      'rightHip',
      'leftKnee',
      'rightKnee',
      'leftFoot',
      'rightFoot',
    ] as const) {
      expect(outline.has(JSON.stringify(profile.landmarks[key]))).toBe(true);
    }
  });
});
