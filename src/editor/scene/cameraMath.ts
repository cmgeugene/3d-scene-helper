import type { PerspectiveCamera } from 'three';
import { FILM_GAUGE_MM, MANNEQUIN_REFERENCE_HEIGHT_M } from '../constants';
import type { SceneDocument } from '../persistence/sceneSchema';
import type { CameraShotPreset } from '../presets/cameras';
import type { SceneObjectBounds } from './sceneObjectModel';

export interface LetterboxRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

function requirePositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
}

export function computeLetterbox(
  viewportWidth: number,
  viewportHeight: number,
  outputAspect: number,
): LetterboxRectangle {
  requirePositiveFinite(viewportWidth, 'viewportWidth');
  requirePositiveFinite(viewportHeight, 'viewportHeight');
  requirePositiveFinite(outputAspect, 'outputAspect');

  const viewportAspect = viewportWidth / viewportHeight;
  const width =
    outputAspect <= viewportAspect
      ? viewportHeight * outputAspect
      : viewportWidth;
  const height =
    outputAspect <= viewportAspect
      ? viewportHeight
      : viewportWidth / outputAspect;

  return {
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
    width,
    height,
  };
}

export function applyOutputCameraProjection(
  camera: PerspectiveCamera,
  outputAspect: number,
  focalLengthMm: number,
) {
  requirePositiveFinite(outputAspect, 'outputAspect');
  requirePositiveFinite(focalLengthMm, 'focalLengthMm');
  camera.filmGauge = FILM_GAUGE_MM;
  camera.aspect = outputAspect;
  camera.setFocalLength(focalLengthMm);
  camera.updateProjectionMatrix();
}

export function applyViewportCameraProjection(
  camera: PerspectiveCamera,
  viewportWidth: number,
  viewportHeight: number,
  outputAspect: number,
  focalLengthMm: number,
) {
  const frame = computeLetterbox(viewportWidth, viewportHeight, outputAspect);
  requirePositiveFinite(focalLengthMm, 'focalLengthMm');

  const viewportAspect = viewportWidth / viewportHeight;
  const viewportFilmHeight = FILM_GAUGE_MM / Math.max(viewportAspect, 1);
  const outputFilmHeight = FILM_GAUGE_MM / Math.max(outputAspect, 1);

  camera.filmGauge = FILM_GAUGE_MM;
  camera.aspect = viewportAspect;
  camera.setFocalLength(focalLengthMm);
  camera.zoom =
    (frame.height / viewportHeight) * (viewportFilmHeight / outputFilmHeight);
  camera.updateProjectionMatrix();
}

type OutputCameraData = SceneDocument['outputCamera'];

const REFERENCE_SUBJECT_BOUNDS: SceneObjectBounds = {
  min: { x: -0.25, y: 0, z: -0.15 },
  max: { x: 0.25, y: MANNEQUIN_REFERENCE_HEIGHT_M, z: 0.15 },
  size: { x: 0.5, y: MANNEQUIN_REFERENCE_HEIGHT_M, z: 0.3 },
  center: { x: 0, y: MANNEQUIN_REFERENCE_HEIGHT_M / 2, z: 0 },
};

type VectorData = OutputCameraData['target'];

const REFERENCE_EYE_LEVEL_M = 1.6;
const SHOT_FRAME_OCCUPANCY = 0.82;

