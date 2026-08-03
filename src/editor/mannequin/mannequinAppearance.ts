import {
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  SphereGeometry,
  Vector2,
} from 'three';
import {
  MANNEQUIN_BODY_PROPORTIONS,
  type MannequinBodyRadialScale,
  type MannequinBodyTypeId,
} from './mannequinBodyType';

function applyRadialScale<T extends BufferGeometry>(
  geometry: T,
  { x, z }: MannequinBodyRadialScale,
) {
  geometry.scale(x, 1, z);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const createProfileGeometry = (
  profile: ReadonlyArray<readonly [radius: number, y: number]>,
  radialSegments = 24,
  depthScale = 1,
) => {
  const first = profile[0];
  const last = profile.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error('마네킹 profile에는 하나 이상의 단면이 필요합니다.');
  }
  const orderedProfile = first[1] <= last[1] ? profile : [...profile].reverse();
  const bottom = orderedProfile[0]!;
  const top = orderedProfile.at(-1)!;
  const geometry = new LatheGeometry(
    [
      new Vector2(0, bottom[1]),
      ...orderedProfile.map(([radius, y]) => new Vector2(radius, y)),
      new Vector2(0, top[1]),
    ],
    radialSegments,
  );
  geometry.scale(1, 1, depthScale);
  geometry.computeVertexNormals();
  return geometry;
};

