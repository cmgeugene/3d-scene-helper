import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  MathUtils,
  Box3,
  Color,
  Vector3,
  type BufferGeometry,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import {
  getSharedStudioMannequinGeometries,
  type StudioMannequinGeometries,
} from '../mannequin/mannequinAppearance';
import {
  MANNEQUIN_BODY_PROPORTIONS,
  type MannequinBodyTypeId,
} from '../mannequin/mannequinBodyType';
import {
  createMannequinFocusContourMaterialSet,
  disposeMannequinFocusContourMaterialSet,
  getMannequinFocusContourMaterialState,
  setMannequinFocusContourMaterialSetEnabled,
  type MannequinFocusContourMaterialSet,
} from '../mannequin/mannequinFocusContours';
import {
  MANNEQUIN_ARM_ANCHORS,
  MANNEQUIN_ARM_LENGTHS,
  MANNEQUIN_LEG_ANCHORS,
  MANNEQUIN_LEG_LENGTHS,
  type MannequinEulerDegrees,
  type MannequinPose,
  type MannequinSide,
} from '../mannequin/mannequinRig';

interface ArticulatedMannequinProps {
  objectId: string;
  color: string;
  dimensions: { x: number; y: number; z: number };
  bodyType: MannequinBodyTypeId;
  pose: MannequinPose;
  selected: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  focusContoursEnabled: boolean;
}

interface MeshPartProps {
  name: string;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
  geometry: 'box' | 'sphere' | 'cylinder' | BufferGeometry;
  args?:
    | [number, number, number]
    | [number, number, number, number]
    | [number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  unlit?: boolean;
  material?: MeshStandardMaterial;
}

const toRadians = ({ x, y, z }: MannequinEulerDegrees) =>
  [MathUtils.degToRad(x), MathUtils.degToRad(y), MathUtils.degToRad(z)] as [
    number,
    number,
    number,
  ];

function MeshPart({
  name,
  color,
  castShadow,
  receiveShadow,
  geometry,
  args,
  position,
  rotation,
  scale,
  unlit = false,
  material,
}: MeshPartProps) {
  return (
    <mesh
      name={name}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      position={position}
      rotation={rotation}
      scale={scale}
    >
      {geometry === 'box' && args !== undefined ? (
        <boxGeometry args={args as [number, number, number]} />
      ) : null}
      {geometry === 'sphere' && args !== undefined ? (
        <sphereGeometry args={args as [number, number]} />
      ) : null}
      {geometry === 'cylinder' && args !== undefined ? (
        <cylinderGeometry args={args as [number, number, number, number]} />
      ) : null}
      {typeof geometry !== 'string' ? (
        <primitive object={geometry} attach="geometry" />
      ) : null}
      {unlit ? (
        <meshBasicMaterial color={color} toneMapped={false} />
      ) : material !== undefined ? (
        <primitive object={material} attach="material" />
      ) : (
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.06}
          roughness={0.58}
          metalness={0.015}
        />
      )}
    </mesh>
  );
}

function Arm({
  side,
  pose,
  color,
  castShadow,
  receiveShadow,
  jointColor,
  geometries,
  materials,
}: {
  side: MannequinSide;
  pose: MannequinPose;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
  jointColor: string;
  geometries: StudioMannequinGeometries;
  materials: MannequinFocusContourMaterialSet;
}) {
  const arm = pose.arms[side];
  const anchor = MANNEQUIN_ARM_ANCHORS[side].shoulder;
  const prefix = `Mannequin.${side}`;
  return (
    <group
      name={`${prefix}-shoulder-pivot`}
      position={[anchor.x, anchor.y - 0.06, anchor.z]}
      rotation={toRadians(arm.shoulderRotationDeg)}
    >
      <MeshPart
        name={`${prefix}-shoulder-joint`}
        color={color}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry="sphere"
        args={[0.058, 20]}
        material={materials.limb}
      />
      <MeshPart
        name={`${prefix}-upper-arm`}
        color={color}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry={geometries.upperArm}
        material={materials.limb}
      />
      <group
        name={`${prefix}-elbow-pivot`}
        position={[0, -MANNEQUIN_ARM_LENGTHS.upperArm, 0]}
        rotation={[
          MathUtils.degToRad(arm.elbowBendDeg),
          0,
          MathUtils.degToRad(arm.elbowDeviationDeg),
        ]}
      >
        <MeshPart
          name={`${prefix}-elbow-joint`}
          color={jointColor}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry="sphere"
          args={[0.048, 20]}
          material={materials.joint}
        />
        <MeshPart
          name={`${prefix}-forearm`}
          color={color}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry={geometries.forearm}
          material={materials.limb}
        />
        <group
          name={`${prefix}-wrist-pivot`}
          position={[0, -MANNEQUIN_ARM_LENGTHS.forearm, 0]}
          rotation={toRadians(arm.wristRotationDeg)}
        >
          <MeshPart
            name={`${prefix}-hand`}
            color={color}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            geometry={geometries.hand}
            material={materials.limb}
          />
          <MeshPart
            name={`${prefix}-thumb`}
            color={color}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            geometry={geometries.thumb}
            material={materials.limb}
            position={[side === 'left' ? 0.027 : -0.027, -0.05, -0.003]}
            rotation={[0, 0, side === 'left' ? -0.42 : 0.42]}
          />
        </group>
      </group>
    </group>
  );
}

