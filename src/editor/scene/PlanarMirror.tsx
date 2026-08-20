import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import {
  PLANAR_MIRROR_TEXTURE_SIZE,
  createPlanarReflector,
  disposePlanarReflector,
} from './planarMirrorResource';

interface PlanarMirrorProps {
  mirrorObjectId: string;
  width: number;
  height: number;
  color: string;
  reflectedObjectIds: readonly string[];
}

interface PlanarMirrorDiagnostic {
  mirrorObjectId: string;
  reflectedObjectIds: readonly string[];
  textureSize: number;
}

const mountedMirrors = new WeakMap<
  HTMLCanvasElement,
  Map<string, PlanarMirrorDiagnostic>
>();

function publishMirrorDiagnostic(
  canvas: HTMLCanvasElement,
  diagnostic: PlanarMirrorDiagnostic | null,
  mirrorObjectId: string,
) {
  const mirrors = mountedMirrors.get(canvas) ?? new Map();
  if (diagnostic === null) mirrors.delete(mirrorObjectId);
  else mirrors.set(mirrorObjectId, diagnostic);
  if (mirrors.size === 0) {
    mountedMirrors.delete(canvas);
    delete canvas.dataset.planarMirrors;
    return;
  }
  mountedMirrors.set(canvas, mirrors);
  canvas.dataset.planarMirrors = JSON.stringify([...mirrors.values()]);
}

export function PlanarMirror({
  mirrorObjectId,
  width,
  height,
  color,
  reflectedObjectIds,
}: PlanarMirrorProps) {
  const canvas = useThree((state) => state.gl.domElement);
  const reflector = useMemo(
    () => createPlanarReflector(width, height, color),
    [color, height, width],
  );

  useLayoutEffect(() => {
    if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
      publishMirrorDiagnostic(
        canvas,
        {
          mirrorObjectId,
          reflectedObjectIds: [...reflectedObjectIds],
          textureSize: PLANAR_MIRROR_TEXTURE_SIZE,
        },
        mirrorObjectId,
      );
    }
    return () => {
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
        publishMirrorDiagnostic(canvas, null, mirrorObjectId);
      }
    };
  }, [canvas, mirrorObjectId, reflectedObjectIds, reflector]);

  useLayoutEffect(() => () => disposePlanarReflector(reflector), [reflector]);

  return (
    <primitive
      object={reflector}
      dispose={null}
      name={`planar-mirror:${mirrorObjectId}`}
      userData={{
        mirrorObjectId,
        reflectedObjectIds: [...reflectedObjectIds],
      }}
    />
  );
}
