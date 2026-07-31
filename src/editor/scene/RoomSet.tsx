import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';

interface RoomSetProps {
  color: string;
  dimensions: { x: number; y: number; z: number };
  castShadow: boolean;
  receiveShadow: boolean;
}

const WALL_THICKNESS_M = 0.08;

function publishRoomSetDiagnostics(runtimeCanvas: HTMLCanvasElement) {
  const nextCount = Number(runtimeCanvas.dataset.roomSetCount ?? '0') + 1;
  runtimeCanvas.dataset.roomSetCount = String(nextCount);
  runtimeCanvas.dataset.roomSetParts = 'floor,back-wall,left-wall';
  runtimeCanvas.dataset.roomSetOpenings = 'ceiling,front,right';
}

function clearRoomSetDiagnostics(runtimeCanvas: HTMLCanvasElement) {
  const remaining = Math.max(
    0,
    Number(runtimeCanvas.dataset.roomSetCount ?? '1') - 1,
  );
  if (remaining === 0) {
    delete runtimeCanvas.dataset.roomSetCount;
    delete runtimeCanvas.dataset.roomSetParts;
    delete runtimeCanvas.dataset.roomSetOpenings;
  } else {
    runtimeCanvas.dataset.roomSetCount = String(remaining);
  }
}

export function RoomSet({
  color,
  dimensions,
  castShadow,
  receiveShadow,
}: RoomSetProps) {
  const runtimeCanvas = useThree((state) => state.gl.domElement);
  const thickness = Math.min(
    WALL_THICKNESS_M,
    dimensions.x / 4,
    dimensions.y / 4,
    dimensions.z / 4,
  );
  const material = (
    <meshStandardMaterial color={color} roughness={0.82} metalness={0} />
  );

  useLayoutEffect(() => {
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;

    publishRoomSetDiagnostics(runtimeCanvas);
    return () => {
      clearRoomSetDiagnostics(runtimeCanvas);
    };
  }, [runtimeCanvas]);

  return (
    <group name="RoomSet.primitive-group">
      <mesh
        name="RoomSet.floor"
        castShadow={false}
        receiveShadow={receiveShadow}
        position={[0, -dimensions.y / 2 + thickness / 2, 0]}
      >
        <boxGeometry args={[dimensions.x, thickness, dimensions.z]} />
        {material}
      </mesh>
      <mesh
        name="RoomSet.back-wall"
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        position={[0, 0, -dimensions.z / 2 + thickness / 2]}
      >
        <boxGeometry args={[dimensions.x, dimensions.y, thickness]} />
        {material}
      </mesh>
      <mesh
        name="RoomSet.left-wall"
        castShadow={castShadow}
        receiveShadow={receiveShadow}
        position={[-dimensions.x / 2 + thickness / 2, 0, 0]}
      >
        <boxGeometry args={[thickness, dimensions.y, dimensions.z]} />
        {material}
      </mesh>
    </group>
  );
}
