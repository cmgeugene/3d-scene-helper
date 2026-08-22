import {
  Box3,
  Mesh,
  Object3D,
  SkinnedMesh,
  Vector3,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  riggedCharacterAnalysisSchema,
  type RiggedCharacterAnalysis,
  type RiggedCharacterIkBoneMap,
} from '../../../shared/riggedCharacterAsset';

function normalizeBoneName(name: string) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function findBoneName(root: Object3D, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeBoneName);
  const matches: string[] = [];
  root.traverse((child) => {
    if (child.type !== 'Bone') return;
    const normalized = normalizeBoneName(child.name);
    if (
      matches.length === 0 &&
      normalizedAliases.some(
        (alias) => normalized === alias || normalized.endsWith(alias),
      )
    ) {
      matches.push(child.name);
    }
  });
  return matches[0] ?? null;
}

export function detectHumanoidIkBoneMap(
  root: Object3D,
): RiggedCharacterIkBoneMap | null {
  const bone = (aliases: string[]) => findBoneName(root, aliases);
  const values = {
    leftArm: bone(['leftarm', 'leftupperarm', 'upperarml']),
    leftForeArm: bone(['leftforearm', 'leftlowerarm', 'forearml', 'lowerarml']),
    leftHand: bone(['lefthand', 'handl']),
    rightArm: bone(['rightarm', 'rightupperarm', 'upperarmr']),
    rightForeArm: bone([
      'rightforearm',
      'rightlowerarm',
      'forearmr',
      'lowerarmr',
    ]),
    rightHand: bone(['righthand', 'handr']),
    leftUpLeg: bone([
      'leftupleg',
      'leftupperleg',
      'leftthigh',
      'upperlegl',
      'thighl',
    ]),
    leftLeg: bone([
      'leftleg',
      'leftlowerleg',
      'leftcalf',
      'lowerlegl',
      'calfl',
    ]),
    leftFoot: bone(['leftfoot', 'leftankle', 'footl', 'anklel']),
    rightUpLeg: bone([
      'rightupleg',
      'rightupperleg',
      'rightthigh',
      'upperlegr',
      'thighr',
    ]),
    rightLeg: bone([
      'rightleg',
      'rightlowerleg',
      'rightcalf',
      'lowerlegr',
      'calfr',
    ]),
    rightFoot: bone(['rightfoot', 'rightankle', 'footr', 'ankler']),
  };
  if (Object.values(values).some((name) => name === null)) return null;
  return {
    leftHand: {
      root: values.leftArm!,
      middle: values.leftForeArm!,
      effector: values.leftHand!,
    },
    rightHand: {
      root: values.rightArm!,
      middle: values.rightForeArm!,
      effector: values.rightHand!,
    },
    leftFoot: {
      root: values.leftUpLeg!,
      middle: values.leftLeg!,
      effector: values.leftFoot!,
    },
    rightFoot: {
      root: values.rightUpLeg!,
      middle: values.rightLeg!,
      effector: values.rightFoot!,
    },
  };
}

function findByNormalizedName(root: Object3D, names: string[]) {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  const matches: Object3D[] = [];
  root.traverse((child) => {
    const normalized = child.name.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
    if (matches.length === 0 && normalizedNames.has(normalized)) {
      matches.push(child);
    }
  });
  return matches[0] ?? null;
}

function inferForwardRotationYDeg(root: Object3D) {
  const head = findByNormalizedName(root, ['head']);
  const headFront = findByNormalizedName(root, [
    'headfront',
    'facefront',
    'headend',
  ]);
  if (head !== null && headFront !== null) {
    const direction = headFront
      .getWorldPosition(new Vector3())
      .sub(head.getWorldPosition(new Vector3()));
    if (Math.abs(direction.z) > Math.abs(direction.x)) {
      return direction.z >= 0 ? 180 : 0;
    }
  }
  // Rodin/Meshy humanoid exports normally face glTF +Z, while the editor's
  // subject-facing convention is -Z.
  return 180;
}

function disposeMaterial(material: Material | Material[]) {
  for (const item of Array.isArray(material) ? material : [material]) {
    item.dispose();
  }
}

export async function analyzeRiggedCharacterGlb(
  file: File,
): Promise<RiggedCharacterAnalysis> {
  if (!file.name.toLowerCase().endsWith('.glb')) {
    throw new Error('GLB 파일만 가져올 수 있습니다.');
  }
  if (file.size === 0 || file.size > 100 * 1024 * 1024) {
    throw new Error('GLB 파일은 100MB 이하여야 합니다.');
  }

  const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
  try {
    gltf.scene.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(gltf.scene, true);
    const dimensions = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    if (
      bounds.isEmpty() ||
      ![dimensions.x, dimensions.y, dimensions.z].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    ) {
      throw new Error('캐릭터의 실제 크기를 계산할 수 없습니다.');
    }

    let boneCount = 0;
    let skinnedMeshCount = 0;
    gltf.scene.traverse((child) => {
      if (child.type === 'Bone') boneCount += 1;
      if ((child as SkinnedMesh).isSkinnedMesh) skinnedMeshCount += 1;
    });
    if (boneCount === 0 || skinnedMeshCount === 0) {
      throw new Error('스킨과 본이 포함된 리깅 GLB가 아닙니다.');
    }

    const clip =
      gltf.animations.find(({ name }) => /(^|[|_\s-])idle/i.test(name)) ??
      gltf.animations[0] ??
      null;
    return riggedCharacterAnalysisSchema.parse({
      dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      center: { x: center.x, y: center.y, z: center.z },
      forwardRotationYDeg: inferForwardRotationYDeg(gltf.scene),
      boneCount,
      skinnedMeshCount,
      animation:
        clip === null
          ? null
          : { clipName: clip.name, durationSeconds: clip.duration },
      ikBoneMap: detectHumanoidIkBoneMap(gltf.scene),
    });
  } finally {
    gltf.scene.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
    });
  }
}

export function getRiggedCharacterDisplayName(fileName: string) {
  const withoutExtension = fileName.replace(/\.glb$/i, '').trim();
  return (withoutExtension || 'Rigged Character').slice(0, 120);
}
