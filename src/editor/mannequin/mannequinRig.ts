import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

export interface MannequinVector3 {
  x: number;
  y: number;
  z: number;
}

export type MannequinEulerDegrees = MannequinVector3;
export type MannequinSide = 'left' | 'right';
export type MannequinLimbIkJoint = 'hand' | 'foot' | 'elbow' | 'knee';
export type MannequinIkJoint = MannequinLimbIkJoint | 'neck';
export type MannequinRotationAxis = 'x' | 'y' | 'z';

export type MannequinIkHandleDescriptor =
  { joint: 'neck' } | { side: MannequinSide; joint: MannequinLimbIkJoint };

export type MannequinPosePresetId = 'default' | 'a' | 't' | 'walk-ready';
export type MannequinPoseId = MannequinPosePresetId | 'custom';

export interface MannequinArmPose {
  shoulderRotationDeg: MannequinEulerDegrees;
  elbowBendDeg: number;
  elbowDeviationDeg: number;
  wristRotationDeg: MannequinEulerDegrees;
}

export interface MannequinLegPose {
  hipRotationDeg: MannequinEulerDegrees;
  kneeBendDeg: number;
  kneeDeviationDeg: number;
  ankleRotationDeg: MannequinEulerDegrees;
}

export interface MannequinPose {
  id: MannequinPoseId;
  torsoRotationDeg: MannequinEulerDegrees;
  headRotationDeg: MannequinEulerDegrees;
  arms: Record<MannequinSide, MannequinArmPose>;
  legs: Record<MannequinSide, MannequinLegPose>;
}

/**
 * Mannequin-local coordinates are right-handed: +X is right, +Y is up,
 * and the mannequin looks forward along -Z.
 */
export const MANNEQUIN_FORWARD_AXIS = { x: 0, y: 0, z: -1 } as const;

export const MANNEQUIN_ARM_LENGTHS = {
  upperArm: 0.31,
  forearm: 0.29,
} as const;

export const MANNEQUIN_LEG_LENGTHS = {
  thigh: 0.37,
  shin: 0.37,
} as const;

/** Fixed local-space anchors used by procedural rendering and IK handles. */
export const MANNEQUIN_ARM_ANCHORS = {
  left: {
    shoulder: { x: -0.18, y: 0.47, z: 0 },
    hand: { x: -0.2, y: -0.12, z: 0 },
  },
  right: {
    shoulder: { x: 0.18, y: 0.47, z: 0 },
    hand: { x: 0.2, y: -0.12, z: 0 },
  },
} as const;

export const MANNEQUIN_LEG_ANCHORS = {
  left: { hip: { x: -0.085, y: 0.01, z: 0 } },
  right: { hip: { x: 0.085, y: 0.01, z: 0 } },
} as const;

export const MANNEQUIN_NECK_ANCHOR = { x: 0, y: 0.62, z: 0 } as const;

const rotation = (x = 0, y = 0, z = 0): MannequinEulerDegrees => ({
  x,
  y,
  z,
});

function pose(
  id: MannequinPosePresetId,
  values: {
    leftShoulder?: MannequinEulerDegrees;
    rightShoulder?: MannequinEulerDegrees;
    leftElbow?: number;
    rightElbow?: number;
    leftHip?: MannequinEulerDegrees;
    rightHip?: MannequinEulerDegrees;
    leftKnee?: number;
    rightKnee?: number;
  } = {},
): MannequinPose {
  return {
    id,
    torsoRotationDeg: rotation(),
    headRotationDeg: rotation(),
    arms: {
      left: {
        shoulderRotationDeg: values.leftShoulder ?? rotation(),
        elbowBendDeg: values.leftElbow ?? 8,
        elbowDeviationDeg: 0,
        wristRotationDeg: rotation(),
      },
      right: {
        shoulderRotationDeg: values.rightShoulder ?? rotation(),
        elbowBendDeg: values.rightElbow ?? 8,
        elbowDeviationDeg: 0,
        wristRotationDeg: rotation(),
      },
    },
    legs: {
      left: {
        hipRotationDeg: values.leftHip ?? rotation(),
        kneeBendDeg: values.leftKnee ?? 0,
        kneeDeviationDeg: 0,
        ankleRotationDeg: rotation(),
      },
      right: {
        hipRotationDeg: values.rightHip ?? rotation(),
        kneeBendDeg: values.rightKnee ?? 0,
        kneeDeviationDeg: 0,
        ankleRotationDeg: rotation(),
      },
    },
  };
}

export const MANNEQUIN_POSE_PRESETS: Readonly<
  Record<MannequinPosePresetId, MannequinPose>
> = {
  default: pose('default', {
    leftShoulder: rotation(0, 0, -6),
    rightShoulder: rotation(0, 0, 6),
  }),
  a: pose('a', {
    leftShoulder: rotation(0, 0, -35),
    rightShoulder: rotation(0, 0, 35),
    leftElbow: 5,
    rightElbow: 5,
  }),
  t: pose('t', {
    leftShoulder: rotation(0, 0, -90),
    rightShoulder: rotation(0, 0, 90),
    leftElbow: 0,
    rightElbow: 0,
  }),
  'walk-ready': pose('walk-ready', {
    leftShoulder: rotation(-24, 0, -6),
    rightShoulder: rotation(24, 0, 6),
    leftElbow: 22,
    rightElbow: 22,
    leftHip: rotation(18),
    rightHip: rotation(-18),
    leftKnee: 8,
    rightKnee: 18,
  }),
};

