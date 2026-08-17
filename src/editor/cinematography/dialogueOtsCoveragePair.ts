import type { CinematicSubjectProfile, Vec3 } from './cinematicSubjectProfile';
import { computeCinematicProjectionMetrics } from './projectionMetrics';
import {
  solveDialogueOts,
  type DialogueOtsCameraCandidate,
  type DialogueOtsProfileReference,
  type DialogueOtsShotSize,
  type DialogueOtsShoulderSide,
} from './dialogueOtsSolver';

export type DialogueOtsCoveragePairLensMm = 50 | 65 | 85;
export type DialogueOtsCoveragePairAxisSide = 'positive' | 'negative';

export interface DialogueOtsCoverageIdentity {
  id: string;
  profile: DialogueOtsProfileReference;
}

export interface DialogueOtsCoveragePairIntent {
  identityA: DialogueOtsCoverageIdentity;
  identityB: DialogueOtsCoverageIdentity;
  canonicalAxisSide: DialogueOtsCoveragePairAxisSide;
  shotSize: DialogueOtsShotSize;
  intensity: number;
  lensMm: DialogueOtsCoveragePairLensMm;
  outputAspect: number;
}

export type DialogueOtsCoveragePairFailureReason =
  | 'axis-crossing'
  | 'face-blocked'
  | 'foreground-torso-wall'
  | 'identity-profile-mismatch'
  | 'mismatched-eyeline'
  | 'mismatched-face-occupancy'
  | 'mismatched-foreground-scale'
  | 'mismatched-headroom'
  | 'mismatched-lens'
  | 'mismatched-look-room'
  | 'mismatched-shot-size'
  | 'missing-shot-a-canonical-leg'
  | 'missing-reverse-b-canonical-leg'
  | 'same-identity'
  | 'same-role-pseudo-pair'
  | 'same-screen-direction';

export interface DialogueOtsCoveragePairTolerances {
  headroom: number;
  faceOccupancy: number;
  eyeline: number;
  foregroundScale: number;
  foregroundHeadScaleMin: number;
  foregroundHeadScaleMax: number;
  foregroundScaleMax: number;
  foregroundShoulderScaleMin: number;
  lookRoom: number;
  neckEdgeCoordinateMax: number;
  neckEdgeCoordinateMin: number;
  shoulderInwardReachMin: number;
  shoulderRidgeNdcYMin: number;
  shoulderToHeadRatioMin: number;
}

export interface DialogueOtsCoveragePairCanonicalAxis {
  fromIdentityId: string;
  toIdentityId: string;
  direction: Vec3;
  midpoint: Vec3;
  selectedHalfPlaneSign: -1 | 1;
}

export interface DialogueOtsCoveragePairLeg {
  label: 'shot-a' | 'reverse-b';
  subjectIdentityId: string;
  foregroundIdentityId: string;
  compositionKind: 'canonical-shoulder-over';
  shotSize: DialogueOtsShotSize;
  shoulderSide: DialogueOtsShoulderSide;
  canonicalAxisHalfPlaneSign: -1 | 1;
  canonicalAxisSignedValue: number;
  subjectScreenDirectionSign: -1 | 1;
  foregroundTopology: {
    edge: 'left' | 'right';
    neckEdgeCoordinate: number;
    shoulderInwardReach: number;
    shoulderRidgeNdcY: number;
    shoulderToHeadRatio: number;
    quality: number;
  };
  candidate: DialogueOtsCameraCandidate;
}

export interface DialogueOtsCoveragePairContinuityDiagnostics {
  lensMatched: boolean;
  shotSizeMatched: boolean;
  headroomDelta: number;
  faceOccupancyDelta: number;
  eyelineDelta: number;
  foregroundScaleDelta: number;
  lookRoomDelta: number;
  screenDirectionsOpposed: boolean;
  targetFacesCounterPositioned: boolean;
  nearShoulderEdgeReversed: boolean;
}

export interface DialogueOtsCoveragePairDiagnostics {
  accepted: boolean;
  failureReasons: readonly DialogueOtsCoveragePairFailureReason[];
  evaluatedPairCount: number;
  rejectedPairCount: number;
  tolerances: DialogueOtsCoveragePairTolerances;
  continuity: DialogueOtsCoveragePairContinuityDiagnostics | null;
}

