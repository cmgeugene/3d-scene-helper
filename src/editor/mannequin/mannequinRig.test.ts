import { describe, expect, it } from 'vitest';
import {
  Box3,
  Euler,
  Group,
  MathUtils,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { mannequinPoseSchema } from '../persistence/sceneSchema';
import { createStudioMannequinGeometries } from './mannequinAppearance';
import {
  MANNEQUIN_BODY_TYPE_IDS,
  type MannequinBodyTypeId,
} from './mannequinBodyType';
import {
  MANNEQUIN_ARM_ANCHORS,
  MANNEQUIN_ARM_LENGTHS,
  MANNEQUIN_FORWARD_AXIS,
  MANNEQUIN_LEG_ANCHORS,
  MANNEQUIN_LEG_LENGTHS,
  MANNEQUIN_POSE_PRESETS,
  applyMannequinIkRotation,
  computeMannequinPoseBounds,
  createMannequinPose,
  getMannequinArmChain,
  getMannequinLegChain,
  solveMannequinArmIk,
  solveMannequinElbowIk,
  solveMannequinKneeIk,
  solveMannequinLegIk,
  solveTwoBoneArmIk,
} from './mannequinRig';

function vectorDistance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function renderedShinAndFootBounds(
  pose: ReturnType<typeof createMannequinPose>,
  side: 'left' | 'right',
  bodyType: MannequinBodyTypeId = 'standard',
) {
  const geometries = createStudioMannequinGeometries(bodyType);
  const pelvis = new Group();
  pelvis.position.y = 0.06;
  const hip = new Group();
  const hipAnchor = MANNEQUIN_LEG_ANCHORS[side].hip;
  hip.position.set(hipAnchor.x, hipAnchor.y - 0.06, hipAnchor.z);
  hip.rotation.set(
    MathUtils.degToRad(pose.legs[side].hipRotationDeg.x),
    MathUtils.degToRad(pose.legs[side].hipRotationDeg.y),
    MathUtils.degToRad(pose.legs[side].hipRotationDeg.z),
    'XYZ',
  );
  const knee = new Group();
  knee.position.y = -MANNEQUIN_LEG_LENGTHS.thigh;
  knee.rotation.set(
    -MathUtils.degToRad(pose.legs[side].kneeBendDeg),
    0,
    MathUtils.degToRad(pose.legs[side].kneeDeviationDeg),
    'XYZ',
  );
  const ankle = new Group();
  ankle.position.y = -MANNEQUIN_LEG_LENGTHS.shin;
  ankle.rotation.set(
    MathUtils.degToRad(pose.legs[side].ankleRotationDeg.x),
    MathUtils.degToRad(pose.legs[side].ankleRotationDeg.y),
    MathUtils.degToRad(pose.legs[side].ankleRotationDeg.z),
    'XYZ',
  );
  knee.add(new Mesh(geometries.shin), ankle);
  ankle.add(new Mesh(geometries.foot));
  hip.add(knee);
  pelvis.add(hip);
  pelvis.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(pelvis);
  for (const geometry of Object.values(geometries)) geometry.dispose();
  return bounds;
}

function renderedTorsoBounds(
  pose: ReturnType<typeof createMannequinPose>,
  bodyType: MannequinBodyTypeId,
) {
  const geometries = createStudioMannequinGeometries(bodyType);
  const pelvis = new Group();
  pelvis.position.y = 0.06;
  const torsoPivot = new Group();
  torsoPivot.rotation.set(
    MathUtils.degToRad(pose.torsoRotationDeg.x),
    MathUtils.degToRad(pose.torsoRotationDeg.y),
    MathUtils.degToRad(pose.torsoRotationDeg.z),
    'XYZ',
  );
  const torso = new Mesh(geometries.torso);
  torso.position.y = 0.28;
  torsoPivot.add(torso);
  pelvis.add(torsoPivot);
  pelvis.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(pelvis);
  for (const geometry of Object.values(geometries)) geometry.dispose();
  return bounds;
}

function armBendDirection(chain: ReturnType<typeof getMannequinArmChain>) {
  const shoulder = new Vector3(
    chain.shoulder.x,
    chain.shoulder.y,
    chain.shoulder.z,
  );
  const handAxis = new Vector3(chain.hand.x, chain.hand.y, chain.hand.z)
    .sub(shoulder)
    .normalize();
  const elbowOffset = new Vector3(
    chain.elbow.x,
    chain.elbow.y,
    chain.elbow.z,
  ).sub(shoulder);
  return elbowOffset
    .addScaledVector(handAxis, -elbowOffset.dot(handAxis))
    .normalize();
}

function axialTwistDegrees(rotation: { x: number; y: number; z: number }) {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(rotation.x),
      MathUtils.degToRad(rotation.y),
      MathUtils.degToRad(rotation.z),
      'XYZ',
    ),
  );
  const twistLength = Math.hypot(quaternion.y, quaternion.w);
  if (twistLength < 1e-12) return 180;
  const angle = MathUtils.radToDeg(
    2 * Math.atan2(quaternion.y / twistLength, quaternion.w / twistLength),
  );
  return Math.abs(MathUtils.euclideanModulo(angle + 180, 360) - 180);
}