export function createMannequinPose(id: MannequinPosePresetId): MannequinPose {
  return JSON.parse(
    JSON.stringify(MANNEQUIN_POSE_PRESETS[id]),
  ) as MannequinPose;
}

export interface TwoBoneArmIkRequest {
  shoulder: MannequinVector3;
  handTarget: MannequinVector3;
  pole: MannequinVector3;
  upperArmLength: number;
  forearmLength: number;
  minimumElbowBendDeg?: number;
  maximumElbowBendDeg?: number;
}

export interface TwoBoneArmIkSolution {
  shoulder: MannequinVector3;
  elbow: MannequinVector3;
  hand: MannequinVector3;
  bendDirection: MannequinVector3;
  requestedDistance: number;
  solvedDistance: number;
  elbowBendDeg: number;
  reachClamped: boolean;
}

const subtract = (
  left: MannequinVector3,
  right: MannequinVector3,
): MannequinVector3 => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});

const dot = (left: MannequinVector3, right: MannequinVector3) =>
  left.x * right.x + left.y * right.y + left.z * right.z;

const normalize = (
  vector: MannequinVector3,
  fallback: MannequinVector3,
): MannequinVector3 => {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-10
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : { ...fallback };
};

function perpendicularPoleDirection(
  axis: MannequinVector3,
  shoulder: MannequinVector3,
  pole: MannequinVector3,
): MannequinVector3 {
  const projectPerpendicular = (vector: MannequinVector3) => {
    const projection = dot(vector, axis);
    return {
      x: vector.x - axis.x * projection,
      y: vector.y - axis.y * projection,
      z: vector.z - axis.z * projection,
    };
  };
  const perpendicular = projectPerpendicular(subtract(pole, shoulder));
  if (Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z) > 1e-10) {
    return normalize(perpendicular, MANNEQUIN_FORWARD_AXIS);
  }

  for (const fallback of [
    MANNEQUIN_FORWARD_AXIS,
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 0, z: 0 },
  ]) {
    const projectedFallback = projectPerpendicular(fallback);
    if (
      Math.hypot(
        projectedFallback.x,
        projectedFallback.y,
        projectedFallback.z,
      ) > 1e-10
    ) {
      return normalize(projectedFallback, { x: 1, y: 0, z: 0 });
    }
  }

  return { x: 1, y: 0, z: 0 };
}

export function solveTwoBoneArmIk(
  request: TwoBoneArmIkRequest,
): TwoBoneArmIkSolution {
  const {
    shoulder,
    handTarget,
    pole,
    upperArmLength,
    forearmLength,
    minimumElbowBendDeg = 2,
    maximumElbowBendDeg = 160,
  } = request;
  const targetOffset = subtract(handTarget, shoulder);
  const requestedDistance = Math.hypot(
    targetOffset.x,
    targetOffset.y,
    targetOffset.z,
  );
  const axis = normalize(targetOffset, { x: 0, y: -1, z: 0 });
  const bendDirection = perpendicularPoleDirection(axis, shoulder, pole);
  const distanceAtBend = (bendDeg: number) => {
    const bendRad = (bendDeg * Math.PI) / 180;
    return Math.sqrt(
      upperArmLength ** 2 +
        forearmLength ** 2 +
        2 * upperArmLength * forearmLength * Math.cos(bendRad),
    );
  };
  const maximumReach = distanceAtBend(minimumElbowBendDeg);
  const minimumReach = distanceAtBend(maximumElbowBendDeg);
  const solvedDistance = Math.max(
    minimumReach,
    Math.min(maximumReach, requestedDistance),
  );
  const reachClamped = Math.abs(solvedDistance - requestedDistance) > 1e-12;
  const hand = reachClamped
    ? {
        x: shoulder.x + axis.x * solvedDistance,
        y: shoulder.y + axis.y * solvedDistance,
        z: shoulder.z + axis.z * solvedDistance,
      }
    : { ...handTarget };
  const along =
    (upperArmLength ** 2 - forearmLength ** 2 + solvedDistance ** 2) /
    (2 * solvedDistance);
  const bendHeight = Math.sqrt(Math.max(0, upperArmLength ** 2 - along ** 2));
  const elbow = {
    x: shoulder.x + axis.x * along + bendDirection.x * bendHeight,
    y: shoulder.y + axis.y * along + bendDirection.y * bendHeight,
    z: shoulder.z + axis.z * along + bendDirection.z * bendHeight,
  };
  const bendCosine =
    (solvedDistance ** 2 - upperArmLength ** 2 - forearmLength ** 2) /
    (2 * upperArmLength * forearmLength);
  const computedElbowBendDeg =
    (Math.acos(Math.max(-1, Math.min(1, bendCosine))) * 180) / Math.PI;
  const elbowBendDeg =
    solvedDistance <= minimumReach + 1e-12
      ? maximumElbowBendDeg
      : solvedDistance >= maximumReach - 1e-12
        ? minimumElbowBendDeg
        : Math.max(
            minimumElbowBendDeg,
            Math.min(maximumElbowBendDeg, computedElbowBendDeg),
          );

  return {
    shoulder: { ...shoulder },
    elbow,
    hand,
    bendDirection,
    requestedDistance,
    solvedDistance,
    elbowBendDeg,
    reachClamped,
  };
}

