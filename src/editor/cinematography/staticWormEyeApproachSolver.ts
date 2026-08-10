import type { MannequinCinematicLandmarks } from '../mannequin/mannequinRig';
import type { SceneDocument } from '../persistence/sceneSchema';
import type { CinematicSubjectProfile, Vec3 } from './cinematicSubjectProfile';
import {
  computeCinematicProjectionMetrics,
  type CinematicProjectionMetrics,
} from './projectionMetrics';

export type StaticWormEyeActionPhase = 'support-contact' | 'flight';
export type StaticWormEyeSupportFoot = 'left' | 'right';
export type StaticWormEyeCameraMotion = 'none';

export interface StaticWormEyeApproachIntent {
  subject: CinematicSubjectProfile;
  motionDirection: Vec3;
  actionPhase: StaticWormEyeActionPhase;
  supportFoot?: StaticWormEyeSupportFoot;
  floorTopY: number;
  groundClearanceM: number;
  lensMm: number;
  cameraHeightM: number;
  outputAspect: number;
  targetOccupancy: number;
  intensity: number;
  cameraMotion: StaticWormEyeCameraMotion;
}

export type StaticWormEyeRejectionReason =
  | 'approach-misaligned'
  | 'camera-height-out-of-range'
  | 'critical-leading-limb-clipped'
  | 'flight-not-airborne'
  | 'free-foot-too-low'
  | 'ground-room-insufficient'
  | 'head-clipped'
  | 'invalid-action-silhouette'
  | 'invalid-camera-motion'
  | 'invalid-clearance'
  | 'invalid-floor'
  | 'invalid-input'
  | 'invalid-motion-direction'
  | 'invalid-subject-profile'
  | 'invalid-support-foot'
  | 'no-candidate'
  | 'occupancy-out-of-range'
  | 'ordinary-low-angle'
  | 'pelvis-dominant'
  | 'support-contact-mismatch';

export interface StaticWormEyeSubjectStaging {
  yawDeltaDeg: number;
  translationDelta: Vec3;
  groundingDeltaY: number;
}

export interface StaticWormEyeCandidateDiagnostics {
  accepted: boolean;
  rejectionReasons: readonly StaticWormEyeRejectionReason[];
  approachAlignment: number;
  cameraHeightM: number;
  cameraHeightAboveFloorM: number;
  upwardPitchDeg: number;
  groundRoom: number;
  headroom: number;
  leadingSide: StaticWormEyeSupportFoot;
  leadingKneePelvisSeparation: number;
  leadingFootPelvisSeparation: number;
  pelvisDominanceRatio: number;
  opposingLimbPhase: boolean;
  handsBelowHead: boolean;
  supportContactErrorM: number | null;
  supportFootWorldY: number | null;
  minimumFootClearanceM: number;
  freeFootClearanceM: number | null;
  componentScores: {
    approach: number;
    occupancy: number;
    upwardPerspective: number;
    groundRoom: number;
    actionSilhouette: number;
  };
}

export interface StaticWormEyeApproachProposal {
  id: string;
  score: number;
  camera: SceneDocument['outputCamera'];
  cameraMotion: 'none';
  subjectStaging: StaticWormEyeSubjectStaging;
  transformedApproachDirection: Vec3;
  transformedSubject: CinematicSubjectProfile;
  actionPhase: StaticWormEyeActionPhase;
  supportFoot: StaticWormEyeSupportFoot | null;
  metrics: CinematicProjectionMetrics;
  diagnostics: StaticWormEyeCandidateDiagnostics;
}

export interface StaticWormEyeApproachResult {
  accepted: boolean;
  proposal: StaticWormEyeApproachProposal | null;
  diagnostics: {
    evaluatedCount: number;
    failureReasons: readonly StaticWormEyeRejectionReason[];
    rejected: readonly StaticWormEyeApproachProposal[];
  };
}