describe('mannequin pose conventions and presets', () => {
  it('documents -Z as forward and exposes four JSON-safe named poses', () => {
    expect(MANNEQUIN_FORWARD_AXIS).toEqual({ x: 0, y: 0, z: -1 });
    expect(Object.keys(MANNEQUIN_POSE_PRESETS)).toEqual([
      'default',
      'a',
      't',
      'walk-ready',
    ]);

    for (const id of ['default', 'a', 't', 'walk-ready'] as const) {
      const pose = createMannequinPose(id);
      expect(JSON.parse(JSON.stringify(pose))).toEqual(pose);
      expect(pose.id).toBe(id);
    }
  });

  it('keeps preset creation isolated from shared preset data', () => {
    const first = createMannequinPose('t');
    first.arms.left.shoulderRotationDeg.z = 0;

    expect(createMannequinPose('t').arms.left.shoulderRotationDeg.z).toBe(-90);
    expect(MANNEQUIN_POSE_PRESETS.t.arms.right.shoulderRotationDeg.z).toBe(90);
  });

  it('defines mirrored shoulder and relaxed-hand anchors for both arms', () => {
    expect(MANNEQUIN_ARM_ANCHORS).toEqual({
      left: {
        shoulder: { x: -0.18, y: 0.47, z: 0 },
        hand: { x: -0.2, y: -0.12, z: 0 },
      },
      right: {
        shoulder: { x: 0.18, y: 0.47, z: 0 },
        hand: { x: 0.2, y: -0.12, z: 0 },
      },
    });
    expect(MANNEQUIN_ARM_LENGTHS).toEqual({ upperArm: 0.31, forearm: 0.29 });

    for (const side of ['left', 'right'] as const) {
      const { shoulder, hand } = MANNEQUIN_ARM_ANCHORS[side];
      expect(Math.hypot(hand.x - shoulder.x, hand.y - shoulder.y)).toBeLessThan(
        MANNEQUIN_ARM_LENGTHS.upperArm + MANNEQUIN_ARM_LENGTHS.forearm,
      );
    }
  });
});

describe('IK rotation gizmo pose updates', () => {
  it('allows only clamped left-right yaw at the neck', () => {
    const initial = createMannequinPose('t');
    const pitch = applyMannequinIkRotation(initial, { joint: 'neck' }, 'x', 90);
    const yaw = applyMannequinIkRotation(initial, { joint: 'neck' }, 'y', 120);
    const tilt = applyMannequinIkRotation(initial, { joint: 'neck' }, 'z', -90);

    expect(pitch).toEqual(initial);
    expect(yaw.headRotationDeg).toEqual({ x: 0, y: 80, z: 0 });
    expect(tilt).toEqual(initial);
    const expected = structuredClone(initial);
    expected.id = 'custom';
    expected.headRotationDeg.y = 80;
    expect(yaw).toEqual(expected);
  });

  it('rotates end effectors on local axes and clamps hinge joints anatomically', () => {
    const initial = createMannequinPose('default');
    initial.arms.left.wristRotationDeg.z = 170;
    const wristRotated = applyMannequinIkRotation(
      initial,
      { side: 'left', joint: 'hand' },
      'z',
      30,
    );
    const ankleRotated = applyMannequinIkRotation(
      wristRotated,
      { side: 'right', joint: 'foot' },
      'y',
      -35,
    );
    const elbowRotated = applyMannequinIkRotation(
      ankleRotated,
      { side: 'left', joint: 'elbow' },
      'x',
      300,
    );
    const kneeRotated = applyMannequinIkRotation(
      elbowRotated,
      { side: 'right', joint: 'knee' },
      'x',
      300,
    );

    expect(initial.arms.left.wristRotationDeg.z).toBe(170);
    expect(wristRotated.arms.left.wristRotationDeg.z).toBeCloseTo(-160, 6);
    expect(ankleRotated.legs.right.ankleRotationDeg.y).toBeCloseTo(-35, 6);
    expect(elbowRotated.arms.left.elbowBendDeg).toBe(145);
    expect(kneeRotated.legs.right.kneeBendDeg).toBe(135);
    expect(kneeRotated.id).toBe('custom');
    expect(() => mannequinPoseSchema.parse(kneeRotated)).not.toThrow();
  });

  it('clamps elbow lateral deviation without changing the shoulder or bend', () => {
    const initial = createMannequinPose('default');
    const positive = applyMannequinIkRotation(
      initial,
      { side: 'left', joint: 'elbow' },
      'z',
      40,
    );
    const negative = applyMannequinIkRotation(
      positive,
      { side: 'left', joint: 'elbow' },
      'z',
      -40,
    );

    expect(positive.arms.left.elbowDeviationDeg).toBe(8);
    expect(negative.arms.left.elbowDeviationDeg).toBe(-8);
    const expectedPositive = structuredClone(initial);
    expectedPositive.id = 'custom';
    expectedPositive.arms.left.elbowDeviationDeg = 8;
    expect(positive).toEqual(expectedPositive);
    const expectedNegative = structuredClone(expectedPositive);
    expectedNegative.arms.left.elbowDeviationDeg = -8;
    expect(negative).toEqual(expectedNegative);
  });

  it('clamps knee lateral deviation without changing any other joint', () => {
    const initial = createMannequinPose('walk-ready');
    const positive = applyMannequinIkRotation(
      initial,
      { side: 'right', joint: 'knee' },
      'z',
      40,
    ) as typeof initial & {
      legs: { right: { kneeDeviationDeg?: number } };
    };
    const negative = applyMannequinIkRotation(
      positive,
      { side: 'right', joint: 'knee' },
      'z',
      -40,
    ) as typeof initial & {
      legs: { right: { kneeDeviationDeg?: number } };
    };

    expect(positive.legs.right.kneeDeviationDeg).toBe(5);
    expect(negative.legs.right.kneeDeviationDeg).toBe(-5);
    const expectedPositive = structuredClone(initial) as typeof positive;
    expectedPositive.id = 'custom';
    expectedPositive.legs.right.kneeDeviationDeg = 5;
    expect(positive).toEqual(expectedPositive);
    const expectedNegative = structuredClone(expectedPositive);
    expectedNegative.legs.right.kneeDeviationDeg = -5;
    expect(negative).toEqual(expectedNegative);
  });

  it('applies elbow deviation only to the chain below the elbow', () => {
    const initial = createMannequinPose('default');
    initial.arms.left.elbowBendDeg = 70;
    const before = getMannequinArmChain(initial, 'left');
    const deviated = applyMannequinIkRotation(
      initial,
      { side: 'left', joint: 'elbow' },
      'z',
      8,
    );
    const after = getMannequinArmChain(deviated, 'left');

    expect(after.shoulder).toEqual(before.shoulder);
    expect(after.elbow).toEqual(before.elbow);
    expect(vectorDistance(after.hand, before.hand)).toBeGreaterThan(0.02);
    expect(vectorDistance(after.elbow, after.hand)).toBeCloseTo(
      MANNEQUIN_ARM_LENGTHS.forearm,
      10,
    );
  });

  it('applies knee deviation only to the chain below the knee', () => {
    const initial = createMannequinPose('walk-ready');
    initial.legs.right.kneeBendDeg = 60;
    const before = getMannequinLegChain(initial, 'right');
    const deviated = applyMannequinIkRotation(
      initial,
      { side: 'right', joint: 'knee' },
      'z',
      5,
    );
    const after = getMannequinLegChain(deviated, 'right');

    expect(after.hip).toEqual(before.hip);
    expect(after.knee).toEqual(before.knee);
    expect(vectorDistance(after.foot, before.foot)).toBeGreaterThan(0.02);
    expect(vectorDistance(after.knee, after.foot)).toBeCloseTo(
      MANNEQUIN_LEG_LENGTHS.shin,
      10,
    );
  });
});