const DOWN = new Vector3(0, -1, 0);
const PELVIS_ORIGIN = new Vector3(0, 0.06, 0);

interface LimbSwingLimits {
  forward: number;
  backward: number;
  outward: number;
  inward: number;
  twist: number;
}

const ARM_SWING_LIMITS: LimbSwingLimits = {
  forward: 160,
  backward: 60,
  outward: 160,
  inward: 45,
  twist: 70,
};

const LEG_SWING_LIMITS: LimbSwingLimits = {
  forward: 120,
  backward: 30,
  outward: 55,
  inward: 20,
  twist: 45,
};
const MAX_ELBOW_FLEXION_DEG = 145;
const MAX_ELBOW_DEVIATION_DEG = 8;
const MAX_KNEE_FLEXION_DEG = 135;
const MAX_KNEE_DEVIATION_DEG = 5;
const MAX_NECK_YAW_DEG = 80;

function constrainLimbSwing(
  quaternion: Quaternion,
  side: MannequinSide,
  limits: LimbSwingLimits,
) {
  const direction = DOWN.clone().applyQuaternion(quaternion).normalize();
  const swingRad = DOWN.angleTo(direction);
  const horizontalLength = Math.hypot(direction.x, direction.z);
  let horizontalX =
    horizontalLength < 1e-12 ? 0 : direction.x / horizontalLength;
  let horizontalZ =
    horizontalLength < 1e-12 ? -1 : direction.z / horizontalLength;
  let antiparallelSwingScale = 1;
  const antiparallelBlendStart = Math.PI - MathUtils.degToRad(20);
  if (swingRad > antiparallelBlendStart) {
    const blend = Math.max(
      0,
      Math.min(1, (Math.PI - swingRad) / (Math.PI - antiparallelBlendStart)),
    );
    const mappedX = horizontalX * blend;
    const mappedZ = horizontalZ * blend - (1 - blend);
    const mappedLength = Math.hypot(mappedX, mappedZ);
    antiparallelSwingScale = Math.min(1, mappedLength);
    if (mappedLength < 1e-12) {
      horizontalX = 0;
      horizontalZ = -1;
    } else {
      horizontalX = mappedX / mappedLength;
      horizontalZ = mappedZ / mappedLength;
    }
  }
  const lateralWeight = Math.abs(horizontalX);
  const sagittalWeight = Math.abs(horizontalZ);
  const isOutward = side === 'left' ? horizontalX < 0 : horizontalX > 0;
  const lateralLimit = isOutward ? limits.outward : limits.inward;
  const sagittalLimit = horizontalZ < 0 ? limits.forward : limits.backward;
  const maximumSwingDeg =
    1 /
    Math.sqrt(
      (lateralWeight / lateralLimit) ** 2 +
        (sagittalWeight / sagittalLimit) ** 2,
    );
  const maximumSwingRad =
    MathUtils.degToRad(maximumSwingDeg) * antiparallelSwingScale;
  let constrained = quaternion.clone().normalize();
  if (swingRad > maximumSwingRad + 1e-10) {
    const swingAxis = new Vector3().crossVectors(
      DOWN,
      new Vector3(horizontalX, 0, horizontalZ),
    );
    swingAxis.normalize();
    const constrainedDirection = DOWN.clone().applyQuaternion(
      new Quaternion().setFromAxisAngle(swingAxis, maximumSwingRad),
    );
    const correction = new Quaternion().setFromUnitVectors(
      direction,
      constrainedDirection,
    );
    constrained = correction.multiply(constrained).normalize();
  }

  return constrained;
}

function constrainLimbTwist(quaternion: Quaternion, maximumTwistDeg: number) {
  const constrained = quaternion.clone().normalize();
  const twist = new Quaternion(0, constrained.y, 0, constrained.w);
  if (twist.lengthSq() < 1e-12) return constrained;
  twist.normalize();
  const swing = constrained.clone().multiply(twist.clone().invert());
  const twistRad =
    MathUtils.euclideanModulo(
      2 * Math.atan2(twist.y, twist.w) + Math.PI,
      Math.PI * 2,
    ) - Math.PI;
  const maximumTwistRad = MathUtils.degToRad(maximumTwistDeg);
  const constrainedTwist = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.max(-maximumTwistRad, Math.min(maximumTwistRad, twistRad)),
  );
  return swing.multiply(constrainedTwist).normalize();
}

function quaternionFromDegrees(rotationDeg: MannequinEulerDegrees) {
  return new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(rotationDeg.x),
      MathUtils.degToRad(rotationDeg.y),
      MathUtils.degToRad(rotationDeg.z),
      'XYZ',
    ),
  );
}

function plainVector(vector: Vector3): MannequinVector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function degreesFromQuaternion(quaternion: Quaternion): MannequinEulerDegrees {
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    x: MathUtils.radToDeg(euler.x),
    y: MathUtils.radToDeg(euler.y),
    z: MathUtils.radToDeg(euler.z),
  };
}

const MANNEQUIN_ROTATION_AXES: Record<MannequinRotationAxis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