export interface StaticWormEyeValidationResult {
  valid: boolean;
  reasons: readonly StaticWormEyeRejectionReason[];
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const EPSILON = 1e-10;
const CAMERA_HEIGHT_MIN_M = 0.05;
const CAMERA_HEIGHT_MAX_M = 0.15;
const OCCUPANCY_MIN = 0.65;
const OCCUPANCY_MAX = 0.85;
const SUPPORT_TOLERANCE_M = 1e-7;
const REJECTION_REASON_ORDER: readonly StaticWormEyeRejectionReason[] = [
  'approach-misaligned',
  'camera-height-out-of-range',
  'occupancy-out-of-range',
  'ordinary-low-angle',
  'head-clipped',
  'critical-leading-limb-clipped',
  'pelvis-dominant',
  'invalid-action-silhouette',
  'free-foot-too-low',
  'ground-room-insufficient',
  'support-contact-mismatch',
  'flight-not-airborne',
  'invalid-camera-motion',
  'invalid-clearance',
  'invalid-floor',
  'invalid-input',
  'invalid-motion-direction',
  'invalid-subject-profile',
  'invalid-support-foot',
  'no-candidate',
];
const LANDMARK_KEYS = [
  'eyeCenter',
  'faceCenter',
  'headTop',
  'headLeft',
  'headRight',
  'neck',
  'chest',
  'pelvis',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftHand',
  'rightHand',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftFoot',
  'rightFoot',
] as const satisfies readonly (keyof MannequinCinematicLandmarks)[];

const round = (value: number) => Math.round(value * 1e9) / 1e9;
const add = (left: Vec3, right: Vec3): Vec3 => ({
  x: left.x + right.x,
  y: left.y + right.y,
  z: left.z + right.z,
});
const subtract = (left: Vec3, right: Vec3): Vec3 => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});
const scale = (value: Vec3, amount: number): Vec3 => ({
  x: value.x * amount,
  y: value.y * amount,
  z: value.z * amount,
});
const dot = (left: Vec3, right: Vec3) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const length = (value: Vec3) => Math.hypot(value.x, value.y, value.z);
const normalize = (value: Vec3): Vec3 => {
  const magnitude = length(value);
  if (magnitude <= EPSILON) return { x: 0, y: 0, z: 0 };
  return scale(value, 1 / magnitude);
};
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));
const closeness = (value: number, target: number, tolerance: number) =>
  clamp(1 - Math.abs(value - target) / tolerance, 0, 1);

function finiteVector(value: Vec3) {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}

function horizontal(value: Vec3): Vec3 {
  return normalize({ x: value.x, y: 0, z: value.z });
}

function signedYawDeg(from: Vec3, to: Vec3) {
  const fromAngle = Math.atan2(from.x, from.z);
  const toAngle = Math.atan2(to.x, to.z);
  let delta = ((toAngle - fromAngle) * 180) / Math.PI;
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;
  return round(delta);
}

