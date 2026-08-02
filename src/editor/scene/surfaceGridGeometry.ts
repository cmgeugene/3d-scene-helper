export interface SurfaceGridLine {
  major: boolean;
  start: readonly [x: number, z: number];
  end: readonly [x: number, z: number];
}

export function createSurfaceGridLines(
  width: number,
  depth: number,
  parentScale: Readonly<{ x: number; z: number }> = { x: 1, z: 1 },
): SurfaceGridLine[] {
  const lines: SurfaceGridLine[] = [];
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const scaleX = Math.max(Math.abs(parentScale.x), 1e-9);
  const scaleZ = Math.max(Math.abs(parentScale.z), 1e-9);
  const spacingX = 0.5 / scaleX;
  const spacingZ = 0.5 / scaleZ;
  const isMajor = (worldCoordinate: number) =>
    Math.abs(worldCoordinate - Math.round(worldCoordinate)) < 1e-9;

  for (
    let index = Math.ceil(-halfWidth / spacingX);
    index <= Math.floor(halfWidth / spacingX);
    index += 1
  ) {
    const x = index === 0 ? 0 : index * spacingX;
    lines.push({
      major: isMajor(x * scaleX),
      start: [x, -halfDepth],
      end: [x, halfDepth],
    });
  }
  for (
    let index = Math.ceil(-halfDepth / spacingZ);
    index <= Math.floor(halfDepth / spacingZ);
    index += 1
  ) {
    const z = index === 0 ? 0 : index * spacingZ;
    lines.push({
      major: isMajor(z * scaleZ),
      start: [-halfWidth, z],
      end: [halfWidth, z],
    });
  }

  return lines;
}
