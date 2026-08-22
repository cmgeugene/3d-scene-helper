export const RIGGED_CHARACTER_ASSET_IDS = ['meshy-idle-3'] as const;

export type RiggedCharacterAssetId =
  (typeof RIGGED_CHARACTER_ASSET_IDS)[number];

export interface RiggedCharacterAssetDefinition {
  id: RiggedCharacterAssetId;
  label: string;
  originalFileName: string;
  dimensions: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
  forwardRotationYDeg: number;
  boneCount: number;
  skinnedMeshCount: number;
  animation: {
    clipName: string;
    durationSeconds: number;
  };
  ikBoneMap: {
    leftHand: { root: string; middle: string; effector: string };
    rightHand: { root: string; middle: string; effector: string };
    leftFoot: { root: string; middle: string; effector: string };
    rightFoot: { root: string; middle: string; effector: string };
  };
}

export const RIGGED_CHARACTER_ASSETS: Readonly<
  Record<RiggedCharacterAssetId, RiggedCharacterAssetDefinition>
> = {
  'meshy-idle-3': {
    id: 'meshy-idle-3',
    label: 'Meshy Idle 캐릭터',
    originalFileName: 'Meshy_AI_Animation_Idle_3_withSkin.glb',
    dimensions: { x: 1.0291533, y: 1.7, z: 0.4099451 },
    center: { x: 0, y: 0.85, z: 0 },
    forwardRotationYDeg: 180,
    boneCount: 24,
    skinnedMeshCount: 1,
    animation: {
      clipName: 'Armature|Idle_3|baselayer',
      durationSeconds: 10,
    },
    ikBoneMap: {
      leftHand: {
        root: 'LeftArm',
        middle: 'LeftForeArm',
        effector: 'LeftHand',
      },
      rightHand: {
        root: 'RightArm',
        middle: 'RightForeArm',
        effector: 'RightHand',
      },
      leftFoot: {
        root: 'LeftUpLeg',
        middle: 'LeftLeg',
        effector: 'LeftFoot',
      },
      rightFoot: {
        root: 'RightUpLeg',
        middle: 'RightLeg',
        effector: 'RightFoot',
      },
    },
  },
};

export function getRiggedCharacterAsset(id: string) {
  if (!RIGGED_CHARACTER_ASSET_IDS.includes(id as RiggedCharacterAssetId)) {
    return undefined;
  }
  return RIGGED_CHARACTER_ASSETS[id as RiggedCharacterAssetId];
}