function rotateYaw(point: Vec3, pivot: Vec3, yawDeg: number): Vec3 {
  const radians = (yawDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localX = point.x - pivot.x;
  const localZ = point.z - pivot.z;
  return {
    x: pivot.x + localX * cosine + localZ * sine,
    y: point.y,
    z: pivot.z - localX * sine + localZ * cosine,
  };
}

function rotateYawDirection(direction: Vec3, yawDeg: number): Vec3 {
  return rotateYaw(direction, { x: 0, y: 0, z: 0 }, yawDeg);
}

function translated(point: Vec3, delta: Vec3): Vec3 {
  return add(point, delta);
}

function boundsFromPoints(points: readonly Vec3[]) {
  const min = {
    x: Math.min(...points.map(({ x }) => x)),
    y: Math.min(...points.map(({ y }) => y)),
    z: Math.min(...points.map(({ z }) => z)),
  };
  const max = {
    x: Math.max(...points.map(({ x }) => x)),
    y: Math.max(...points.map(({ y }) => y)),
    z: Math.max(...points.map(({ z }) => z)),
  };
  return {
    min,
    max,
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
  };
}

function transformedProfile(
  subject: CinematicSubjectProfile,
  yawDeltaDeg: number,
  translationDelta: Vec3,
): CinematicSubjectProfile {
  const pivot = subject.landmarks.pelvis;
  const transformPoint = (point: Vec3) =>
    translated(rotateYaw(point, pivot, yawDeltaDeg), translationDelta);
  const landmarks = Object.fromEntries(
    LANDMARK_KEYS.map((key) => [key, transformPoint(subject.landmarks[key])]),
  ) as unknown as MannequinCinematicLandmarks;
  landmarks.faceForward = normalize(
    rotateYawDirection(subject.landmarks.faceForward, yawDeltaDeg),
  );
  const outline = subject.outline.map(transformPoint);
  return {
    objectId: subject.objectId,
    bounds: boundsFromPoints(outline),
    landmarks,
    outline,
    basis: {
      forward: normalize(
        rotateYawDirection(subject.basis.forward, yawDeltaDeg),
      ),
      right: normalize(rotateYawDirection(subject.basis.right, yawDeltaDeg)),
      up: normalize(rotateYawDirection(subject.basis.up, yawDeltaDeg)),
      faceForward: landmarks.faceForward,
    },
  };
}

function stagedSubject(
  intent: StaticWormEyeApproachIntent,
  approachDistanceM: number,
) {
  const motion = horizontal(intent.motionDirection);
  const forward = horizontal(intent.subject.basis.forward);
  const yawDeltaDeg = signedYawDeg(forward, motion);
  const rotated = transformedProfile(intent.subject, yawDeltaDeg, {
    x: 0,
    y: 0,
    z: 0,
  });
  const horizontalDelta = {
    x: -motion.x * approachDistanceM - rotated.landmarks.pelvis.x,
    y: 0,
    z: -motion.z * approachDistanceM - rotated.landmarks.pelvis.z,
  };
  const horizontalStaged = transformedProfile(
    intent.subject,
    yawDeltaDeg,
    horizontalDelta,
  );
  const supportFoot = intent.supportFoot ?? null;
  const groundingDeltaY =
    intent.actionPhase === 'support-contact' && supportFoot !== null
      ? intent.floorTopY +
        intent.groundClearanceM -
        horizontalStaged.landmarks[`${supportFoot}Foot`].y
      : 0;
  const translationDelta = {
    ...horizontalDelta,
    y: round(groundingDeltaY),
  };
  return {
    motion,
    profile: transformedProfile(intent.subject, yawDeltaDeg, translationDelta),
    staging: {
      yawDeltaDeg,
      translationDelta,
      groundingDeltaY: round(groundingDeltaY),
    },
  };
}

function candidateCamera(
  intent: StaticWormEyeApproachIntent,
  profile: CinematicSubjectProfile,
  aimWeight: number,
  aimYOffsetM: number,
): SceneDocument['outputCamera'] {
  const cameraPosition = { x: 0, y: intent.cameraHeightM, z: 0 };
  const weightedAim = add(
    scale(profile.landmarks.chest, 1 - aimWeight),
    scale(profile.landmarks.faceCenter, aimWeight),
  );
  return {
    position: {
      x: round(cameraPosition.x),
      y: round(intent.cameraHeightM),
      z: round(cameraPosition.z),
    },
    target: {
      x: round(weightedAim.x),
      y: round(
        Math.max(
          weightedAim.y + aimYOffsetM,
          profile.landmarks.pelvis.y + 0.08,
        ),
      ),
      z: round(weightedAim.z),
    },
    focalLengthMm: intent.lensMm,
    rollDeg: 0,
  };
}

function diagnosticsForCandidate(
  intent: StaticWormEyeApproachIntent,
  profile: CinematicSubjectProfile,
  motion: Vec3,
  camera: SceneDocument['outputCamera'],
  metrics: CinematicProjectionMetrics,
): StaticWormEyeCandidateDiagnostics {
  const subjectToCamera = horizontal(
    subtract(camera.position, profile.landmarks.pelvis),
  );
  const approachAlignment = dot(motion, subjectToCamera);
  const cameraForward = normalize(subtract(camera.target, camera.position));
  const upwardPitchDeg =
    (Math.asin(clamp(dot(cameraForward, UP), -1, 1)) * 180) / Math.PI;
  const leftLead = dot(
    subtract(profile.landmarks.leftFoot, profile.landmarks.pelvis),
    motion,
  );
  const rightLead = dot(
    subtract(profile.landmarks.rightFoot, profile.landmarks.pelvis),
    motion,
  );
  const leadingSide: StaticWormEyeSupportFoot =
    leftLead >= rightLead ? 'left' : 'right';
  const leadingKnee = metrics.landmarks[`${leadingSide}Knee`];
  const leadingFoot = metrics.landmarks[`${leadingSide}Foot`];
  const pelvis = metrics.landmarks.pelvis;
  const leadingKneePelvisSeparation = Math.hypot(
    leadingKnee.ndc.x - pelvis.ndc.x,
    leadingKnee.ndc.y - pelvis.ndc.y,
  );
  const leadingFootPelvisSeparation = Math.hypot(
    leadingFoot.ndc.x - pelvis.ndc.x,
    leadingFoot.ndc.y - pelvis.ndc.y,
  );
  const headPelvisSeparation = Math.hypot(
    metrics.landmarks.headTop.ndc.x - pelvis.ndc.x,
    metrics.landmarks.headTop.ndc.y - pelvis.ndc.y,
  );
  const pelvisDominanceRatio =
    leadingFootPelvisSeparation / Math.max(headPelvisSeparation, EPSILON);
  const handPhase = dot(
    subtract(profile.landmarks.leftHand, profile.landmarks.rightHand),
    motion,
  );
  const footPhase = dot(
    subtract(profile.landmarks.leftFoot, profile.landmarks.rightFoot),
    motion,
  );
  const opposingLimbPhase = handPhase * footPhase < -0.002;
  const handsBelowHead =
    profile.landmarks.leftHand.y < profile.landmarks.headTop.y - 0.02 &&
    profile.landmarks.rightHand.y < profile.landmarks.headTop.y - 0.02;
  const supportContactErrorM =
    intent.actionPhase === 'support-contact' && intent.supportFoot !== undefined
      ? Math.abs(
          profile.landmarks[`${intent.supportFoot}Foot`].y -
            (intent.floorTopY + intent.groundClearanceM),
        )
      : null;
  const supportFootWorldY =
    intent.actionPhase === 'support-contact' && intent.supportFoot !== undefined
      ? profile.landmarks[`${intent.supportFoot}Foot`].y
      : null;
  const freeFootClearanceM =
    intent.actionPhase === 'support-contact' && intent.supportFoot !== undefined
      ? profile.landmarks[
          `${intent.supportFoot === 'left' ? 'right' : 'left'}Foot`
        ].y - intent.floorTopY
      : null;
  const minimumFootClearanceM = Math.min(
    profile.landmarks.leftFoot.y - intent.floorTopY,
    profile.landmarks.rightFoot.y - intent.floorTopY,
  );
  const groundAnchorSide =
    intent.actionPhase === 'support-contact' && intent.supportFoot !== undefined
      ? intent.supportFoot
      : leadingSide;
  const groundAnchor = metrics.landmarks[`${groundAnchorSide}Foot`];
  const groundRoom = clamp((groundAnchor.ndc.y + 1) / 2, 0, 1);
  const headroom = metrics.headroom ?? -1;
  const rejectionReasons: StaticWormEyeRejectionReason[] = [];
  if (approachAlignment < 0.985) rejectionReasons.push('approach-misaligned');
  if (
    camera.position.y < CAMERA_HEIGHT_MIN_M ||
    camera.position.y > CAMERA_HEIGHT_MAX_M
  ) {
    rejectionReasons.push('camera-height-out-of-range');
  }
  if (
    metrics.occupancy.height < OCCUPANCY_MIN ||
    metrics.occupancy.height > OCCUPANCY_MAX
  ) {
    rejectionReasons.push('occupancy-out-of-range');
  }
  if (upwardPitchDeg < 12) rejectionReasons.push('ordinary-low-angle');
  if (
    !metrics.landmarks.headTop.insideFrame ||
    !metrics.landmarks.faceCenter.insideFrame
  ) {
    rejectionReasons.push('head-clipped');
  }
  if (!leadingKnee.insideFrame || !leadingFoot.insideFrame) {
    rejectionReasons.push('critical-leading-limb-clipped');
  }
  if (pelvisDominanceRatio > 1.5) rejectionReasons.push('pelvis-dominant');
  if (groundRoom < 0.025) rejectionReasons.push('ground-room-insufficient');
  if (
    !opposingLimbPhase ||
    !handsBelowHead ||
    leadingKneePelvisSeparation < 0.08 ||
    leadingFootPelvisSeparation < 0.12
  ) {
    rejectionReasons.push('invalid-action-silhouette');
  }
  if (
    supportContactErrorM !== null &&
    supportContactErrorM > SUPPORT_TOLERANCE_M
  ) {
    rejectionReasons.push('support-contact-mismatch');
  }
  if (freeFootClearanceM !== null && freeFootClearanceM < 0.12) {
    rejectionReasons.push('free-foot-too-low');
  }
  if (
    intent.actionPhase === 'flight' &&
    minimumFootClearanceM <= intent.groundClearanceM
  ) {
    rejectionReasons.push('flight-not-airborne');
  }
  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    approachAlignment: round(approachAlignment),
    cameraHeightM: camera.position.y,
    cameraHeightAboveFloorM: round(camera.position.y - intent.floorTopY),
    upwardPitchDeg: round(upwardPitchDeg),
    groundRoom: round(groundRoom),
    headroom: round(headroom),
    leadingSide,
    leadingKneePelvisSeparation: round(leadingKneePelvisSeparation),
    leadingFootPelvisSeparation: round(leadingFootPelvisSeparation),
    pelvisDominanceRatio: round(pelvisDominanceRatio),
    opposingLimbPhase,
    handsBelowHead,
    supportContactErrorM:
      supportContactErrorM === null ? null : round(supportContactErrorM),
    supportFootWorldY:
      supportFootWorldY === null ? null : round(supportFootWorldY),
    minimumFootClearanceM: round(minimumFootClearanceM),
    freeFootClearanceM:
      freeFootClearanceM === null ? null : round(freeFootClearanceM),
    componentScores: {
      approach: closeness(approachAlignment, 1, 0.08),
      occupancy: closeness(
        metrics.occupancy.height,
        intent.targetOccupancy,
        0.18,
      ),
      upwardPerspective: closeness(
        upwardPitchDeg,
        28 + intent.intensity * 12,
        30,
      ),
      groundRoom: closeness(groundRoom, 0.1, 0.12),
      actionSilhouette:
        (opposingLimbPhase ? 0.35 : 0) +
        (handsBelowHead ? 0.2 : 0) +
        0.2 * clamp(leadingKneePelvisSeparation / 0.25, 0, 1) +
        0.25 * clamp(leadingFootPelvisSeparation / 0.4, 0, 1),
    },
  };
}

