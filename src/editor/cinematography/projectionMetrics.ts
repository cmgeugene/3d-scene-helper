import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { SAFE_AREA_INSETS } from '../constants';
import type {
  MannequinCinematicLandmarks,
  MannequinVector3,
} from '../mannequin/mannequinRig';
import type { SceneDocument } from '../persistence/sceneSchema';
import { applyOutputCameraProjection } from '../scene/cameraMath';
import type { CinematicSubjectProfile } from './cinematicSubjectProfile';

type ProjectionCamera = Pick<
  SceneDocument['outputCamera'],
  'position' | 'target' | 'focalLengthMm' | 'rollDeg'
>;

export interface ProjectedPoint {
  ndc: { x: number; y: number; z: number };
  inFront: boolean;
  insideFrame: boolean;
  insideActionSafe: boolean;
}

export interface CinematicProjectionMetrics {
  landmarks: Record<keyof MannequinCinematicLandmarks, ProjectedPoint>;
  outline: readonly ProjectedPoint[];
  visibleRect: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
  } | null;
  occupancy: { width: number; height: number };
  headroom: number | null;
  clippedLandmarks: readonly (keyof MannequinCinematicLandmarks)[];
  allInFront: boolean;
}

const FRAME_EPSILON = 1e-10;
const OUTPUT_CAMERA_NEAR = 0.1;
const OUTPUT_CAMERA_FAR = 100;

function requirePositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

function requireFinite(value: number, name: string) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number.`);
  }
}

function createOutputCamera(
  cameraData: ProjectionCamera,
  outputAspect: number,
) {
  requirePositiveFinite(outputAspect, 'outputAspect');
  requirePositiveFinite(cameraData.focalLengthMm, 'focalLengthMm');
  for (const [name, value] of Object.entries({
    positionX: cameraData.position.x,
    positionY: cameraData.position.y,
    positionZ: cameraData.position.z,
    targetX: cameraData.target.x,
    targetY: cameraData.target.y,
    targetZ: cameraData.target.z,
    rollDeg: cameraData.rollDeg,
  })) {
    requireFinite(value, name);
  }
  requirePositiveFinite(
    Math.hypot(
      cameraData.position.x - cameraData.target.x,
      cameraData.position.y - cameraData.target.y,
      cameraData.position.z - cameraData.target.z,
    ),
    'camera distance',
  );

  const camera = new PerspectiveCamera(
    50,
    outputAspect,
    OUTPUT_CAMERA_NEAR,
    OUTPUT_CAMERA_FAR,
  );
  camera.position.set(
    cameraData.position.x,
    cameraData.position.y,
    cameraData.position.z,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(cameraData.target.x, cameraData.target.y, cameraData.target.z);
  camera.rotateZ(MathUtils.degToRad(cameraData.rollDeg));
  applyOutputCameraProjection(camera, outputAspect, cameraData.focalLengthMm);
  camera.updateMatrixWorld(true);
  return camera;
}

function inside(value: number, limit: number) {
  return Math.abs(value) <= limit + FRAME_EPSILON;
}

function projectPoint(
  point: MannequinVector3,
  camera: PerspectiveCamera,
): ProjectedPoint {
  const world = new Vector3(point.x, point.y, point.z);
  const cameraSpace = world.clone().applyMatrix4(camera.matrixWorldInverse);
  const projected = world.project(camera);
  const inFront = cameraSpace.z < 0;
  const withinDepth = projected.z >= -1 && projected.z <= 1;
  const insideFrame =
    inFront && withinDepth && inside(projected.x, 1) && inside(projected.y, 1);
  const actionSafeLimit = 1 - SAFE_AREA_INSETS.action * 2;

  return {
    ndc: { x: projected.x, y: projected.y, z: projected.z },
    inFront,
    insideFrame,
    insideActionSafe:
      inFront &&
      withinDepth &&
      inside(projected.x, actionSafeLimit) &&
      inside(projected.y, actionSafeLimit),
  };
}

export function computeCinematicProjectionMetrics(
  profile: CinematicSubjectProfile,
  cameraData: ProjectionCamera,
  outputAspect: number,
): CinematicProjectionMetrics {
  const camera = createOutputCamera(cameraData, outputAspect);
  const landmarkEntries = Object.entries(profile.landmarks) as [
    keyof MannequinCinematicLandmarks,
    MannequinVector3,
  ][];
  const landmarks = Object.fromEntries(
    landmarkEntries.map(([name, point]) => [name, projectPoint(point, camera)]),
  ) as Record<keyof MannequinCinematicLandmarks, ProjectedPoint>;
  const outline = profile.outline.map((point) => projectPoint(point, camera));
  const visibleOutline = outline.filter(({ inFront }) => inFront);
  const visibleRect =
    visibleOutline.length === 0
      ? null
      : (() => {
          const xs = visibleOutline.map(({ ndc }) => ndc.x);
          const ys = visibleOutline.map(({ ndc }) => ndc.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          return {
            minX,
            maxX,
            minY,
            maxY,
            width: maxX - minX,
            height: maxY - minY,
          };
        })();
  const clippedLandmarks = landmarkEntries
    .map(([name]) => name)
    .filter((name) => !landmarks[name].insideFrame);
  const projectedHeadTop = landmarks.headTop;

  return {
    landmarks,
    outline,
    visibleRect,
    occupancy:
      visibleRect === null
        ? { width: 0, height: 0 }
        : {
            width: visibleRect.width / 2,
            height: visibleRect.height / 2,
          },
    headroom: projectedHeadTop.inFront
      ? (1 - projectedHeadTop.ndc.y) / 2
      : null,
    clippedLandmarks,
    allInFront: Object.values(landmarks).every(({ inFront }) => inFront),
  };
}