export function applyMannequinIkRotation(
  pose: MannequinPose,
  handle: MannequinIkHandleDescriptor,
  axis: MannequinRotationAxis,
  deltaDeg: number,
): MannequinPose {
  const next = structuredClone(pose);
  if (handle.joint === 'neck' && axis !== 'y') return next;
  next.id = 'custom';

  if (handle.joint === 'neck') {
    next.headRotationDeg = {
      x: 0,
      y: MathUtils.clamp(
        pose.headRotationDeg.y + deltaDeg,
        -MAX_NECK_YAW_DEG,
        MAX_NECK_YAW_DEG,
      ),
      z: 0,
    };
    return next;
  }

  if (handle.joint === 'elbow') {
    if (axis === 'x') {
      next.arms[handle.side].elbowBendDeg = Math.max(
        0,
        Math.min(
          MAX_ELBOW_FLEXION_DEG,
          pose.arms[handle.side].elbowBendDeg + deltaDeg,
        ),
      );
    } else if (axis === 'z') {
      next.arms[handle.side].elbowDeviationDeg = MathUtils.clamp(
        pose.arms[handle.side].elbowDeviationDeg + deltaDeg,
        -MAX_ELBOW_DEVIATION_DEG,
        MAX_ELBOW_DEVIATION_DEG,
      );
    }
    return next;
  }
  if (handle.joint === 'knee') {
    if (axis === 'x') {
      next.legs[handle.side].kneeBendDeg = Math.max(
        0,
        Math.min(
          MAX_KNEE_FLEXION_DEG,
          pose.legs[handle.side].kneeBendDeg + deltaDeg,
        ),
      );
    } else if (axis === 'z') {
      next.legs[handle.side].kneeDeviationDeg = MathUtils.clamp(
        pose.legs[handle.side].kneeDeviationDeg + deltaDeg,
        -MAX_KNEE_DEVIATION_DEG,
        MAX_KNEE_DEVIATION_DEG,
      );
    }
    return next;
  }

  const currentRotation =
    handle.joint === 'hand'
      ? pose.arms[handle.side].wristRotationDeg
      : pose.legs[handle.side].ankleRotationDeg;
  const rotated = degreesFromQuaternion(
    quaternionFromDegrees(currentRotation).multiply(
      new Quaternion().setFromAxisAngle(
        MANNEQUIN_ROTATION_AXES[axis],
        MathUtils.degToRad(deltaDeg),
      ),
    ),
  );
  if (handle.joint === 'hand') {
    next.arms[handle.side].wristRotationDeg = rotated;
  } else {
    next.legs[handle.side].ankleRotationDeg = rotated;
  }
  return next;
}

export interface MannequinArmChain {
  shoulder: MannequinVector3;
  elbow: MannequinVector3;
  hand: MannequinVector3;
}

interface MannequinArmKinematics {
  shoulder: Vector3;
  elbow: Vector3;
  wrist: Vector3;
  shoulderQuaternion: Quaternion;
  elbowQuaternion: Quaternion;
  wristQuaternion: Quaternion;
}

function getMannequinArmKinematics(
  pose: MannequinPose,
  side: MannequinSide,
): MannequinArmKinematics {
  const torsoQuaternion = quaternionFromDegrees(pose.torsoRotationDeg);
  const shoulder = new Vector3(
    MANNEQUIN_ARM_ANCHORS[side].shoulder.x,
    MANNEQUIN_ARM_ANCHORS[side].shoulder.y - PELVIS_ORIGIN.y,
    MANNEQUIN_ARM_ANCHORS[side].shoulder.z,
  )
    .applyQuaternion(torsoQuaternion)
    .add(PELVIS_ORIGIN);
  const shoulderQuaternion = torsoQuaternion
    .clone()
    .multiply(quaternionFromDegrees(pose.arms[side].shoulderRotationDeg));
  const elbow = shoulder
    .clone()
    .addScaledVector(
      DOWN.clone().applyQuaternion(shoulderQuaternion),
      MANNEQUIN_ARM_LENGTHS.upperArm,
    );
  const elbowQuaternion = shoulderQuaternion.clone().multiply(
    quaternionFromDegrees({
      x: pose.arms[side].elbowBendDeg,
      y: 0,
      z: pose.arms[side].elbowDeviationDeg,
    }),
  );
  const wrist = elbow
    .clone()
    .addScaledVector(
      DOWN.clone().applyQuaternion(elbowQuaternion),
      MANNEQUIN_ARM_LENGTHS.forearm,
    );
  const wristQuaternion = elbowQuaternion
    .clone()
    .multiply(quaternionFromDegrees(pose.arms[side].wristRotationDeg));
  return {
    shoulder,
    elbow,
    wrist,
    shoulderQuaternion,
    elbowQuaternion,
    wristQuaternion,
  };
}

export function getMannequinArmChain(
  pose: MannequinPose,
  side: MannequinSide,
): MannequinArmChain {
  const { shoulder, elbow, wrist } = getMannequinArmKinematics(pose, side);
  return {
    shoulder: plainVector(shoulder),
    elbow: plainVector(elbow),
    hand: plainVector(wrist),
  };
}

export interface MannequinLegChain {
  hip: MannequinVector3;
  knee: MannequinVector3;
  foot: MannequinVector3;
}

interface MannequinLegKinematics {
  hip: Vector3;
  knee: Vector3;
  ankle: Vector3;
  hipQuaternion: Quaternion;
  kneeQuaternion: Quaternion;
  footQuaternion: Quaternion;
}