function scoreCandidate(diagnostics: StaticWormEyeCandidateDiagnostics) {
  const scores = diagnostics.componentScores;
  return round(
    scores.approach * 20 +
      scores.occupancy * 30 +
      scores.upwardPerspective * 15 +
      scores.groundRoom * 10 +
      scores.actionSilhouette * 25,
  );
}

function invalidResult(
  reasons: readonly StaticWormEyeRejectionReason[],
): StaticWormEyeApproachResult {
  return {
    accepted: false,
    proposal: null,
    diagnostics: {
      evaluatedCount: 0,
      failureReasons: [...reasons].sort(
        (left, right) =>
          REJECTION_REASON_ORDER.indexOf(left) -
          REJECTION_REASON_ORDER.indexOf(right),
      ),
      rejected: [],
    },
  };
}

function validateIntent(
  intent: StaticWormEyeApproachIntent,
): readonly StaticWormEyeRejectionReason[] {
  const reasons: StaticWormEyeRejectionReason[] = [];
  const subjectPoints = [
    ...Object.values(intent.subject.landmarks),
    ...intent.subject.outline,
    ...Object.values(intent.subject.basis),
    intent.subject.bounds.min,
    intent.subject.bounds.max,
    intent.subject.bounds.size,
    intent.subject.bounds.center,
  ];
  if (subjectPoints.some((point) => !finiteVector(point))) {
    reasons.push('invalid-subject-profile');
  }
  if (
    !finiteVector(intent.motionDirection) ||
    length(horizontal(intent.motionDirection)) <= EPSILON
  ) {
    reasons.push('invalid-motion-direction');
  }
  if (intent.cameraMotion !== 'none') reasons.push('invalid-camera-motion');
  if (!Number.isFinite(intent.floorTopY)) reasons.push('invalid-floor');
  if (
    !Number.isFinite(intent.groundClearanceM) ||
    intent.groundClearanceM < 0 ||
    intent.groundClearanceM > 0.05
  ) {
    reasons.push('invalid-clearance');
  }
  if (
    intent.actionPhase === 'support-contact' &&
    intent.supportFoot === undefined
  ) {
    reasons.push('invalid-support-foot');
  }
  if (intent.actionPhase === 'flight' && intent.supportFoot !== undefined) {
    reasons.push('invalid-support-foot');
  }
  if (
    !Number.isFinite(intent.cameraHeightM) ||
    intent.cameraHeightM < CAMERA_HEIGHT_MIN_M ||
    intent.cameraHeightM > CAMERA_HEIGHT_MAX_M
  ) {
    reasons.push('camera-height-out-of-range');
  }
  if (
    !Number.isFinite(intent.lensMm) ||
    intent.lensMm <= 0 ||
    !Number.isFinite(intent.outputAspect) ||
    intent.outputAspect <= 0 ||
    !Number.isFinite(intent.targetOccupancy) ||
    intent.targetOccupancy < OCCUPANCY_MIN ||
    intent.targetOccupancy > OCCUPANCY_MAX ||
    !Number.isFinite(intent.intensity) ||
    intent.intensity < 0 ||
    intent.intensity > 1
  ) {
    reasons.push('invalid-input');
  }
  return reasons;
}

