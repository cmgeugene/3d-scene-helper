import { FILM_GAUGE_MM } from '../constants';
import type { SceneDocument } from '../persistence/sceneSchema';
import { createDepthOfFieldSettingsForLens } from '../scene/lensDepthOfField';
import type { CinematicSubjectProfile, Vec3 } from './cinematicSubjectProfile';
import {
  computeCinematicProjectionMetrics,
  type ProjectedPoint,
} from './projectionMetrics';

export type DialogueOtsProfileReference =
  CinematicSubjectProfile | { objectId: string };
export type DialogueOtsShoulderSide = 'left' | 'right';
export type DialogueOtsShotSize = 'medium-close' | 'tight';
export type DialogueOtsCompositionKind =
  'balanced-dirty-single' | 'canonical-shoulder-over';
export type DialogueOtsAxisSidePolicy = {
  mode: 'positive' | 'negative' | 'preserve';
  continuitySign?: -1 | 1;
};

export interface DialogueOtsIntent {
  subject: DialogueOtsProfileReference;
  foreground: DialogueOtsProfileReference;
  shoulderSide: DialogueOtsShoulderSide;
  axisSidePolicy: DialogueOtsAxisSidePolicy;
  shotSize: DialogueOtsShotSize;
  intensity: number;
  lensMm: number;
  outputAspect: number;
  kind?: DialogueOtsCompositionKind;
}

export type DialogueOtsRejectionReason =
  | 'axis-discontinuity'
  | 'dirty-edge-only'
  | 'face-blocked'
  | 'false-wide-two-shot'
  | 'foreground-torso-wall'
  | 'near-plane-unsafe'
  | 'same-side-imbalance'
  | 'shoulder-window-blocked'
  | 'side-profile-two-shot'
  | 'subject-critical-clipped'
  | 'subject-framing';

export interface DialogueOtsCandidateDiagnostics {
  accepted: boolean;
  rejectionReasons: readonly DialogueOtsRejectionReason[];
  subjectEyeNdc: { x: number; y: number };
  subjectFaceNdc: { x: number; y: number };
  subjectCounterPositioned: boolean;
  subjectHorizontalCenterOffset: number;
  subjectHeadroom: number;
  subjectLookRoom: number;
  subjectFaceHeightOccupancy: number;
  faceClearance: number;
  faceOcclusion: number;
  foregroundEdge: 'left' | 'right' | null;
  foregroundEdgeContact: boolean;
  foregroundWidthOccupancy: number;
  foregroundHeadWidthOccupancy: number;
  foregroundShoulderWidthOccupancy: number;
  foregroundOutlineWidthOccupancy: number;
  foregroundOutlineClippedCount: number;
  foregroundTorsoWall: boolean;
  cameraBehindDot: number;
  lateralToBehindRatio: number;
  foregroundRearThreeQuarter: boolean;
  foregroundHeadNeckEdgeAligned: boolean;
  foregroundShoulderRidgeNdcY: number;
  subjectEyeClearanceAboveShoulderRidge: number;
  subjectFaceClearanceAboveShoulderRidge: number;
  canonicalShoulderWindow: boolean;
  subjectCriticalClipped: readonly string[];
  foregroundClipped: readonly string[];
  nearPlaneMargin: number;
  nearPlaneSafe: boolean;
  axisSideSign: -1 | 1;
  axisContinuity: boolean;
  componentScores: {
    eyePlacement: number;
    headroom: number;
    lookRoom: number;
    faceClearance: number;
    foregroundOccupancy: number;
    clipping: number;
    nearPlane: number;
    axisContinuity: number;
    horizontalBalance: number;
    canonicalTopology: number;
  };
}

export interface DialogueOtsCameraCandidate {
  id: string;
  kind: DialogueOtsCompositionKind;
  shoulderSide: DialogueOtsShoulderSide;
  score: number;
  camera: SceneDocument['outputCamera'];
  diagnostics: DialogueOtsCandidateDiagnostics;
}

export interface DialogueOtsSolveResult {
  candidates: readonly DialogueOtsCameraCandidate[];
  diagnostics: {
    evaluatedCount: number;
    rejected: readonly DialogueOtsCameraCandidate[];
  };
}

