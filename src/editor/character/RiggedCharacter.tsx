import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MathUtils, type Group, type Mesh } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import type { SceneObject } from '../persistence/sceneSchema';
import {
  RiggedCharacterIK,
  type RiggedCharacterIkBinding,
} from './RiggedCharacterIK';

function publishRiggedCharacterDiagnostics(
  canvas: HTMLCanvasElement,
  assetId: string,
  boneCount: number,
  clipName: string,
) {
  canvas.dataset.riggedCharacterAsset = assetId;
  canvas.dataset.riggedCharacterBones = String(boneCount);
  canvas.dataset.riggedCharacterClip = clipName;
}

function clearRiggedCharacterDiagnostics(canvas: HTMLCanvasElement) {
  delete canvas.dataset.riggedCharacterAsset;
  delete canvas.dataset.riggedCharacterBones;
  delete canvas.dataset.riggedCharacterClip;
  delete canvas.dataset.riggedCharacterTime;
}

function publishRiggedCharacterTime(
  canvas: HTMLCanvasElement,
  timeSeconds: number,
) {
  canvas.dataset.riggedCharacterTime = timeSeconds.toFixed(3);
}

interface RiggedCharacterProps {
  object: SceneObject;
  assetUrl: string;
  castShadow: boolean;
  receiveShadow: boolean;
  ik?: RiggedCharacterIkBinding;
}

export function RiggedCharacter({
  object,
  assetUrl,
  castShadow,
  receiveShadow,
  ik,
}: RiggedCharacterProps) {
  const asset = object.characterAsset!;
  const assetId = object.characterAssetId ?? 'meshy-idle-3';
  const gltf = useGLTF(assetUrl);
  const animationRoot = useRef<Group>(null);
  const canvas = useThree((state) => state.gl.domElement);
  const instance = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const { actions, mixer } = useAnimations(gltf.animations, animationRoot);
  const animation = object.characterAnimation;
  const contentScale = object.dimensions.y / asset.dimensions.y;

  useLayoutEffect(() => {
    instance.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
      }
    });
  }, [castShadow, instance, receiveShadow]);

  useLayoutEffect(() => {
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
    let boneCount = 0;
    instance.traverse((child) => {
      if (child.type === 'Bone') boneCount += 1;
    });
    publishRiggedCharacterDiagnostics(
      canvas,
      assetId,
      boneCount,
      animation?.clipName ?? '',
    );
    return () => clearRiggedCharacterDiagnostics(canvas);
  }, [animation?.clipName, assetId, canvas, instance]);

  useEffect(() => {
    if (animation === undefined) return;
    const action = actions[animation.clipName];
    if (action == null) return;

    action
      .reset()
      .setEffectiveTimeScale(animation.playing ? 1 : 0)
      .play();
    mixer.setTime(animation.timeSeconds);
    return () => {
      action.stop();
    };
  }, [actions, animation, mixer]);

  useFrame(() => {
    if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
      const actionTime =
        animation === undefined ? 0 : (actions[animation.clipName]?.time ?? 0);
      publishRiggedCharacterTime(canvas, actionTime);
    }
  });

  return (
    <group
      ref={animationRoot}
      name={`RiggedCharacter:${assetId}`}
      scale={contentScale}
      rotation={[0, MathUtils.degToRad(asset.forwardRotationYDeg), 0]}
    >
      <primitive
        object={instance}
        position={[-asset.center.x, -asset.center.y, -asset.center.z]}
      />
      {ik === undefined ? null : (
        <RiggedCharacterIK
          object={object}
          instance={instance}
          rootRef={animationRoot}
          handleScale={1 / contentScale}
          {...ik}
        />
      )}
    </group>
  );
}