export interface DialogueOtsCoveragePairResult {
  kind: 'canonical-shoulder-over-coverage-pair';
  accepted: boolean;
  pairId: string | null;
  pairScore: number | null;
  identities: { aId: string; bId: string };
  canonicalAxis: DialogueOtsCoveragePairCanonicalAxis | null;
  shotA: DialogueOtsCoveragePairLeg | null;
  reverseB: DialogueOtsCoveragePairLeg | null;
  diagnostics: DialogueOtsCoveragePairDiagnostics;
}

const PAIR_TOLERANCES: DialogueOtsCoveragePairTolerances = {
  headroom: 0.06,
  faceOccupancy: 0.04,
  eyeline: 0.06,
  foregroundScale: 0.08,
  foregroundHeadScaleMin: 0.1,
  foregroundHeadScaleMax: 0.24,
  foregroundScaleMax: 0.36,
  foregroundShoulderScaleMin: 0.245,
  lookRoom: 0.08,
  neckEdgeCoordinateMax: 0.98,
  neckEdgeCoordinateMin: 0.82,
  shoulderInwardReachMin: 0.28,
  shoulderRidgeNdcYMin: -1.2,
  shoulderToHeadRatioMin: 1.35,
};
const FAILURE_ORDER: readonly DialogueOtsCoveragePairFailureReason[] = [
  'same-identity',
  'identity-profile-mismatch',
  'missing-shot-a-canonical-leg',
  'missing-reverse-b-canonical-leg',
  'same-role-pseudo-pair',
  'axis-crossing',
  'mismatched-lens',
  'mismatched-shot-size',
  'mismatched-headroom',
  'mismatched-face-occupancy',
  'mismatched-eyeline',
  'mismatched-foreground-scale',
  'mismatched-look-room',
  'same-screen-direction',
  'face-blocked',
  'foreground-torso-wall',
];

const subtract = (left: Vec3, right: Vec3): Vec3 => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});
const midpoint = (left: Vec3, right: Vec3): Vec3 => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
  z: (left.z + right.z) / 2,
});
const length = (value: Vec3) => Math.hypot(value.x, value.y, value.z);
const dot = (left: Vec3, right: Vec3) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const cross = (left: Vec3, right: Vec3): Vec3 => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});
const normalize = (value: Vec3, name: string): Vec3 => {
  const magnitude = length(value);
  if (magnitude < 1e-10)
    throw new RangeError(`${name} must have non-zero length.`);
  return {
    x: value.x / magnitude,
    y: value.y / magnitude,
    z: value.z / magnitude,
  };
};
const round = (value: number) => Math.round(value * 1e9) / 1e9;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));
const closeness = (value: number, target: number, tolerance: number) =>
  clamp(1 - Math.abs(value - target) / tolerance, 0, 1);

function topologyQuality(
  diagnostics: DialogueOtsCameraCandidate['diagnostics'],
  neckEdgeCoordinate: number,
  shoulderInwardReach: number,
  shoulderRidgeNdcY: number,
) {
  const shoulderToHeadRatio =
    diagnostics.foregroundShoulderWidthOccupancy /
    Math.max(diagnostics.foregroundHeadWidthOccupancy, 1e-9);
  return round(
    0.25 * closeness(diagnostics.foregroundShoulderWidthOccupancy, 0.31, 0.12) +
      0.15 * closeness(diagnostics.foregroundHeadWidthOccupancy, 0.18, 0.1) +
      0.15 * closeness(shoulderToHeadRatio, 1.65, 0.65) +
      0.2 * closeness(neckEdgeCoordinate, 0.88, 0.1) +
      0.15 * closeness(shoulderInwardReach, 0.34, 0.15) +
      0.1 * closeness(shoulderRidgeNdcY, -0.45, 0.7),
  );
}
const sign = (value: number): -1 | 1 => (value < 0 ? -1 : 1);
const oppositeShoulder = (
  shoulder: DialogueOtsShoulderSide,
): DialogueOtsShoulderSide => (shoulder === 'left' ? 'right' : 'left');

