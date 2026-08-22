import {
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  DoubleSide,
  MathUtils,
  type BufferGeometry,
  type Group,
  type Mesh,
} from 'three';
import { RENDER_LAYERS } from '../constants';
import {
  computeMannequinPoseBounds,
  createMannequinPose,
  type MannequinPose,
} from '../mannequin/mannequinRig';
import type { SceneObject as SceneObjectData } from '../persistence/sceneSchema';
import { ArticulatedMannequin } from './ArticulatedMannequin';
import {
  MannequinIKControls,
  type MannequinIKBinding,
} from './MannequinIKControls';
import { PlanarMirror } from './PlanarMirror';
import { RoomSet } from './RoomSet';
import { RiggedCharacter } from '../character/RiggedCharacter';
import type { RiggedCharacterIkBinding } from '../character/RiggedCharacterIK';
import { getBundledRiggedCharacterUrl } from '../character/riggedCharacterUrls';
import { SurfaceGrid } from './SurfaceGrid';
import { getSceneObjectModel } from './sceneObjectModel';
import { applyProxyOpacityToMaterial } from './proxyVisualization';
import { consumeObjectSelectionSuppression } from './objectSelectionGuard';
import {
  createBentPlaneGeometry,
  createEquilateralTriangleGeometry,
  createRoundedCubeGeometry,
} from './presetGeometries';

interface SceneObjectProps {
  object: SceneObjectData;
  selected: boolean;
  onSelect: (id: string) => void;
  onRootReady: (id: string, root: Group | null) => void;
  runtimeMannequinPose?: MannequinPose;
  mannequinIK?: MannequinIKBinding;
  focusContoursEnabled: boolean;
  reflectedObjectIds?: readonly string[];
  characterAssetUrl?: string;
  riggedCharacterIK?: RiggedCharacterIkBinding;
}

interface PrimitiveProps {
  object: SceneObjectData;
  selected: boolean;
  runtimeMannequinPose?: MannequinPose;
  castShadow: boolean;
  receiveShadow: boolean;
  focusContoursEnabled: boolean;
  reflectedObjectIds: readonly string[];
  characterAssetUrl?: string;
  riggedCharacterIK?: RiggedCharacterIkBinding;
}

function PresetGeometryMesh({
  dimensions,
  createGeometry,
  castShadow,
  receiveShadow,
  material,
}: {
  dimensions: SceneObjectData['dimensions'];
  createGeometry: (dimensions: SceneObjectData['dimensions']) => BufferGeometry;
  castShadow: boolean;
  receiveShadow: boolean;
  material: ReactNode;
}) {
  const { x, y, z } = dimensions;
  const geometry = useMemo(
    () => createGeometry({ x, y, z }),
    [createGeometry, x, y, z],
  );
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      geometry={geometry}
    >
      {material}
    </mesh>
  );
}

function Primitive({
  object,
  selected,
  runtimeMannequinPose,
  castShadow,
  receiveShadow,
  focusContoursEnabled,
  reflectedObjectIds,
  characterAssetUrl,
  riggedCharacterIK,
}: PrimitiveProps) {
  const { dimensions, kind } = object;
  const material = (
    <meshStandardMaterial
      color={object.color}
      roughness={0.72}
      metalness={0.02}
    />
  );

  switch (kind) {
    case 'cube':
      return (
        <>
          <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
            <boxGeometry args={[dimensions.x, dimensions.y, dimensions.z]} />
            {material}
          </mesh>
          <SurfaceGrid
            color={object.color}
            depth={dimensions.z}
            kind="cube"
            parentScale={object.transform.scale}
            positionY={dimensions.y / 2 + 0.002}
            width={dimensions.x}
          />
        </>
      );
    case 'floor':
      return (
        <>
          <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
            <boxGeometry args={[dimensions.x, dimensions.y, dimensions.z]} />
            {material}
          </mesh>
          <SurfaceGrid
            color={object.color}
            depth={dimensions.z}
            kind="floor"
            parentScale={object.transform.scale}
            positionY={dimensions.y / 2 + 0.002}
            width={dimensions.x}
          />
        </>
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
        <>
          {object.appearanceIntent.surfaceType === 'mirror' ? (
            <PlanarMirror
              mirrorObjectId={object.id}
              width={dimensions.x}
              height={dimensions.z}
              color={object.color}
              reflectedObjectIds={reflectedObjectIds}
            />
          ) : (
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
          )}
          <SurfaceGrid
            color={object.color}
            depth={dimensions.z}
            kind="plane"
            parentScale={object.transform.scale}
            positionY={0.002}
            width={dimensions.x}
          />
        </>
      );
    case 'rounded-cube':
      return (
        <PresetGeometryMesh
          dimensions={dimensions}
          createGeometry={createRoundedCubeGeometry}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          material={material}
        />
      );
    case 'bent-plane':
      return (
        <PresetGeometryMesh
          dimensions={dimensions}
          createGeometry={createBentPlaneGeometry}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          material={
            <meshStandardMaterial
              color={object.color}
              roughness={0.82}
              metalness={0}
              side={DoubleSide}
            />
          }
        />
      );
    case 'triangle':
      return (
        <PresetGeometryMesh
          dimensions={dimensions}
          createGeometry={createEquilateralTriangleGeometry}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          material={
            <meshStandardMaterial
              color={object.color}
              roughness={0.78}
              metalness={0}
              side={DoubleSide}
            />
          }
        />
      );
    case 'mannequin':
      return (
        <ArticulatedMannequin
          objectId={object.id}
          color={object.color}
          dimensions={dimensions}
          bodyType={object.mannequinBodyType ?? 'standard'}
          pose={
            runtimeMannequinPose ??
            object.mannequinPose ??
            createMannequinPose('default')
          }
          selected={selected}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          focusContoursEnabled={focusContoursEnabled}
        />
      );
    case 'room':
      return (
        <RoomSet
          color={object.color}
          dimensions={dimensions}
          parentScale={object.transform.scale}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      );
    case 'character-glb':
      return (characterAssetUrl ??
        getBundledRiggedCharacterUrl(object.characterAssetId ?? '')) ===
        undefined ? (
        <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
          <boxGeometry args={[dimensions.x, dimensions.y, dimensions.z]} />
          <meshStandardMaterial
            color="#7b8794"
            wireframe
            transparent
            opacity={0.45}
          />
        </mesh>
      ) : (
        <Suspense
          fallback={
            <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
              <boxGeometry args={[dimensions.x, dimensions.y, dimensions.z]} />
              <meshStandardMaterial
                color="#7b8794"
                wireframe
                transparent
                opacity={0.45}
              />
            </mesh>
          }
        >
          <RiggedCharacter
            object={object}
            assetUrl={
              characterAssetUrl ??
              getBundledRiggedCharacterUrl(object.characterAssetId ?? '')!
            }
            castShadow={castShadow}
            receiveShadow={receiveShadow}
            ik={riggedCharacterIK}
          />
        </Suspense>
      );
  }
}