type Rect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const OUTPUT_CAMERA_NEAR = 0.1;
const SUBJECT_COUNTER_POSITION_MIN = 0.15;
const SUBJECT_COUNTER_POSITION_MAX = 0.45;
const SUBJECT_COUNTER_POSITION_TARGET = 0.23;
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const SUBJECT_CRITICAL_LANDMARKS = [
  'eyeCenter',
  'faceCenter',
  'headTop',
  'headLeft',
  'headRight',
  'neck',
] as const;
const FOREGROUND_SILHOUETTE_LANDMARKS = [
  'headTop',
  'headLeft',
  'headRight',
  'neck',
  'leftShoulder',
  'rightShoulder',
  'chest',
] as const;
const FACE_RECT_LANDMARKS = [
  'headTop',
  'headLeft',
  'headRight',
  'neck',
] as const;
const SHOULDER_RECT_LANDMARKS = [
  'leftShoulder',
  'rightShoulder',
  'neck',
  'chest',
] as const;

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
const scale = (vector: Vec3, amount: number): Vec3 => ({
  x: vector.x * amount,
  y: vector.y * amount,
  z: vector.z * amount,
});
const dot = (left: Vec3, right: Vec3) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const cross = (left: Vec3, right: Vec3): Vec3 => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});
const length = (vector: Vec3) => Math.hypot(vector.x, vector.y, vector.z);
const normalize = (vector: Vec3, name: string): Vec3 => {
  const magnitude = length(vector);
  if (magnitude < 1e-10)
    throw new RangeError(`${name} must have non-zero length.`);
  return scale(vector, 1 / magnitude);
};
const midpoint = (left: Vec3, right: Vec3): Vec3 =>
  scale(add(left, right), 0.5);
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));
const closeness = (value: number, target: number, tolerance: number) =>
  clamp(1 - Math.abs(value - target) / tolerance, 0, 1);
const roundScore = (score: number) => Math.round(score * 1e9) / 1e9;

function requirePositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

function validateIntent(intent: DialogueOtsIntent) {
  requirePositiveFinite(intent.lensMm, 'lensMm');
  requirePositiveFinite(intent.outputAspect, 'outputAspect');
  if (
    !Number.isFinite(intent.intensity) ||
    intent.intensity < 0 ||
    intent.intensity > 1
  ) {
    throw new RangeError('intensity must be a finite number from 0 through 1.');
  }
  if (
    intent.axisSidePolicy.mode === 'preserve' &&
    intent.axisSidePolicy.continuitySign === undefined
  ) {
    throw new RangeError('preserve axis-side policy requires continuitySign.');
  }
}

function requireProfile(
  reference: DialogueOtsProfileReference,
  profiles: Readonly<Record<string, CinematicSubjectProfile>>,
): CinematicSubjectProfile {
  if ('landmarks' in reference) return reference;
  const profile = profiles[reference.objectId];
  if (profile !== undefined) return profile;
  throw new RangeError(
    `Missing cinematic subject profile for ${reference.objectId}.`,
  );
}

function rect(points: readonly ProjectedPoint[]): Rect | null {
  const visible = points.filter(({ inFront }) => inFront);
  if (visible.length === 0) return null;
  return {
    minX: Math.min(...visible.map(({ ndc }) => ndc.x)),
    maxX: Math.max(...visible.map(({ ndc }) => ndc.x)),
    minY: Math.min(...visible.map(({ ndc }) => ndc.y)),
    maxY: Math.max(...visible.map(({ ndc }) => ndc.y)),
  };
}

function clippedWidth(frameRect: Rect | null) {
  if (frameRect === null) return 0;
  return (
    Math.max(0, clamp(frameRect.maxX, -1, 1) - clamp(frameRect.minX, -1, 1)) / 2
  );
}

function rectOverlap(left: Rect | null, right: Rect | null) {
  if (left === null || right === null) return { width: 0, height: 0, area: 0 };
  const width = Math.max(
    0,
    Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX),
  );
  const height = Math.max(
    0,
    Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY),
  );
  return { width, height, area: width * height };
}

function rectArea(value: Rect | null) {
  return value === null
    ? 0
    : Math.max(0, value.maxX - value.minX) *
        Math.max(0, value.maxY - value.minY);
}

