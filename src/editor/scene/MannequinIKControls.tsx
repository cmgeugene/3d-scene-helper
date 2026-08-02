import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Color,
  MathUtils,
  Plane,
  Quaternion,
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
  applyMannequinIkRotation,
  getMannequinArmChain,
  getMannequinIkRotationFrame,
  getMannequinLegChain,
  getMannequinNeckPosition,
  solveMannequinArmIk,
  solveMannequinElbowIk,
  solveMannequinKneeIk,
  solveMannequinLegIk,
  type MannequinIkHandleDescriptor,
  type MannequinLimbIkJoint,
  type MannequinPose,
  type MannequinRotationAxis,
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
const tempCross = new Vector3();
const tempQuaternion = new Quaternion();
const tempRingStart = new Vector3();
const tempRingEnd = new Vector3();
const dragPlane = new Plane();
const pointerNdc = new Vector2();
const pointerRaycaster = new Raycaster();

type MannequinIKHandleId = `${MannequinSide}-${MannequinLimbIkJoint}` | 'neck';
type MannequinIKHandle = MannequinIkHandleDescriptor & {
  id: MannequinIKHandleId;
};

const IK_HANDLES: MannequinIKHandle[] = [
  ...(['left', 'right'] as const).flatMap((side) =>
    (['hand', 'foot', 'elbow', 'knee'] as const).map((joint) => ({
      id: `${side}-${joint}` as MannequinIKHandleId,
      side,
      joint,
    })),
  ),
  { id: 'neck', joint: 'neck' },
];

const IK_HANDLE_COLORS: Record<MannequinIKHandleId, string> = {
  'left-hand': '#ff4fd8',
  'right-hand': '#42e8ff',
  'left-foot': '#ff8a3d',
  'right-foot': '#72f08a',
  'left-elbow': '#ffd84d',
  'right-elbow': '#748cff',
  'left-knee': '#ff6f7d',
  'right-knee': '#54e6c1',
  neck: '#c084fc',
};

const ROTATION_AXES = ['x', 'y', 'z'] as const;
const ROTATION_AXIS_COLORS: Record<MannequinRotationAxis, string> = {
  x: '#ff5b5b',
  y: '#69e07a',
  z: '#5b8cff',
};
const brightenColor = (color: string) =>
  `#${new Color(color).lerp(new Color('#ffffff'), 0.38).getHexString()}`;
const IK_HANDLE_HIGHLIGHT_COLORS = Object.fromEntries(
  Object.entries(IK_HANDLE_COLORS).map(([id, color]) => [
    id,
    brightenColor(color),
  ]),
) as Record<MannequinIKHandleId, string>;
const ROTATION_AXIS_HIGHLIGHT_COLORS = Object.fromEntries(
  Object.entries(ROTATION_AXIS_COLORS).map(([axis, color]) => [
    axis,
    brightenColor(color),
  ]),
) as Record<MannequinRotationAxis, string>;
const ROTATION_RING_RADIUS = 0.105;
const ROTATION_RING_END_ANGLE = Math.PI / 3;

function rotationRingStartAngle(axis: MannequinRotationAxis) {
  if (axis === 'x') return 0;
  if (axis === 'y') return Math.PI / 2;
  return (Math.PI * 5) / 4;
}

function rotationAxesForHandle(handle: MannequinIKHandle) {
  return handle.joint === 'neck'
    ? (['y'] as const)
    : handle.joint === 'hand' || handle.joint === 'foot'
      ? ROTATION_AXES
      : handle.joint === 'elbow' || handle.joint === 'knee'
        ? (['x', 'z'] as const)
        : (['x'] as const);
}

function rotationRingRotation(
  axis: MannequinRotationAxis,
): [number, number, number] {
  if (axis === 'x') return [0, Math.PI / 2, 0];
  if (axis === 'y') return [Math.PI / 2, 0, 0];
  return [0, 0, 0];
}

function getHandlePosition(
  pose: MannequinPose,
  handle: MannequinIKHandle,
): MannequinVector3 {
  if (handle.joint === 'neck') return getMannequinNeckPosition(pose);
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
  if (handle.joint === 'neck') return pose;
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
    canvas.dataset.ikDragging =
      draggingHandle.joint === 'neck' ? 'center' : draggingHandle.side;
    canvas.dataset.ikActiveHandle = draggingHandle.id;
  }
}

