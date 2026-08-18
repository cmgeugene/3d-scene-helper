import { BufferAttribute, BufferGeometry, PlaneGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

interface Size3 {
  x: number;
  y: number;
  z: number;
}

export function roundedCubeRadius(dimensions: Size3) {
  return Math.min(dimensions.x, dimensions.y, dimensions.z) * 0.16;
}

export function createRoundedCubeGeometry(dimensions: Size3) {
  return new RoundedBoxGeometry(
    dimensions.x,
    dimensions.y,
    dimensions.z,
    4,
    roundedCubeRadius(dimensions),
  );
}

export function createBentPlaneGeometry(dimensions: Size3) {
  const width = dimensions.x;
  const height = dimensions.y;
  const sagitta = dimensions.z;
  const geometry = new PlaneGeometry(width, height, 24, 1);
  const position = geometry.getAttribute('position') as BufferAttribute;
  const halfWidth = width / 2;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const t = halfWidth === 0 ? 0 : x / halfWidth;
    position.setZ(index, sagitta * (1 - t * t));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry as BufferGeometry;
}

export function equilateralTriangleHeight(side: number) {
  return (Math.sqrt(3) / 2) * side;
}

export function createEquilateralTriangleGeometry(dimensions: Size3) {
  const side = dimensions.x;
  const height = equilateralTriangleHeight(side);
  const geometry = new BufferGeometry();
  const positions = new Float32Array([
    -side / 2,
    -height / 3,
    0,
    side / 2,
    -height / 3,
    0,
    0,
    (2 * height) / 3,
    0,
  ]);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}