/**
 * Samples a transient, deterministic static worm's-eye running-approach proposal.
 * The input profile and all editor/document/runtime state remain untouched.
 */
export function solveStaticWormEyeApproach(
  intent: StaticWormEyeApproachIntent,
): StaticWormEyeApproachResult {
  const invalidReasons = validateIntent(intent);
  if (invalidReasons.length > 0) return invalidResult(invalidReasons);
  const evaluated: StaticWormEyeApproachProposal[] = [];
  const distances = [1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.65, 2.9, 3.2, 3.5, 3.9];
  const aimWeights = [0.35, 0.5, 0.65];
  const aimYOffsetsM = [-0.45, -0.3, -0.15, 0];
  let index = 0;
  for (const distanceM of distances) {
    const staged = stagedSubject(intent, distanceM);
    for (const aimWeight of aimWeights) {
      for (const aimYOffsetM of aimYOffsetsM) {
        const camera = candidateCamera(
          intent,
          staged.profile,
          aimWeight,
          aimYOffsetM,
        );
        const metrics = computeCinematicProjectionMetrics(
          staged.profile,
          camera,
          intent.outputAspect,
        );
        const diagnostics = diagnosticsForCandidate(
          intent,
          staged.profile,
          staged.motion,
          camera,
          metrics,
        );
        evaluated.push({
          id: `static-wormeye-approach-${String(index).padStart(3, '0')}`,
          score: scoreCandidate(diagnostics),
          camera,
          cameraMotion: 'none',
          subjectStaging: staged.staging,
          transformedApproachDirection: staged.motion,
          transformedSubject: staged.profile,
          actionPhase: intent.actionPhase,
          supportFoot: intent.supportFoot ?? null,
          metrics,
          diagnostics,
        });
        index += 1;
      }
    }
  }
  const rank = (
    left: StaticWormEyeApproachProposal,
    right: StaticWormEyeApproachProposal,
  ) => right.score - left.score || left.id.localeCompare(right.id);
  const accepted = evaluated
    .filter(({ diagnostics }) => diagnostics.accepted)
    .sort(rank);
  const rejected = evaluated
    .filter(({ diagnostics }) => !diagnostics.accepted)
    .sort(rank);
  const proposal = accepted[0] ?? null;
  const failureReasons =
    proposal === null
      ? (
          [
            ...new Set(
              rejected.flatMap(
                ({ diagnostics }) => diagnostics.rejectionReasons,
              ),
            ),
            'no-candidate',
          ] as StaticWormEyeRejectionReason[]
        ).sort(
          (left, right) =>
            REJECTION_REASON_ORDER.indexOf(left) -
            REJECTION_REASON_ORDER.indexOf(right),
        )
      : [];
  return {
    accepted: proposal !== null,
    proposal,
    diagnostics: {
      evaluatedCount: evaluated.length,
      failureReasons,
      rejected,
    },
  };
}

