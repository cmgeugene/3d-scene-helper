export interface LensPreset {
  focalLengthMm: 18 | 24 | 35 | 50 | 85;
  label: string;
}

export interface CameraShotPreset {
  id:
    | 'eye-level-medium'
    | 'full-body'
    | 'low-angle'
    | 'high-angle'
    | 'close-up'
    | 'dutch-angle';
  label: string;
  framing: {
    reference: 'subject-bounds';
    coverage: number;
    elevationDeg: number;
    rollDeg: number;
  };
}

export interface CameraViewPreset {
  id:
    | 'front'
    | 'rear'
    | 'left'
    | 'right'
    | 'front-three-quarter'
    | 'rear-three-quarter';
  label: string;
  cameraDirection: { x: number; y: 0; z: number };
}

export const LENS_PRESETS = [
  { focalLengthMm: 18, label: '18mm' },
  { focalLengthMm: 24, label: '24mm' },
  { focalLengthMm: 35, label: '35mm' },
  { focalLengthMm: 50, label: '50mm' },
  { focalLengthMm: 85, label: '85mm' },
] as const satisfies readonly LensPreset[];

export const CAMERA_SHOT_PRESETS = [
  {
    id: 'eye-level-medium',
    label: '눈높이 미디엄',
    framing: {
      reference: 'subject-bounds',
      coverage: 0.65,
      elevationDeg: 0,
      rollDeg: 0,
    },
  },
  {
    id: 'full-body',
    label: '전신',
    framing: {
      reference: 'subject-bounds',
      coverage: 0.9,
      elevationDeg: 0,
      rollDeg: 0,
    },
  },
  {
    id: 'low-angle',
    label: '로우 앵글',
    framing: {
      reference: 'subject-bounds',
      coverage: 0.8,
      elevationDeg: -15,
      rollDeg: 0,
    },
  },
  {
    id: 'high-angle',
    label: '하이 앵글',
    framing: {
      reference: 'subject-bounds',
      coverage: 0.8,
      elevationDeg: 15,
      rollDeg: 0,
    },
  },
  {
    id: 'close-up',
    label: '클로즈업',
    framing: {
      reference: 'subject-bounds',
      coverage: 0.4,
      elevationDeg: 0,
      rollDeg: 0,
    },
  },
  {
    id: 'dutch-angle',
    label: '더치 앵글',
    framing: {
      reference: 'subject-bounds',
      coverage: 0.65,
      elevationDeg: 0,
      rollDeg: 12,
    },
  },
] as const satisfies readonly CameraShotPreset[];

/**
 * Mannequin local forward is -Z. A front camera therefore sits on the
 * subject's -Z side and looks toward +Z.
 */
export const CAMERA_VIEW_PRESETS = [
  {
    id: 'front',
    label: '정면',
    cameraDirection: { x: 0, y: 0, z: -1 },
  },
  {
    id: 'rear',
    label: '후면',
    cameraDirection: { x: 0, y: 0, z: 1 },
  },
  {
    id: 'left',
    label: '좌측',
    cameraDirection: { x: -1, y: 0, z: 0 },
  },
  {
    id: 'right',
    label: '우측',
    cameraDirection: { x: 1, y: 0, z: 0 },
  },
  {
    id: 'front-three-quarter',
    label: '3/4 정면',
    cameraDirection: { x: 1, y: 0, z: -1 },
  },
  {
    id: 'rear-three-quarter',
    label: '3/4 후면',
    cameraDirection: { x: -1, y: 0, z: 1 },
  },
] as const satisfies readonly CameraViewPreset[];