function resolveProfile(
  identity: DialogueOtsCoverageIdentity,
  profiles: Readonly<Record<string, CinematicSubjectProfile>>,
): CinematicSubjectProfile {
  if ('landmarks' in identity.profile) return identity.profile;
  const resolved = profiles[identity.profile.objectId];
  if (resolved !== undefined) return resolved;
  throw new RangeError(
    `Missing cinematic subject profile for ${identity.profile.objectId}.`,
  );
}

function canonicalAxis(
  intent: DialogueOtsCoveragePairIntent,
  profileA: CinematicSubjectProfile,
  profileB: CinematicSubjectProfile,
): DialogueOtsCoveragePairCanonicalAxis {
  const from = profileA.landmarks.eyeCenter;
  const to = profileB.landmarks.eyeCenter;
  const raw = { ...subtract(to, from), y: 0 };
  const magnitude = length(raw);
  if (magnitude < 1e-10) {
    throw new RangeError(
      'Canonical conversation axis must have non-zero length.',
    );
  }
  return {
    fromIdentityId: intent.identityA.id,
    toIdentityId: intent.identityB.id,
    direction: {
      x: raw.x / magnitude,
      y: 0,
      z: raw.z / magnitude,
    },
    midpoint: midpoint(from, to),
    selectedHalfPlaneSign: intent.canonicalAxisSide === 'negative' ? -1 : 1,
  };
}

function canonicalHalfPlaneValue(
  axis: DialogueOtsCoveragePairCanonicalAxis,
  camera: Vec3,
) {
  const offset = subtract(camera, axis.midpoint);
  return round(axis.direction.z * offset.x - axis.direction.x * offset.z);
}

function emptyContinuity(): DialogueOtsCoveragePairContinuityDiagnostics {
  return {
    lensMatched: false,
    shotSizeMatched: false,
    headroomDelta: 0,
    faceOccupancyDelta: 0,
    eyelineDelta: 0,
    foregroundScaleDelta: 0,
    lookRoomDelta: 0,
    screenDirectionsOpposed: false,
    targetFacesCounterPositioned: false,
    nearShoulderEdgeReversed: false,
  };
}

function failureResult(
  intent: DialogueOtsCoveragePairIntent,
  reasons: readonly DialogueOtsCoveragePairFailureReason[],
  axis: DialogueOtsCoveragePairCanonicalAxis | null = null,
): DialogueOtsCoveragePairResult {
  const orderedReasons = FAILURE_ORDER.filter((reason) =>
    reasons.includes(reason),
  );
  return {
    kind: 'canonical-shoulder-over-coverage-pair',
    accepted: false,
    pairId: null,
    pairScore: null,
    identities: { aId: intent.identityA.id, bId: intent.identityB.id },
    canonicalAxis: axis,
    shotA: null,
    reverseB: null,
    diagnostics: {
      accepted: false,
      failureReasons: orderedReasons,
      evaluatedPairCount: 0,
      rejectedPairCount: 0,
      tolerances: PAIR_TOLERANCES,
      continuity: null,
    },
  };
}