const distance = (
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

describe('analytic two-bone arm IK', () => {
  it('reaches a target while preserving both segment lengths and pole direction', () => {
    const solution = solveTwoBoneArmIk({
      shoulder: { x: 0, y: 0, z: 0 },
      handTarget: { x: 0.12, y: -0.45, z: -0.08 },
      pole: { x: 0, y: 0, z: -1 },
      upperArmLength: 0.31,
      forearmLength: 0.29,
    });

    expect(solution.hand).toEqual({ x: 0.12, y: -0.45, z: -0.08 });
    expect(distance(solution.shoulder, solution.elbow)).toBeCloseTo(0.31, 10);
    expect(distance(solution.elbow, solution.hand)).toBeCloseTo(0.29, 10);
    expect(solution.elbow.z).toBeLessThan(0);
    expect(solution.reachClamped).toBe(false);
    expect(JSON.parse(JSON.stringify(solution))).toEqual(solution);
  });

  it('uses a deterministic perpendicular fallback when the pole is collinear', () => {
    const downRequest = {
      shoulder: { x: 0, y: 0, z: 0 },
      handTarget: { x: 0, y: -0.5, z: 0 },
      pole: { x: 0, y: -2, z: 0 },
      upperArmLength: 0.31,
      forearmLength: 0.29,
    };
    const forwardRequest = {
      ...downRequest,
      handTarget: { x: 0, y: 0, z: -0.5 },
      pole: { x: 0, y: 0, z: -2 },
    };

    expect(solveTwoBoneArmIk(downRequest).bendDirection).toEqual({
      x: 0,
      y: 0,
      z: -1,
    });
    expect(solveTwoBoneArmIk(downRequest)).toEqual(
      solveTwoBoneArmIk(downRequest),
    );
    expect(solveTwoBoneArmIk(forwardRequest).bendDirection).toEqual({
      x: 0,
      y: 1,
      z: 0,
    });
  });

  it('clamps far and near targets to a default 2°–160° elbow bend range', () => {
    const common = {
      shoulder: { x: 0, y: 0, z: 0 },
      pole: { x: 0, y: 0, z: -1 },
      upperArmLength: 0.31,
      forearmLength: 0.29,
    };
    const far = solveTwoBoneArmIk({
      ...common,
      handTarget: { x: 0, y: -10, z: 0 },
    });
    const near = solveTwoBoneArmIk({
      ...common,
      handTarget: { x: 0, y: -0.001, z: 0 },
    });

    expect(far.reachClamped).toBe(true);
    expect(far.elbowBendDeg).toBeCloseTo(2, 8);
    expect(far.solvedDistance).toBeLessThan(0.6);
    expect(distance(far.shoulder, far.elbow)).toBeCloseTo(0.31, 10);
    expect(distance(far.elbow, far.hand)).toBeCloseTo(0.29, 10);
    expect(near.reachClamped).toBe(true);
    expect(near.elbowBendDeg).toBeCloseTo(160, 8);
    expect(near.solvedDistance).toBeGreaterThan(0);
    expect(distance(near.elbow, near.hand)).toBeCloseTo(0.29, 10);
  });

  it('converts a local hand target into a serializable custom arm pose', () => {
    const target = { x: -0.36, y: 0.12, z: -0.28 };
    const pose = solveMannequinArmIk(
      createMannequinPose('default'),
      'left',
      target,
    );
    const chain = getMannequinArmChain(pose, 'left');

    expect(pose.id).toBe('custom');
    expect(distance(chain.hand, target)).toBeLessThan(1e-6);
    expect(pose.arms.left.elbowBendDeg).toBeGreaterThanOrEqual(2);
    expect(pose.arms.left.elbowBendDeg).toBeLessThanOrEqual(150);
    expect(JSON.parse(JSON.stringify(pose))).toEqual(pose);
  });

  it('preserves the current elbow bend plane for a nearby hand target', () => {
    const initial = createMannequinPose('default');
    initial.arms.left.shoulderRotationDeg = { x: 38, y: 22, z: -34 };
    initial.arms.left.elbowBendDeg = 72;
    const before = getMannequinArmChain(initial, 'left');
    const beforeBendDirection = armBendDirection(before);
    const shoulder = new Vector3(
      before.shoulder.x,
      before.shoulder.y,
      before.shoulder.z,
    );
    const handAxis = new Vector3(before.hand.x, before.hand.y, before.hand.z)
      .sub(shoulder)
      .normalize();
    const tangent = new Vector3(0, 1, 0).cross(handAxis).normalize();
    const target = new Vector3(
      before.hand.x,
      before.hand.y,
      before.hand.z,
    ).addScaledVector(tangent, 0.012);

    const solved = solveMannequinArmIk(initial, 'left', {
      x: target.x,
      y: target.y,
      z: target.z,
    });
    const after = getMannequinArmChain(solved, 'left');

    expect(armBendDirection(after).dot(beforeBendDirection)).toBeGreaterThan(
      0.98,
    );
  });

  it('preserves elbow deviation while reaching a compatible nearby hand target', () => {
    const initial = createMannequinPose('a');
    initial.arms.left.elbowBendDeg = 70;
    initial.arms.left.elbowDeviationDeg = 8;
    const currentHand = getMannequinArmChain(initial, 'left').hand;
    const nearbyTarget = {
      x: currentHand.x + 0.01,
      y: currentHand.y + 0.005,
      z: currentHand.z - 0.005,
    };

    const solved = solveMannequinArmIk(initial, 'left', nearbyTarget);

    expect(solved.arms.left.elbowDeviationDeg).toBe(8);
    expect(
      vectorDistance(getMannequinArmChain(solved, 'left').hand, nearbyTarget),
    ).toBeLessThan(1e-6);
  });

  it('uses the shoulder local hinge direction when a straight arm starts bending', () => {
    const initial = createMannequinPose('default');
    initial.arms.left.shoulderRotationDeg = { x: 38, y: 22, z: -34 };
    initial.arms.left.elbowBendDeg = 0;
    const before = getMannequinArmChain(initial, 'left');
    const shoulder = new Vector3(
      before.shoulder.x,
      before.shoulder.y,
      before.shoulder.z,
    );
    const handOffset = new Vector3(before.hand.x, before.hand.y, before.hand.z)
      .sub(shoulder)
      .multiplyScalar(0.96);
    const target = shoulder.clone().add(handOffset);
    const shoulderQuaternion = new Quaternion().setFromEuler(
      new Euler(
        MathUtils.degToRad(initial.arms.left.shoulderRotationDeg.x),
        MathUtils.degToRad(initial.arms.left.shoulderRotationDeg.y),
        MathUtils.degToRad(initial.arms.left.shoulderRotationDeg.z),
        'XYZ',
      ),
    );
    const preferredBendDirection = new Vector3(0, 0, 1)
      .applyQuaternion(shoulderQuaternion)
      .normalize();

    const solved = solveMannequinArmIk(initial, 'left', {
      x: target.x,
      y: target.y,
      z: target.z,
    });

    expect(
      armBendDirection(getMannequinArmChain(solved, 'left')).dot(
        preferredBendDirection,
      ),
    ).toBeGreaterThan(0.98);
  });

  it('returns the exact conservative maximum bend at minimum reach', () => {
    const pose = solveMannequinArmIk(
      createMannequinPose('default'),
      'left',
      MANNEQUIN_ARM_ANCHORS.left.shoulder,
    );

    expect(pose.arms.left.elbowBendDeg).toBe(145);
    expect(mannequinPoseSchema.safeParse(pose).success).toBe(true);
  });

  it('keeps a folded elbow inside a conservative anatomical hinge limit', () => {
    const pose = solveMannequinArmIk(
      createMannequinPose('default'),
      'left',
      MANNEQUIN_ARM_ANCHORS.left.shoulder,
    );

    expect(pose.arms.left.elbowBendDeg).toBe(145);
  });

  it('inherits torso rotation in arm FK and IK target solving', () => {
    const rotated = createMannequinPose('t');
    rotated.torsoRotationDeg.y = 90;
    const before = getMannequinArmChain(rotated, 'left');

    expect(before.shoulder.x).toBeCloseTo(0, 10);
    expect(before.shoulder.z).toBeCloseTo(0.18, 10);
    expect(distance(before.shoulder, before.elbow)).toBeCloseTo(0.31, 10);
    expect(distance(before.elbow, before.hand)).toBeCloseTo(0.29, 10);

    const target = { x: -0.12, y: 0.38, z: 0.42 };
    const solved = solveMannequinArmIk(rotated, 'left', target);
    expect(
      distance(getMannequinArmChain(solved, 'left').hand, target),
    ).toBeLessThan(1e-6);
  });
});

describe('analytic two-bone leg IK', () => {
  it('folds a positive knee bend backward along +Z', () => {
    const bent = createMannequinPose('default');
    bent.legs.left.kneeBendDeg = 90;
    const chain = getMannequinLegChain(bent, 'left');

    expect(chain.foot.z).toBeGreaterThan(chain.knee.z + 0.3);
  });

  it('moves the ankle target while preserving thigh and shin lengths', () => {
    const target = { x: -0.16, y: -0.62, z: -0.25 };
    const pose = solveMannequinLegIk(
      createMannequinPose('default'),
      'left',
      target,
    );
    const chain = getMannequinLegChain(pose, 'left');

    expect(distance(chain.foot, target)).toBeLessThan(1e-6);
    expect(distance(chain.hip, chain.knee)).toBeCloseTo(
      MANNEQUIN_LEG_LENGTHS.thigh,
      10,
    );
    expect(distance(chain.knee, chain.foot)).toBeCloseTo(
      MANNEQUIN_LEG_LENGTHS.shin,
      10,
    );
    expect(pose.legs.left.kneeBendDeg).toBeGreaterThanOrEqual(0);
    expect(pose.legs.left.kneeBendDeg).toBeLessThanOrEqual(150);
    expect(mannequinPoseSchema.safeParse(pose).success).toBe(true);
  });

  it('preserves knee deviation while reaching a compatible nearby foot target', () => {
    const initial = createMannequinPose('walk-ready');
    initial.legs.right.kneeBendDeg = 70;
    initial.legs.right.kneeDeviationDeg = 5;
    const currentFoot = getMannequinLegChain(initial, 'right').foot;
    const nearbyTarget = {
      x: currentFoot.x - 0.005,
      y: currentFoot.y + 0.005,
      z: currentFoot.z + 0.005,
    };

    const solved = solveMannequinLegIk(initial, 'right', nearbyTarget);

    expect(solved.legs.right.kneeDeviationDeg).toBe(5);
    expect(
      vectorDistance(getMannequinLegChain(solved, 'right').foot, nearbyTarget),
    ).toBeLessThan(1e-6);
  });

  it('limits lateral hip abduction and deep knee folding', () => {
    const initial = createMannequinPose('default');
    const sideSolved = solveMannequinLegIk(initial, 'left', {
      x: MANNEQUIN_LEG_ANCHORS.left.hip.x - 2,
      y: MANNEQUIN_LEG_ANCHORS.left.hip.y,
      z: MANNEQUIN_LEG_ANCHORS.left.hip.z,
    });
    const sideChain = getMannequinLegChain(sideSolved, 'left');
    const upperAngleFromDown =
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            (sideChain.hip.y - sideChain.knee.y) / MANNEQUIN_LEG_LENGTHS.thigh,
          ),
        ),
      ) *
        180) /
      Math.PI;
    const footOffset = {
      x: sideChain.foot.x - sideChain.hip.x,
      y: sideChain.foot.y - sideChain.hip.y,
      z: sideChain.foot.z - sideChain.hip.z,
    };
    const footAngleFromDown =
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            -footOffset.y /
              Math.hypot(footOffset.x, footOffset.y, footOffset.z),
          ),
        ),
      ) *
        180) /
      Math.PI;
    const folded = solveMannequinLegIk(
      initial,
      'left',
      MANNEQUIN_LEG_ANCHORS.left.hip,
    );
    const inwardSolved = solveMannequinLegIk(initial, 'left', {
      x: MANNEQUIN_LEG_ANCHORS.left.hip.x + 2,
      y: MANNEQUIN_LEG_ANCHORS.left.hip.y,
      z: MANNEQUIN_LEG_ANCHORS.left.hip.z,
    });
    const inwardChain = getMannequinLegChain(inwardSolved, 'left');
    const inwardFootOffset = {
      x: inwardChain.foot.x - inwardChain.hip.x,
      y: inwardChain.foot.y - inwardChain.hip.y,
      z: inwardChain.foot.z - inwardChain.hip.z,
    };
    const inwardFootAngle =
      (Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            -inwardFootOffset.y /
              Math.hypot(
                inwardFootOffset.x,
                inwardFootOffset.y,
                inwardFootOffset.z,
              ),
          ),
        ),
      ) *
        180) /
      Math.PI;

    expect(upperAngleFromDown).toBeLessThanOrEqual(55.000001);
    expect(footAngleFromDown).toBeLessThanOrEqual(55.000001);
    expect(inwardFootAngle).toBeLessThanOrEqual(20.000001);
    expect(folded.legs.left.kneeBendDeg).toBe(135);
  });

  it('keeps the constrained leg continuous near an antiparallel target', () => {
    const initial = createMannequinPose('default');
    const hip = MANNEQUIN_LEG_ANCHORS.left.hip;
    const before = getMannequinLegChain(
      solveMannequinLegIk(initial, 'left', {
        x: hip.x - 0.0001,
        y: hip.y + 1,
        z: hip.z,
      }),
      'left',
    );
    const after = getMannequinLegChain(
      solveMannequinLegIk(initial, 'left', {
        x: hip.x + 0.0001,
        y: hip.y + 1,
        z: hip.z,
      }),
      'left',
    );

    expect(vectorDistance(before.knee, after.knee)).toBeLessThan(0.01);
    expect(vectorDistance(before.foot, after.foot)).toBeLessThan(0.01);
  });

  it('does not flip when an antiparallel leg target crosses the pole threshold', () => {
    const initial = createMannequinPose('default');
    const hip = MANNEQUIN_LEG_ANCHORS.left.hip;
    const near = getMannequinLegChain(
      solveMannequinLegIk(initial, 'left', {
        x: hip.x,
        y: hip.y + 1,
        z: hip.z + 0.0001,
      }),
      'left',
    );
    const across = getMannequinLegChain(
      solveMannequinLegIk(initial, 'left', {
        x: hip.x,
        y: hip.y + 1,
        z: hip.z + 0.001,
      }),
      'left',
    );
    const directNear = getMannequinLegChain(
      solveMannequinKneeIk(initial, 'left', {
        x: hip.x,
        y: hip.y + 1,
        z: hip.z + 0.0001,
      }),
      'left',
    );
    const directAcross = getMannequinLegChain(
      solveMannequinKneeIk(initial, 'left', {
        x: hip.x,
        y: hip.y + 1,
        z: hip.z + 0.001,
      }),
      'left',
    );

    expect(vectorDistance(near.knee, across.knee)).toBeLessThan(0.01);
    expect(vectorDistance(near.foot, across.foot)).toBeLessThan(0.01);
    expect(vectorDistance(directNear.knee, directAcross.knee)).toBeLessThan(
      0.01,
    );
  });

  it('stays continuous across the antiparallel azimuth branch cut', () => {
    const initial = createMannequinPose('default');
    const hip = MANNEQUIN_LEG_ANCHORS.left.hip;

    for (const swingDeg of [166, 170, 175]) {
      const swingRad = MathUtils.degToRad(swingDeg);
      const target = (x: number) => ({
        x: hip.x + x,
        y: hip.y - Math.cos(swingRad),
        z: hip.z + Math.sin(swingRad),
      });
      const endpointNegative = getMannequinLegChain(
        solveMannequinLegIk(initial, 'left', target(-1e-8)),
        'left',
      );
      const endpointPositive = getMannequinLegChain(
        solveMannequinLegIk(initial, 'left', target(1e-8)),
        'left',
      );
      const directNegative = getMannequinLegChain(
        solveMannequinKneeIk(initial, 'left', target(-1e-8)),
        'left',
      );
      const directPositive = getMannequinLegChain(
        solveMannequinKneeIk(initial, 'left', target(1e-8)),
        'left',
      );

      expect(
        vectorDistance(endpointNegative.knee, endpointPositive.knee),
      ).toBeLessThan(0.01);
      expect(
        vectorDistance(endpointNegative.foot, endpointPositive.foot),
      ).toBeLessThan(0.01);
      expect(
        vectorDistance(directNegative.knee, directPositive.knee),
      ).toBeLessThan(0.01);
      expect(
        vectorDistance(directNegative.foot, directPositive.foot),
      ).toBeLessThan(0.01);
    }
  });

  it('produces mirrored left and right leg solutions', () => {
    const initial = createMannequinPose('default');
    const left = getMannequinLegChain(
      solveMannequinLegIk(initial, 'left', { x: -0.3, y: -0.52, z: -0.18 }),
      'left',
    );
    const right = getMannequinLegChain(
      solveMannequinLegIk(initial, 'right', { x: 0.3, y: -0.52, z: -0.18 }),
      'right',
    );

    expect(left.knee.x).toBeCloseTo(-right.knee.x, 6);
    expect(left.knee.y).toBeCloseTo(right.knee.y, 6);
    expect(left.knee.z).toBeCloseTo(right.knee.z, 6);
    expect(left.foot.x).toBeCloseTo(-right.foot.x, 6);
    expect(left.foot.y).toBeCloseTo(right.foot.y, 6);
    expect(left.foot.z).toBeCloseTo(right.foot.z, 6);
  });
});