function clearIKDiagnostics(canvas: HTMLCanvasElement) {
  delete canvas.dataset.ikDragging;
  delete canvas.dataset.ikActiveHandle;
  delete canvas.dataset.ikHandleProjections;
  delete canvas.dataset.ikHandPositions;
  delete canvas.dataset.ikJointProjections;
  delete canvas.dataset.ikRotationHandle;
  delete canvas.dataset.ikRotationRingProjections;
  delete canvas.dataset.ikRotationAxis;
  delete canvas.dataset.ikHighlightState;
  delete canvas.dataset.ikHighlightHandle;
  delete canvas.dataset.ikHighlightKind;
  delete canvas.dataset.ikHighlightAxis;
  delete canvas.dataset.ikHighlightColor;
}

function publishIKHighlightDiagnostics(
  canvas: HTMLCanvasElement,
  highlight: {
    state: 'hover' | 'drag';
    handleId: MannequinIKHandleId;
    rotationAxis: MannequinRotationAxis | null;
  } | null,
) {
  if (highlight === null) {
    delete canvas.dataset.ikHighlightState;
    delete canvas.dataset.ikHighlightHandle;
    delete canvas.dataset.ikHighlightKind;
    delete canvas.dataset.ikHighlightAxis;
    delete canvas.dataset.ikHighlightColor;
    return;
  }
  canvas.dataset.ikHighlightState = highlight.state;
  canvas.dataset.ikHighlightHandle = highlight.handleId;
  canvas.dataset.ikHighlightKind =
    highlight.rotationAxis === null
      ? highlight.handleId === 'neck'
        ? 'rotation-origin'
        : 'position'
      : 'rotation';
  if (highlight.rotationAxis === null) {
    delete canvas.dataset.ikHighlightAxis;
    canvas.dataset.ikHighlightColor =
      IK_HANDLE_HIGHLIGHT_COLORS[highlight.handleId];
  } else {
    canvas.dataset.ikHighlightAxis = highlight.rotationAxis;
    canvas.dataset.ikHighlightColor =
      ROTATION_AXIS_HIGHLIGHT_COLORS[highlight.rotationAxis];
  }
}

function publishIKDragging(
  canvas: HTMLCanvasElement,
  handle: MannequinIKHandle | null,
  rotationAxis: MannequinRotationAxis | null = null,
) {
  if (handle === null) {
    delete canvas.dataset.ikDragging;
    delete canvas.dataset.ikActiveHandle;
    delete canvas.dataset.ikRotationAxis;
  } else {
    canvas.dataset.ikDragging =
      handle.joint === 'neck' ? 'center' : handle.side;
    canvas.dataset.ikActiveHandle = handle.id;
    if (rotationAxis === null) {
      delete canvas.dataset.ikRotationAxis;
    } else {
      canvas.dataset.ikRotationAxis = rotationAxis;
    }
  }
}

type RotationRingProjections = Partial<
  Record<
    MannequinRotationAxis,
    {
      start: { x: number; y: number };
      end: { x: number; y: number };
    }
  >
>;

