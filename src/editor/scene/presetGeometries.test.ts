import { describe, expect, it } from 'vitest';
import {
  createBentPlaneGeometry,
  createEquilateralTriangleGeometry,
  createRoundedCubeGeometry,
} from './presetGeometries';

describe('presetGeometries', () => {
  it('gives a rounded cube more vertices than a box and keeps the radius inside the box', () => {
    const geometry = createRoundedCubeGeometry({ x: 1, y: 1, z: 1 });
    const position = geometry.getAttribute('position');
    expect(position.count).toBeGreaterThan(24);

    let maxAbs = 0;
    for (let index = 0; index < position.count; index += 1) {
      maxAbs = Math.max(
        maxAbs,
        Math.abs(position.getX(index)),
        Math.abs(position.getY(index)),
        Math.abs(position.getZ(index)),
      );
    }
    expect(maxAbs).toBeCloseTo(0.5, 5);
    geometry.dispose();
  });

  it('bends a standing plane so the center recedes from the camera', () => {
    const geometry = createBentPlaneGeometry({ x: 2, y: 2, z: 0.7 });
    const position = geometry.getAttribute('position');
    let minZ = Infinity;
    let maxZ = -Infinity;
    let centerZ = 0;
    let centerSamples = 0;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      if (Math.abs(x) < 0.05) {
        centerZ += z;
        centerSamples += 1;
      }
    }
    expect(maxZ - minZ).toBeCloseTo(0.7, 2);
    expect(centerZ / centerSamples).toBeGreaterThan(0.6);
    expect(minZ).toBeCloseTo(0, 2);
    geometry.dispose();
  });

  it('builds a centered equilateral triangle facing the camera', () => {
    const geometry = createEquilateralTriangleGeometry({
      x: 2,
      y: 1,
      z: 0.02,
    });
    const position = geometry.getAttribute('position');
    expect(position.count).toBe(3);
    const xs = [0, 1, 2]
      .map((index) => position.getX(index))
      .sort((a, b) => a - b);
    const ys = [0, 1, 2].map((index) => position.getY(index));
    expect(xs[0]).toBeCloseTo(-1);
    expect(xs[2]).toBeCloseTo(1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(Math.sqrt(3), 5);
    geometry.dispose();
  });
});