describe('direct elbow and knee targets', () => {
  it('aims the proximal bone at a joint target without changing its length', () => {
    const initial = createMannequinPose('default');
    const leftArm = getMannequinArmChain(initial, 'left');
    const leftLeg = getMannequinLegChain(initial, 'left');
    const elbowTarget = {
      x: leftArm.shoulder.x,
      y: leftArm.shoulder.y,
      z: leftArm.shoulder.z - MANNEQUIN_ARM_LENGTHS.upperArm,
    };
    const kneeDrop = 0.28;
    const kneeTarget = {
      x: leftLeg.hip.x,
      y: leftLeg.hip.y - kneeDrop,
      z:
        leftLeg.hip.z -
        Math.sqrt(MANNEQUIN_LEG_LENGTHS.thigh ** 2 - kneeDrop ** 2),
    };

    const elbowSolved = solveMannequinElbowIk(initial, 'left', elbowTarget);
    const kneeSolved = solveMannequinKneeIk(initial, 'left', kneeTarget);

    expect(
      distance(getMannequinArmChain(elbowSolved, 'left').elbow, elbowTarget),
    ).toBeLessThan(1e-6);
    expect(
      distance(getMannequinLegChain(kneeSolved, 'left').knee, kneeTarget),
    ).toBeLessThan(1e-6);
    expect(elbowSolved.arms.right).toEqual(initial.arms.right);
    expect(kneeSolved.legs.right).toEqual(initial.legs.right);
    expect(mannequinPoseSchema.safeParse(elbowSolved).success).toBe(true);
    expect(mannequinPoseSchema.safeParse(kneeSolved).success).toBe(true);
  });

  it('stops direct joint targets before the shoulder or hip inverts', () => {
    const initial = createMannequinPose('default');
    const arm = getMannequinArmChain(initial, 'left');
    const leg = getMannequinLegChain(initial, 'left');
    const elbowSolved = solveMannequinElbowIk(initial, 'left', {
      x: arm.shoulder.x,
      y: arm.shoulder.y + 2,
      z: arm.shoulder.z,
    });
    const kneeSolved = solveMannequinKneeIk(initial, 'left', {
      x: leg.hip.x - 2,
      y: leg.hip.y,
      z: leg.hip.z,
    });
    const elbow = getMannequinArmChain(elbowSolved, 'left');
    const knee = getMannequinLegChain(kneeSolved, 'left');
    const angleFromDown = (
      origin: { y: number },
      joint: { y: number },
      length: number,
    ) =>
      (Math.acos(Math.max(-1, Math.min(1, (origin.y - joint.y) / length))) *
        180) /
      Math.PI;

    expect(
      angleFromDown(
        elbow.shoulder,
        elbow.elbow,
        MANNEQUIN_ARM_LENGTHS.upperArm,
      ),
    ).toBeLessThanOrEqual(160.000001);
    expect(
      angleFromDown(knee.hip, knee.knee, MANNEQUIN_LEG_LENGTHS.thigh),
    ).toBeLessThanOrEqual(55.000001);
  });

  it('clamps inherited shoulder and hip axial twist', () => {
    const twisted = createMannequinPose('default');
    twisted.arms.left.shoulderRotationDeg.y = 170;
    twisted.legs.left.hipRotationDeg.y = 170;
    const shoulder = MANNEQUIN_ARM_ANCHORS.left.shoulder;
    const hip = MANNEQUIN_LEG_ANCHORS.left.hip;

    const armSolved = solveMannequinElbowIk(twisted, 'left', {
      x: shoulder.x,
      y: shoulder.y - MANNEQUIN_ARM_LENGTHS.upperArm,
      z: shoulder.z,
    });
    const legSolved = solveMannequinKneeIk(twisted, 'left', {
      x: hip.x,
      y: hip.y - MANNEQUIN_LEG_LENGTHS.thigh,
      z: hip.z,
    });

    expect(
      axialTwistDegrees(armSolved.arms.left.shoulderRotationDeg),
    ).toBeLessThanOrEqual(70.000001);
    expect(
      axialTwistDegrees(legSolved.legs.left.hipRotationDeg),
    ).toBeLessThanOrEqual(45.000001);
  });

  it('clamps inherited elbow and knee flexion to anatomical hinge ranges', () => {
    const overflexed = createMannequinPose('default');
    overflexed.arms.left.elbowBendDeg = 150;
    overflexed.legs.left.kneeBendDeg = 150;
    const elbow = getMannequinArmChain(overflexed, 'left');
    const knee = getMannequinLegChain(overflexed, 'left');

    const elbowSolved = solveMannequinElbowIk(overflexed, 'left', elbow.elbow);
    const kneeSolved = solveMannequinKneeIk(overflexed, 'left', knee.knee);

    expect(elbowSolved.arms.left.elbowBendDeg).toBe(145);
    expect(kneeSolved.legs.left.kneeBendDeg).toBe(135);

    const hyperextended = createMannequinPose('default');
    hyperextended.arms.left.elbowBendDeg = -20;
    hyperextended.legs.left.kneeBendDeg = -20;
    const straightElbow = getMannequinArmChain(hyperextended, 'left');
    const straightKnee = getMannequinLegChain(hyperextended, 'left');

    expect(
      solveMannequinElbowIk(hyperextended, 'left', straightElbow.elbow).arms
        .left.elbowBendDeg,
    ).toBe(0);
    expect(
      solveMannequinKneeIk(hyperextended, 'left', straightKnee.knee).legs.left
        .kneeBendDeg,
    ).toBe(0);
  });

  it('treats coincident and sub-epsilon direct joint targets as no-ops', () => {
    const initial = createMannequinPose('walk-ready');
    const arm = getMannequinArmChain(initial, 'left');
    const leg = getMannequinLegChain(initial, 'left');
    const elbowSolved = solveMannequinElbowIk(initial, 'left', {
      x: arm.shoulder.x + 1e-15,
      y: arm.shoulder.y,
      z: arm.shoulder.z,
    });
    const kneeSolved = solveMannequinKneeIk(initial, 'left', {
      x: leg.hip.x + 1e-15,
      y: leg.hip.y,
      z: leg.hip.z,
    });

    expect(elbowSolved.arms.left.shoulderRotationDeg).toEqual(
      initial.arms.left.shoulderRotationDeg,
    );
    expect(kneeSolved.legs.left.hipRotationDeg).toEqual(
      initial.legs.left.hipRotationDeg,
    );
  });
});