/** Revalidates a solver result without mutating it or any editor state. */
export function validateStaticWormEyeApproach(
  result: StaticWormEyeApproachResult,
): StaticWormEyeValidationResult {
  if (!result.accepted || result.proposal === null) {
    return {
      valid: false,
      reasons:
        result.diagnostics.failureReasons.length > 0
          ? result.diagnostics.failureReasons
          : ['no-candidate'],
    };
  }
  const proposal = result.proposal;
  const reasons: StaticWormEyeRejectionReason[] = [];
  if (
    proposal.camera.position.y < CAMERA_HEIGHT_MIN_M ||
    proposal.camera.position.y > CAMERA_HEIGHT_MAX_M ||
    proposal.camera.position.y !== proposal.diagnostics.cameraHeightM
  ) {
    reasons.push('camera-height-out-of-range');
  }
  if (proposal.cameraMotion !== 'none') reasons.push('invalid-camera-motion');
  if (proposal.diagnostics.approachAlignment < 0.985) {
    reasons.push('approach-misaligned');
  }
  if (
    proposal.metrics.occupancy.height < OCCUPANCY_MIN ||
    proposal.metrics.occupancy.height > OCCUPANCY_MAX
  ) {
    reasons.push('occupancy-out-of-range');
  }
  if (proposal.diagnostics.upwardPitchDeg < 12) {
    reasons.push('ordinary-low-angle');
  }
  if (
    !proposal.metrics.landmarks.headTop.insideFrame ||
    !proposal.metrics.landmarks.faceCenter.insideFrame
  ) {
    reasons.push('head-clipped');
  }
  const leadingKnee =
    proposal.metrics.landmarks[`${proposal.diagnostics.leadingSide}Knee`];
  const leadingFoot =
    proposal.metrics.landmarks[`${proposal.diagnostics.leadingSide}Foot`];
  if (!leadingKnee.insideFrame || !leadingFoot.insideFrame) {
    reasons.push('critical-leading-limb-clipped');
  }
  if (proposal.diagnostics.pelvisDominanceRatio > 1.5) {
    reasons.push('pelvis-dominant');
  }
  if (proposal.diagnostics.groundRoom < 0.025) {
    reasons.push('ground-room-insufficient');
  }
  if (
    !proposal.diagnostics.opposingLimbPhase ||
    !proposal.diagnostics.handsBelowHead ||
    proposal.diagnostics.leadingKneePelvisSeparation < 0.08 ||
    proposal.diagnostics.leadingFootPelvisSeparation < 0.12
  ) {
    reasons.push('invalid-action-silhouette');
  }
  if (
    proposal.diagnostics.freeFootClearanceM !== null &&
    proposal.diagnostics.freeFootClearanceM < 0.12
  ) {
    reasons.push('free-foot-too-low');
  }
  if (
    proposal.diagnostics.supportContactErrorM !== null &&
    proposal.diagnostics.supportContactErrorM > SUPPORT_TOLERANCE_M
  ) {
    reasons.push('support-contact-mismatch');
  }
  for (const reason of proposal.diagnostics.rejectionReasons) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return { valid: reasons.length === 0, reasons };
}
