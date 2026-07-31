import { useCallback, useLayoutEffect, useRef } from 'react';
import { DoubleSide, MathUtils, type Group, type Mesh } from 'three';
import { RENDER_LAYERS } from '../constants';
import type { SceneObject as SceneObjectData } from '../persistence/sceneSchema';
import { Mannequin } from './Mannequin';
import { RoomSet } from './RoomSet';
import { getSceneObjectModel } from './sceneObjectModel';

interface SceneObjectProps {
  object: SceneObjectData;
  selected: boolean;
  onSelect: (id: string) => void;
  onRootReady: (id: string, root: Group | null) => void;
}

interface PrimitiveProps {
  object: SceneObjectData;
  castShadow: boolean;
  receiveShadow: boolean;
}

function Primitive({ object, castShadow, receiveShadow }: PrimitiveProps) {
  const { dimensions, kind } = object;
  const material = (
    <meshStandardMaterial
      color={object.color}
      roughness={0.72}
      metalness={0.02}
    />
  );

  switch (kind) {
    case 'floor':
    case 'cube':
      return (
        <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
          <boxGeometry args={[dimensions.x, dimensions.y, dimensions.z]} />
          {material}
        </mesh>
      );
    case 'sphere':
      return (
        <mesh
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          scale={[dimensions.x, dimensions.y, dimensions.z]}
        >
          <sphereGeometry args={[0.5, 32, 20]} />
          {material}
        </mesh>
      );
    case 'cylinder':
      return (
        <mesh
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          scale={[1, 1, dimensions.z / dimensions.x]}
        >
          <cylinderGeometry
            args={[dimensions.x / 2, dimensions.x / 2, dimensions.y, 32]}
          />
          {material}
        </mesh>
      );
    case 'plane':
      return (
        <mesh
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[dimensions.x, dimensions.z]} />
          <meshStandardMaterial
            color={object.color}
            roughness={0.82}
            metalness={0}
            side={DoubleSide}
          />
        </mesh>
      );
    case 'mannequin':
      return (
        <Mannequin
          color={object.color}
          dimensions={dimensions}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      );
    case 'room':
      return (
        <RoomSet
          color={object.color}
          dimensions={dimensions}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      );
  }
}

function SelectionHelper({ object }: { object: SceneObjectData }) {
  const ref = useRef<Mesh>(null);

  useLayoutEffect(() => {
    ref.current?.layers.set(RENDER_LAYERS.editor);
  }, []);

  return (
    <mesh
      ref={ref}
      name={`selection-helper:${object.id}`}
      scale={1.025}
      renderOrder={1000}
      raycast={() => undefined}
    >
      <boxGeometry
        args={[object.dimensions.x, object.dimensions.y, object.dimensions.z]}
      />
      <meshBasicMaterial
        color="#ffd166"
        wireframe
        transparent
        opacity={0.95}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

export function SceneObject({
  object,
  selected,
  onSelect,
  onRootReady,
}: SceneObjectProps) {
  const model = getSceneObjectModel(object);
  const { position, rotationDeg, scale } = object.transform;
  const rootRef = useCallback(
    (root: Group | null) => {
      onRootReady(object.id, root);
    },
    [object.id, onRootReady],
  );

  return (
    <group
      ref={rootRef}
      name={model.testName}
      userData={{ sceneObjectId: object.id, displayName: model.displayName }}
      position={[position.x, position.y, position.z]}
      rotation={[
        MathUtils.degToRad(rotationDeg.x),
        MathUtils.degToRad(rotationDeg.y),
        MathUtils.degToRad(rotationDeg.z),
      ]}
      scale={[scale.x, scale.y, scale.z]}
      visible={object.visible}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(object.id);
      }}
    >
      <Primitive
        object={object}
        castShadow={model.castShadow}
        receiveShadow={model.receiveShadow}
      />
      {selected ? <SelectionHelper object={object} /> : null}
    </group>
  );
}