function rectClearance(left: Rect | null, right: Rect | null) {
  if (left === null || right === null) return 0;
  const x = Math.max(left.minX - right.maxX, right.minX - left.maxX, 0);
  const y = Math.max(left.minY - right.maxY, right.minY - left.maxY, 0);
  return Math.hypot(x, y) / 2;
}

function cameraAxes(camera: SceneDocument['outputCamera']) {
  const forward = normalize(
    subtract(camera.target, camera.position),
    'camera direction',
  );
  const right = normalize(cross(forward, UP), 'camera right');
  const up = normalize(cross(right, forward), 'camera up');
  return { forward, right, up };
}

function desiredAxisSign(policy: DialogueOtsAxisSidePolicy): -1 | 1 {
  if (policy.mode === 'positive') return 1;
  if (policy.mode === 'negative') return -1;
  return policy.continuitySign ?? 1;
}

function axisSign(
  foregroundEye: Vec3,
  subjectEye: Vec3,
  cameraPosition: Vec3,
): -1 | 1 {
  const axis = normalize(
    { ...subtract(subjectEye, foregroundEye), y: 0 },
    'conversation axis',
  );
  const offset = subtract(cameraPosition, midpoint(foregroundEye, subjectEye));
  const signed = cross(axis, offset).y;
  return signed < 0 ? -1 : 1;
}

function cameraDepth(point: Vec3, camera: SceneDocument['outputCamera']) {
  return dot(subtract(point, camera.position), cameraAxes(camera).forward);
}

