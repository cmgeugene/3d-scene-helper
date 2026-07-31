import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type Group,
  type Mesh,
  type PerspectiveCamera,
} from 'three';
import type { StoreApi } from 'zustand/vanilla';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import { RENDER_LAYERS } from '../constants';
import {
  getMannequinArmChain,
  solveMannequinArmIk,
  type MannequinPose,
  type MannequinSide,
} from '../mannequin/mannequinRig';
import type { SceneObject } from '../persistence/sceneSchema';
import type { EditorStore } from '../state/editorStore';

export interface MannequinIKBinding {
  store: StoreApi<EditorStore>;
  pose: MannequinPose;
  onRuntimePoseChange: (pose: MannequinPose | null) => void;
  onDraggingChange: (dragging: boolean) => void;
}

interface MannequinIKControlsProps extends MannequinIKBinding {
  object: SceneObject;
}

const tempWorld = new Vector3();
const tempProjected = new Vector3();
const tempNormal = new Vector3();
const dragPlane = new Plane();
const pointerNdc = new Vector2();
const pointerRaycaster = new Raycaster();

function publishIKDiagnostics(
  canvas: HTMLCanvasElement,
  projections: Record<MannequinSide, { x: number; y: number }>,
  worldPositions: Record<MannequinSide, { x: number; y: number; z: number }>,
  draggingSide: MannequinSide | null,
) {
  canvas.dataset.ikHandleProjections = JSON.stringify(projections);
  canvas.dataset.ikHandPositions = JSON.stringify(worldPositions);
  if (draggingSide === null) delete canvas.dataset.ikDragging;
  else canvas.dataset.ikDragging = draggingSide;
}

function clearIKDiagnostics(canvas: HTMLCanvasElement) {
  delete canvas.dataset.ikDragging;
  delete canvas.dataset.ikHandleProjections;
  delete canvas.dataset.ikHandPositions;
}

function publishIKDragging(
  canvas: HTMLCanvasElement,
  side: MannequinSide | null,
) {
  if (side === null) delete canvas.dataset.ikDragging;
  else canvas.dataset.ikDragging = side;
}

function captureCanvasPointer(canvas: HTMLCanvasElement, pointerId: number) {
  canvas.setPointerCapture(pointerId);
}

function releaseCanvasPointer(canvas: HTMLCanvasElement, pointerId: number) {
  canvas.releasePointerCapture(pointerId);
}

