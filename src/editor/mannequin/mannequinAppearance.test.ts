import { describe, expect, it } from 'vitest';
import { BufferGeometry } from 'three';
import {
  createStudioMannequinGeometries,
  getSharedStudioMannequinGeometries,
} from './mannequinAppearance';

function radialExtentAtY(
  geometry: BufferGeometry,
  targetY: number,
  tolerance = 0.012,
) {
  const position = geometry.getAttribute('position');
  let extent = 0;
  for (let index = 0; index < position.count; index += 1) {
    if (Math.abs(position.getY(index) - targetY) > tolerance) continue;
    extent = Math.max(extent, Math.abs(position.getX(index)));
  }
  return extent;
}

function depthExtentsAtY(
  geometry: BufferGeometry,
  targetY: number,
  tolerance = 0.012,
) {
  const position = geometry.getAttribute('position');
  let front = 0;
  let back = 0;
  for (let index = 0; index < position.count; index += 1) {
    if (Math.abs(position.getY(index) - targetY) > tolerance) continue;
    front = Math.max(front, -position.getZ(index));
    back = Math.max(back, position.getZ(index));
  }
  return { front, back };
}

function countOpenBoundaryEdges(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (index === null) throw new Error('indexed geometry가 필요합니다.');
  const vertexKey = (vertex: number) =>
    [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)]
      .map((value) => (Math.abs(value) < 0.0000005 ? 0 : value).toFixed(6))
      .join(',');
  const edgeCounts = new Map<string, number>();
  for (let offset = 0; offset < index.count; offset += 3) {
    const triangle = [
      vertexKey(index.getX(offset)),
      vertexKey(index.getX(offset + 1)),
      vertexKey(index.getX(offset + 2)),
    ];
    for (const [from, to] of [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ] as const) {
      if (from === to) continue;
      const edge = from < to ? `${from}|${to}` : `${to}|${from}`;
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
    }
  }
  return [...edgeCounts.values()].filter((count) => count === 1).length;
}

function signedVolume(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (index === null) throw new Error('indexed geometry가 필요합니다.');
  let volume = 0;
  for (let offset = 0; offset < index.count; offset += 3) {
    const a = index.getX(offset);
    const b = index.getX(offset + 1);
    const c = index.getX(offset + 2);
    const ax = positions.getX(a);
    const ay = positions.getY(a);
    const az = positions.getZ(a);
    const bx = positions.getX(b);
    const by = positions.getY(b);
    const bz = positions.getZ(b);
    const cx = positions.getX(c);
    const cy = positions.getY(c);
    const cz = positions.getZ(c);
    volume +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return volume;
}

describe('studio mannequin appearance geometry', () => {
  it('shares one immutable geometry set across mannequin instances', () => {
    expect(getSharedStudioMannequinGeometries()).toBe(
      getSharedStudioMannequinGeometries(),
    );
  });

  it('uses anatomical profile variation instead of block primitives', () => {
    const geometry = createStudioMannequinGeometries();

    expect(radialExtentAtY(geometry.torso, 0.12)).toBeGreaterThan(
      radialExtentAtY(geometry.torso, -0.18) * 1.35,
    );
    expect(radialExtentAtY(geometry.forearm, -0.12)).toBeGreaterThan(
      radialExtentAtY(geometry.forearm, -0.28) * 1.35,
    );
    expect(radialExtentAtY(geometry.shin, -0.14)).toBeGreaterThan(
      radialExtentAtY(geometry.shin, -0.35) * 1.4,
    );

    geometry.foot.computeBoundingBox();
    expect(geometry.foot.boundingBox?.min.z).toBeLessThan(-0.2);
    expect(geometry.foot.boundingBox?.max.z).toBeLessThan(0.1);
    expect(signedVolume(geometry.foot)).toBeGreaterThan(0);

    for (const part of Object.values(geometry)) part.dispose();
  });

  it('models a projected chest and lower face so front and back read differently', () => {
    const geometry = createStudioMannequinGeometries();
    const upperChest = depthExtentsAtY(geometry.torso, 0.12);
    geometry.head.computeBoundingBox();

    expect(upperChest.front).toBeGreaterThan(upperChest.back * 1.1);
    expect(geometry.head.boundingBox?.min.z).toBeLessThan(-0.098);
    expect(geometry.head.boundingBox?.max.z).toBeGreaterThan(0.1);

    for (const part of Object.values(geometry)) part.dispose();
  });

  it('closes every profile mesh so the outer surface has no open rings', () => {
    const geometry = createStudioMannequinGeometries();

    expect(
      Object.fromEntries(
        [
          'torso',
          'pelvis',
          'neck',
          'upperArm',
          'forearm',
          'thigh',
          'shin',
          'hand',
          'foot',
        ].map((name) => [
          name,
          countOpenBoundaryEdges(
            geometry[name as keyof typeof geometry] as BufferGeometry,
          ),
        ]),
      ),
    ).toEqual({
      torso: 0,
      pelvis: 0,
      neck: 0,
      upperArm: 0,
      forearm: 0,
      thigh: 0,
      shin: 0,
      hand: 0,
      foot: 0,
    });

    for (const part of Object.values(geometry)) part.dispose();
  });

  it('winds every closed body profile outward for FrontSide materials', () => {
    const geometry = createStudioMannequinGeometries();
    const bodyProfiles = [
      'torso',
      'pelvis',
      'neck',
      'upperArm',
      'forearm',
      'thigh',
      'shin',
      'hand',
      'foot',
    ] as const;

    expect(
      Object.fromEntries(
        bodyProfiles.map((name) => [name, signedVolume(geometry[name]) > 0]),
      ),
    ).toEqual(Object.fromEntries(bodyProfiles.map((name) => [name, true])));

    for (const part of Object.values(geometry)) part.dispose();
  });
});
