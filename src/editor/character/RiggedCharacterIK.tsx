import { useFrame, useThree } from '@react-three/fiber';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type Bone,
  type Group,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import type { StoreApi } from 'zustand/vanilla';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import type { RiggedCharacterIkBoneMap } from '../../../shared/riggedCharacterAsset';
import type { SceneObject } from '../persistence/sceneSchema';
import type { EditorStore } from '../state/editorStore';
import { RENDER_LAYERS } from '../constants';
import { suppressNextObjectSelection } from '../scene/objectSelectionGuard';
import {
  solveRiggedCharacterIkChain,
  type BoneChain,
} from './riggedCharacterIkSolver';

export type RiggedCharacterIkTargetId =
  'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
type IkTargets = NonNullable<SceneObject['characterIkTargets']>;

export interface RiggedCharacterIkBinding {
  store: StoreApi<EditorStore>;
  enabled: boolean;
  onDraggingChange: (dragging: boolean) => void;
}

interface RiggedCharacterIKProps extends RiggedCharacterIkBinding {
  object: SceneObject;
  instance: Object3D;
  rootRef: RefObject<Group | null>;
  handleScale: number;
}

const TARGET_IDS: RiggedCharacterIkTargetId[] = [
  'leftHand',
  'rightHand',
  'leftFoot',
  'rightFoot',
];

const TARGET_COLORS: Record<RiggedCharacterIkTargetId, string> = {
  leftHand: '#ff4fd8',
  rightHand: '#42e8ff',
  leftFoot: '#ff8a3d',
  rightFoot: '#72f08a',
};

const dragPlane = new Plane();
const pointerNdc = new Vector2();
const raycaster = new Raycaster();
const targetWorld = new Vector3();
const cameraDirection = new Vector3();
const projected = new Vector3();

function cloneTargets(targets: IkTargets): IkTargets {
  return Object.fromEntries(
    TARGET_IDS.map((id) => [id, { ...targets[id] }]),
  ) as IkTargets;
}

function resolveBone(instance: Object3D, name: string) {
  const bone = instance.getObjectByName(name);
  return bone?.type === 'Bone' ? (bone as Bone) : null;
}

function resolveChains(instance: Object3D, map: RiggedCharacterIkBoneMap) {
  const chains = {} as Record<RiggedCharacterIkTargetId, BoneChain>;
  for (const id of TARGET_IDS) {
    const descriptor = map[id];
    const root = resolveBone(instance, descriptor.root);
    const middle = resolveBone(instance, descriptor.middle);
    const effector = resolveBone(instance, descriptor.effector);
    if (root === null || middle === null || effector === null) return null;
    chains[id] = { root, middle, effector };
  }
  return chains;
}

function captureTargets(
  instance: Object3D,
  chains: Record<RiggedCharacterIkTargetId, BoneChain>,
  center: { x: number; y: number; z: number },
) {
  instance.updateWorldMatrix(true, true);
  return Object.fromEntries(
    TARGET_IDS.map((id) => {
      const position = chains[id].effector.getWorldPosition(new Vector3());
      instance.worldToLocal(position);
      return [
        id,
        {
          x: position.x - center.x,
          y: position.y - center.y,
          z: position.z - center.z,
        },
      ];
    }),
  ) as IkTargets;
}

function setIkDiagnostics(
  canvas: HTMLCanvasElement,
  projections: Partial<
    Record<RiggedCharacterIkTargetId, { x: number; y: number }>
  >,
  dragging: RiggedCharacterIkTargetId | null,
) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
  canvas.dataset.characterIkProjections = JSON.stringify(projections);
  if (dragging === null) delete canvas.dataset.characterIkDragging;
  else canvas.dataset.characterIkDragging = dragging;
}

