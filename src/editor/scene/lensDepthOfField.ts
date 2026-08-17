export const PHOTOGRAPHIC_F_STOPS = [
  1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10,
  11, 13, 14, 16, 18, 20, 22,
] as const;

export const MIN_F_STOP = PHOTOGRAPHIC_F_STOPS[0];
export const MAX_F_STOP = PHOTOGRAPHIC_F_STOPS.at(-1) as 22;

export function getPhotographicFStopAtIndex(index: number): number {
  if (!Number.isFinite(index)) {
    throw new RangeError('Photographic stop index must be finite.');
  }
  const boundedIndex = Math.min(
    PHOTOGRAPHIC_F_STOPS.length - 1,
    Math.max(0, Math.round(index)),
  );
  return PHOTOGRAPHIC_F_STOPS[boundedIndex];
}

export function getPhotographicFStopIndex(fStop: number): number {
  if (!Number.isFinite(fStop)) {
    throw new RangeError('f-stop must be finite.');
  }
  let nearestIndex = 0;
  let nearestDistance = Math.abs(fStop - PHOTOGRAPHIC_F_STOPS[0]);
  for (let index = 1; index < PHOTOGRAPHIC_F_STOPS.length; index += 1) {
    const distance = Math.abs(fStop - PHOTOGRAPHIC_F_STOPS[index]);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

export const LENS_AUTO_APERTURE_MAP = {
  18: 8,
  24: 5.6,
  35: 4,
  50: 2.8,
  85: 2,
} as const;

export type LensFocalLengthMm = keyof typeof LENS_AUTO_APERTURE_MAP;
export type DepthOfFieldSettings = {
  enabled: boolean;
  apertureMode: 'auto' | 'manual';
  fStop: number;
};

type Vector3Data = { x: number; y: number; z: number };
type LensCameraData = {
  position: Vector3Data;
  target: Vector3Data;
  focalLengthMm: number;
  depthOfField: DepthOfFieldSettings;
};

function requireFiniteVector(vector: Vector3Data, name: string) {
  if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
    throw new RangeError(`${name} must contain finite coordinates.`);
  }
}

export function getAutoApertureForLens(focalLengthMm: number): number {
  const aperture =
    LENS_AUTO_APERTURE_MAP[
      focalLengthMm as keyof typeof LENS_AUTO_APERTURE_MAP
    ];
  if (aperture === undefined) {
    throw new RangeError('Unsupported lens focal length.');
  }
  return aperture;
}

export function createLensDepthOfFieldSettings(
  enabled: boolean,
): DepthOfFieldSettings {
  return {
    enabled,
    apertureMode: 'auto',
    fStop: LENS_AUTO_APERTURE_MAP[50],
  };
}

export function createDepthOfFieldSettingsForLens(
  focalLengthMm: number,
  enabled: boolean,
): DepthOfFieldSettings {
  if (!Number.isFinite(focalLengthMm) || focalLengthMm <= 0) {
    throw new RangeError('Lens focal length must be a positive finite number.');
  }
  const presetFStop =
    LENS_AUTO_APERTURE_MAP[
      focalLengthMm as keyof typeof LENS_AUTO_APERTURE_MAP
    ];
  return presetFStop === undefined
    ? { enabled, apertureMode: 'manual', fStop: LENS_AUTO_APERTURE_MAP[50] }
    : { enabled, apertureMode: 'auto', fStop: presetFStop };
}

export function getFocusDistanceM(camera: {
  position: Vector3Data;
  target: Vector3Data;
}): number {
  requireFiniteVector(camera.position, 'camera.position');
  requireFiniteVector(camera.target, 'camera.target');
  const distance = Math.hypot(
    camera.position.x - camera.target.x,
    camera.position.y - camera.target.y,
    camera.position.z - camera.target.z,
  );
  if (!Number.isFinite(distance) || distance <= 1e-6) {
    throw new RangeError(
      'Camera position and target must define a focus distance.',
    );
  }
  return distance;
}

export function getDepthOfFieldRuntimeParameters(camera: LensCameraData) {
  const focusDistanceM = getFocusDistanceM(camera);
  const fStop =
    camera.depthOfField.apertureMode === 'auto'
      ? getAutoApertureForLens(camera.focalLengthMm)
      : camera.depthOfField.fStop;
  if (!Number.isFinite(fStop) || fStop < MIN_F_STOP || fStop > MAX_F_STOP) {
    throw new RangeError(`f-stop must be ${MIN_F_STOP}..${MAX_F_STOP}.`);
  }

  const relativeLensOpening =
    camera.focalLengthMm / fStop / (50 / LENS_AUTO_APERTURE_MAP[50]);
  return {
    enabled: camera.depthOfField.enabled,
    focusDistanceM,
    focalLengthMm: camera.focalLengthMm,
    fStop,
    aperture: 0.002 * relativeLensOpening,
    maxBlur: Math.min(0.012, 0.002 + 0.01 * relativeLensOpening),
  };
}
