export const MANNEQUIN_BODY_TYPE_IDS = [
  'standard',
  'athletic',
  'heavy',
] as const;

export type MannequinBodyTypeId = (typeof MANNEQUIN_BODY_TYPE_IDS)[number];

export interface MannequinBodyRadialScale {
  x: number;
  z: number;
}

export type MannequinBodyPart =
  | 'torso'
  | 'torsoCue'
  | 'pelvis'
  | 'neck'
  | 'head'
  | 'upperArm'
  | 'forearm'
  | 'thigh'
  | 'shin'
  | 'hand'
  | 'thumb'
  | 'foot';

export const MANNEQUIN_BODY_PROPORTIONS: Record<
  MannequinBodyTypeId,
  Record<MannequinBodyPart, MannequinBodyRadialScale>
> = {
  standard: {
    torso: { x: 1, z: 1 },
    torsoCue: { x: 1, z: 1 },
    pelvis: { x: 1, z: 1 },
    neck: { x: 1, z: 1 },
    head: { x: 1, z: 1 },
    upperArm: { x: 1, z: 1 },
    forearm: { x: 1, z: 1 },
    thigh: { x: 1, z: 1 },
    shin: { x: 1, z: 1 },
    hand: { x: 1, z: 1 },
    thumb: { x: 1, z: 1 },
    foot: { x: 1, z: 1 },
  },
  athletic: {
    torso: { x: 1.28, z: 1.14 },
    torsoCue: { x: 1.28, z: 1.14 },
    pelvis: { x: 1.1, z: 1.08 },
    neck: { x: 1.08, z: 1.08 },
    head: { x: 1.03, z: 1.03 },
    upperArm: { x: 1.26, z: 1.22 },
    forearm: { x: 1.2, z: 1.18 },
    thigh: { x: 1.18, z: 1.16 },
    shin: { x: 1.14, z: 1.12 },
    hand: { x: 1.08, z: 1.06 },
    thumb: { x: 1.08, z: 1.06 },
    foot: { x: 1.06, z: 1.04 },
  },
  heavy: {
    torso: { x: 1.9, z: 1.9 },
    torsoCue: { x: 1.32, z: 1.42 },
    pelvis: { x: 1.34, z: 1.42 },
    neck: { x: 1.12, z: 1.12 },
    head: { x: 1.08, z: 1.08 },
    upperArm: { x: 1.34, z: 1.38 },
    forearm: { x: 1.26, z: 1.3 },
    thigh: { x: 1.45, z: 1.48 },
    shin: { x: 1.2, z: 1.22 },
    hand: { x: 1.1, z: 1.08 },
    thumb: { x: 1.1, z: 1.08 },
    foot: { x: 1.1, z: 1.08 },
  },
};

export const MANNEQUIN_BODY_TYPE_PRESETS = [
  { id: 'standard', label: '일반 체형', heightMeters: 1.7 },
  { id: 'athletic', label: '건장한 체형', heightMeters: 1.8 },
  { id: 'heavy', label: '뚱뚱한 체형', heightMeters: 1.7 },
] as const satisfies ReadonlyArray<{
  id: MannequinBodyTypeId;
  label: string;
  heightMeters: number;
}>;