function createHeadGeometry() {
  const geometry = new SphereGeometry(1, 28, 20);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const sourceX = position.getX(index);
    const sourceY = position.getY(index);
    const sourceZ = position.getZ(index);
    const lowerHalf = Math.max(0, -sourceY);
    const jawTaper = 1 - lowerHalf * 0.3;
    const cranium = 1 + Math.max(0, sourceY) * 0.06;
    const x = sourceX * 0.112 * jawTaper * cranium;
    const y = sourceY * 0.13;
    let z = sourceZ * 0.105 * (1 - lowerHalf * 0.08);
    if (z < -0.075) z = -0.075 + (z + 0.075) * 0.42;
    if (sourceZ < 0) {
      const lowerFace = Math.max(0, 1 - Math.abs(sourceY + 0.35) / 0.65);
      z -= 0.018 * Math.max(0, -sourceZ) * (0.35 + lowerFace * 0.65);
    }
    position.setXYZ(index, x, y, z);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createTorsoGeometry(bodyType: MannequinBodyTypeId) {
  const geometry = createProfileGeometry(
    [
      [0.122, -0.25],
      [0.112, -0.22],
      [0.118, -0.17],
      [0.145, -0.08],
      [0.178, 0.06],
      [0.19, 0.12],
      [0.172, 0.19],
      [0.122, 0.22],
    ],
    28,
    0.72,
  );
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    let z = position.getZ(index);
    const upperChest = Math.max(0, 1 - Math.abs(y - 0.11) / 0.2);
    if (z < 0) {
      z = z * (1 + upperChest * 0.12) - upperChest * 0.004;
    } else {
      z *= 1 - upperChest * 0.035;
    }
    const belly = Math.max(0, 1 - Math.abs(y + 0.08) / 0.24);
    const widthScale =
      bodyType === 'athletic'
        ? 1.16 + upperChest * 0.12
        : bodyType === 'heavy'
          ? 1.08 + belly * 1.35
          : 1;
    const depthScale =
      bodyType === 'athletic'
        ? 1.14
        : bodyType === 'heavy'
          ? z < 0
            ? 1.12 + belly * 1.6
            : 1.08 + belly * 0.65
          : 1;
    const forwardBellyOffset =
      bodyType === 'heavy' && z < 0 ? belly * 0.025 : 0;
    position.setXYZ(
      index,
      position.getX(index) * widthScale,
      y,
      z * depthScale - forwardBellyOffset,
    );
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFootGeometry() {
  const radialSegments = 20;
  const slices = [
    { z: 0.065, width: 0.04, centerY: -0.052, height: 0.048 },
    { z: 0.02, width: 0.055, centerY: -0.05, height: 0.06 },
    { z: -0.09, width: 0.08, centerY: -0.06, height: 0.06 },
    { z: -0.18, width: 0.073, centerY: -0.057, height: 0.052 },
    { z: -0.235, width: 0.045, centerY: -0.065, height: 0.036 },
  ] as const;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const slice of slices) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const roundedX = Math.sign(cosine) * Math.pow(Math.abs(cosine), 0.72);
      const roundedY = Math.sign(sine) * Math.pow(Math.abs(sine), 0.72);
      vertices.push(
        roundedX * slice.width,
        slice.centerY + roundedY * slice.height,
        slice.z,
      );
    }
  }
  for (let slice = 0; slice < slices.length - 1; slice += 1) {
    const nextSlice = slice + 1;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const nextSegment = (segment + 1) % radialSegments;
      const current = slice * radialSegments + segment;
      const currentNext = slice * radialSegments + nextSegment;
      const forward = nextSlice * radialSegments + segment;
      const forwardNext = nextSlice * radialSegments + nextSegment;
      indices.push(
        current,
        forward,
        currentNext,
        currentNext,
        forward,
        forwardNext,
      );
    }
  }
  const heelCenter = vertices.length / 3;
  vertices.push(0, slices[0].centerY, slices[0].z);
  const toeCenter = vertices.length / 3;
  const toe = slices.at(-1)!;
  vertices.push(0, toe.centerY, toe.z);
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const nextSegment = (segment + 1) % radialSegments;
    indices.push(heelCenter, segment, nextSegment);
    const toeOffset = (slices.length - 1) * radialSegments;
    indices.push(toeCenter, toeOffset + nextSegment, toeOffset + segment);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createStudioMannequinGeometries(
  bodyType: MannequinBodyTypeId = 'standard',
) {
  const scales = MANNEQUIN_BODY_PROPORTIONS[bodyType];
  return {
    torso: createTorsoGeometry(bodyType),
    pelvis: applyRadialScale(
      createProfileGeometry(
        [
          [0.1, -0.1],
          [0.132, -0.065],
          [0.15, 0.005],
          [0.142, 0.06],
          [0.112, 0.1],
        ],
        28,
        0.64,
      ),
      scales.pelvis,
    ),
    neck: applyRadialScale(
      createProfileGeometry(
        [
          [0.046, -0.17],
          [0.05, -0.145],
          [0.057, -0.125],
          [0.055, -0.055],
          [0.046, -0.035],
        ],
        20,
        0.92,
      ),
      scales.neck,
    ),
    head: applyRadialScale(createHeadGeometry(), scales.head),
    upperArm: applyRadialScale(
      createProfileGeometry([
        [0.048, 0],
        [0.061, -0.055],
        [0.059, -0.13],
        [0.052, -0.22],
        [0.042, -0.31],
      ]),
      scales.upperArm,
    ),
    forearm: applyRadialScale(
      createProfileGeometry([
        [0.05, 0],
        [0.057, -0.055],
        [0.058, -0.12],
        [0.052, -0.205],
        [0.034, -0.29],
      ]),
      scales.forearm,
    ),
    thigh: applyRadialScale(
      createProfileGeometry(
        [
          [0.066, 0],
          [0.078, -0.07],
          [0.075, -0.17],
          [0.064, -0.27],
          [0.05, -0.37],
        ],
        26,
        0.92,
      ),
      scales.thigh,
    ),
    shin: applyRadialScale(
      createProfileGeometry(
        [
          [0.052, 0],
          [0.058, -0.055],
          [0.064, -0.14],
          [0.053, -0.235],
          [0.035, -0.37],
        ],
        26,
        0.94,
      ),
      scales.shin,
    ),
    hand: applyRadialScale(
      createProfileGeometry(
        [
          [0.024, 0.015],
          [0.04, -0.02],
          [0.046, -0.075],
          [0.035, -0.12],
          [0.01, -0.145],
        ],
        20,
        0.62,
      ),
      scales.hand,
    ),
    thumb: applyRadialScale(
      new CapsuleGeometry(0.009, 0.024, 4, 10),
      scales.thumb,
    ),
    nose: new ConeGeometry(0.024, 0.068, 14).rotateX(-Math.PI / 2),
    foot: applyRadialScale(createFootGeometry(), scales.foot),
  };
}

export type StudioMannequinGeometries = ReturnType<
  typeof createStudioMannequinGeometries
>;

const sharedStudioMannequinGeometries = new Map<
  MannequinBodyTypeId,
  StudioMannequinGeometries
>();

export function getSharedStudioMannequinGeometries(
  bodyType: MannequinBodyTypeId = 'standard',
) {
  const existing = sharedStudioMannequinGeometries.get(bodyType);
  if (existing !== undefined) return existing;
  const geometries = createStudioMannequinGeometries(bodyType);
  sharedStudioMannequinGeometries.set(bodyType, geometries);
  return geometries;
}