export function RiggedCharacterIK({
  object,
  instance,
  rootRef,
  handleScale,
  store,
  enabled,
  onDraggingChange,
}: RiggedCharacterIKProps) {
  const map = object.characterAsset?.ikBoneMap;
  const chains = useMemo(
    () => (map == null ? null : resolveChains(instance, map)),
    [instance, map],
  );
  const defaultTargets = useMemo(
    () =>
      !enabled || chains === null || object.characterAsset === undefined
        ? null
        : captureTargets(instance, chains, object.characterAsset.center),
    [chains, enabled, instance, object.characterAsset],
  );
  const [runtimeTargets, setRuntimeTargets] = useState<IkTargets | null>(null);
  const targets = runtimeTargets ?? object.characterIkTargets ?? defaultTargets;
  const targetsRef = useRef<IkTargets | null>(targets);
  const draggingRef = useRef<RiggedCharacterIkTargetId | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const projectionsRef = useRef<
    Partial<Record<RiggedCharacterIkTargetId, { x: number; y: number }>>
  >({});
  const handlesRef = useRef<Group>(null);
  const canvas = useThree((state) => state.gl.domElement);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  useLayoutEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useLayoutEffect(() => {
    handlesRef.current?.traverse((child) => {
      child.layers.set(RENDER_LAYERS.editor);
    });
  }, [targets]);

  useFrame(() => {
    const root = rootRef.current;
    const currentTargets = targetsRef.current;
    if (root === null || chains === null || currentTargets === null) return;
    root.updateWorldMatrix(true, true);
    for (const id of TARGET_IDS) {
      targetWorld.set(
        currentTargets[id].x,
        currentTargets[id].y,
        currentTargets[id].z,
      );
      root.localToWorld(targetWorld);
      solveRiggedCharacterIkChain(chains[id], targetWorld);
    }

    if (!enabled) return;
    const nextProjections: Partial<
      Record<RiggedCharacterIkTargetId, { x: number; y: number }>
    > = {};
    for (const id of TARGET_IDS) {
      targetWorld.set(
        currentTargets[id].x,
        currentTargets[id].y,
        currentTargets[id].z,
      );
      root.localToWorld(targetWorld);
      projected.copy(targetWorld).project(camera);
      nextProjections[id] = {
        x: ((projected.x + 1) / 2) * canvas.clientWidth,
        y: ((1 - projected.y) / 2) * canvas.clientHeight,
      };
    }
    projectionsRef.current = nextProjections;
    setIkDiagnostics(canvas, nextProjections, draggingRef.current);
  });

  useEffect(() => {
    if (!enabled || chains === null) return;
    const pointerPosition = (event: PointerEvent) => {
      const rectangle = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rectangle.left,
        y: event.clientY - rectangle.top,
        rectangle,
      };
    };
    const updateRay = (pointer: ReturnType<typeof pointerPosition>) => {
      pointerNdc.set(
        (pointer.x / pointer.rectangle.width) * 2 - 1,
        -(pointer.y / pointer.rectangle.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointerNdc, camera);
    };
    const nearestTarget = (pointer: ReturnType<typeof pointerPosition>) =>
      TARGET_IDS.map((id) => {
        const projection = projectionsRef.current[id];
        return {
          id,
          distance:
            projection === undefined
              ? Number.POSITIVE_INFINITY
              : Math.hypot(pointer.x - projection.x, pointer.y - projection.y),
        };
      }).sort(
        (left, right) =>
          left.distance - right.distance || left.id.localeCompare(right.id),
      )[0];
    const begin = (event: PointerEvent) => {
      if (event.button !== 0 || draggingRef.current !== null) return;
      const nearest = nearestTarget(pointerPosition(event));
      const root = rootRef.current;
      const currentTargets = targetsRef.current;
      if (
        nearest === undefined ||
        nearest.distance > 28 ||
        root === null ||
        currentTargets === null
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      draggingRef.current = nearest.id;
      pointerIdRef.current = event.pointerId;
      setRuntimeTargets(cloneTargets(currentTargets));
      targetWorld.set(
        currentTargets[nearest.id].x,
        currentTargets[nearest.id].y,
        currentTargets[nearest.id].z,
      );
      root.localToWorld(targetWorld);
      camera.getWorldDirection(cameraDirection);
      dragPlane.setFromNormalAndCoplanarPoint(cameraDirection, targetWorld);
      canvas.setPointerCapture(event.pointerId);
      onDraggingChange(true);
      setIkDiagnostics(canvas, projectionsRef.current, nearest.id);
    };
    const move = (event: PointerEvent) => {
      const id = draggingRef.current;
      if (id === null || pointerIdRef.current !== event.pointerId) return;
      const root = rootRef.current;
      const currentTargets = targetsRef.current;
      if (root === null || currentTargets === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      updateRay(pointerPosition(event));
      const hit = raycaster.ray.intersectPlane(dragPlane, targetWorld);
      if (hit === null) return;
      root.worldToLocal(hit);
      const next = cloneTargets(currentTargets);
      next[id] = { x: hit.x, y: hit.y, z: hit.z };
      targetsRef.current = next;
      setRuntimeTargets(next);
    };
    const finish = (event: PointerEvent, commit: boolean) => {
      if (pointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const dragged = draggingRef.current;
      canvas.releasePointerCapture(event.pointerId);
      if (commit && targetsRef.current !== null) {
        store
          .getState()
          .setRiggedCharacterIkTargets(object.id, targetsRef.current);
      }
      draggingRef.current = null;
      pointerIdRef.current = null;
      setRuntimeTargets(null);
      onDraggingChange(false);
      setIkDiagnostics(canvas, projectionsRef.current, null);
      if (commit && dragged !== null) suppressNextObjectSelection();
    };
    const up = (event: PointerEvent) => finish(event, true);
    const cancel = (event: PointerEvent) => finish(event, false);
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || pointerIdRef.current === null) return;
      const pointerId = pointerIdRef.current;
      cancel(new PointerEvent('pointercancel', { pointerId }));
    };
    canvas.addEventListener('pointerdown', begin, true);
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerup', up, true);
    canvas.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', keydown);
    return () => {
      canvas.removeEventListener('pointerdown', begin, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', up, true);
      canvas.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', keydown);
      if (draggingRef.current !== null) onDraggingChange(false);
    };
  }, [
    camera,
    canvas,
    chains,
    enabled,
    object.id,
    onDraggingChange,
    rootRef,
    store,
  ]);

  useEffect(
    () => () => {
      if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
      delete canvas.dataset.characterIkProjections;
      delete canvas.dataset.characterIkDragging;
    },
    [canvas],
  );

  if (!enabled || chains === null || targets === null) return null;
  return (
    <group ref={handlesRef} name="RiggedCharacterIKHandles.layer1">
      {TARGET_IDS.map((id) => (
        <mesh
          key={id}
          name={`RiggedCharacter.${id}-ik.layer1`}
          position={[targets[id].x, targets[id].y, targets[id].z]}
          scale={handleScale}
          renderOrder={1200}
        >
          <sphereGeometry args={[0.058, 20, 14]} />
          <meshBasicMaterial
            color={TARGET_COLORS[id]}
            depthTest={false}
            toneMapped={false}
            transparent
            opacity={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}