export function MannequinIKControls({
  store,
  object,
  pose,
  onRuntimePoseChange,
  onDraggingChange,
}: MannequinIKControlsProps) {
  const groupRef = useRef<Group>(null);
  const rootRef = useRef<Group | null>(null);
  const handleRefs = useRef<Record<MannequinSide, Mesh | null>>({
    left: null,
    right: null,
  });
  const draggingSideRef = useRef<MannequinSide | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const projectionsRef = useRef<
    Record<MannequinSide, { x: number; y: number; depth: number }>
  >({
    left: { x: 0, y: 0, depth: Infinity },
    right: { x: 0, y: 0, depth: Infinity },
  });
  const runtimePoseRef = useRef(pose);
  const initialPoseRef = useRef<MannequinPose | null>(null);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const canvas = useThree((state) => state.gl.domElement);
  const dimensionScale = {
    x: object.dimensions.x / 0.5,
    y: object.dimensions.y / 1.7,
    z: object.dimensions.z / 0.3,
  };

  useLayoutEffect(() => {
    runtimePoseRef.current = pose;
  }, [pose]);

  useLayoutEffect(() => {
    rootRef.current = groupRef.current?.parent as Group | null;
    groupRef.current?.traverse((child) => {
      child.layers.set(RENDER_LAYERS.editor);
    });
  }, []);

  const finishDrag = (commit: boolean) => {
    const side = draggingSideRef.current;
    if (side === null) return;
    try {
      if (commit) {
        store.getState().commitMannequinPose(runtimePoseRef.current);
      } else {
        store.getState().cancelMannequinPose();
      }
    } catch (error) {
      if (commit) store.getState().cancelMannequinPose();
      throw error;
    } finally {
      draggingSideRef.current = null;
      pointerIdRef.current = null;
      initialPoseRef.current = null;
      onRuntimePoseChange(null);
      onDraggingChange(false);
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) publishIKDragging(canvas, null);
    }
  };

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && draggingSideRef.current !== null) {
        event.preventDefault();
        finishDrag(false);
      }
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  });

  useEffect(
    () => () => {
      if (draggingSideRef.current !== null) {
        draggingSideRef.current = null;
        store.getState().cancelMannequinPose();
        onRuntimePoseChange(null);
        onDraggingChange(false);
      }
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
        clearIKDiagnostics(canvas);
      }
    },
    [canvas, onDraggingChange, onRuntimePoseChange, store],
  );

  useFrame(() => {
    const root = rootRef.current;
    if (root === null) return;
    const projections: Record<
      MannequinSide,
      { x: number; y: number; depth: number }
    > = {
      left: { x: 0, y: 0, depth: Infinity },
      right: { x: 0, y: 0, depth: Infinity },
    };
    const worldPositions: Record<
      MannequinSide,
      { x: number; y: number; z: number }
    > = {
      left: { x: 0, y: 0, z: 0 },
      right: { x: 0, y: 0, z: 0 },
    };
    for (const side of ['left', 'right'] as const) {
      const handle = handleRefs.current[side];
      if (handle === null) continue;
      handle.getWorldPosition(tempWorld);
      worldPositions[side] = {
        x: tempWorld.x,
        y: tempWorld.y,
        z: tempWorld.z,
      };
      tempProjected.copy(tempWorld).project(camera);
      projections[side] = {
        x: ((tempProjected.x + 1) / 2) * canvas.clientWidth,
        y: ((1 - tempProjected.y) / 2) * canvas.clientHeight,
        depth: tempProjected.z,
      };
    }
    projectionsRef.current = projections;
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
    publishIKDiagnostics(
      canvas,
      projections,
      worldPositions,
      draggingSideRef.current,
    );
  });

  useEffect(() => {
    const pointerPosition = (event: PointerEvent) => {
      const rectangle = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rectangle.left,
        y: event.clientY - rectangle.top,
        rectangle,
      };
    };
    const begin = (event: PointerEvent) => {
      if (draggingSideRef.current !== null || event.button !== 0) return;
      const pointer = pointerPosition(event);
      const side = (['left', 'right'] as const)
        .map((candidate) => {
          const projection = projectionsRef.current[candidate];
          return {
            side: candidate,
            distance: Math.hypot(
              pointer.x - projection.x,
              pointer.y - projection.y,
            ),
            depth: projection.depth,
          };
        })
        .filter(({ distance }) => distance <= 26)
        .sort(
          (left, right) =>
            left.distance - right.distance || left.depth - right.depth,
        )[0]?.side;
      if (side === undefined) return;
      const root = rootRef.current;
      if (root === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      draggingSideRef.current = side;
      pointerIdRef.current = event.pointerId;
      runtimePoseRef.current = pose;
      initialPoseRef.current = structuredClone(pose);
      store.getState().beginMannequinPose();
      onDraggingChange(true);
      captureCanvasPointer(canvas, event.pointerId);
      const hand = getMannequinArmChain(pose, side).hand;
      tempWorld.set(
        hand.x * dimensionScale.x,
        hand.y * dimensionScale.y,
        hand.z * dimensionScale.z,
      );
      root.localToWorld(tempWorld);
      camera.getWorldDirection(tempNormal);
      dragPlane.setFromNormalAndCoplanarPoint(tempNormal, tempWorld);
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) publishIKDragging(canvas, side);
    };
    const move = (event: PointerEvent) => {
      const side = draggingSideRef.current;
      if (side === null || pointerIdRef.current !== event.pointerId) return;
      const root = rootRef.current;
      if (root === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const pointer = pointerPosition(event);
      pointerNdc.set(
        (pointer.x / pointer.rectangle.width) * 2 - 1,
        -(pointer.y / pointer.rectangle.height) * 2 + 1,
      );
      pointerRaycaster.setFromCamera(pointerNdc, camera);
      const worldTarget = pointerRaycaster.ray.intersectPlane(
        dragPlane,
        tempWorld,
      );
      if (worldTarget === null) return;
      const localTarget = root.worldToLocal(worldTarget.clone());
      const nextPose = solveMannequinArmIk(runtimePoseRef.current, side, {
        x: localTarget.x / dimensionScale.x,
        y: localTarget.y / dimensionScale.y,
        z: localTarget.z / dimensionScale.z,
      });
      runtimePoseRef.current = nextPose;
      onRuntimePoseChange(nextPose);
    };
    const end = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      releaseCanvasPointer(canvas, event.pointerId);
      finishDrag(true);
    };
    canvas.addEventListener('pointerdown', begin, true);
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerup', end, true);
    canvas.addEventListener('pointercancel', end, true);
    return () => {
      canvas.removeEventListener('pointerdown', begin, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', end, true);
      canvas.removeEventListener('pointercancel', end, true);
    };
  });

  return (
    <group ref={groupRef} name="MannequinIKHandles.layer1">
      {(['left', 'right'] as const).map((side) => {
        const hand = getMannequinArmChain(pose, side).hand;
        return (
          <mesh
            key={side}
            ref={(mesh) => {
              handleRefs.current[side] = mesh;
            }}
            name={`Mannequin.${side}-hand-ik.layer1`}
            position={[
              hand.x * dimensionScale.x,
              hand.y * dimensionScale.y,
              hand.z * dimensionScale.z,
            ]}
            renderOrder={1200}
          >
            <sphereGeometry args={[0.12, 20, 14]} />
            <meshBasicMaterial
              color={side === 'left' ? '#ff4fd8' : '#42e8ff'}
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