function diagnosticsForCandidate(
  intent: DialogueOtsIntent,
  subject: CinematicSubjectProfile,
  foreground: CinematicSubjectProfile,
  cameraData: SceneDocument['outputCamera'],
): DialogueOtsCandidateDiagnostics {
  const subjectMetrics = computeCinematicProjectionMetrics(
    subject,
    cameraData,
    intent.outputAspect,
  );
  const foregroundMetrics = computeCinematicProjectionMetrics(
    foreground,
    cameraData,
    intent.outputAspect,
  );
  const subjectFaceRect = rect(
    FACE_RECT_LANDMARKS.map((name) => subjectMetrics.landmarks[name]),
  );
  const foregroundSilhouettePoints = FOREGROUND_SILHOUETTE_LANDMARKS.map(
    (name) => foregroundMetrics.landmarks[name],
  );
  const foregroundRect = rect(foregroundSilhouettePoints);
  const foregroundHeadRect = rect(
    FACE_RECT_LANDMARKS.map((name) => foregroundMetrics.landmarks[name]),
  );
  const foregroundShoulderRect = rect(
    SHOULDER_RECT_LANDMARKS.map((name) => foregroundMetrics.landmarks[name]),
  );
  const foregroundOutlineRect = rect(foregroundMetrics.outline);
  const faceOverlap = rectOverlap(subjectFaceRect, foregroundRect);
  const faceOcclusion =
    rectArea(subjectFaceRect) <= 1e-12
      ? 1
      : faceOverlap.area / rectArea(subjectFaceRect);
  const faceClearance = rectClearance(subjectFaceRect, foregroundRect);
  const foregroundWidthOccupancy = clippedWidth(foregroundRect);
  const foregroundHeadWidthOccupancy = clippedWidth(foregroundHeadRect);
  const foregroundShoulderWidthOccupancy = clippedWidth(foregroundShoulderRect);
  const foregroundOutlineWidthOccupancy = clippedWidth(foregroundOutlineRect);
  const foregroundOutlineClippedCount = foregroundMetrics.outline.filter(
    ({ insideFrame }) => !insideFrame,
  ).length;
  const expectedEdge = intent.shoulderSide === 'left' ? 'right' : 'left';
  const foregroundEdge: 'left' | 'right' | null =
    foregroundRect === null
      ? null
      : foregroundRect.minX <= -0.88
        ? 'left'
        : foregroundRect.maxX >= 0.88
          ? 'right'
          : null;
  const foregroundEdgeContact = foregroundEdge === expectedEdge;
  const subjectCriticalClipped = SUBJECT_CRITICAL_LANDMARKS.filter(
    (name) => !subjectMetrics.landmarks[name].insideFrame,
  );
  const foregroundClipped = FOREGROUND_SILHOUETTE_LANDMARKS.filter(
    (name) => !foregroundMetrics.landmarks[name].insideFrame,
  );
  const nearDepths = [
    ...FOREGROUND_SILHOUETTE_LANDMARKS.map((name) =>
      cameraDepth(foreground.landmarks[name], cameraData),
    ),
    ...SUBJECT_CRITICAL_LANDMARKS.map((name) =>
      cameraDepth(subject.landmarks[name], cameraData),
    ),
    ...foreground.outline.map((point) => cameraDepth(point, cameraData)),
  ];
  const nearPlaneMargin = Math.min(...nearDepths) - OUTPUT_CAMERA_NEAR;
  const nearPlaneSafe = nearPlaneMargin >= 0.03;
  const sideSign = axisSign(
    foreground.landmarks.eyeCenter,
    subject.landmarks.eyeCenter,
    cameraData.position,
  );
  const axisContinuity = sideSign === desiredAxisSign(intent.axisSidePolicy);
  const eye = subjectMetrics.landmarks.eyeCenter.ndc;
  const face = subjectMetrics.landmarks.faceCenter.ndc;
  const expectedSubjectSign = expectedEdge === 'right' ? -1 : 1;
  const subjectHorizontalCenterOffset = Math.min(
    Math.abs(eye.x),
    Math.abs(face.x),
  );
  const subjectCounterPositioned =
    Math.sign(eye.x) === expectedSubjectSign &&
    Math.sign(face.x) === expectedSubjectSign &&
    subjectHorizontalCenterOffset >= SUBJECT_COUNTER_POSITION_MIN &&
    Math.max(Math.abs(eye.x), Math.abs(face.x)) <= SUBJECT_COUNTER_POSITION_MAX;
  const headroom = subjectMetrics.headroom ?? -1;
  const axes = cameraAxes(cameraData);
  const lookDirection = normalize(
    subtract(foreground.landmarks.eyeCenter, subject.landmarks.eyeCenter),
    'subject look direction',
  );
  const screenLook = dot(lookDirection, axes.right);
  const lookRoom = screenLook >= 0 ? (1 - eye.x) / 2 : (eye.x + 1) / 2;
  const subjectFaceHeightOccupancy =
    subjectFaceRect === null
      ? 0
      : Math.max(0, subjectFaceRect.maxY - subjectFaceRect.minY) / 2;
  const foregroundTorsoWall =
    foregroundWidthOccupancy > 0.38 ||
    (foregroundShoulderWidthOccupancy > 0.34 &&
      foregroundHeadWidthOccupancy > 0.28);
  const shoulder =
    foreground.landmarks[
      intent.shoulderSide === 'left' ? 'leftShoulder' : 'rightShoulder'
    ];
  const shoulderToCamera = subtract(cameraData.position, shoulder);
  const cameraBehindDirection = scale(foreground.basis.faceForward, -1);
  const cameraBehindDistance = dot(shoulderToCamera, cameraBehindDirection);
  const cameraLateralDistance = Math.abs(
    dot(shoulderToCamera, foreground.basis.right),
  );
  const cameraBehindDot = dot(
    normalize(shoulderToCamera, 'shoulder-to-camera direction'),
    cameraBehindDirection,
  );
  const lateralToBehindRatio =
    cameraLateralDistance / Math.max(cameraBehindDistance, 1e-9);
  const foregroundRearThreeQuarter =
    cameraBehindDot >= 0.65 &&
    lateralToBehindRatio >= 0.12 &&
    lateralToBehindRatio <= 0.85;
  const expectedEdgeSign = expectedEdge === 'right' ? 1 : -1;
  const projectedHeadTop = foregroundMetrics.landmarks.headTop.ndc;
  const projectedNeck = foregroundMetrics.landmarks.neck.ndc;
  const projectedShoulder =
    foregroundMetrics.landmarks[
      intent.shoulderSide === 'left' ? 'leftShoulder' : 'rightShoulder'
    ].ndc;
  const foregroundHeadNeckEdgeAligned =
    expectedEdgeSign * projectedHeadTop.x >= 0.82 &&
    expectedEdgeSign * projectedNeck.x >= 0.82 &&
    Math.abs(projectedHeadTop.x - projectedNeck.x) <= 0.35 &&
    expectedEdgeSign * projectedShoulder.x <=
      expectedEdgeSign * projectedNeck.x - 0.08;
  const foregroundShoulderRidgeNdcY = projectedShoulder.y;
  const subjectEyeClearanceAboveShoulderRidge =
    eye.y - foregroundShoulderRidgeNdcY;
  const subjectFaceClearanceAboveShoulderRidge =
    (subjectFaceRect?.minY ?? -1) - foregroundShoulderRidgeNdcY;
  const canonicalShoulderWindow =
    foregroundRearThreeQuarter &&
    foregroundHeadNeckEdgeAligned &&
    foregroundHeadWidthOccupancy >= 0.06 &&
    foregroundShoulderWidthOccupancy >= 0.14 &&
    subjectEyeClearanceAboveShoulderRidge >= 0.12 &&
    subjectFaceClearanceAboveShoulderRidge >= 0.05;
  const canonicalKind =
    (intent.kind ?? 'balanced-dirty-single') === 'canonical-shoulder-over';
  const rejectionReasons: DialogueOtsRejectionReason[] = [];
  if (!axisContinuity) rejectionReasons.push('axis-discontinuity');
  if (faceOcclusion > 0.18 || faceClearance < 0.015)
    rejectionReasons.push('face-blocked');
  if (!foregroundEdgeContact || foregroundWidthOccupancy < 0.12)
    rejectionReasons.push('false-wide-two-shot');
  if (!subjectCounterPositioned) rejectionReasons.push('same-side-imbalance');
  if (canonicalKind && !foregroundRearThreeQuarter) {
    rejectionReasons.push('side-profile-two-shot');
  }
  if (
    canonicalKind &&
    (!foregroundHeadNeckEdgeAligned ||
      foregroundHeadWidthOccupancy < 0.06 ||
      foregroundShoulderWidthOccupancy < 0.14)
  ) {
    rejectionReasons.push('dirty-edge-only');
  }
  if (
    canonicalKind &&
    (subjectEyeClearanceAboveShoulderRidge < 0.12 ||
      subjectFaceClearanceAboveShoulderRidge < 0.05)
  ) {
    rejectionReasons.push('shoulder-window-blocked');
  }
  if (foregroundTorsoWall) rejectionReasons.push('foreground-torso-wall');
  if (!nearPlaneSafe) rejectionReasons.push('near-plane-unsafe');
  if (subjectCriticalClipped.length > 0)
    rejectionReasons.push('subject-critical-clipped');
  if (headroom <= 0 || lookRoom <= 0.08 || eye.y < 0.05 || eye.y > 0.62)
    rejectionReasons.push('subject-framing');

  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    subjectEyeNdc: { x: eye.x, y: eye.y },
    subjectFaceNdc: { x: face.x, y: face.y },
    subjectCounterPositioned,
    subjectHorizontalCenterOffset,
    subjectHeadroom: headroom,
    subjectLookRoom: lookRoom,
    subjectFaceHeightOccupancy,
    faceClearance,
    faceOcclusion,
    foregroundEdge,
    foregroundEdgeContact,
    foregroundWidthOccupancy,
    foregroundHeadWidthOccupancy,
    foregroundShoulderWidthOccupancy,
    foregroundOutlineWidthOccupancy,
    foregroundOutlineClippedCount,
    foregroundTorsoWall,
    cameraBehindDot,
    lateralToBehindRatio,
    foregroundRearThreeQuarter,
    foregroundHeadNeckEdgeAligned,
    foregroundShoulderRidgeNdcY,
    subjectEyeClearanceAboveShoulderRidge,
    subjectFaceClearanceAboveShoulderRidge,
    canonicalShoulderWindow,
    subjectCriticalClipped,
    foregroundClipped,
    nearPlaneMargin,
    nearPlaneSafe,
    axisSideSign: sideSign,
    axisContinuity,
    componentScores: {
      eyePlacement:
        0.55 * closeness(eye.y, 0.33, 0.3) +
        0.45 * closeness(Math.abs(eye.x), 0.26, 0.35),
      headroom: closeness(headroom, 0.08, 0.12),
      lookRoom: closeness(lookRoom, 0.45, 0.4),
      faceClearance: clamp(faceClearance / 0.08, 0, 1),
      foregroundOccupancy: closeness(foregroundWidthOccupancy, 0.175, 0.12),
      clipping:
        subjectCriticalClipped.length === 0 && foregroundOutlineClippedCount > 0
          ? 1
          : 0,
      nearPlane: nearPlaneSafe ? clamp(nearPlaneMargin / 0.3, 0, 1) : 0,
      axisContinuity: axisContinuity ? 1 : 0,
      horizontalBalance:
        0.5 *
          closeness(
            eye.x,
            expectedSubjectSign * SUBJECT_COUNTER_POSITION_TARGET,
            0.22,
          ) +
        0.5 *
          closeness(
            face.x,
            expectedSubjectSign * SUBJECT_COUNTER_POSITION_TARGET,
            0.22,
          ),
      canonicalTopology:
        0.2 * closeness(cameraBehindDot, 0.9, 0.35) +
        0.15 * closeness(lateralToBehindRatio, 0.45, 0.45) +
        0.2 * (foregroundHeadNeckEdgeAligned ? 1 : 0) +
        0.15 * closeness(foregroundHeadWidthOccupancy, 0.14, 0.14) +
        0.15 * closeness(foregroundShoulderWidthOccupancy, 0.22, 0.18) +
        0.075 * clamp(subjectEyeClearanceAboveShoulderRidge / 0.3, 0, 1) +
        0.075 * clamp(subjectFaceClearanceAboveShoulderRidge / 0.2, 0, 1),
    },
  };
}

