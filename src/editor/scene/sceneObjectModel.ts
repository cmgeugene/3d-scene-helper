import { MathUtils } from 'three';
import type { SceneObject, SceneObjectKind } from '../persistence/sceneSchema';

export type RuntimeGeometry =
  'box' | 'sphere' | 'cylinder' | 'plane' | 'mannequin';

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
  const localSize = {
    x: object.dimensions.x * object.transform.scale.x,
    y: object.dimensions.y * object.transform.scale.y,
    z: object.dimensions.z * object.transform.scale.z,
  };
  const x = MathUtils.degToRad(object.transform.rotationDeg.x);
  const y = MathUtils.degToRad(object.transform.rotationDeg.y);
  const z = MathUtils.degToRad(object.transform.rotationDeg.z);
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const matrix = {
    m11: c * e,
    m12: -c * f,
    m13: d,
    m21: a * f + b * e * d,
    m22: a * e - b * f * d,
    m23: -b * c,
    m31: b * f - a * e * d,
    m32: b * e + a * f * d,
    m33: a * c,
  };
  const size = {
    x: roundBoundsValue(
      Math.abs(matrix.m11) * localSize.x +
        Math.abs(matrix.m12) * localSize.y +
        Math.abs(matrix.m13) * localSize.z,
    ),
    y: roundBoundsValue(
      Math.abs(matrix.m21) * localSize.x +
        Math.abs(matrix.m22) * localSize.y +
        Math.abs(matrix.m23) * localSize.z,
    ),
    z: roundBoundsValue(
      Math.abs(matrix.m31) * localSize.x +
        Math.abs(matrix.m32) * localSize.y +
        Math.abs(matrix.m33) * localSize.z,
    ),
  };
  const center = { ...object.transform.position };

  return {
    min: {
      x: roundBoundsValue(center.x - size.x / 2),
      y: roundBoundsValue(center.y - size.y / 2),
      z: roundBoundsValue(center.z - size.z / 2),
    },
    max: {
      x: roundBoundsValue(center.x + size.x / 2),
      y: roundBoundsValue(center.y + size.y / 2),
      z: roundBoundsValue(center.z + size.z / 2),
    },
    size,
    center,
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