function getMannequinLegKinematics(
  pose: MannequinPose,
  side: MannequinSide,
): MannequinLegKinematics {
  const leg = pose.legs[side];
  const hip = new Vector3(
    MANNEQUIN_LEG_ANCHORS[side].hip.x,
    MANNEQUIN_LEG_ANCHORS[side].hip.y,
    MANNEQUIN_LEG_ANCHORS[side].hip.z,
  );
  const hipQuaternion = quaternionFromDegrees(leg.hipRotationDeg);
  const knee = hip
    .clone()
    .addScaledVector(
      DOWN.clone().applyQuaternion(hipQuaternion),
      MANNEQUIN_LEG_LENGTHS.thigh,
    );
  const kneeQuaternion = hipQuaternion.clone().multiply(
    quaternionFromDegrees({
      x: -leg.kneeBendDeg,
      y: 0,
      z: leg.kneeDeviationDeg,
    }),
  );
  const ankle = knee
    .clone()
    .addScaledVector(
      DOWN.clone().applyQuaternion(kneeQuaternion),
      MANNEQUIN_LEG_LENGTHS.shin,
    );
  const footQuaternion = kneeQuaternion
    .clone()
    .multiply(quaternionFromDegrees(leg.ankleRotationDeg));
  return {
    hip,
    knee,
    ankle,
    hipQuaternion,
    kneeQuaternion,
    footQuaternion,
  };
}

export function getMannequinLegChain(
  pose: MannequinPose,
  side: MannequinSide,
): MannequinLegChain {
  const { hip, knee, ankle } = getMannequinLegKinematics(pose, side);
  return {
    hip: plainVector(hip),
    knee: plainVector(knee),
    foot: plainVector(ankle),
  };
}

export function getMannequinNeckPosition(
  pose: MannequinPose,
): MannequinVector3 {
  return plainVector(
    new Vector3(
      MANNEQUIN_NECK_ANCHOR.x,
      MANNEQUIN_NECK_ANCHOR.y - PELVIS_ORIGIN.y,
      MANNEQUIN_NECK_ANCHOR.z,
    )
      .applyQuaternion(quaternionFromDegrees(pose.torsoRotationDeg))
      .add(PELVIS_ORIGIN),
  );
}

export function getMannequinIkRotationFrame(
  pose: MannequinPose,
  handle: MannequinIkHandleDescriptor,
): Quaternion {
  if (handle.joint === 'neck') {
    return quaternionFromDegrees(pose.torsoRotationDeg).multiply(
      quaternionFromDegrees({ x: 0, y: pose.headRotationDeg.y, z: 0 }),
    );
  }
  if (handle.joint === 'hand' || handle.joint === 'elbow') {
    const arm = getMannequinArmKinematics(pose, handle.side);
    if (handle.joint === 'hand') return arm.wristQuaternion.clone();
    return arm.shoulderQuaternion
      .clone()
      .multiply(
        new Quaternion().setFromAxisAngle(
          MANNEQUIN_ROTATION_AXES.x,
          MathUtils.degToRad(pose.arms[handle.side].elbowBendDeg),
        ),
      );
  }

  const leg = pose.legs[handle.side];
  const hipQuaternion = quaternionFromDegrees(leg.hipRotationDeg);
  const bentKneeQuaternion = new Quaternion().setFromAxisAngle(
    MANNEQUIN_ROTATION_AXES.x,
    -MathUtils.degToRad(leg.kneeBendDeg),
  );
  if (handle.joint === 'knee') {
    return hipQuaternion.multiply(bentKneeQuaternion);
  }
  return hipQuaternion
    .multiply(
      quaternionFromDegrees({
        x: -leg.kneeBendDeg,
        y: 0,
        z: leg.kneeDeviationDeg,
      }),
    )
    .multiply(quaternionFromDegrees(leg.ankleRotationDeg));
}

function quaternionMappingDirectionPairs(
  sourceUpper: Vector3,
  sourceLower: Vector3,
  targetUpper: Vector3,
  targetLower: Vector3,
) {
  const frameQuaternion = (upper: Vector3, lower: Vector3) => {
    const primary = upper.clone().normalize();
    const secondary = lower
      .clone()
      .addScaledVector(primary, -lower.dot(primary));
    if (secondary.lengthSq() < 1e-12) {
      const fallback = new Vector3(
        MANNEQUIN_FORWARD_AXIS.x,
        MANNEQUIN_FORWARD_AXIS.y,
        MANNEQUIN_FORWARD_AXIS.z,
      );
      if (Math.abs(primary.dot(fallback)) > 0.99) fallback.set(1, 0, 0);
      secondary
        .copy(fallback)
        .addScaledVector(primary, -fallback.dot(primary))
        .normalize();
    } else {
      secondary.normalize();
    }
    const tertiary = new Vector3().crossVectors(primary, secondary).normalize();
    secondary.crossVectors(tertiary, primary).normalize();
    return new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(primary, secondary, tertiary),
    );
  };

  return frameQuaternion(targetUpper, targetLower)
    .multiply(frameQuaternion(sourceUpper, sourceLower).invert())
    .normalize();
}