function makeLeg(
  label: DialogueOtsCoveragePairLeg['label'],
  subjectIdentityId: string,
  foregroundIdentityId: string,
  shotSize: DialogueOtsShotSize,
  outputAspect: number,
  candidate: DialogueOtsCameraCandidate,
  axis: DialogueOtsCoveragePairCanonicalAxis,
  subject: CinematicSubjectProfile,
  foreground: CinematicSubjectProfile,
): DialogueOtsCoveragePairLeg {
  const signedValue = canonicalHalfPlaneValue(axis, candidate.camera.position);
  const cameraForward = normalize(
    subtract(candidate.camera.target, candidate.camera.position),
    'coverage camera direction',
  );
  const cameraRight = normalize(
    cross(cameraForward, { x: 0, y: 1, z: 0 }),
    'coverage camera right',
  );
  const subjectLook = normalize(
    subtract(foreground.landmarks.eyeCenter, subject.landmarks.eyeCenter),
    'coverage subject look direction',
  );
  const screenDirection = dot(subjectLook, cameraRight);
  const foregroundMetrics = computeCinematicProjectionMetrics(
    foreground,
    candidate.camera,
    outputAspect,
  );
  const foregroundEdge = candidate.diagnostics.foregroundEdge;
  if (foregroundEdge === null) {
    throw new RangeError('Canonical OTS pair leg requires a foreground edge.');
  }
  const edgeSign = foregroundEdge === 'right' ? 1 : -1;
  const nearShoulder =
    foregroundMetrics.landmarks[
      candidate.shoulderSide === 'left' ? 'leftShoulder' : 'rightShoulder'
    ].ndc;
  const neck = foregroundMetrics.landmarks.neck.ndc;
  const neckEdgeCoordinate = round(edgeSign * neck.x);
  const shoulderInwardReach = round((1 - edgeSign * nearShoulder.x) / 2);
  const shoulderRidgeNdcY = round(nearShoulder.y);
  const shoulderToHeadRatio = round(
    candidate.diagnostics.foregroundShoulderWidthOccupancy /
      Math.max(candidate.diagnostics.foregroundHeadWidthOccupancy, 1e-9),
  );
  return {
    label,
    subjectIdentityId,
    foregroundIdentityId,
    compositionKind: 'canonical-shoulder-over',
    shotSize,
    shoulderSide: candidate.shoulderSide,
    canonicalAxisHalfPlaneSign: sign(signedValue),
    canonicalAxisSignedValue: signedValue,
    subjectScreenDirectionSign: screenDirection < 0 ? -1 : 1,
    foregroundTopology: {
      edge: foregroundEdge,
      neckEdgeCoordinate,
      shoulderInwardReach,
      shoulderRidgeNdcY,
      shoulderToHeadRatio,
      quality: topologyQuality(
        candidate.diagnostics,
        neckEdgeCoordinate,
        shoulderInwardReach,
        shoulderRidgeNdcY,
      ),
    },
    candidate,
  };
}

function continuityFor(
  shotA: DialogueOtsCoveragePairLeg,
  reverseB: DialogueOtsCoveragePairLeg,
): DialogueOtsCoveragePairContinuityDiagnostics {
  const first = shotA.candidate.diagnostics;
  const second = reverseB.candidate.diagnostics;
  return {
    lensMatched:
      shotA.candidate.camera.focalLengthMm ===
      reverseB.candidate.camera.focalLengthMm,
    shotSizeMatched: shotA.shotSize === reverseB.shotSize,
    headroomDelta: round(
      Math.abs(first.subjectHeadroom - second.subjectHeadroom),
    ),
    faceOccupancyDelta: round(
      Math.abs(
        first.subjectFaceHeightOccupancy - second.subjectFaceHeightOccupancy,
      ),
    ),
    eyelineDelta: round(
      Math.abs(first.subjectEyeNdc.y - second.subjectEyeNdc.y),
    ),
    foregroundScaleDelta: round(
      Math.abs(
        first.foregroundWidthOccupancy - second.foregroundWidthOccupancy,
      ),
    ),
    lookRoomDelta: round(
      Math.abs(first.subjectLookRoom - second.subjectLookRoom),
    ),
    screenDirectionsOpposed:
      shotA.subjectScreenDirectionSign !== reverseB.subjectScreenDirectionSign,
    targetFacesCounterPositioned:
      Math.sign(first.subjectFaceNdc.x) !== Math.sign(second.subjectFaceNdc.x),
    nearShoulderEdgeReversed:
      shotA.shoulderSide !== reverseB.shoulderSide &&
      first.foregroundEdge !== second.foregroundEdge,
  };
}

function canonicalLegTopologyQuality(leg: DialogueOtsCoveragePairLeg) {
  return leg.foregroundTopology.quality;
}

function canonicalLegTopologyAccepted(leg: DialogueOtsCoveragePairLeg) {
  const diagnostics = leg.candidate.diagnostics;
  const topology = leg.foregroundTopology;
  return (
    diagnostics.foregroundHeadWidthOccupancy >=
      PAIR_TOLERANCES.foregroundHeadScaleMin &&
    diagnostics.foregroundHeadWidthOccupancy <=
      PAIR_TOLERANCES.foregroundHeadScaleMax &&
    diagnostics.foregroundShoulderWidthOccupancy >=
      PAIR_TOLERANCES.foregroundShoulderScaleMin &&
    diagnostics.foregroundWidthOccupancy <=
      PAIR_TOLERANCES.foregroundScaleMax &&
    topology.shoulderToHeadRatio >= PAIR_TOLERANCES.shoulderToHeadRatioMin &&
    topology.neckEdgeCoordinate >= PAIR_TOLERANCES.neckEdgeCoordinateMin &&
    topology.neckEdgeCoordinate <= PAIR_TOLERANCES.neckEdgeCoordinateMax &&
    topology.shoulderInwardReach >= PAIR_TOLERANCES.shoulderInwardReachMin &&
    topology.shoulderRidgeNdcY >= PAIR_TOLERANCES.shoulderRidgeNdcYMin
  );
}

