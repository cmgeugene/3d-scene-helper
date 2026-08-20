import { Euler, MathUtils, Vector3 } from 'three';
import type { SceneObject } from '../persistence/sceneSchema';

export function getPlanarMirrorWorldPlane(
  object: Pick<SceneObject, 'kind' | 'transform' | 'appearanceIntent'>,
) {
  if (
    object.kind !== 'plane' ||
    object.appearanceIntent.surfaceType !== 'mirror'
  ) {
    throw new TypeError(
      'Planar mirror contract requires a mirror plane object',
    );
  }
  const rotation = new Euler(
    MathUtils.degToRad(object.transform.rotationDeg.x),
    MathUtils.degToRad(object.transform.rotationDeg.y),
    MathUtils.degToRad(object.transform.rotationDeg.z),
    'XYZ',
  );
  const normal = new Vector3(0, 1, 0).applyEuler(rotation).normalize();
  const clean = (value: number) => (Math.abs(value) < 1e-10 ? 0 : value);
  return {
    pointWorld: { ...object.transform.position },
    normalWorld: {
      x: clean(normal.x),
      y: clean(normal.y),
      z: clean(normal.z),
    },
  };
}
