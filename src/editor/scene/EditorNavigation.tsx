import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MathUtils, PerspectiveCamera, type Camera, type Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import type { EditorStore } from '../state/editorStore';

interface EditorNavigationProps {
  store: StoreApi<EditorStore>;
  enabled: boolean;
}

const roundDiagnosticValue = (value: number) => Number(value.toFixed(6));

function publishRuntimeCamera(camera: Camera, domElement: HTMLCanvasElement) {
  if (
    !IS_EDITOR_TEST_BRIDGE_ENABLED ||
    !(camera instanceof PerspectiveCamera)
  ) {
    return;
  }

  domElement.dataset.runtimeCamera = JSON.stringify({
    position: {
      x: roundDiagnosticValue(camera.position.x),
      y: roundDiagnosticValue(camera.position.y),
      z: roundDiagnosticValue(camera.position.z),
    },
    focalLengthMm: roundDiagnosticValue(camera.getFocalLength()),
    rotationZDeg: roundDiagnosticValue(MathUtils.radToDeg(camera.rotation.z)),
  });
}

function applyCameraRoll(
  camera: Camera,
  target: Vector3,
  rollDeg: number,
  domElement: HTMLCanvasElement,
) {
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.rotateZ(MathUtils.degToRad(rollDeg));
  publishRuntimeCamera(camera, domElement);
}

function setNavigationEnabled(
  controls: OrbitControls | null,
  domElement: HTMLCanvasElement,
  enabled: boolean,
) {
  if (controls !== null) controls.enabled = enabled;
  if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
    domElement.dataset.orbitEnabled = String(enabled);
  }
}

export function EditorNavigation({ store, enabled }: EditorNavigationProps) {
  const controlsRef = useRef<OrbitControls | null>(null);
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const cameraData = useStore(store, (state) => state.document.outputCamera);
  const isInteracting = useStore(
    store,
    (state) => state.navigation.isInteracting,
  );

  useEffect(() => {
    const controls = new OrbitControls(camera, domElement);
    controlsRef.current = controls;
    controls.enableDamping = false;
    controls.enableZoom = false;
    controls.screenSpacePanning = true;
    controls.target.set(
      cameraData.target.x,
      cameraData.target.y,
      cameraData.target.z,
    );
    controls.update();
    applyCameraRoll(camera, controls.target, cameraData.rollDeg, domElement);

    const updateTransientNavigation = (interacting: boolean) => {
      store.getState().setNavigation({
        position: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        target: {
          x: controls.target.x,
          y: controls.target.y,
          z: controls.target.z,
        },
        isInteracting: interacting,
      });
    };

    const handleStart = () => {
      updateTransientNavigation(true);
    };
    const handleChange = () => {
      applyCameraRoll(
        camera,
        controls.target,
        store.getState().document.outputCamera.rollDeg,
        domElement,
      );
      if (store.getState().navigation.isInteracting) {
        updateTransientNavigation(true);
      }
    };
    const handleEnd = () => {
      const documentCamera = store.getState().document.outputCamera;
      const cameraChanged =
        camera.position.distanceTo(documentCamera.position) > 1e-6 ||
        controls.target.distanceTo(documentCamera.target) > 1e-6;

      if (!cameraChanged) {
        updateTransientNavigation(false);
        return;
      }

      store.getState().commitCamera({
        position: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        target: {
          x: controls.target.x,
          y: controls.target.y,
          z: controls.target.z,
        },
        focalLengthMm: documentCamera.focalLengthMm,
        rollDeg: documentCamera.rollDeg,
      });
    };

    controls.addEventListener('start', handleStart);
    controls.addEventListener('change', handleChange);
    controls.addEventListener('end', handleEnd);

    return () => {
      controls.removeEventListener('start', handleStart);
      controls.removeEventListener('change', handleChange);
      controls.removeEventListener('end', handleEnd);
      controls.dispose();
      if (controlsRef.current === controls) controlsRef.current = null;
    };
  }, [camera, cameraData.rollDeg, cameraData.target, domElement, store]);

  useEffect(() => {
    setNavigationEnabled(controlsRef.current, domElement, enabled);
  }, [domElement, enabled]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null || isInteracting) return;

    controls.target.set(
      cameraData.target.x,
      cameraData.target.y,
      cameraData.target.z,
    );
    controls.update();
    applyCameraRoll(camera, controls.target, cameraData.rollDeg, domElement);
  }, [
    camera,
    cameraData.rollDeg,
    cameraData.target,
    domElement,
    isInteracting,
  ]);

  return null;
}