function continuityFailures(
  shotA: DialogueOtsCoveragePairLeg,
  reverseB: DialogueOtsCoveragePairLeg,
  continuity: DialogueOtsCoveragePairContinuityDiagnostics,
  axis: DialogueOtsCoveragePairCanonicalAxis,
): DialogueOtsCoveragePairFailureReason[] {
  const failures: DialogueOtsCoveragePairFailureReason[] = [];
  if (
    shotA.subjectIdentityId === reverseB.subjectIdentityId ||
    shotA.foregroundIdentityId === reverseB.foregroundIdentityId ||
    shotA.subjectIdentityId !== reverseB.foregroundIdentityId ||
    shotA.foregroundIdentityId !== reverseB.subjectIdentityId
  ) {
    failures.push('same-role-pseudo-pair');
  }
  if (!canonicalLegTopologyAccepted(shotA)) {
    failures.push('missing-shot-a-canonical-leg');
  }
  if (!canonicalLegTopologyAccepted(reverseB)) {
    failures.push('missing-reverse-b-canonical-leg');
  }
  if (
    Math.abs(shotA.canonicalAxisSignedValue) <= 1e-6 ||
    Math.abs(reverseB.canonicalAxisSignedValue) <= 1e-6 ||
    shotA.canonicalAxisHalfPlaneSign !== axis.selectedHalfPlaneSign ||
    reverseB.canonicalAxisHalfPlaneSign !== axis.selectedHalfPlaneSign
  ) {
    failures.push('axis-crossing');
  }
  if (!continuity.lensMatched) failures.push('mismatched-lens');
  if (!continuity.shotSizeMatched) failures.push('mismatched-shot-size');
  if (continuity.headroomDelta > PAIR_TOLERANCES.headroom)
    failures.push('mismatched-headroom');
  if (continuity.faceOccupancyDelta > PAIR_TOLERANCES.faceOccupancy)
    failures.push('mismatched-face-occupancy');
  if (continuity.eyelineDelta > PAIR_TOLERANCES.eyeline)
    failures.push('mismatched-eyeline');
  if (continuity.foregroundScaleDelta > PAIR_TOLERANCES.foregroundScale)
    failures.push('mismatched-foreground-scale');
  if (continuity.lookRoomDelta > PAIR_TOLERANCES.lookRoom)
    failures.push('mismatched-look-room');
  if (
    !continuity.screenDirectionsOpposed ||
    !continuity.targetFacesCounterPositioned ||
    !continuity.nearShoulderEdgeReversed
  ) {
    failures.push('same-screen-direction');
  }
  if (
    shotA.candidate.diagnostics.faceOcclusion > 0.18 ||
    reverseB.candidate.diagnostics.faceOcclusion > 0.18
  ) {
    failures.push('face-blocked');
  }
  if (
    shotA.candidate.diagnostics.foregroundTorsoWall ||
    reverseB.candidate.diagnostics.foregroundTorsoWall
  ) {
    failures.push('foreground-torso-wall');
  }
  return failures;
}

/**
 * Revalidates a transient coverage-pair result against the canonical A-to-B
 * axis, role-swap, topology, and pair-continuity contract. Diagnostics use
 * the stable {@link FAILURE_ORDER}; neither the result nor its candidates are
 * mutated.
 */
