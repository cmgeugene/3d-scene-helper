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
  getMannequinLegChain,
  solveMannequinArmIk,
  solveMannequinElbowIk,
  solveMannequinKneeIk,
  solveMannequinLegIk,
  type MannequinPose,
  type MannequinSide,
  type MannequinVector3,
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

type MannequinIKJoint = 'hand' | 'foot' | 'elbow' | 'knee';
type MannequinIKHandleId = `${MannequinSide}-${MannequinIKJoint}`;

interface MannequinIKHandle {
  id: MannequinIKHandleId;
  side: MannequinSide;
  joint: MannequinIKJoint;
}

const IK_HANDLES = (['left', 'right'] as const).flatMap((side) =>
  (['hand', 'foot', 'elbow', 'knee'] as const).map((joint) => ({
    id: `${side}-${joint}` as MannequinIKHandleId,
    side,
    joint,
  })),
);

const IK_HANDLE_COLORS: Record<MannequinIKHandleId, string> = {
  'left-hand': '#ff4fd8',
  'right-hand': '#42e8ff',
  'left-foot': '#ff8a3d',
  'right-foot': '#72f08a',
  'left-elbow': '#ffd84d',
  'right-elbow': '#748cff',
  'left-knee': '#ff6f7d',
  'right-knee': '#54e6c1',
};

function getHandlePosition(
  pose: MannequinPose,
  handle: MannequinIKHandle,
): MannequinVector3 {
  if (handle.joint === 'hand' || handle.joint === 'elbow') {
    return getMannequinArmChain(pose, handle.side)[handle.joint];
  }
  const leg = getMannequinLegChain(pose, handle.side);
  return handle.joint === 'foot' ? leg.foot : leg.knee;
}

function solveHandleTarget(
  pose: MannequinPose,
  handle: MannequinIKHandle,
  target: MannequinVector3,
) {
  if (handle.joint === 'hand') {
    return solveMannequinArmIk(pose, handle.side, target);
  }
  if (handle.joint === 'foot') {
    return solveMannequinLegIk(pose, handle.side, target);
  }
  if (handle.joint === 'elbow') {
    return solveMannequinElbowIk(pose, handle.side, target);
  }
  return solveMannequinKneeIk(pose, handle.side, target);
}

function publishIKDiagnostics(
  canvas: HTMLCanvasElement,
  projections: Record<MannequinSide, { x: number; y: number }>,
  worldPositions: Record<MannequinSide, { x: number; y: number; z: number }>,
  jointProjections: Record<
    MannequinIKHandleId,
    { x: number; y: number; depth: number }
  >,
  draggingHandle: MannequinIKHandle | null,
) {
  canvas.dataset.ikHandleProjections = JSON.stringify(projections);
  canvas.dataset.ikHandPositions = JSON.stringify(worldPositions);
  canvas.dataset.ikJointProjections = JSON.stringify(jointProjections);
  if (draggingHandle === null) {
    delete canvas.dataset.ikDragging;
    delete canvas.dataset.ikActiveHandle;
  } else {
    canvas.dataset.ikDragging = draggingHandle.side;
    canvas.dataset.ikActiveHandle = draggingHandle.id;
  }
}

function clearIKDiagnostics(canvas: HTMLCanvasElement) {
  delete canvas.dataset.ikDragging;
  delete canvas.dataset.ikActiveHandle;
  delete canvas.dataset.ikHandleProjections;
  delete canvas.dataset.ikHandPositions;
  delete canvas.dataset.ikJointProjections;
}

