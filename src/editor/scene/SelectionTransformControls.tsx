import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  MathUtils,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Raycaster,
} from 'three';
import type { TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { StoreApi } from 'zustand/vanilla';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import { RENDER_LAYERS } from '../constants';
import type { SceneObject } from '../persistence/sceneSchema';
import type { EditorStore } from '../state/editorStore';

interface SelectionTransformControlsProps {
  store: StoreApi<EditorStore>;
  object: Object3D;
  objectData: SceneObject;
  onDraggingChange: (dragging: boolean) => void;
}

interface TransformControlsInternals {
  axis: string | null;
  raycaster: Raycaster;
}

const projectedPosition = new Vector3();

function runtimeTransform(object: Object3D): SceneObject['transform'] {
  return {
    position: {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    },
    rotationDeg: {
      x: MathUtils.radToDeg(object.rotation.x),
      y: MathUtils.radToDeg(object.rotation.y),
      z: MathUtils.radToDeg(object.rotation.z),
    },
    scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
  };
}

function applyTransform(object: Object3D, transform: SceneObject['transform']) {
  object.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  object.rotation.set(
    MathUtils.degToRad(transform.rotationDeg.x),
    MathUtils.degToRad(transform.rotationDeg.y),
    MathUtils.degToRad(transform.rotationDeg.z),
  );
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  object.updateMatrixWorld(true);
}

function publishDiagnostics(
  object: Object3D,
  mode: EditorStore['transformMode'],
  dragging: boolean,
  camera: PerspectiveCamera,
  domElement: HTMLCanvasElement,
  controls: TransformControlsImpl | null = null,
) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;

  object.getWorldPosition(projectedPosition).project(camera);
  domElement.dataset.transformObject = object.name;
  domElement.dataset.transformMode = mode;
  domElement.dataset.transformDragging = String(dragging);
  domElement.dataset.transformAxis =
    (controls as unknown as TransformControlsInternals | null)?.axis ?? '';
  domElement.dataset.runtimeTransform = JSON.stringify(
    runtimeTransform(object),
  );
  domElement.dataset.gizmoOrigin = JSON.stringify({
    x: ((projectedPosition.x + 1) / 2) * domElement.clientWidth,
    y: ((1 - projectedPosition.y) / 2) * domElement.clientHeight,
  });
}

export function SelectionTransformControls({
  store,
  object,
  objectData,
  onDraggingChange,
}: SelectionTransformControlsProps) {
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const draggingRef = useRef(false);
  const initialRuntimeTransformRef = useRef<SceneObject['transform'] | null>(
    null,
  );
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const domElement = useThree((state) => state.gl.domElement);
  const mode = store.getState().transformMode;

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (controls === null) return;

    controls.traverse((child) => child.layers.set(RENDER_LAYERS.editor));
    const internals = controls as unknown as TransformControlsInternals;
    internals.raycaster.layers.set(RENDER_LAYERS.editor);
  }, []);

  useLayoutEffect(() => {
    publishDiagnostics(object, mode, draggingRef.current, camera, domElement);
    return () => {
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
        delete domElement.dataset.transformObject;
        delete domElement.dataset.transformMode;
        delete domElement.dataset.transformDragging;
        delete domElement.dataset.transformAxis;
        delete domElement.dataset.runtimeTransform;
        delete domElement.dataset.gizmoOrigin;
      }
    };
  }, [camera, domElement, mode, object, objectData.transform]);

  useEffect(
    () => () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const initialRuntimeTransform = initialRuntimeTransformRef.current;
      initialRuntimeTransformRef.current = null;
      if (initialRuntimeTransform !== null) {
        applyTransform(object, initialRuntimeTransform);
      }
      const inProgress = store.getState().inProgressTransform;
      if (inProgress?.objectId === objectData.id) {
        store.getState().cancelTransform();
      }
      onDraggingChange(false);
    },
    [object, objectData.id, onDraggingChange, store],
  );

  return (
    <TransformControls
      ref={controlsRef}
      object={object}
      mode={mode}
      size={0.8}
      onMouseDown={() => {
        if (draggingRef.current) return;
        draggingRef.current = true;
        initialRuntimeTransformRef.current = runtimeTransform(object);
        store.getState().beginTransform();
        onDraggingChange(true);
        publishDiagnostics(
          object,
          mode,
          true,
          camera,
          domElement,
          controlsRef.current,
        );
      }}
      onChange={() => {
        publishDiagnostics(
          object,
          mode,
          draggingRef.current,
          camera,
          domElement,
          controlsRef.current,
        );
      }}
      onObjectChange={() => {
        publishDiagnostics(
          object,
          mode,
          true,
          camera,
          domElement,
          controlsRef.current,
        );
      }}
      onMouseUp={() => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        const inProgress = store.getState().inProgressTransform;
        if (inProgress?.objectId !== objectData.id) {
          const initialRuntimeTransform = initialRuntimeTransformRef.current;
          initialRuntimeTransformRef.current = null;
          if (initialRuntimeTransform !== null) {
            applyTransform(object, initialRuntimeTransform);
          }
          onDraggingChange(false);
          publishDiagnostics(
            object,
            mode,
            false,
            camera,
            domElement,
            controlsRef.current,
          );
          return;
        }

        const finalTransform = runtimeTransform(object);
        initialRuntimeTransformRef.current = null;
        try {
          store.getState().commitTransform(finalTransform);
        } catch {
          applyTransform(object, inProgress.initialTransform);
          store.getState().cancelTransform();
        }
        onDraggingChange(false);
        publishDiagnostics(
          object,
          mode,
          false,
          camera,
          domElement,
          controlsRef.current,
        );
      }}
    />
  );
}