export function validateDialogueOtsCoveragePair(
  result: DialogueOtsCoveragePairResult,
): DialogueOtsCoveragePairDiagnostics {
  const failures = new Set<DialogueOtsCoveragePairFailureReason>();
  if (result.identities.aId === result.identities.bId)
    failures.add('same-identity');
  if (
    result.canonicalAxis === null ||
    result.shotA === null ||
    result.reverseB === null
  ) {
    for (const reason of result.diagnostics.failureReasons)
      failures.add(reason);
    if (result.shotA === null) failures.add('missing-shot-a-canonical-leg');
    if (result.reverseB === null)
      failures.add('missing-reverse-b-canonical-leg');
    return {
      ...result.diagnostics,
      accepted: false,
      failureReasons: FAILURE_ORDER.filter((reason) => failures.has(reason)),
      continuity: null,
    };
  }

  const axis = result.canonicalAxis;
  const refreshedLeg = (
    leg: DialogueOtsCoveragePairLeg,
  ): DialogueOtsCoveragePairLeg => {
    const signedValue = canonicalHalfPlaneValue(
      axis,
      leg.candidate.camera.position,
    );
    return {
      ...leg,
      canonicalAxisHalfPlaneSign: sign(signedValue),
      canonicalAxisSignedValue: signedValue,
    };
  };
  const shotA = refreshedLeg(result.shotA);
  const reverseB = refreshedLeg(result.reverseB);
  if (
    shotA.compositionKind !== 'canonical-shoulder-over' ||
    shotA.candidate.kind !== 'canonical-shoulder-over' ||
    !shotA.candidate.diagnostics.accepted
  ) {
    failures.add('missing-shot-a-canonical-leg');
  }
  if (
    reverseB.compositionKind !== 'canonical-shoulder-over' ||
    reverseB.candidate.kind !== 'canonical-shoulder-over' ||
    !reverseB.candidate.diagnostics.accepted
  ) {
    failures.add('missing-reverse-b-canonical-leg');
  }
  const continuity = continuityFor(shotA, reverseB);
  for (const reason of continuityFailures(shotA, reverseB, continuity, axis)) {
    failures.add(reason);
  }
  const failureReasons = FAILURE_ORDER.filter((reason) => failures.has(reason));
  return {
    ...result.diagnostics,
    accepted: failureReasons.length === 0,
    failureReasons,
    tolerances: PAIR_TOLERANCES,
    continuity,
  };
}

/**
 * Solves deterministic canonical OTS coverage for two distinct identities.
 * Shot A is subject A over foreground B; Reverse B swaps those roles. Both
 * candidates are selected from the existing single-shot canonical solver on
 * one physical half-plane of the stable A-to-B conversation axis.
 *
 * The result is JSON-safe, pure, and transient. It never writes a
 * SceneDocument or editor/runtime state. A supported lens or profile may
 * still return explicit missing-leg diagnostics when no candidate satisfies
 * the pair-local literal shoulder-window and continuity tolerances.
 */
