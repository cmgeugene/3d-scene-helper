export const MIN_F_STOP = 1.4 as const;
export const MAX_F_STOP = 22 as const;

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
  const presetFStop = getAutoApertureForLens(camera.focalLengthMm);
  const fStop =
    camera.depthOfField.apertureMode === 'auto'
      ? presetFStop
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