function candidateScore(
  diagnostics: DialogueOtsCandidateDiagnostics,
  kind: DialogueOtsCompositionKind,
) {
  const scores = diagnostics.componentScores;
  const foregroundOccupancyWeight =
    kind === 'canonical-shoulder-over' ? 12 : 22;
  const canonicalTopologyWeight = kind === 'canonical-shoulder-over' ? 10 : 0;
  return roundScore(
    scores.eyePlacement * 12 +
      scores.headroom * 10 +
      scores.lookRoom * 8 +
      scores.faceClearance * 18 +
      scores.foregroundOccupancy * foregroundOccupancyWeight +
      scores.clipping * 8 +
      scores.nearPlane * 5 +
      scores.axisContinuity * 7 +
      scores.horizontalBalance * 10 +
      scores.canonicalTopology * canonicalTopologyWeight,
  );
}

function buildCandidateCamera(
  intent: DialogueOtsIntent,
  subject: CinematicSubjectProfile,
  foreground: CinematicSubjectProfile,
  behindDistance: number,
  outsideDistance: number,
  cameraHeightOffset: number,
  eyeY: number,
  eyeX: number,
): SceneDocument['outputCamera'] {
  const subjectEye = subject.landmarks.eyeCenter;
  const foregroundEye = foreground.landmarks.eyeCenter;
  const shoulder =
    foreground.landmarks[
      intent.shoulderSide === 'left' ? 'leftShoulder' : 'rightShoulder'
    ];
  const behind =
    intent.kind === 'canonical-shoulder-over'
      ? scale(foreground.basis.faceForward, -1)
      : normalize(
          subtract(foregroundEye, subjectEye),
          'conversation separation',
        );
  const outward = normalize(
    subtract(shoulder, foreground.landmarks.neck),
    'foreground shoulder direction',
  );
  const horizontalOutward = normalize(
    { ...subtract(shoulder, foreground.landmarks.neck), y: 0 },
    'horizontal foreground shoulder direction',
  );
  const anatomicalOutsideLimit =
    intent.kind === 'canonical-shoulder-over' ? 0 : 0.6;
  const anatomicalOutsideDistance = Math.min(
    outsideDistance,
    anatomicalOutsideLimit,
  );
  const additionalHorizontalDistance = Math.max(
    0,
    outsideDistance - anatomicalOutsideLimit,
  );
  const outsideOffset = add(
    scale(outward, anatomicalOutsideDistance),
    scale(horizontalOutward, additionalHorizontalDistance),
  );
  const position = add(
    add(shoulder, scale(behind, behindDistance)),
    add(outsideOffset, scale(foreground.basis.up, cameraHeightOffset)),
  );
  const initialForward = normalize(
    subtract(subjectEye, position),
    'camera direction',
  );
  const initialRight = normalize(cross(initialForward, UP), 'camera right');
  const initialUp = normalize(cross(initialRight, initialForward), 'camera up');
  const subjectDepth = length(subtract(subjectEye, position));
  const filmHeightMm = FILM_GAUGE_MM / Math.max(intent.outputAspect, 1);
  const halfHeight = subjectDepth * (filmHeightMm / (2 * intent.lensMm));
  const halfWidth = halfHeight * intent.outputAspect;
  const target = add(
    add(subjectEye, scale(initialRight, -eyeX * halfWidth)),
    scale(initialUp, -eyeY * halfHeight),
  );
  return {
    position,
    target,
    focalLengthMm: intent.lensMm,
    rollDeg: 0,
    depthOfField: createDepthOfFieldSettingsForLens(intent.lensMm, true),
  };
}