function Leg({
  side,
  pose,
  color,
  castShadow,
  receiveShadow,
  jointColor,
  geometries,
  materials,
}: {
  side: MannequinSide;
  pose: MannequinPose;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
  jointColor: string;
  geometries: StudioMannequinGeometries;
  materials: MannequinFocusContourMaterialSet;
}) {
  const leg = pose.legs[side];
  const anchor = MANNEQUIN_LEG_ANCHORS[side].hip;
  const prefix = `Mannequin.${side}`;
  return (
    <group
      name={`${prefix}-hip-pivot`}
      position={[anchor.x, anchor.y - 0.06, anchor.z]}
      rotation={toRadians(leg.hipRotationDeg)}
    >
      <MeshPart
        name={`${prefix}-hip-joint`}
        color={color}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry="sphere"
        args={[0.06, 20]}
        material={materials.limb}
      />
      <MeshPart
        name={`${prefix}-thigh`}
        color={color}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry={geometries.thigh}
        material={materials.limb}
      />
      <group
        name={`${prefix}-knee-pivot`}
        position={[0, -MANNEQUIN_LEG_LENGTHS.thigh, 0]}
        rotation={[
          -MathUtils.degToRad(leg.kneeBendDeg),
          0,
          MathUtils.degToRad(leg.kneeDeviationDeg),
        ]}
      >
        <MeshPart
          name={`${prefix}-knee-joint`}
          color={jointColor}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry="sphere"
          args={[0.048, 20]}
          material={materials.joint}
        />
        <MeshPart
          name={`${prefix}-shin`}
          color={color}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry={geometries.shin}
          material={materials.limb}
        />
        <group
          name={`${prefix}-ankle-pivot`}
          position={[0, -MANNEQUIN_LEG_LENGTHS.shin, 0]}
          rotation={toRadians(leg.ankleRotationDeg)}
        >
          <MeshPart
            name={`${prefix}-ankle-joint`}
            color={jointColor}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            geometry="sphere"
            args={[0.038, 18]}
            material={materials.joint}
          />
          <MeshPart
            name={`${prefix}-foot`}
            color={color}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            geometry={geometries.foot}
            material={materials.limb}
          />
        </group>
      </group>
    </group>
  );
}

function publishMannequinDiagnostics(
  canvas: HTMLCanvasElement,
  poseId: MannequinPose['id'],
  bodyType: MannequinBodyTypeId,
  content: Group,
  bounds: Box3,
  size: Vector3,
  center: Vector3,
) {
  canvas.dataset.mannequinRig = 'articulated';
  canvas.dataset.mannequinPose = poseId;
  canvas.dataset.mannequinBodyType = bodyType;
  canvas.dataset.mannequinPivots = [
    'left-shoulder',
    'left-elbow',
    'left-hip',
    'left-knee',
    'right-shoulder',
    'right-elbow',
    'right-hip',
    'right-knee',
  ].join(',');
  canvas.dataset.mannequinBounds = JSON.stringify({
    min: bounds.min,
    max: bounds.max,
    size,
    center,
  });
  const nodeNames = {
    faceCenter: 'Mannequin.face-plane',
    leftShoulder: 'Mannequin.left-shoulder-pivot',
    rightShoulder: 'Mannequin.right-shoulder-pivot',
    leftFoot: 'Mannequin.left-ankle-pivot',
    rightFoot: 'Mannequin.right-ankle-pivot',
  } as const;
  const cinematicLandmarks = Object.fromEntries(
    Object.entries(nodeNames).map(([name, nodeName]) => {
      const node = content.getObjectByName(nodeName);
      if (node === undefined) {
        throw new Error(`Missing runtime mannequin landmark node: ${nodeName}`);
      }
      const point = node.getWorldPosition(new Vector3());
      return [name, { x: point.x, y: point.y, z: point.z }];
    }),
  );
  canvas.dataset.mannequinCinematicLandmarks =
    JSON.stringify(cinematicLandmarks);
}

