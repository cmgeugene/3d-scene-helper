import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import {
  MathUtils,
  type PerspectiveCamera as PerspectiveCameraImpl,
} from 'three';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import { ASPECT_RATIO_VALUES, RENDER_LAYERS } from '../constants';
import type { EditorStore } from '../state/editorStore';
import { applyViewportCameraProjection } from './cameraMath';

interface OutputCameraProps {
  store: StoreApi<EditorStore>;
}

const roundDiagnosticValue = (value: number) => Number(value.toFixed(6));

function publishRuntimeCamera(
  camera: PerspectiveCameraImpl,
  target: EditorStore['document']['outputCamera']['target'],
  rollDeg: number,
  domElement: HTMLCanvasElement,
  outputAspect: number,
) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;

  domElement.dataset.runtimeCamera = JSON.stringify({
    position: {
      x: roundDiagnosticValue(camera.position.x),
      y: roundDiagnosticValue(camera.position.y),
      z: roundDiagnosticValue(camera.position.z),
    },
    target,
    focalLengthMm: roundDiagnosticValue(camera.getFocalLength()),
    filmGaugeMm: roundDiagnosticValue(camera.filmGauge),
    aspect: roundDiagnosticValue(camera.aspect),
    outputAspect: roundDiagnosticValue(outputAspect),
    zoom: roundDiagnosticValue(camera.zoom),
    rotationZDeg: roundDiagnosticValue(rollDeg),
  });
}

export function OutputCamera({ store }: OutputCameraProps) {
  const ref = useRef<PerspectiveCameraImpl>(null);
  const cameraData = useStore(store, (state) => state.document.outputCamera);
  const isInteracting = useStore(
    store,
    (state) => state.navigation.isInteracting,
  );
  const outputAspectId = useStore(
    store,
    (state) => state.document.output.aspectRatioId,
  );
  const domElement = useThree((state) => state.gl.domElement);
  const setThree = useThree((state) => state.set);
  const viewportWidth = useThree((state) => state.size.width);
  const viewportHeight = useThree((state) => state.size.height);

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
    const outputAspect = ASPECT_RATIO_VALUES[outputAspectId];
    applyViewportCameraProjection(
      camera,
      viewportWidth,
      viewportHeight,
      outputAspect,
      cameraData.focalLengthMm,
    );
    camera.layers.enable(RENDER_LAYERS.editor);
    publishRuntimeCamera(
      camera,
      cameraData.target,
      cameraData.rollDeg,
      domElement,
      outputAspect,
    );
  }, [
    cameraData,
    domElement,
    isInteracting,
    outputAspectId,
    viewportHeight,
    viewportWidth,
  ]);

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