export function solveMannequinArmIk(
  pose: MannequinPose,
  side: MannequinSide,
  handTarget: MannequinVector3,
): MannequinPose {
  const torsoQuaternion = quaternionFromDegrees(pose.torsoRotationDeg);
  const inverseTorsoQuaternion = torsoQuaternion.clone().invert();
  const currentElbow = getMannequinArmChain(pose, side).elbow;
  const shoulder = {
    x: MANNEQUIN_ARM_ANCHORS[side].shoulder.x,
    y: MANNEQUIN_ARM_ANCHORS[side].shoulder.y - PELVIS_ORIGIN.y,
    z: MANNEQUIN_ARM_ANCHORS[side].shoulder.z,
  };
  const localTarget = new Vector3(handTarget.x, handTarget.y, handTarget.z)
    .sub(PELVIS_ORIGIN)
    .applyQuaternion(inverseTorsoQuaternion);
  const localElbowPole = new Vector3(
    currentElbow.x,
    currentElbow.y,
    currentElbow.z,
  )
    .sub(PELVIS_ORIGIN)
    .applyQuaternion(inverseTorsoQuaternion);
  if (pose.arms[side].elbowBendDeg <= 2) {
    localElbowPole
      .set(shoulder.x, shoulder.y, shoulder.z)
      .add(
        new Vector3(0, 0, 1).applyQuaternion(
          quaternionFromDegrees(pose.arms[side].shoulderRotationDeg),
        ),
      );
  }
  const solution = solveTwoBoneArmIk({
    shoulder,
    handTarget: plainVector(localTarget),
    pole: plainVector(localElbowPole),
    upperArmLength: MANNEQUIN_ARM_LENGTHS.upperArm,
    forearmLength: MANNEQUIN_ARM_LENGTHS.forearm,
    maximumElbowBendDeg: MAX_ELBOW_FLEXION_DEG,
  });
  const upper = new Vector3(
    solution.elbow.x - shoulder.x,
    solution.elbow.y - shoulder.y,
    solution.elbow.z - shoulder.z,
  ).normalize();
  const lower = new Vector3(
    solution.hand.x - solution.elbow.x,
    solution.hand.y - solution.elbow.y,
    solution.hand.z - solution.elbow.z,
  ).normalize();
  const totalBendRad = MathUtils.degToRad(solution.elbowBendDeg);
  const requestedDeviationRad = MathUtils.degToRad(
    MathUtils.clamp(
      pose.arms[side].elbowDeviationDeg,
      -MAX_ELBOW_DEVIATION_DEG,
      MAX_ELBOW_DEVIATION_DEG,
    ),
  );
  const deviationSign = Math.sign(requestedDeviationRad) || 1;
  let deviationRad = Math.min(Math.abs(requestedDeviationRad), totalBendRad);
  let elbowBendRad = Math.acos(
    MathUtils.clamp(Math.cos(totalBendRad) / Math.cos(deviationRad), -1, 1),
  );
  const maximumElbowBendRad = MathUtils.degToRad(MAX_ELBOW_FLEXION_DEG);
  if (elbowBendRad > maximumElbowBendRad) {
    elbowBendRad = maximumElbowBendRad;
    deviationRad = Math.acos(
      MathUtils.clamp(
        Math.cos(totalBendRad) / Math.cos(maximumElbowBendRad),
        -1,
        1,
      ),
    );
  }
  deviationRad *= deviationSign;
  const elbowQuaternion = quaternionFromDegrees({
    x: MathUtils.radToDeg(elbowBendRad),
    y: 0,
    z: MathUtils.radToDeg(deviationRad),
  });
  const shoulderQuaternion = quaternionMappingDirectionPairs(
    DOWN,
    DOWN.clone().applyQuaternion(elbowQuaternion),
    upper,
    lower,
  );
  const nextPose = JSON.parse(JSON.stringify(pose)) as MannequinPose;
  nextPose.id = 'custom';
  nextPose.arms[side].shoulderRotationDeg = degreesFromQuaternion(
    constrainLimbSwing(shoulderQuaternion, side, ARM_SWING_LIMITS),
  );
  nextPose.arms[side].elbowBendDeg = MathUtils.radToDeg(elbowBendRad);
  nextPose.arms[side].elbowDeviationDeg = MathUtils.radToDeg(deviationRad);
  return nextPose;
}