export function solveDialogueOtsCoveragePair(
  intent: DialogueOtsCoveragePairIntent,
  profiles: Readonly<Record<string, CinematicSubjectProfile>> = {},
): DialogueOtsCoveragePairResult {
  if (![50, 65, 85].includes(intent.lensMm)) {
    return failureResult(intent, ['mismatched-lens']);
  }
  if (intent.identityA.id === intent.identityB.id) {
    return failureResult(intent, ['same-identity']);
  }
  const profileA = resolveProfile(intent.identityA, profiles);
  const profileB = resolveProfile(intent.identityB, profiles);
  if (
    profileA.objectId !== intent.identityA.id ||
    profileB.objectId !== intent.identityB.id
  ) {
    return failureResult(intent, ['identity-profile-mismatch']);
  }
  if (profileA.objectId === profileB.objectId) {
    return failureResult(intent, ['same-identity']);
  }
  const axis = canonicalAxis(intent, profileA, profileB);
  const shotARoleSign = (axis.selectedHalfPlaneSign * -1) as -1 | 1;
  const reverseRoleSign = axis.selectedHalfPlaneSign;
  const acceptedPairs: {
    id: string;
    score: number;
    shotA: DialogueOtsCoveragePairLeg;
    reverseB: DialogueOtsCoveragePairLeg;
    continuity: DialogueOtsCoveragePairContinuityDiagnostics;
  }[] = [];
  let evaluatedPairCount = 0;
  let shotACanonicalCount = 0;
  let reverseCanonicalCount = 0;
  const observedFailures = new Set<DialogueOtsCoveragePairFailureReason>();

  for (const shotAShoulder of ['left', 'right'] as const) {
    const reverseShoulder = oppositeShoulder(shotAShoulder);
    const shotAResult = solveDialogueOts(
      {
        subject: profileA,
        foreground: profileB,
        kind: 'canonical-shoulder-over',
        shoulderSide: shotAShoulder,
        axisSidePolicy: {
          mode: 'preserve',
          continuitySign: shotARoleSign,
        },
        shotSize: intent.shotSize,
        intensity: intent.intensity,
        lensMm: intent.lensMm,
        outputAspect: intent.outputAspect,
      },
      profiles,
    );
    const reverseResult = solveDialogueOts(
      {
        subject: profileB,
        foreground: profileA,
        kind: 'canonical-shoulder-over',
        shoulderSide: reverseShoulder,
        axisSidePolicy: {
          mode: 'preserve',
          continuitySign: reverseRoleSign,
        },
        shotSize: intent.shotSize,
        intensity: intent.intensity,
        lensMm: intent.lensMm,
        outputAspect: intent.outputAspect,
      },
      profiles,
    );
    shotACanonicalCount += shotAResult.candidates.length;
    reverseCanonicalCount += reverseResult.candidates.length;
    for (const shotACandidate of shotAResult.candidates) {
      for (const reverseCandidate of reverseResult.candidates) {
        evaluatedPairCount += 1;
        const shotA = makeLeg(
          'shot-a',
          intent.identityA.id,
          intent.identityB.id,
          intent.shotSize,
          intent.outputAspect,
          shotACandidate,
          axis,
          profileA,
          profileB,
        );
        const reverseB = makeLeg(
          'reverse-b',
          intent.identityB.id,
          intent.identityA.id,
          intent.shotSize,
          intent.outputAspect,
          reverseCandidate,
          axis,
          profileB,
          profileA,
        );
        const continuity = continuityFor(shotA, reverseB);
        const failures = continuityFailures(shotA, reverseB, continuity, axis);
        for (const failure of failures) observedFailures.add(failure);
        if (failures.length > 0) continue;
        const continuityPenalty =
          continuity.headroomDelta * 100 +
          continuity.faceOccupancyDelta * 100 +
          continuity.eyelineDelta * 100 +
          continuity.foregroundScaleDelta * 100 +
          continuity.lookRoomDelta * 100;
        acceptedPairs.push({
          id: `${shotACandidate.id}__${reverseCandidate.id}`,
          score: round(
            shotACandidate.score +
              reverseCandidate.score +
              canonicalLegTopologyQuality(shotA) * 20 +
              canonicalLegTopologyQuality(reverseB) * 20 -
              continuityPenalty,
          ),
          shotA,
          reverseB,
          continuity,
        });
      }
    }
  }

  acceptedPairs.sort(
    (left, right) =>
      right.score - left.score || left.id.localeCompare(right.id),
  );
  const selected = acceptedPairs[0];
  if (selected === undefined) {
    const reasons: DialogueOtsCoveragePairFailureReason[] = [];
    if (shotACanonicalCount === 0) reasons.push('missing-shot-a-canonical-leg');
    if (reverseCanonicalCount === 0)
      reasons.push('missing-reverse-b-canonical-leg');
    reasons.push(...observedFailures);
    if (reasons.length === 0) reasons.push('axis-crossing');
    const failure = failureResult(intent, reasons, axis);
    return {
      ...failure,
      diagnostics: {
        ...failure.diagnostics,
        evaluatedPairCount,
        rejectedPairCount: evaluatedPairCount,
        continuity: emptyContinuity(),
      },
    };
  }

  return {
    kind: 'canonical-shoulder-over-coverage-pair',
    accepted: true,
    pairId: selected.id,
    pairScore: selected.score,
    identities: { aId: intent.identityA.id, bId: intent.identityB.id },
    canonicalAxis: axis,
    shotA: selected.shotA,
    reverseB: selected.reverseB,
    diagnostics: {
      accepted: true,
      failureReasons: [],
      evaluatedPairCount,
      rejectedPairCount: evaluatedPairCount - acceptedPairs.length,
      tolerances: PAIR_TOLERANCES,
      continuity: selected.continuity,
    },
  };
}