describe('posed mannequin bounds', () => {
  it.each(
    MANNEQUIN_BODY_TYPE_IDS.flatMap((bodyType) => [
      { bodyType, torsoRotationDeg: { x: 0, y: 0, z: 0 } },
      { bodyType, torsoRotationDeg: { x: 20, y: 35, z: -10 } },
    ]),
  )(
    'contains the rendered $bodyType torso at $torsoRotationDeg',
    ({ bodyType, torsoRotationDeg }) => {
      const pose = createMannequinPose('default');
      pose.torsoRotationDeg = torsoRotationDeg;
      pose.arms.left.shoulderRotationDeg.z = 0;
      pose.arms.right.shoulderRotationDeg.z = 0;
      const rendered = renderedTorsoBounds(pose, bodyType);
      const computed = computeMannequinPoseBounds(pose, bodyType);

      expect(computed.min.x).toBeLessThanOrEqual(rendered.min.x);
      expect(computed.min.y).toBeLessThanOrEqual(rendered.min.y);
      expect(computed.min.z).toBeLessThanOrEqual(rendered.min.z);
      expect(computed.max.x).toBeGreaterThanOrEqual(rendered.max.x);
      expect(computed.max.y).toBeGreaterThanOrEqual(rendered.max.y);
      expect(computed.max.z).toBeGreaterThanOrEqual(rendered.max.z);
    },
  );

  it.each(MANNEQUIN_BODY_TYPE_IDS)(
    'contains the rendered %s foot envelope after a 180° ankle yaw',
    (bodyType) => {
      const pose = createMannequinPose('default');
      pose.legs.left.ankleRotationDeg.y = 180;
      const rendered = renderedShinAndFootBounds(pose, 'left', bodyType);
      const computed = computeMannequinPoseBounds(pose, bodyType);

      expect(computed.min.x).toBeLessThanOrEqual(rendered.min.x);
      expect(computed.min.y).toBeLessThanOrEqual(rendered.min.y);
      expect(computed.min.z).toBeLessThanOrEqual(rendered.min.z);
      expect(computed.max.x).toBeGreaterThanOrEqual(rendered.max.x);
      expect(computed.max.y).toBeGreaterThanOrEqual(rendered.max.y);
      expect(computed.max.z).toBeGreaterThanOrEqual(rendered.max.z);
    },
  );

  it.each([
    { side: 'right' as const, deviationDeg: 5, hipZDeg: -24, bendDeg: 68 },
    { side: 'left' as const, deviationDeg: -5, hipZDeg: 24, bendDeg: 112 },
  ])(
    'contains the rendered $side shin and foot at maximum $deviationDeg° knee deviation',
    ({ side, deviationDeg, hipZDeg, bendDeg }) => {
      const pose = createMannequinPose('default');
      pose.legs[side].hipRotationDeg.z = hipZDeg;
      pose.legs[side].kneeBendDeg = bendDeg;
      pose.legs[side].kneeDeviationDeg = deviationDeg;
      const rendered = renderedShinAndFootBounds(pose, side);
      const computed = computeMannequinPoseBounds(pose);

      expect(computed.min.x).toBeLessThanOrEqual(rendered.min.x);
      expect(computed.min.y).toBeLessThanOrEqual(rendered.min.y);
      expect(computed.min.z).toBeLessThanOrEqual(rendered.min.z);
      expect(computed.max.x).toBeGreaterThanOrEqual(rendered.max.x);
      expect(computed.max.y).toBeGreaterThanOrEqual(rendered.max.y);
      expect(computed.max.z).toBeGreaterThanOrEqual(rendered.max.z);
    },
  );

  it('uses the same backward knee hinge direction as FK and rendering', () => {
    const bent = createMannequinPose('default');
    bent.legs.left.kneeBendDeg = 90;
    const chain = getMannequinLegChain(bent, 'left');
    const bounds = computeMannequinPoseBounds(bent);

    expect(chain.foot.z).toBeGreaterThan(0.3);
    expect(bounds.max.z).toBeGreaterThan(chain.foot.z + 0.04);
  });

  it('includes articulated limbs and front-facing nose/toe cues', () => {
    const standing = computeMannequinPoseBounds(createMannequinPose('default'));
    const tPose = computeMannequinPoseBounds(createMannequinPose('t'));

    expect(tPose.size.x).toBeGreaterThan(standing.size.x + 0.35);
    expect(tPose.min.x).toBeLessThan(-0.7);
    expect(tPose.max.x).toBeGreaterThan(0.7);
    expect(standing.min.z).toBeLessThan(-0.2);
    expect(standing.max.z).toBeGreaterThan(0.09);
    expect(standing.min.y).toBeLessThanOrEqual(-0.85);
    expect(standing.max.y).toBeGreaterThanOrEqual(0.85);
  });

  it('contains the complete rendered hand envelope in a T pose', () => {
    const pose = createMannequinPose('t');
    const bounds = computeMannequinPoseBounds(pose);
    const leftWrist = getMannequinArmChain(pose, 'left').hand;
    const rightWrist = getMannequinArmChain(pose, 'right').hand;

    expect(bounds.min.x).toBeLessThanOrEqual(leftWrist.x - 0.114);
    expect(bounds.max.x).toBeGreaterThanOrEqual(rightWrist.x + 0.114);
  });

  it('rotates torso and wrist geometry into the posed envelope', () => {
    const pose = createMannequinPose('t');
    pose.torsoRotationDeg.y = 90;
    pose.arms.left.wristRotationDeg.z = 90;
    pose.arms.right.wristRotationDeg.z = -90;
    pose.headRotationDeg.y = 45;
    const bounds = computeMannequinPoseBounds(pose);

    expect(bounds.size.z).toBeGreaterThan(1.35);
    expect(bounds.size.x).toBeLessThan(0.65);
    expect(bounds.max.y).toBeGreaterThanOrEqual(0.85);
  });
});