export function solveMannequinLegIk(
  pose: MannequinPose,
  side: MannequinSide,
  footTarget: MannequinVector3,
): MannequinPose {
  const hip = MANNEQUIN_LEG_ANCHORS[side].hip;
  const solution = solveTwoBoneArmIk({
    shoulder: hip,
    handTarget: footTarget,
    pole: { x: hip.x, y: hip.y, z: hip.z - 1 },
    upperArmLength: MANNEQUIN_LEG_LENGTHS.thigh,
    forearmLength: MANNEQUIN_LEG_LENGTHS.shin,
    minimumElbowBendDeg: 0,
    maximumElbowBendDeg: MAX_KNEE_FLEXION_DEG,
  });
  const upper = new Vector3(
    solution.elbow.x - hip.x,
    solution.elbow.y - hip.y,
    solution.elbow.z - hip.z,
  ).normalize();
  const lower = new Vector3(
    solution.hand.x - solution.elbow.x,
    solution.hand.y - solution.elbow.y,
    solution.hand.z - solution.elbow.z,
  ).normalize();
  const totalBendRad = MathUtils.degToRad(solution.elbowBendDeg);
  const requestedDeviationRad = MathUtils.degToRad(
    MathUtils.clamp(
      pose.legs[side].kneeDeviationDeg,
      -MAX_KNEE_DEVIATION_DEG,
      MAX_KNEE_DEVIATION_DEG,
    ),
  );
  const deviationSign = Math.sign(requestedDeviationRad) || 1;
  let deviationRad = Math.min(Math.abs(requestedDeviationRad), totalBendRad);
  let kneeBendRad = Math.acos(
    MathUtils.clamp(Math.cos(totalBendRad) / Math.cos(deviationRad), -1, 1),
  );
  const maximumKneeBendRad = MathUtils.degToRad(MAX_KNEE_FLEXION_DEG);
  if (kneeBendRad > maximumKneeBendRad) {
    kneeBendRad = maximumKneeBendRad;
    deviationRad = Math.acos(
      MathUtils.clamp(
        Math.cos(totalBendRad) / Math.cos(maximumKneeBendRad),
        -1,
        1,
      ),
    );
  }
  deviationRad *= deviationSign;
  const kneeQuaternion = quaternionFromDegrees({
    x: -MathUtils.radToDeg(kneeBendRad),
    y: 0,
    z: MathUtils.radToDeg(deviationRad),
  });
  const hipQuaternion = quaternionMappingDirectionPairs(
    DOWN,
    DOWN.clone().applyQuaternion(kneeQuaternion),
    upper,
    lower,
  );
  const nextPose = structuredClone(pose);
  nextPose.id = 'custom';
  nextPose.legs[side].hipRotationDeg = degreesFromQuaternion(
    constrainLimbSwing(hipQuaternion, side, LEG_SWING_LIMITS),
  );
  nextPose.legs[side].kneeBendDeg = MathUtils.radToDeg(kneeBendRad);
  nextPose.legs[side].kneeDeviationDeg = MathUtils.radToDeg(deviationRad);
  return nextPose;
}

function aimRotationAtTarget(
  currentRotation: MannequinEulerDegrees,
  origin: Vector3,
  target: Vector3,
  side: MannequinSide,
  limits: LimbSwingLimits,
) {
  const currentQuaternion = quaternionFromDegrees(currentRotation);
  const currentDirection = DOWN.clone().applyQuaternion(currentQuaternion);
  const targetOffset = target.sub(origin);
  if (targetOffset.lengthSq() < 1e-12) return currentRotation;
  const targetDirection = targetOffset.normalize();
  const delta = new Quaternion().setFromUnitVectors(
    currentDirection,
    targetDirection,
  );
  return degreesFromQuaternion(
    constrainLimbTwist(
      constrainLimbSwing(delta.multiply(currentQuaternion), side, limits),
      limits.twist,
    ),
  );
}

export function solveMannequinElbowIk(
  pose: MannequinPose,
  side: MannequinSide,
  elbowTarget: MannequinVector3,
): MannequinPose {
  const torsoQuaternion = quaternionFromDegrees(pose.torsoRotationDeg);
  const targetInTorso = new Vector3(elbowTarget.x, elbowTarget.y, elbowTarget.z)
    .sub(PELVIS_ORIGIN)
    .applyQuaternion(torsoQuaternion.clone().invert());
  const shoulderInTorso = new Vector3(
    MANNEQUIN_ARM_ANCHORS[side].shoulder.x,
    MANNEQUIN_ARM_ANCHORS[side].shoulder.y - PELVIS_ORIGIN.y,
    MANNEQUIN_ARM_ANCHORS[side].shoulder.z,
  );
  const nextPose = structuredClone(pose);
  nextPose.id = 'custom';
  nextPose.arms[side].shoulderRotationDeg = aimRotationAtTarget(
    pose.arms[side].shoulderRotationDeg,
    shoulderInTorso,
    targetInTorso,
    side,
    ARM_SWING_LIMITS,
  );
  nextPose.arms[side].elbowBendDeg = MathUtils.clamp(
    pose.arms[side].elbowBendDeg,
    0,
    MAX_ELBOW_FLEXION_DEG,
  );
  return nextPose;
}

export function solveMannequinKneeIk(
  pose: MannequinPose,
  side: MannequinSide,
  kneeTarget: MannequinVector3,
): MannequinPose {
  const hip = new Vector3(
    MANNEQUIN_LEG_ANCHORS[side].hip.x,
    MANNEQUIN_LEG_ANCHORS[side].hip.y,
    MANNEQUIN_LEG_ANCHORS[side].hip.z,
  );
  const nextPose = structuredClone(pose);
  nextPose.id = 'custom';
  nextPose.legs[side].hipRotationDeg = aimRotationAtTarget(
    pose.legs[side].hipRotationDeg,
    hip,
    new Vector3(kneeTarget.x, kneeTarget.y, kneeTarget.z),
    side,
    LEG_SWING_LIMITS,
  );
  nextPose.legs[side].kneeBendDeg = MathUtils.clamp(
    pose.legs[side].kneeBendDeg,
    0,
    MAX_KNEE_FLEXION_DEG,
  );
  return nextPose;
}

export interface MannequinPoseBounds {
  min: MannequinVector3;
  max: MannequinVector3;
  size: MannequinVector3;
  center: MannequinVector3;
}

