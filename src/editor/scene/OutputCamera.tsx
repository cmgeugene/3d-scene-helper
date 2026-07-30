import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import {
  MathUtils,
  type PerspectiveCamera as PerspectiveCameraImpl,
} from 'three';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { RENDER_LAYERS } from '../constants';
import type { EditorStore } from '../state/editorStore';

interface OutputCameraProps {
  store: StoreApi<EditorStore>;
}

export function OutputCamera({ store }: OutputCameraProps) {
  const ref = useRef<PerspectiveCameraImpl>(null);
  const cameraData = useStore(store, (state) => state.document.outputCamera);
  const isInteracting = useStore(
    store,
    (state) => state.navigation.isInteracting,
  );
  const size = useThree((state) => state.size);
  const setThree = useThree((state) => state.set);

  useLayoutEffect(() => {
    const camera = ref.current;
    if (camera === null) return;

    setThree({ camera });
  }, [setThree]);

  useLayoutEffect(() => {
    const camera = ref.current;
    if (camera === null || isInteracting) return;

    camera.position.set(
      cameraData.position.x,
      cameraData.position.y,
      cameraData.position.z,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(
      cameraData.target.x,
      cameraData.target.y,
      cameraData.target.z,
    );
    camera.rotateZ(MathUtils.degToRad(cameraData.rollDeg));
    camera.aspect = size.width / Math.max(size.height, 1);
    camera.setFocalLength(cameraData.focalLengthMm);
    camera.layers.enable(RENDER_LAYERS.editor);
    camera.updateProjectionMatrix();
  }, [cameraData, isInteracting, size.height, size.width]);

  return (
    <perspectiveCamera
      ref={ref}
      name="OutputCamera.runtime"
      near={0.1}
      far={100}
      position={[
        cameraData.position.x,
        cameraData.position.y,
        cameraData.position.z,
      ]}
    />
  );
}