export function solveDialogueOts(
  intent: DialogueOtsIntent,
  profiles: Readonly<Record<string, CinematicSubjectProfile>> = {},
): DialogueOtsSolveResult {
  validateIntent(intent);
  const subject = requireProfile(intent.subject, profiles);
  const foreground = requireProfile(intent.foreground, profiles);
  const kind = intent.kind ?? 'balanced-dirty-single';
  if (subject.objectId === foreground.objectId) {
    throw new RangeError(
      'Dialogue OTS requires distinct subject and foreground profiles.',
    );
  }
  const side = intent.shoulderSide === 'left' ? -1 : 1;
  const desiredEyeX = side * (0.18 + intent.intensity * 0.08);
  const desiredEyeY =
    intent.shotSize === 'tight'
      ? 0.38 + intent.intensity * 0.03
      : 0.3 + intent.intensity * 0.05;
  const intimacyScale = intent.shotSize === 'tight' ? 0.82 : 1;
  const behindDistances = (
    kind === 'canonical-shoulder-over'
      ? [0.55, 0.7, 0.85, 1, 1.15, 1.3]
      : [0.35, 0.5, 0.65, 0.78, 0.94, 1.1, 1.26]
  ).map((value) => value * intimacyScale);
  const outsideDistances = (
    kind === 'canonical-shoulder-over'
      ? [0.12, 0.18, 0.24, 0.3, 0.36, 0.42]
      : [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3]
  ).map((value) => value * intimacyScale + intent.intensity * 0.06);
  const evaluated: DialogueOtsCameraCandidate[] = [];
  const cameraHeightOffsets =
    kind === 'canonical-shoulder-over' ? [0.16, 0.25, 0.34] : [0.06];
  let index = 0;
  for (const behindDistance of behindDistances) {
    for (const outsideDistance of outsideDistances) {
      for (const cameraHeightOffset of cameraHeightOffsets) {
        for (const eyeYOffset of [-0.03, 0.02]) {
          const camera = buildCandidateCamera(
            intent,
            subject,
            foreground,
            behindDistance,
            outsideDistance,
            cameraHeightOffset,
            desiredEyeY + eyeYOffset,
            desiredEyeX,
          );
          const diagnostics = diagnosticsForCandidate(
            intent,
            subject,
            foreground,
            camera,
          );
          evaluated.push({
            id: `${kind}-${intent.shoulderSide}-shoulder-${intent.shotSize}-${String(index).padStart(2, '0')}`,
            kind,
            shoulderSide: intent.shoulderSide,
            score: candidateScore(diagnostics, kind),
            camera,
            diagnostics,
          });
          index += 1;
        }
      }
    }
  }
  const rank = (
    left: DialogueOtsCameraCandidate,
    right: DialogueOtsCameraCandidate,
  ) => right.score - left.score || left.id.localeCompare(right.id);
  const candidates = evaluated
    .filter(({ diagnostics }) => diagnostics.accepted)
    .sort(rank);
  const rejected = evaluated
    .filter(({ diagnostics }) => !diagnostics.accepted)
    .sort(rank);
  return {
    candidates,
    diagnostics: { evaluatedCount: evaluated.length, rejected },
  };
}