function clearMannequinDiagnostics(canvas: HTMLCanvasElement) {
  delete canvas.dataset.mannequinRig;
  delete canvas.dataset.mannequinPose;
  delete canvas.dataset.mannequinBodyType;
  delete canvas.dataset.mannequinPivots;
  delete canvas.dataset.mannequinBounds;
  delete canvas.dataset.mannequinCinematicLandmarks;
}

interface FocusContourDiagnostic {
  objectId: string;
  enabled: boolean;
  eligibleSurfaceCount: number;
  enabledSurfaceCount: number;
  materialUuids: string[];
  programKeys: string[];
}

const focusContourDiagnostics = new WeakMap<
  HTMLCanvasElement,
  Map<string, FocusContourDiagnostic>
>();

function publishFocusContourDiagnostic(
  canvas: HTMLCanvasElement,
  diagnostic: FocusContourDiagnostic,
) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
  const entries = focusContourDiagnostics.get(canvas) ?? new Map();
  entries.set(diagnostic.objectId, diagnostic);
  focusContourDiagnostics.set(canvas, entries);
  canvas.dataset.mannequinFocusContours = JSON.stringify(
    [...entries.values()].sort((left, right) =>
      left.objectId.localeCompare(right.objectId),
    ),
  );
}

function clearFocusContourDiagnostic(
  canvas: HTMLCanvasElement,
  objectId: string,
) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
  const entries = focusContourDiagnostics.get(canvas);
  entries?.delete(objectId);
  if (entries === undefined || entries.size === 0) {
    focusContourDiagnostics.delete(canvas);
    delete canvas.dataset.mannequinFocusContours;
    return;
  }
  canvas.dataset.mannequinFocusContours = JSON.stringify(
    [...entries.values()].sort((left, right) =>
      left.objectId.localeCompare(right.objectId),
    ),
  );
}

function materialList(material: Material | Material[]) {
  return Array.isArray(material) ? material : [material];
}

