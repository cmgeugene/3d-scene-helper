import { DoubleSide, PlaneGeometry } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RENDER_LAYERS } from '../constants';

export const PLANAR_MIRROR_TEXTURE_SIZE = 512;

export function createPlanarReflector(
  width: number,
  height: number,
  color: string,
) {
  const geometry = new PlaneGeometry(width, height);
  const reflector = new Reflector(geometry, {
    clipBias: 0.003,
    textureWidth: PLANAR_MIRROR_TEXTURE_SIZE,
    textureHeight: PLANAR_MIRROR_TEXTURE_SIZE,
    color,
    multisample: 4,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.layers.set(RENDER_LAYERS.scene);
  const materials = Array.isArray(reflector.material)
    ? reflector.material
    : [reflector.material];
  materials.forEach((material) => {
    material.side = DoubleSide;
  });
  reflector.forceUpdate = true;
  return reflector;
}

export function disposePlanarReflector(reflector: Reflector) {
  reflector.geometry.dispose();
  reflector.dispose();
}
