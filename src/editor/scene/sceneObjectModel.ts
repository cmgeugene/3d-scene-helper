import { Euler, MathUtils, Vector3 } from 'three';
import { computeMannequinPoseBounds } from '../mannequin/mannequinRig';
import type { SceneObject, SceneObjectKind } from '../persistence/sceneSchema';

export type RuntimeGeometry =
  'box' | 'sphere' | 'cylinder' | 'plane' | 'mannequin' | 'room';

export interface SceneObjectModel {
  geometry: RuntimeGeometry;
  displayName: string;
  testName: string;
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface SceneObjectBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
}

const GEOMETRY_BY_KIND: Record<SceneObjectKind, RuntimeGeometry> = {
  floor: 'box',
  cube: 'box',
  sphere: 'sphere',
  cylinder: 'cylinder',
  plane: 'plane',
  mannequin: 'mannequin',
  room: 'room',
};

const ASSET_PLACEMENT_SLOTS = [
  { x: -1.1, z: 0 },
  { x: 1.1, z: 0 },
  { x: -1.35, z: -1.2 },
  { x: 0, z: -1.2 },
  { x: 1.35, z: -1.2 },
  { x: -1.35, z: 1.2 },
  { x: 0, z: 1.2 },
  { x: 1.35, z: 1.2 },
] as const;

function* assetPlacementCandidates(): Generator<{ x: number; z: number }> {
  yield* ASSET_PLACEMENT_SLOTS;

  for (let row = 2; ; row += 1) {
    const z = Number((-row * 1.2).toFixed(2));
    yield { x: 0, z };

    for (let column = 1; column <= row; column += 1) {
      const x = Number((column * 1.35).toFixed(2));
      yield { x: -x, z };
      yield { x, z };
    }
  }
}

const roundBoundsValue = (value: number) =>
  Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(12));

export function getSceneObjectModel(object: SceneObject): SceneObjectModel {
  return {
    geometry: GEOMETRY_BY_KIND[object.kind],
    displayName: object.name,
    testName: `scene-object:${object.id}`,
    castShadow: object.kind !== 'floor' && object.kind !== 'plane',
    receiveShadow: true,
  };
}

export function getSceneObjectBounds(object: SceneObject): SceneObjectBounds {
  const localBounds =
    object.kind === 'mannequin' && object.mannequinPose !== undefined
      ? computeMannequinPoseBounds(object.mannequinPose)
      : {
          min: {
            x: -object.dimensions.x / 2,
            y: -object.dimensions.y / 2,
            z: -object.dimensions.z / 2,
          },
          max: {
            x: object.dimensions.x / 2,
            y: object.dimensions.y / 2,
            z: object.dimensions.z / 2,
          },
        };
  const dimensionScale =
    object.kind === 'mannequin'
      ? {
          x: object.dimensions.x / 0.5,
          y: object.dimensions.y / 1.7,
          z: object.dimensions.z / 0.3,
        }
      : { x: 1, y: 1, z: 1 };
  const rotation = new Euler(
    MathUtils.degToRad(object.transform.rotationDeg.x),
    MathUtils.degToRad(object.transform.rotationDeg.y),
    MathUtils.degToRad(object.transform.rotationDeg.z),
    'XYZ',
  );
  const worldMin = new Vector3(Infinity, Infinity, Infinity);
  const worldMax = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [localBounds.min.x, localBounds.max.x]) {
    for (const y of [localBounds.min.y, localBounds.max.y]) {
      for (const z of [localBounds.min.z, localBounds.max.z]) {
        const point = new Vector3(
          x * dimensionScale.x * object.transform.scale.x,
          y * dimensionScale.y * object.transform.scale.y,
          z * dimensionScale.z * object.transform.scale.z,
        )
          .applyEuler(rotation)
          .add(
            new Vector3(
              object.transform.position.x,
              object.transform.position.y,
              object.transform.position.z,
            ),
          );
        worldMin.min(point);
        worldMax.max(point);
      }
    }
  }
  const size = worldMax.clone().sub(worldMin);
  const center = worldMin.clone().add(worldMax).multiplyScalar(0.5);
  return {
    min: {
      x: roundBoundsValue(worldMin.x),
      y: roundBoundsValue(worldMin.y),
      z: roundBoundsValue(worldMin.z),
    },
    max: {
      x: roundBoundsValue(worldMax.x),
      y: roundBoundsValue(worldMax.y),
      z: roundBoundsValue(worldMax.z),
    },
    size: {
      x: roundBoundsValue(size.x),
      y: roundBoundsValue(size.y),
      z: roundBoundsValue(size.z),
    },
    center: {
      x: roundBoundsValue(center.x),
      y: roundBoundsValue(center.y),
      z: roundBoundsValue(center.z),
    },
  };
}

export function getNextAssetPosition(objects: readonly SceneObject[]): {
  x: number;
  z: number;
} {
  const occupied = objects.filter((object) => object.kind !== 'floor');
  for (const candidate of assetPlacementCandidates()) {
    const available = !occupied.some(
      (object) =>
        Math.hypot(
          object.transform.position.x - candidate.x,
          object.transform.position.z - candidate.z,
        ) < 0.5,
    );

    if (available) return candidate;
  }

  throw new Error('Asset placement candidate generator ended unexpectedly.');
}