function subtract(left: VectorData, right: VectorData): VectorData {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function cross(left: VectorData, right: VectorData): VectorData {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function dot(left: VectorData, right: VectorData) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function normalize(vector: VectorData, fallback: VectorData): VectorData {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-9
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : fallback;
}

function cameraBackward(camera: OutputCameraData): VectorData {
  return normalize(subtract(camera.position, camera.target), {
    x: 0,
    y: 0,
    z: 1,
  });
}

function backwardAtElevation(
  camera: OutputCameraData,
  elevationDeg: number,
): VectorData {
  const current = cameraBackward(camera);
  const horizontal = normalize(
    { x: current.x, y: 0, z: current.z },
    { x: 0, y: 0, z: 1 },
  );
  const elevation = (elevationDeg * Math.PI) / 180;
  return {
    x: horizontal.x * Math.cos(elevation),
    y: Math.sin(elevation),
    z: horizontal.z * Math.cos(elevation),
  };
}

function frameCorners(bounds: SceneObjectBounds) {
  return [bounds.min.x, bounds.max.x].flatMap((x) =>
    [bounds.min.y, bounds.max.y].flatMap((y) =>
      [bounds.min.z, bounds.max.z].map((z) => ({ x, y, z })),
    ),
  );
}

function cameraDistanceForFrame(
  bounds: SceneObjectBounds,
  target: VectorData,
  backward: VectorData,
  rollDeg: number,
  focalLengthMm: number,
  outputAspect: number,
  occupancy: number,
) {
  requirePositiveFinite(bounds.size.x, 'frame width');
  requirePositiveFinite(bounds.size.y, 'frame height');
  requirePositiveFinite(bounds.size.z, 'frame depth');
  requirePositiveFinite(focalLengthMm, 'focalLengthMm');
  requirePositiveFinite(outputAspect, 'outputAspect');
  requirePositiveFinite(occupancy, 'occupancy');
  if (occupancy > 1) throw new RangeError('occupancy must not exceed 1.');

  const filmHeight = FILM_GAUGE_MM / Math.max(outputAspect, 1);
  const verticalTangent = filmHeight / (2 * focalLengthMm);
  const horizontalTangent = verticalTangent * outputAspect;
  const forward = { x: -backward.x, y: -backward.y, z: -backward.z };
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }), {
    x: 1,
    y: 0,
    z: 0,
  });
  const up = normalize(cross(right, forward), { x: 0, y: 1, z: 0 });
  const roll = (rollDeg * Math.PI) / 180;
  const rolledRight = {
    x: right.x * Math.cos(roll) + up.x * Math.sin(roll),
    y: right.y * Math.cos(roll) + up.y * Math.sin(roll),
    z: right.z * Math.cos(roll) + up.z * Math.sin(roll),
  };
  const rolledUp = {
    x: up.x * Math.cos(roll) - right.x * Math.sin(roll),
    y: up.y * Math.cos(roll) - right.y * Math.sin(roll),
    z: up.z * Math.cos(roll) - right.z * Math.sin(roll),
  };

  return frameCorners(bounds).reduce((distance, corner) => {
    const relative = subtract(corner, target);
    const depthTowardCamera = dot(relative, backward);
    const horizontalDistance =
      depthTowardCamera +
      Math.abs(dot(relative, rolledRight)) / (horizontalTangent * occupancy);
    const verticalDistance =
      depthTowardCamera +
      Math.abs(dot(relative, rolledUp)) / (verticalTangent * occupancy);
    return Math.max(distance, horizontalDistance, verticalDistance);
  }, 0);
}

function positionFromBackward(
  target: VectorData,
  backward: VectorData,
  distance: number,
): VectorData {
  return {
    x: target.x + backward.x * distance,
    y: target.y + backward.y * distance,
    z: target.z + backward.z * distance,
  };
}

function topFractionBounds(
  bounds: SceneObjectBounds,
  fraction: number,
): SceneObjectBounds {
  requirePositiveFinite(fraction, 'visible subject fraction');
  const height = bounds.size.y * Math.min(fraction, 1);
  const minY = bounds.max.y - height;
  return {
    min: { ...bounds.min, y: minY },
    max: { ...bounds.max },
    size: { ...bounds.size, y: height },
    center: { ...bounds.center, y: minY + height / 2 },
  };
}

export function computeCameraShot(
  subjectBounds: SceneObjectBounds | null,
  camera: OutputCameraData,
  outputAspect: number,
  preset: CameraShotPreset,
): OutputCameraData {
  const bounds = subjectBounds ?? REFERENCE_SUBJECT_BOUNDS;
  const isFullBody = preset.id === 'full-body';
  const visibleBounds = isFullBody
    ? bounds
    : topFractionBounds(bounds, preset.framing.coverage);
  const usesEyeLevel = ['eye-level-medium', 'close-up', 'dutch-angle'].includes(
    preset.id,
  );
  const target = {
    x: bounds.center.x,
    y: usesEyeLevel
      ? bounds.min.y +
        bounds.size.y * (REFERENCE_EYE_LEVEL_M / MANNEQUIN_REFERENCE_HEIGHT_M)
      : visibleBounds.center.y,
    z: bounds.center.z,
  };
  const backward = backwardAtElevation(camera, preset.framing.elevationDeg);
  const distance = cameraDistanceForFrame(
    visibleBounds,
    target,
    backward,
    preset.framing.rollDeg,
    camera.focalLengthMm,
    outputAspect,
    isFullBody ? preset.framing.coverage : SHOT_FRAME_OCCUPANCY,
  );

  return {
    position: positionFromBackward(target, backward, distance),
    target,
    focalLengthMm: camera.focalLengthMm,
    rollDeg: preset.framing.rollDeg,
  };
}

export function computeFrameSelectedCamera(
  bounds: SceneObjectBounds,
  camera: OutputCameraData,
  outputAspect: number,
): OutputCameraData {
  const target = { ...bounds.center };
  const backward = cameraBackward(camera);
  const distance = cameraDistanceForFrame(
    bounds,
    target,
    backward,
    camera.rollDeg,
    camera.focalLengthMm,
    outputAspect,
    SHOT_FRAME_OCCUPANCY,
  );

  return {
    ...camera,
    position: positionFromBackward(target, backward, distance),
    target,
  };
}

export function computeLookAtSelectedCamera(
  bounds: SceneObjectBounds,
  camera: OutputCameraData,
): OutputCameraData {
  return { ...camera, target: { ...bounds.center } };
}