export function computeMannequinPoseBounds(
  pose: MannequinPose,
): MannequinPoseBounds {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const include = (point: Vector3, radius = 0) => {
    min.min(point.clone().addScalar(-radius));
    max.max(point.clone().addScalar(radius));
  };
  const includeBox = (
    center: Vector3,
    halfSize: Vector3,
    quaternion = new Quaternion(),
  ) => {
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) {
          include(
            new Vector3(x * halfSize.x, y * halfSize.y, z * halfSize.z)
              .applyQuaternion(quaternion)
              .add(center),
          );
        }
      }
    }
  };
  const transformPoint = (
    point: Vector3,
    origin: Vector3,
    quaternion: Quaternion,
  ) => point.clone().applyQuaternion(quaternion).add(origin);
  const includeChildBox = (
    localCenter: Vector3,
    halfSize: Vector3,
    origin: Vector3,
    quaternion: Quaternion,
  ) =>
    includeBox(
      transformPoint(localCenter, origin, quaternion),
      halfSize,
      quaternion,
    );

  includeBox(new Vector3(0, PELVIS_ORIGIN.y, 0), new Vector3(0.15, 0.1, 0.096));

  const torsoQuaternion = quaternionFromDegrees(pose.torsoRotationDeg);
  includeChildBox(
    new Vector3(0, 0.265, -0.0145),
    new Vector3(0.19, 0.235, 0.1555),
    PELVIS_ORIGIN,
    torsoQuaternion,
  );
  includeChildBox(
    new Vector3(0, 0.36, -0.16),
    new Vector3(0.015, 0.045, 0.008),
    PELVIS_ORIGIN,
    torsoQuaternion,
  );
  includeChildBox(
    new Vector3(0, 0.34, 0.134),
    new Vector3(0.013, 0.029, 0.007),
    PELVIS_ORIGIN,
    torsoQuaternion,
  );

  const headOrigin = transformPoint(
    new Vector3(0, 0.66, 0),
    PELVIS_ORIGIN,
    torsoQuaternion,
  );
  const headQuaternion = torsoQuaternion
    .clone()
    .multiply(quaternionFromDegrees({ x: 0, y: pose.headRotationDeg.y, z: 0 }));
  includeChildBox(
    new Vector3(0, -0.1025, 0),
    new Vector3(0.057, 0.0675, 0.053),
    headOrigin,
    headQuaternion,
  );
  includeChildBox(
    new Vector3(0, 0, 0.008),
    new Vector3(0.119, 0.13, 0.11),
    headOrigin,
    headQuaternion,
  );
  includeChildBox(
    new Vector3(0, -0.012, -0.102),
    new Vector3(0.024, 0.024, 0.036),
    headOrigin,
    headQuaternion,
  );

  for (const side of ['left', 'right'] as const) {
    const arm = getMannequinArmKinematics(pose, side);
    include(arm.shoulder, 0.058);
    includeBox(
      arm.shoulder
        .clone()
        .addScaledVector(
          DOWN.clone().applyQuaternion(arm.shoulderQuaternion),
          MANNEQUIN_ARM_LENGTHS.upperArm / 2,
        ),
      new Vector3(0.061, MANNEQUIN_ARM_LENGTHS.upperArm / 2, 0.061),
      arm.shoulderQuaternion,
    );
    include(arm.elbow, 0.048);
    includeBox(
      arm.elbow
        .clone()
        .addScaledVector(
          DOWN.clone().applyQuaternion(arm.elbowQuaternion),
          MANNEQUIN_ARM_LENGTHS.forearm / 2,
        ),
      new Vector3(0.058, MANNEQUIN_ARM_LENGTHS.forearm / 2, 0.058),
      arm.elbowQuaternion,
    );
    includeChildBox(
      new Vector3(0, -0.065, 0),
      new Vector3(0.046, 0.08, 0.029),
      arm.wrist,
      arm.wristQuaternion,
    );
    includeChildBox(
      new Vector3(side === 'left' ? 0.027 : -0.027, -0.05, -0.003),
      new Vector3(0.009, 0.021, 0.009),
      arm.wrist,
      arm.wristQuaternion
        .clone()
        .multiply(
          new Quaternion().setFromEuler(
            new Euler(0, 0, side === 'left' ? -0.42 : 0.42),
          ),
        ),
    );
    const { hip, knee, ankle, hipQuaternion, kneeQuaternion, footQuaternion } =
      getMannequinLegKinematics(pose, side);
    include(hip, 0.06);
    includeBox(
      hip
        .clone()
        .addScaledVector(DOWN.clone().applyQuaternion(hipQuaternion), 0.185),
      new Vector3(0.078, 0.185, 0.072),
      hipQuaternion,
    );
    include(knee, 0.048);
    includeBox(
      knee
        .clone()
        .addScaledVector(DOWN.clone().applyQuaternion(kneeQuaternion), 0.185),
      new Vector3(0.064, 0.185, 0.061),
      kneeQuaternion,
    );
    includeChildBox(
      new Vector3(0, -0.05, -0.085),
      new Vector3(0.08, 0.07, 0.15),
      ankle,
      footQuaternion,
    );
    include(ankle, 0.038);
  }

  const size = max.clone().sub(min);
  const center = min.clone().add(max).multiplyScalar(0.5);
  return {
    min: plainVector(min),
    max: plainVector(max),
    size: plainVector(size),
    center: plainVector(center),
  };
}