function publishIKRotationDiagnostics(
  canvas: HTMLCanvasElement,
  handle: MannequinIKHandle | null,
  projections: RotationRingProjections,
) {
  if (handle === null) {
    delete canvas.dataset.ikRotationHandle;
    delete canvas.dataset.ikRotationRingProjections;
    return;
  }
  canvas.dataset.ikRotationHandle = handle.id;
  canvas.dataset.ikRotationRingProjections = JSON.stringify(projections);
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
  const rotationFrameRef = useRef<Group>(null);
  const handleRefs = useRef<Partial<Record<MannequinIKHandleId, Mesh | null>>>(
    {},
  );
  const rotationRingRefs = useRef<
    Partial<Record<MannequinRotationAxis, Mesh | null>>
  >({});
  const draggingHandleRef = useRef<MannequinIKHandle | null>(null);
  const rotationAxisRef = useRef<MannequinRotationAxis | null>(null);
  const rotationStartVectorRef = useRef(new Vector3());
  const rotationAxisWorldRef = useRef(new Vector3());
  const rotationCenterWorldRef = useRef(new Vector3());
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
  const [focusedHandleId, setFocusedHandleId] =
    useState<MannequinIKHandleId | null>(null);
  const [hoveredHandleId, setHoveredHandleId] =
    useState<MannequinIKHandleId | null>(null);
  const [hoveredRotationAxis, setHoveredRotationAxis] =
    useState<MannequinRotationAxis | null>(null);
  const [dragHighlight, setDragHighlight] = useState<{
    handleId: MannequinIKHandleId;
    rotationAxis: MannequinRotationAxis | null;
  } | null>(null);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const canvas = useThree((state) => state.gl.domElement);
  const dimensionScale = {
    x: object.dimensions.x / 0.5,
    y: object.dimensions.y / 1.7,
    z: object.dimensions.z / 0.3,
  };
  const focusedHandle =
    IK_HANDLES.find(({ id }) => id === focusedHandleId) ?? null;
  const positionHighlightId =
    dragHighlight === null
      ? hoveredHandleId
      : dragHighlight.rotationAxis === null
        ? dragHighlight.handleId
        : null;
  const rotationHighlightAxis =
    dragHighlight?.rotationAxis ??
    (dragHighlight === null ? hoveredRotationAxis : null);

  useEffect(() => {
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
    if (dragHighlight !== null) {
      publishIKHighlightDiagnostics(canvas, {
        state: 'drag',
        ...dragHighlight,
      });
      return;
    }
    if (hoveredRotationAxis !== null && focusedHandleId !== null) {
      publishIKHighlightDiagnostics(canvas, {
        state: 'hover',
        handleId: focusedHandleId,
        rotationAxis: hoveredRotationAxis,
      });
      return;
    }
    publishIKHighlightDiagnostics(
      canvas,
      hoveredHandleId === null
        ? null
        : {
            state: 'hover',
            handleId: hoveredHandleId,
            rotationAxis: null,
          },
    );
  }, [
    canvas,
    dragHighlight,
    focusedHandleId,
    hoveredHandleId,
    hoveredRotationAxis,
  ]);

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
      rotationAxisRef.current = null;
      pointerIdRef.current = null;
      initialPoseRef.current = null;
      setDragHighlight(null);
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
        rotationAxisRef.current = null;
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
    const rotationProjections: RotationRingProjections = {};
    if (focusedHandle !== null) {
      for (const axis of rotationAxesForHandle(focusedHandle)) {
        const ring = rotationRingRefs.current[axis];
        if (ring === null || ring === undefined) continue;
        ring.updateWorldMatrix(true, false);
        const startAngle = rotationRingStartAngle(axis);
        ring.localToWorld(
          tempRingStart.set(
            ROTATION_RING_RADIUS * Math.cos(startAngle),
            ROTATION_RING_RADIUS * Math.sin(startAngle),
            0,
          ),
        );
        ring.localToWorld(
          tempRingEnd.set(
            ROTATION_RING_RADIUS *
              Math.cos(startAngle + ROTATION_RING_END_ANGLE),
            ROTATION_RING_RADIUS *
              Math.sin(startAngle + ROTATION_RING_END_ANGLE),
            0,
          ),
        );
        tempProjected.copy(tempRingStart).project(camera);
        const start = {
          x: ((tempProjected.x + 1) / 2) * canvas.clientWidth,
          y: ((1 - tempProjected.y) / 2) * canvas.clientHeight,
        };
        tempProjected.copy(tempRingEnd).project(camera);
        rotationProjections[axis] = {
          start,
          end: {
            x: ((tempProjected.x + 1) / 2) * canvas.clientWidth,
            y: ((1 - tempProjected.y) / 2) * canvas.clientHeight,
          },
        };
      }
    }
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
    publishIKRotationDiagnostics(canvas, focusedHandle, rotationProjections);
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
    const updatePointerRay = (pointer: ReturnType<typeof pointerPosition>) => {
      pointerNdc.set(
        (pointer.x / pointer.rectangle.width) * 2 - 1,
        -(pointer.y / pointer.rectangle.height) * 2 + 1,
      );
      pointerRaycaster.setFromCamera(pointerNdc, camera);
    };
    const nearestHandle = (
      pointer: ReturnType<typeof pointerPosition>,
      maximumDistance: number,
    ) =>
      IK_HANDLES.map((candidate) => {
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
        .filter(({ distance }) => distance <= maximumDistance)
        .sort(
          (left, right) =>
            left.distance - right.distance ||
            left.depth - right.depth ||
            left.handle.id.localeCompare(right.handle.id),
        )[0];
    const beginPoseInteraction = (
      event: PointerEvent,
      handle: MannequinIKHandle,
      rotationAxis: MannequinRotationAxis | null,
    ) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      draggingHandleRef.current = handle;
      rotationAxisRef.current = rotationAxis;
      pointerIdRef.current = event.pointerId;
      runtimePoseRef.current = pose;
      initialPoseRef.current = structuredClone(pose);
      setDragHighlight({ handleId: handle.id, rotationAxis });
      setFocusedHandleId(handle.id);
      store.getState().beginMannequinPose();
      onDraggingChange(true);
      captureCanvasPointer(canvas, event.pointerId);
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
        publishIKDragging(canvas, handle, rotationAxis);
      }
    };
    const begin = (event: PointerEvent) => {
      if (draggingHandleRef.current !== null || event.button !== 0) return;
      const pointer = pointerPosition(event);
      const root = rootRef.current;
      if (root === null) return;
      updatePointerRay(pointer);

      if (focusedHandle !== null && rotationFrameRef.current !== null) {
        pointerRaycaster.layers.set(RENDER_LAYERS.editor);
        const rings = rotationAxesForHandle(focusedHandle)
          .map((axis) => ({ axis, mesh: rotationRingRefs.current[axis] }))
          .filter(
            (entry): entry is { axis: MannequinRotationAxis; mesh: Mesh } =>
              entry.mesh !== null && entry.mesh !== undefined,
          );
        const hit = pointerRaycaster.intersectObjects(
          rings.map(({ mesh }) => mesh),
          false,
        )[0];
        const hitAxis = rings.find(({ mesh }) => mesh === hit?.object)?.axis;
        if (hitAxis !== undefined) {
          const frame = rotationFrameRef.current;
          frame.getWorldPosition(rotationCenterWorldRef.current);
          frame.getWorldQuaternion(tempQuaternion);
          rotationAxisWorldRef.current
            .set(
              hitAxis === 'x' ? 1 : 0,
              hitAxis === 'y' ? 1 : 0,
              hitAxis === 'z' ? 1 : 0,
            )
            .applyQuaternion(tempQuaternion)
            .normalize();
          dragPlane.setFromNormalAndCoplanarPoint(
            rotationAxisWorldRef.current,
            rotationCenterWorldRef.current,
          );
          const startPoint = pointerRaycaster.ray.intersectPlane(
            dragPlane,
            tempWorld,
          );
          if (startPoint === null) return;
          rotationStartVectorRef.current
            .copy(startPoint)
            .sub(rotationCenterWorldRef.current)
            .normalize();
          beginPoseInteraction(event, focusedHandle, hitAxis);
          return;
        }
      }

      const handle = nearestHandle(pointer, 26)?.handle;
      if (handle === undefined) return;
      if (handle.joint === 'neck') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFocusedHandleId(handle.id);
        return;
      }
      beginPoseInteraction(event, handle, null);
      const handlePosition = getHandlePosition(pose, handle);
      tempWorld.set(
        handlePosition.x * dimensionScale.x,
        handlePosition.y * dimensionScale.y,
        handlePosition.z * dimensionScale.z,
      );
      root.localToWorld(tempWorld);
      camera.getWorldDirection(tempNormal);
      dragPlane.setFromNormalAndCoplanarPoint(tempNormal, tempWorld);
    };
    const move = (event: PointerEvent) => {
      const handle = draggingHandleRef.current;
      const pointer = pointerPosition(event);
      if (handle === null) {
        updatePointerRay(pointer);
        if (focusedHandle !== null) {
          pointerRaycaster.layers.set(RENDER_LAYERS.editor);
          const rings = rotationAxesForHandle(focusedHandle)
            .map((axis) => ({ axis, mesh: rotationRingRefs.current[axis] }))
            .filter(
              (
                entry,
              ): entry is {
                axis: MannequinRotationAxis;
                mesh: Mesh;
              } => entry.mesh !== null && entry.mesh !== undefined,
            );
          const ringHit = pointerRaycaster.intersectObjects(
            rings.map(({ mesh }) => mesh),
            false,
          )[0];
          const hoveredAxis = rings.find(
            ({ mesh }) => mesh === ringHit?.object,
          )?.axis;
          if (hoveredAxis !== undefined) {
            setHoveredHandleId(null);
            setHoveredRotationAxis(hoveredAxis);
            return;
          }
        }
        setHoveredRotationAxis(null);
        const nearest = nearestHandle(pointer, 26);
        if (nearest !== undefined) {
          setHoveredHandleId(nearest.handle.id);
          if (focusedHandleId !== nearest.handle.id) {
            setFocusedHandleId(nearest.handle.id);
          }
        } else if (focusedHandle !== null) {
          setHoveredHandleId(null);
          const focusedProjection = projectionsRef.current[focusedHandle.id];
          if (
            Math.hypot(
              pointer.x - focusedProjection.x,
              pointer.y - focusedProjection.y,
            ) > 84
          ) {
            setFocusedHandleId(null);
          }
        } else {
          setHoveredHandleId(null);
        }
        return;
      }
      if (pointerIdRef.current !== event.pointerId) return;
      const root = rootRef.current;
      if (root === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      updatePointerRay(pointer);
      const worldTarget = pointerRaycaster.ray.intersectPlane(
        dragPlane,
        tempWorld,
      );
      if (worldTarget === null) return;
      const rotationAxis = rotationAxisRef.current;
      if (rotationAxis !== null) {
        const initialPose = initialPoseRef.current;
        if (initialPose === null) return;
        tempNormal
          .copy(worldTarget)
          .sub(rotationCenterWorldRef.current)
          .normalize();
        const signedAngle = Math.atan2(
          rotationAxisWorldRef.current.dot(
            tempCross.crossVectors(rotationStartVectorRef.current, tempNormal),
          ),
          rotationStartVectorRef.current.dot(tempNormal),
        );
        let deltaDeg = MathUtils.radToDeg(signedAngle);
        if (handle.joint === 'knee') deltaDeg *= -1;
        const nextPose = applyMannequinIkRotation(
          initialPose,
          handle,
          rotationAxis,
          deltaDeg,
        );
        runtimePoseRef.current = nextPose;
        onRuntimePoseChange(nextPose);
        return;
      }
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
        const isHighlighted = positionHighlightId === handle.id;
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
            scale={isHighlighted ? 1.3 : 1}
          >
            {isEndEffector ? (
              <sphereGeometry args={[0.058, 20, 14]} />
            ) : (
              <octahedronGeometry args={[0.052, 0]} />
            )}
            <meshBasicMaterial
              color={
                isHighlighted
                  ? IK_HANDLE_HIGHLIGHT_COLORS[handle.id]
                  : IK_HANDLE_COLORS[handle.id]
              }
              depthTest={false}
              toneMapped={false}
              transparent
              opacity={isHighlighted ? 1 : 0.55}
            />
          </mesh>
        );
      })}
      {focusedHandle !== null
        ? (() => {
            const position = getHandlePosition(pose, focusedHandle);
            const frame = getMannequinIkRotationFrame(pose, focusedHandle);
            return (
              <group
                ref={rotationFrameRef}
                name={`Mannequin.${focusedHandle.id}-rotation-gizmo.layer1`}
                position={[
                  position.x * dimensionScale.x,
                  position.y * dimensionScale.y,
                  position.z * dimensionScale.z,
                ]}
                quaternion={[frame.x, frame.y, frame.z, frame.w]}
              >
                {rotationAxesForHandle(focusedHandle).map((axis) => (
                  <mesh
                    key={axis}
                    ref={(mesh) => {
                      rotationRingRefs.current[axis] = mesh;
                      mesh?.layers.set(RENDER_LAYERS.editor);
                    }}
                    name={`Mannequin.${focusedHandle.id}-rotate-${axis}.layer1`}
                    rotation={rotationRingRotation(axis)}
                    renderOrder={1201}
                    scale={rotationHighlightAxis === axis ? 1.14 : 1}
                  >
                    <torusGeometry
                      args={[ROTATION_RING_RADIUS, 0.009, 12, 64]}
                    />
                    <meshBasicMaterial
                      color={
                        rotationHighlightAxis === axis
                          ? ROTATION_AXIS_HIGHLIGHT_COLORS[axis]
                          : ROTATION_AXIS_COLORS[axis]
                      }
                      depthTest={false}
                      toneMapped={false}
                      transparent
                      opacity={rotationHighlightAxis === axis ? 1 : 0.32}
                    />
                  </mesh>
                ))}
              </group>
            );
          })()
        : null}
    </group>
  );
}
