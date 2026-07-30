interface MannequinProps {
  color: string;
  dimensions: { x: number; y: number; z: number };
  castShadow: boolean;
  receiveShadow: boolean;
}

interface PartProps {
  name: string;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
  geometry: 'box' | 'sphere' | 'cylinder';
  args:
    | [number, number, number]
    | [number, number, number, number]
    | [number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

function MannequinPart({
  name,
  color,
  castShadow,
  receiveShadow,
  geometry,
  args,
  position,
  rotation,
  scale,
}: PartProps) {
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
      <meshStandardMaterial color={color} roughness={0.72} metalness={0.02} />
    </mesh>
  );
}

export function Mannequin({
  color,
  dimensions,
  castShadow,
  receiveShadow,
}: MannequinProps) {
  const common = { color, castShadow, receiveShadow };

  return (
    <group
      name="Mannequin.primitive-group"
      scale={[dimensions.x / 0.5, dimensions.y / 1.7, dimensions.z / 0.3]}
    >
      <MannequinPart
        {...common}
        name="Mannequin.head"
        geometry="sphere"
        args={[0.13, 24]}
        position={[0, 0.72, 0]}
        scale={[1, 1, 0.9]}
      />
      <MannequinPart
        {...common}
        name="Mannequin.neck"
        geometry="cylinder"
        args={[0.055, 0.055, 0.1, 16]}
        position={[0, 0.58, 0]}
      />
      <MannequinPart
        {...common}
        name="Mannequin.torso"
        geometry="box"
        args={[0.28, 0.42, 0.18]}
        position={[0, 0.34, 0]}
      />
      <MannequinPart
        {...common}
        name="Mannequin.pelvis"
        geometry="box"
        args={[0.24, 0.16, 0.18]}
        position={[0, 0.06, 0]}
      />
      {([-1, 1] as const).map((side) => (
        <group
          key={side}
          name={side < 0 ? 'Mannequin.left' : 'Mannequin.right'}
        >
          <MannequinPart
            {...common}
            name={
              side < 0
                ? 'Mannequin.left-upper-arm'
                : 'Mannequin.right-upper-arm'
            }
            geometry="cylinder"
            args={[0.045, 0.045, 0.32, 14]}
            position={[side * 0.185, 0.35, 0]}
            rotation={[0, 0, side * 0.12]}
          />
          <MannequinPart
            {...common}
            name={
              side < 0
                ? 'Mannequin.left-lower-arm'
                : 'Mannequin.right-lower-arm'
            }
            geometry="cylinder"
            args={[0.04, 0.04, 0.3, 14]}
            position={[side * 0.205, 0.05, 0]}
          />
          <MannequinPart
            {...common}
            name={side < 0 ? 'Mannequin.left-hand' : 'Mannequin.right-hand'}
            geometry="sphere"
            args={[0.055, 14]}
            position={[side * 0.195, -0.12, 0]}
          />
          <MannequinPart
            {...common}
            name={side < 0 ? 'Mannequin.left-thigh' : 'Mannequin.right-thigh'}
            geometry="cylinder"
            args={[0.065, 0.065, 0.36, 16]}
            position={[side * 0.075, -0.12, 0]}
          />
          <MannequinPart
            {...common}
            name={side < 0 ? 'Mannequin.left-shin' : 'Mannequin.right-shin'}
            geometry="cylinder"
            args={[0.055, 0.05, 0.45, 16]}
            position={[side * 0.075, -0.525, 0]}
          />
          <MannequinPart
            {...common}
            name={side < 0 ? 'Mannequin.left-foot' : 'Mannequin.right-foot'}
            geometry="box"
            args={[0.13, 0.12, 0.3]}
            position={[side * 0.075, -0.79, 0]}
          />
        </group>
      ))}
    </group>
  );
}
