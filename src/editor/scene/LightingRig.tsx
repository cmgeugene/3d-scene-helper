import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import type { AmbientLight, DirectionalLight, WebGLRenderer } from 'three';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import { MAX_SHADOW_MAP_SIZE } from '../constants';
import type { SceneDocument } from '../persistence/sceneSchema';

export const SHADOW_BOUNDS_M = 6;
const LIGHT_DISTANCE_M = 3;

interface LightingRigProps {
  lighting: SceneDocument['lighting'];
}

function rounded(value: number) {
  return Number(value.toFixed(6));
}

function lightSnapshot(light: DirectionalLight) {
  return {
    color: `#${light.color.getHexString()}`,
    intensity: rounded(light.intensity),
    position: light.position.toArray().map(rounded),
    castShadow: light.castShadow,
  };
}

function applyRendererExposure(renderer: WebGLRenderer, exposure: number) {
  renderer.toneMappingExposure = exposure;
}

function publishRuntimeLighting(
  renderer: WebGLRenderer,
  lighting: SceneDocument['lighting'],
  environment: AmbientLight,
  key: DirectionalLight,
  fill: DirectionalLight,
  rim: DirectionalLight,
) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return null;

  const diagnostic = JSON.stringify({
    presetId: lighting.presetId,
    exposure: rounded(renderer.toneMappingExposure),
    environmentIntensity: rounded(environment.intensity),
    key: {
      ...lightSnapshot(key),
      shadowMapSize: key.shadow.mapSize.toArray(),
      shadowRadius: rounded(key.shadow.radius),
    },
    fill: lightSnapshot(fill),
    rim: lightSnapshot(rim),
  });
  renderer.domElement.dataset.runtimeLighting = diagnostic;
  return diagnostic;
}

function clearRuntimeLighting(renderer: WebGLRenderer, diagnostic: string) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
  if (renderer.domElement.dataset.runtimeLighting === diagnostic) {
    delete renderer.domElement.dataset.runtimeLighting;
  }
}

export function LightingRig({ lighting }: LightingRigProps) {
  const environment = useRef<AmbientLight>(null);
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const shadowMapSize = Math.min(lighting.shadows.mapSize, MAX_SHADOW_MAP_SIZE);
  const shadowRadius = 1 + lighting.shadows.softness * 3;

  useLayoutEffect(() => {
    applyRendererExposure(gl, lighting.exposure);
    invalidate();

    if (
      environment.current === null ||
      key.current === null ||
      fill.current === null ||
      rim.current === null
    ) {
      return;
    }

    const diagnostic = publishRuntimeLighting(
      gl,
      lighting,
      environment.current,
      key.current,
      fill.current,
      rim.current,
    );
    if (diagnostic === null) return;

    return () => {
      clearRuntimeLighting(gl, diagnostic);
    };
  }, [gl, invalidate, lighting]);

  return (
    <>
      <ambientLight
        ref={environment}
        name="LightingRig.environment"
        intensity={lighting.environmentIntensity}
        color="#ffffff"
      />
      <directionalLight
        ref={key}
        name="LightingRig.key"
        color={lighting.key.color}
        intensity={lighting.key.intensity}
        position={[
          lighting.key.direction.x * LIGHT_DISTANCE_M,
          lighting.key.direction.y * LIGHT_DISTANCE_M,
          lighting.key.direction.z * LIGHT_DISTANCE_M,
        ]}
        castShadow={lighting.shadows.enabled}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-radius={shadowRadius}
        shadow-camera-left={-SHADOW_BOUNDS_M}
        shadow-camera-right={SHADOW_BOUNDS_M}
        shadow-camera-top={SHADOW_BOUNDS_M}
        shadow-camera-bottom={-SHADOW_BOUNDS_M}
        shadow-camera-near={0.1}
        shadow-camera-far={24}
        shadow-bias={-0.0004}
      />
      <directionalLight
        ref={fill}
        name="LightingRig.fill"
        color={lighting.fill.color}
        intensity={lighting.fill.intensity}
        position={[
          lighting.fill.direction.x * LIGHT_DISTANCE_M,
          lighting.fill.direction.y * LIGHT_DISTANCE_M,
          lighting.fill.direction.z * LIGHT_DISTANCE_M,
        ]}
        castShadow={false}
      />
      <directionalLight
        ref={rim}
        name="LightingRig.rim"
        color={lighting.rim.color}
        intensity={lighting.rim.intensity}
        position={[
          lighting.rim.direction.x * LIGHT_DISTANCE_M,
          lighting.rim.direction.y * LIGHT_DISTANCE_M,
          lighting.rim.direction.z * LIGHT_DISTANCE_M,
        ]}
        castShadow={false}
      />
    </>
  );
}
