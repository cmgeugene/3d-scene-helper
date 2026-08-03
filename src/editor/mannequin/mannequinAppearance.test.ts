import { describe, expect, it } from 'vitest';
import { BufferGeometry } from 'three';
import {
  createStudioMannequinGeometries,
  getSharedStudioMannequinGeometries,
} from './mannequinAppearance';
import { MANNEQUIN_BODY_PROPORTIONS } from './mannequinBodyType';

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

  it('건장한 체형과 뚱뚱한 체형이 관절 길이는 유지하면서 서로 다른 실루엣을 만든다', () => {
    const standard = createStudioMannequinGeometries('standard');
    const athletic = createStudioMannequinGeometries('athletic');
    const heavy = createStudioMannequinGeometries('heavy');
    const size = (geometry: BufferGeometry) => {
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (bounds === null) throw new Error('geometry bounds가 없습니다.');
      return {
        x: bounds.max.x - bounds.min.x,
        y: bounds.max.y - bounds.min.y,
        z: bounds.max.z - bounds.min.z,
      };
    };

    expect(size(athletic.torso).x).toBeGreaterThan(
      size(standard.torso).x * 1.15,
    );
    expect(size(athletic.upperArm).x).toBeGreaterThan(
      size(standard.upperArm).x * 1.15,
    );
    expect(size(heavy.torso).x).toBeGreaterThan(size(standard.torso).x * 1.25);
    expect(size(heavy.torso).z).toBeGreaterThan(size(athletic.torso).z * 1.15);
    expect(size(heavy.thigh).x).toBeGreaterThan(size(standard.thigh).x * 1.4);
    expect(radialExtentAtY(athletic.torso, 0.12)).toBeGreaterThan(
      radialExtentAtY(athletic.torso, -0.08) * 1.25,
    );
    expect(radialExtentAtY(heavy.torso, -0.08)).toBeGreaterThan(
      radialExtentAtY(heavy.torso, 0.12) * 1.03,
    );
    expect(size(athletic.upperArm).y).toBeCloseTo(size(standard.upperArm).y, 8);
    expect(size(heavy.thigh).y).toBeCloseTo(size(standard.thigh).y, 8);

    for (const geometries of [standard, athletic, heavy]) {
      for (const part of Object.values(geometries)) part.dispose();
    }
  });

  it('뚱뚱한 체형은 복부 중앙이 위아래보다 넓고 앞쪽으로 돌출된 항아리 실루엣이다', () => {
    const heavy = createStudioMannequinGeometries('heavy');
    const bellyWidth = radialExtentAtY(heavy.torso, -0.08);
    const chestWidth = radialExtentAtY(heavy.torso, 0.12);
    const lowerBellyWidth = radialExtentAtY(heavy.torso, -0.17);
    const lowerTorsoWidth = radialExtentAtY(heavy.torso, -0.25);
    const bellyDepth = depthExtentsAtY(heavy.torso, -0.08);
    const chestDepth = depthExtentsAtY(heavy.torso, 0.12);
    const standard = createStudioMannequinGeometries('standard');

    expect(bellyWidth).toBeGreaterThan(
      radialExtentAtY(standard.torso, -0.08) * 2.2,
    );
    expect(bellyDepth.front).toBeGreaterThan(
      depthExtentsAtY(standard.torso, -0.08).front * 1.9,
    );
    expect(bellyWidth).toBeGreaterThan(chestWidth * 1.15);
    expect(lowerBellyWidth).toBeGreaterThan(bellyWidth * 0.6);
    expect(bellyWidth).toBeGreaterThan(lowerTorsoWidth * 1.5);
    expect(bellyDepth.front).toBeGreaterThan(chestDepth.front * 1.15);
    expect(bellyDepth.front).toBeLessThan(chestDepth.front * 1.3);
    expect(bellyDepth.front).toBeGreaterThan(bellyDepth.back * 1.25);
    const roundedLowerBellyWidths = [
      -0.08, -0.11, -0.14, -0.17, -0.2, -0.22,
    ].map((y) => radialExtentAtY(heavy.torso, y));
    for (let index = 1; index < roundedLowerBellyWidths.length; index += 1) {
      expect(roundedLowerBellyWidths[index]).toBeGreaterThan(
        roundedLowerBellyWidths[index - 1] * 0.84,
      );
    }

    for (const geometries of [standard, heavy]) {
      for (const part of Object.values(geometries)) part.dispose();
    }

    expect(MANNEQUIN_BODY_PROPORTIONS.heavy.torsoCue.x).toBeLessThan(
      MANNEQUIN_BODY_PROPORTIONS.heavy.torso.x * 0.8,
    );
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