function publishIKDragging(
  canvas: HTMLCanvasElement,
  handle: MannequinIKHandle | null,
) {
  if (handle === null) {
    delete canvas.dataset.ikDragging;
    delete canvas.dataset.ikActiveHandle;
  } else {
    canvas.dataset.ikDragging = handle.side;
    canvas.dataset.ikActiveHandle = handle.id;
  }
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
  const handleRefs = useRef<Partial<Record<MannequinIKHandleId, Mesh | null>>>(
    {},
  );
  const draggingHandleRef = useRef<MannequinIKHandle | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const projectionsRef = useRef<
    Record<MannequinIKHandleId, { x: number; y: number; depth: number }>
  >(
    Object.fromEntries(
      IK_HANDLES.map(({ id }) => [
        id,
        { x: 0, y: 0, depth: Number.POSITIVE_INFINITY },
      ]),
    ) as Record<MannequinIKHandleId, { x: number; y: number; depth: number }>,
  );
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
    const side = draggingHandleRef.current;
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
      draggingHandleRef.current = null;
      pointerIdRef.current = null;
      initialPoseRef.current = null;
      onRuntimePoseChange(null);
      onDraggingChange(false);
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) publishIKDragging(canvas, null);
    }
  };

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && draggingHandleRef.current !== null) {
        event.preventDefault();
        finishDrag(false);
      }
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  });

  useEffect(
    () => () => {
      if (draggingHandleRef.current !== null) {
        draggingHandleRef.current = null;
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
    const jointProjections = {} as Record<
      MannequinIKHandleId,
      { x: number; y: number; depth: number }
    >;
    const worldPositions: Record<
      MannequinSide,
      { x: number; y: number; z: number }
    > = {
      left: { x: 0, y: 0, z: 0 },
      right: { x: 0, y: 0, z: 0 },
    };
    for (const descriptor of IK_HANDLES) {
      const handle = handleRefs.current[descriptor.id];
      if (handle === null || handle === undefined) continue;
      handle.getWorldPosition(tempWorld);
      if (descriptor.joint === 'hand') {
        worldPositions[descriptor.side] = {
          x: tempWorld.x,
          y: tempWorld.y,
          z: tempWorld.z,
        };
      }
      tempProjected.copy(tempWorld).project(camera);
      jointProjections[descriptor.id] = {
        x: ((tempProjected.x + 1) / 2) * canvas.clientWidth,
        y: ((1 - tempProjected.y) / 2) * canvas.clientHeight,
        depth: tempProjected.z,
      };
    }
    projectionsRef.current = jointProjections;
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
    publishIKDiagnostics(
      canvas,
      {
        left: jointProjections['left-hand'],
        right: jointProjections['right-hand'],
      },
      worldPositions,
      jointProjections,
      draggingHandleRef.current,
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
      if (draggingHandleRef.current !== null || event.button !== 0) return;
      const pointer = pointerPosition(event);
      const handle = IK_HANDLES.map((candidate) => {
        const projection = projectionsRef.current[candidate.id];
        return {
          handle: candidate,
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
            left.distance - right.distance ||
            left.depth - right.depth ||
            left.handle.id.localeCompare(right.handle.id),
        )[0]?.handle;
      if (handle === undefined) return;
      const root = rootRef.current;
      if (root === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      draggingHandleRef.current = handle;
      pointerIdRef.current = event.pointerId;
      runtimePoseRef.current = pose;
      initialPoseRef.current = structuredClone(pose);
      store.getState().beginMannequinPose();
      onDraggingChange(true);
      captureCanvasPointer(canvas, event.pointerId);
      const handlePosition = getHandlePosition(pose, handle);
      tempWorld.set(
        handlePosition.x * dimensionScale.x,
        handlePosition.y * dimensionScale.y,
        handlePosition.z * dimensionScale.z,
      );
      root.localToWorld(tempWorld);
      camera.getWorldDirection(tempNormal);
      dragPlane.setFromNormalAndCoplanarPoint(tempNormal, tempWorld);
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) publishIKDragging(canvas, handle);
    };
    const move = (event: PointerEvent) => {
      const handle = draggingHandleRef.current;
      if (handle === null || pointerIdRef.current !== event.pointerId) return;
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
      const nextPose = solveHandleTarget(runtimePoseRef.current, handle, {
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
    const cancel = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishDrag(false);
    };
    canvas.addEventListener('pointerdown', begin, true);
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerup', end, true);
    canvas.addEventListener('pointercancel', cancel, true);
    return () => {
      canvas.removeEventListener('pointerdown', begin, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', end, true);
      canvas.removeEventListener('pointercancel', cancel, true);
    };
  });

  return (
    <group ref={groupRef} name="MannequinIKHandles.layer1">
      {IK_HANDLES.map((handle) => {
        const position = getHandlePosition(pose, handle);
        const isEndEffector =
          handle.joint === 'hand' || handle.joint === 'foot';
        return (
          <mesh
            key={handle.id}
            ref={(mesh) => {
              handleRefs.current[handle.id] = mesh;
            }}
            name={`Mannequin.${handle.id}-ik.layer1`}
            position={[
              position.x * dimensionScale.x,
              position.y * dimensionScale.y,
              position.z * dimensionScale.z,
            ]}
            renderOrder={1200}
          >
            {isEndEffector ? (
              <sphereGeometry args={[0.058, 20, 14]} />
            ) : (
              <octahedronGeometry args={[0.052, 0]} />
            )}
            <meshBasicMaterial
              color={IK_HANDLE_COLORS[handle.id]}
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