export function ArticulatedMannequin({
  objectId,
  color,
  dimensions,
  bodyType,
  pose,
  selected,
  castShadow,
  receiveShadow,
  focusContoursEnabled,
}: ArticulatedMannequinProps) {
  const contentRef = useRef<Group>(null);
  const canvas = useThree((state) => state.gl.domElement);
  const geometries = getSharedStudioMannequinGeometries(bodyType);
  const body = MANNEQUIN_BODY_PROPORTIONS[bodyType];
  const jointColor = useMemo(
    () => `#${new Color(color).multiplyScalar(0.9).getHexString()}`,
    [color],
  );
  const materials = useMemo(
    () => createMannequinFocusContourMaterialSet(color, jointColor),
    [color, jointColor],
  );
  const pendingMaterialDisposal = useRef<{
    materials: MannequinFocusContourMaterialSet;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const common = {
    color,
    castShadow,
    receiveShadow,
    material: materials.axial,
  };
  const articulatedCommon = {
    color,
    castShadow,
    receiveShadow,
    jointColor,
    geometries,
    materials,
  };

  useEffect(() => {
    const pending = pendingMaterialDisposal.current;
    if (pending?.materials === materials) {
      clearTimeout(pending.timer);
      pendingMaterialDisposal.current = null;
    }
    return () => {
      const timer = setTimeout(() => {
        disposeMannequinFocusContourMaterialSet(materials);
        if (pendingMaterialDisposal.current?.materials === materials) {
          pendingMaterialDisposal.current = null;
        }
      }, 0);
      pendingMaterialDisposal.current = { materials, timer };
    };
  }, [materials]);

  useLayoutEffect(() => {
    setMannequinFocusContourMaterialSetEnabled(materials, focusContoursEnabled);
    const content = contentRef.current;
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED || content === null) return;
    const ownedMaterials = new Set(Object.values(materials));
    let eligibleSurfaceCount = 0;
    let enabledSurfaceCount = 0;
    content.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      for (const material of materialList(mesh.material)) {
        if (!ownedMaterials.has(material as MeshStandardMaterial)) continue;
        eligibleSurfaceCount += 1;
        if (
          getMannequinFocusContourMaterialState(
            material as MeshStandardMaterial,
          ).enabled
        ) {
          enabledSurfaceCount += 1;
        }
      }
    });
    publishFocusContourDiagnostic(canvas, {
      objectId,
      enabled: focusContoursEnabled,
      eligibleSurfaceCount,
      enabledSurfaceCount,
      materialUuids: Object.values(materials).map(({ uuid }) => uuid),
      programKeys: [
        ...new Set(
          Object.values(materials).map((material) =>
            material.customProgramCacheKey(),
          ),
        ),
      ],
    });
    return () => clearFocusContourDiagnostic(canvas, objectId);
  }, [canvas, focusContoursEnabled, materials, objectId]);

  useFrame(
    IS_EDITOR_TEST_BRIDGE_ENABLED
      ? () => {
          if (!selected || contentRef.current === null) return;
          contentRef.current.updateWorldMatrix(true, true);
          const bounds = new Box3().setFromObject(contentRef.current);
          const size = bounds.getSize(new Vector3());
          const center = bounds.getCenter(new Vector3());
          publishMannequinDiagnostics(
            canvas,
            pose.id,
            bodyType,
            contentRef.current,
            bounds,
            size,
            center,
          );
        }
      : () => undefined,
  );

  useLayoutEffect(() => {
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
    if (!selected) {
      clearMannequinDiagnostics(canvas);
      return;
    }
    return () => {
      clearMannequinDiagnostics(canvas);
    };
  }, [bodyType, canvas, dimensions, pose, selected]);

  return (
    <group
      ref={contentRef}
      name="Mannequin.articulated-content"
      scale={[dimensions.x / 0.5, dimensions.y / 1.7, dimensions.z / 0.3]}
    >
      <group name="Mannequin.pelvis-pivot" position={[0, 0.06, 0]}>
        <MeshPart
          {...common}
          name="Mannequin.pelvis"
          geometry={geometries.pelvis}
        />
        <group
          name="Mannequin.spine-pivot"
          rotation={toRadians(pose.torsoRotationDeg)}
        >
          <MeshPart
            {...common}
            name="Mannequin.torso"
            geometry={geometries.torso}
            position={[0, 0.28, 0]}
          />
          <MeshPart
            {...common}
            name="Mannequin.upper-chest-plane"
            geometry="sphere"
            args={[0.075, 24]}
            position={[0, 0.4, -0.144 * body.torsoCue.z]}
            scale={[2.05 * body.torsoCue.x, 0.4, 0.22 * body.torsoCue.z]}
          />
          <MeshPart
            {...common}
            name="Mannequin.chest-front-cue"
            color="#d9f4ff"
            unlit
            geometry="sphere"
            args={[0.03, 18]}
            position={[0, 0.36, -0.16 * body.torsoCue.z]}
            scale={[0.46 * body.torsoCue.x, 1.5, 0.24 * body.torsoCue.z]}
          />
          <MeshPart
            {...common}
            name="Mannequin.back-cue"
            color="#4a5568"
            unlit
            geometry="sphere"
            args={[0.025, 18]}
            position={[0, 0.34, 0.134 * body.torsoCue.z]}
            scale={[0.48 * body.torsoCue.x, 1.12, 0.25 * body.torsoCue.z]}
          />
          <group
            name="Mannequin.neck-head-pivot"
            position={[0, 0.66, 0]}
            rotation={[0, MathUtils.degToRad(pose.headRotationDeg.y), 0]}
          >
            <MeshPart
              {...common}
              name="Mannequin.neck"
              geometry={geometries.neck}
            />
            <MeshPart
              {...common}
              name="Mannequin.head"
              geometry={geometries.head}
            />
            <MeshPart
              {...common}
              name="Mannequin.face-plane"
              geometry="sphere"
              args={[0.052, 22]}
              position={[0, -0.02, -0.084 * body.head.z]}
              scale={[1.42 * body.head.x, 1.28, 0.22 * body.head.z]}
            />
            <MeshPart
              {...common}
              name="Mannequin.brow-ridge"
              geometry="sphere"
              args={[0.032, 20]}
              position={[0, 0.035, -0.094 * body.head.z]}
              scale={[2.15 * body.head.x, 0.34, 0.28 * body.head.z]}
            />
            <MeshPart
              {...common}
              name="Mannequin.nose-cue"
              color={color}
              geometry={geometries.nose}
              position={[0, -0.012, -0.102]}
            />
          </group>
          <Arm side="left" pose={pose} {...articulatedCommon} />
          <Arm side="right" pose={pose} {...articulatedCommon} />
        </group>
        <Leg side="left" pose={pose} {...articulatedCommon} />
        <Leg side="right" pose={pose} {...articulatedCommon} />
      </group>
    </group>
  );
}
