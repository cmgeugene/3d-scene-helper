import { useLayoutEffect, useRef } from 'react';
import { MathUtils, Box3, Vector3, type Group } from 'three';
import { useThree } from '@react-three/fiber';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import {
  MANNEQUIN_ARM_ANCHORS,
  MANNEQUIN_ARM_LENGTHS,
  type MannequinEulerDegrees,
  type MannequinPose,
  type MannequinSide,
} from '../mannequin/mannequinRig';

interface ArticulatedMannequinProps {
  color: string;
  dimensions: { x: number; y: number; z: number };
  pose: MannequinPose;
  selected: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
}

interface MeshPartProps {
  name: string;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
  geometry: 'box' | 'sphere' | 'cylinder';
  args:
    | [number, number, number]
    | [number, number, number, number]
    | [number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  unlit?: boolean;
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
      {geometry === 'box' ? (
        <boxGeometry args={args as [number, number, number]} />
      ) : null}
      {geometry === 'sphere' ? (
        <sphereGeometry args={args as [number, number]} />
      ) : null}
      {geometry === 'cylinder' ? (
        <cylinderGeometry args={args as [number, number, number, number]} />
      ) : null}
      {unlit ? (
        <meshBasicMaterial color={color} toneMapped={false} />
      ) : (
        <meshStandardMaterial color={color} roughness={0.72} metalness={0.02} />
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
}: {
  side: MannequinSide;
  pose: MannequinPose;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
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
        args={[0.07, 18]}
      />
      <MeshPart
        name={`${prefix}-upper-arm`}
        color={color}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry="cylinder"
        args={[0.052, 0.065, MANNEQUIN_ARM_LENGTHS.upperArm, 16]}
        position={[0, -MANNEQUIN_ARM_LENGTHS.upperArm / 2, 0]}
      />
      <group
        name={`${prefix}-elbow-pivot`}
        position={[0, -MANNEQUIN_ARM_LENGTHS.upperArm, 0]}
        rotation={[MathUtils.degToRad(arm.elbowBendDeg), 0, 0]}
      >
        <MeshPart
          name={`${prefix}-elbow-joint`}
          color={color}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry="sphere"
          args={[0.062, 18]}
        />
        <MeshPart
          name={`${prefix}-forearm`}
          color={color}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry="cylinder"
          args={[0.043, 0.055, MANNEQUIN_ARM_LENGTHS.forearm, 16]}
          position={[0, -MANNEQUIN_ARM_LENGTHS.forearm / 2, 0]}
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
            geometry="box"
            args={[0.105, 0.14, 0.075]}
            position={[0, -0.045, -0.008]}
            scale={[1, 1, 0.9]}
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
}: {
  side: MannequinSide;
  pose: MannequinPose;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
}) {
  const leg = pose.legs[side];
  const sign = side === 'left' ? -1 : 1;
  const prefix = `Mannequin.${side}`;
  return (
    <group
      name={`${prefix}-hip-pivot`}
      position={[sign * 0.085, -0.05, 0]}
      rotation={toRadians(leg.hipRotationDeg)}
    >
      <MeshPart
        name={`${prefix}-hip-joint`}
        color={color}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry="sphere"
        args={[0.075, 18]}
      />
      <MeshPart
        name={`${prefix}-thigh`}
        color={color}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        geometry="cylinder"
        args={[0.058, 0.075, 0.37, 18]}
        position={[0, -0.185, 0]}
      />
      <group
        name={`${prefix}-knee-pivot`}
        position={[0, -0.37, 0]}
        rotation={[MathUtils.degToRad(leg.kneeBendDeg), 0, 0]}
      >
        <MeshPart
          name={`${prefix}-knee-joint`}
          color={color}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry="sphere"
          args={[0.068, 18]}
        />
        <MeshPart
          name={`${prefix}-shin`}
          color={color}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          geometry="cylinder"
          args={[0.047, 0.061, 0.37, 18]}
          position={[0, -0.185, 0]}
        />
        <group
          name={`${prefix}-ankle-pivot`}
          position={[0, -0.37, 0]}
          rotation={toRadians(leg.ankleRotationDeg)}
        >
          <MeshPart
            name={`${prefix}-foot`}
            color={color}
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            geometry="box"
            args={[0.15, 0.13, 0.34]}
            position={[0, -0.055, -0.055]}
          />
          <MeshPart
            name={`${prefix}-toe-cue`}
            color="#d9f4ff"
            unlit
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            geometry="box"
            args={[0.12, 0.045, 0.04]}
            position={[0, -0.06, -0.205]}
          />
        </group>
      </group>
    </group>
  );
}

function publishMannequinDiagnostics(
  canvas: HTMLCanvasElement,
  poseId: MannequinPose['id'],
  bounds: Box3,
  size: Vector3,
  center: Vector3,
) {
  canvas.dataset.mannequinRig = 'articulated';
  canvas.dataset.mannequinPose = poseId;
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
}

function clearMannequinDiagnostics(canvas: HTMLCanvasElement) {
  delete canvas.dataset.mannequinRig;
  delete canvas.dataset.mannequinPose;
  delete canvas.dataset.mannequinPivots;
  delete canvas.dataset.mannequinBounds;
}

export function ArticulatedMannequin({
  color,
  dimensions,
  pose,
  selected,
  castShadow,
  receiveShadow,
}: ArticulatedMannequinProps) {
  const contentRef = useRef<Group>(null);
  const canvas = useThree((state) => state.gl.domElement);
  const common = { color, castShadow, receiveShadow };

  useLayoutEffect(() => {
    if (
      !IS_EDITOR_TEST_BRIDGE_ENABLED ||
      !selected ||
      contentRef.current === null
    ) {
      return;
    }
    contentRef.current.updateWorldMatrix(true, true);
    const bounds = new Box3().setFromObject(contentRef.current);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    publishMannequinDiagnostics(canvas, pose.id, bounds, size, center);
    return () => {
      clearMannequinDiagnostics(canvas);
    };
  }, [canvas, dimensions, pose, selected]);

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
          geometry="box"
          args={[0.3, 0.18, 0.24]}
          position={[0, 0, 0.01]}
        />
        <group
          name="Mannequin.spine-pivot"
          rotation={toRadians(pose.torsoRotationDeg)}
        >
          <MeshPart
            {...common}
            name="Mannequin.torso"
            geometry="cylinder"
            args={[0.13, 0.175, 0.44, 6]}
            position={[0, 0.28, 0]}
          />
          <MeshPart
            {...common}
            name="Mannequin.chest-front-cue"
            color="#d9f4ff"
            unlit
            geometry="box"
            args={[0.15, 0.21, 0.036]}
            position={[0, 0.31, -0.125]}
          />
          <MeshPart
            {...common}
            name="Mannequin.back-cue"
            color="#4a5568"
            unlit
            geometry="box"
            args={[0.12, 0.13, 0.025]}
            position={[0, 0.3, 0.122]}
          />
          <group
            name="Mannequin.neck-head-pivot"
            position={[0, 0.66, 0]}
            rotation={toRadians(pose.headRotationDeg)}
          >
            <MeshPart
              {...common}
              name="Mannequin.neck"
              geometry="cylinder"
              args={[0.055, 0.065, 0.1, 16]}
              position={[0, -0.08, 0]}
            />
            <MeshPart
              {...common}
              name="Mannequin.head"
              geometry="sphere"
              args={[0.13, 24]}
              scale={[0.92, 1, 0.88]}
            />
            <MeshPart
              {...common}
              name="Mannequin.face-plate"
              color="#d9f4ff"
              unlit
              geometry="box"
              args={[0.13, 0.13, 0.018]}
              position={[0, 0, -0.117]}
            />
            <MeshPart
              {...common}
              name="Mannequin.nose-cue"
              color="#d9f4ff"
              unlit
              geometry="sphere"
              args={[0.036, 14]}
              position={[0, -0.005, -0.16]}
              scale={[0.72, 0.72, 1.3]}
            />
          </group>
          <Arm side="left" pose={pose} {...common} />
          <Arm side="right" pose={pose} {...common} />
        </group>
        <Leg side="left" pose={pose} {...common} />
        <Leg side="right" pose={pose} {...common} />
      </group>
    </group>
  );
}