function SelectionHelper({ object }: { object: SceneObjectData }) {
  const ref = useRef<Mesh>(null);
  const localBounds = useMemo(() => {
    if (object.kind !== 'mannequin' || object.mannequinPose === undefined) {
      return {
        center: { x: 0, y: 0, z: 0 },
        size: object.dimensions,
      };
    }
    const bounds = computeMannequinPoseBounds(
      object.mannequinPose,
      object.mannequinBodyType ?? 'standard',
    );
    return {
      center: {
        x: bounds.center.x * (object.dimensions.x / 0.5),
        y: bounds.center.y * (object.dimensions.y / 1.7),
        z: bounds.center.z * (object.dimensions.z / 0.3),
      },
      size: {
        x: bounds.size.x * (object.dimensions.x / 0.5),
        y: bounds.size.y * (object.dimensions.y / 1.7),
        z: bounds.size.z * (object.dimensions.z / 0.3),
      },
    };
  }, [object]);

  useLayoutEffect(() => {
    ref.current?.layers.set(RENDER_LAYERS.editor);
  }, []);

  return (
    <mesh
      ref={ref}
      name={`selection-helper:${object.id}`}
      position={[
        localBounds.center.x,
        localBounds.center.y,
        localBounds.center.z,
      ]}
      scale={1.025}
      renderOrder={1000}
      raycast={() => undefined}
    >
      <boxGeometry
        args={[localBounds.size.x, localBounds.size.y, localBounds.size.z]}
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
  runtimeMannequinPose,
  mannequinIK,
  focusContoursEnabled,
  reflectedObjectIds = [],
  characterAssetUrl,
  riggedCharacterIK,
}: SceneObjectProps) {
  const model = getSceneObjectModel(object);
  const { position, rotationDeg, scale } = object.transform;
  const visualizationRootRef = useRef<Group>(null);
  const rootRef = useCallback(
    (root: Group | null) => {
      onRootReady(object.id, root);
    },
    [object.id, onRootReady],
  );

  useLayoutEffect(() => {
    const root = visualizationRootRef.current;
    if (root === null) return;
    root.traverse((child) => {
      const candidate = child as typeof child & {
        isMesh?: boolean;
        material?:
          | Parameters<typeof applyProxyOpacityToMaterial>[0]
          | Array<Parameters<typeof applyProxyOpacityToMaterial>[0]>;
      };
      if (!candidate.isMesh || candidate.material === undefined) return;
      const materials = Array.isArray(candidate.material)
        ? candidate.material
        : [candidate.material];
      materials.forEach((material) => {
        applyProxyOpacityToMaterial(
          material,
          object.visualization.proxyOpacity,
        );
      });
    });
  }, [object.visualization.proxyOpacity]);

  return (
    <group
      ref={rootRef}
      name={model.testName}
      userData={{
        sceneObjectId: object.id,
        displayName: model.displayName,
        viewportSelectionLocked: object.viewportSelectionLocked,
      }}
      position={[position.x, position.y, position.z]}
      rotation={[
        MathUtils.degToRad(rotationDeg.x),
        MathUtils.degToRad(rotationDeg.y),
        MathUtils.degToRad(rotationDeg.z),
      ]}
      scale={[scale.x, scale.y, scale.z]}
      visible={object.visible}
      onClick={(event) => {
        if (object.viewportSelectionLocked) return;
        event.stopPropagation();
        if (consumeObjectSelectionSuppression()) return;
        onSelect(object.id);
      }}
    >
      <group
        ref={visualizationRootRef}
        name={`proxy-visualization:${object.id}`}
      >
        <Primitive
          object={object}
          selected={selected}
          runtimeMannequinPose={runtimeMannequinPose}
          castShadow={model.castShadow}
          receiveShadow={model.receiveShadow}
          focusContoursEnabled={focusContoursEnabled}
          reflectedObjectIds={reflectedObjectIds}
          characterAssetUrl={characterAssetUrl}
          riggedCharacterIK={riggedCharacterIK}
        />
      </group>
      {object.kind === 'mannequin' && mannequinIK !== undefined ? (
        <MannequinIKControls object={object} {...mannequinIK} />
      ) : null}
      {selected ? <SelectionHelper object={object} /> : null}
    </group>
  );
}
