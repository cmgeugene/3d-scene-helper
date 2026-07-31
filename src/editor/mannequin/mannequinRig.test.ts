import { describe, expect, it } from 'vitest';
import { mannequinPoseSchema } from '../persistence/sceneSchema';
import {
  MANNEQUIN_ARM_ANCHORS,
  MANNEQUIN_ARM_LENGTHS,
  MANNEQUIN_FORWARD_AXIS,
  MANNEQUIN_POSE_PRESETS,
  computeMannequinPoseBounds,
  createMannequinPose,
  getMannequinArmChain,
  solveMannequinArmIk,
  solveTwoBoneArmIk,
} from './mannequinRig';

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

  it('returns an exact schema-valid maximum bend at minimum reach', () => {
    const pose = solveMannequinArmIk(
      createMannequinPose('default'),
      'left',
      MANNEQUIN_ARM_ANCHORS.left.shoulder,
    );

    expect(pose.arms.left.elbowBendDeg).toBe(150);
    expect(mannequinPoseSchema.safeParse(pose).success).toBe(true);
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

describe('posed mannequin bounds', () => {
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
