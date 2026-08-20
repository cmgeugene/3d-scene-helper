import { Euler, MathUtils, PerspectiveCamera, Vector3 } from 'three';
import {
  layoutSpecSchema,
  type LayoutSpec,
} from '../../shared/layoutSpecSchema';
import { FILM_GAUGE_MM } from '../editor/constants';
import type {
  SceneDocument,
  SceneObject,
} from '../editor/persistence/sceneSchema';
import { getSceneObjectBounds } from '../editor/scene/sceneObjectModel';
import { getPlanarMirrorWorldPlane } from '../editor/scene/planarMirrorContract';
import type { ReferenceArtifact } from './companionClient';

type LayoutObject = LayoutSpec['objects'][number];
type ScreenBounds = NonNullable<LayoutObject['screen']['bounds']>;

const round = (value: number) =>
  Math.abs(value) < 1e-8 ? 0 : Number(value.toFixed(4));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function boundsCorners(bounds: ReturnType<typeof getSceneObjectBounds>) {
  return [bounds.min.x, bounds.max.x].flatMap((x) =>
    [bounds.min.y, bounds.max.y].flatMap((y) =>
      [bounds.min.z, bounds.max.z].map((z) => new Vector3(x, y, z)),
    ),
  );
}

function screenPositionLabel(x: number, y: number) {
  const horizontal = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center';
  const vertical = y < 1 / 3 ? 'top' : y > 2 / 3 ? 'bottom' : 'middle';
  return `${horizontal}-${vertical}`;
}

function clipBounds(bounds: ScreenBounds): ScreenBounds | null {
  const right = clamp01(bounds.x + bounds.width);
  const bottom = clamp01(bounds.y + bounds.height);
  const x = clamp01(bounds.x);
  const y = clamp01(bounds.y);
  if (right <= x || bottom <= y) return null;
  return {
    x: round(x),
    y: round(y),
    width: round(right - x),
    height: round(bottom - y),
  };
}

function roleForObject(object: SceneObject): LayoutObject['role'] {
  if (object.kind === 'mannequin') return 'subject';
  if (object.kind === 'floor' || object.kind === 'room') return 'environment';
  return 'proxy';
}

function mannequinFacing(
  object: SceneObject,
  centerWorld: Vector3,
  camera: PerspectiveCamera,
): LayoutObject['facing'] {
  if (object.kind !== 'mannequin') return null;
  const direction = new Vector3(0, 0, -1)
    .applyEuler(
      new Euler(
        MathUtils.degToRad(object.transform.rotationDeg.x),
        MathUtils.degToRad(object.transform.rotationDeg.y),
        MathUtils.degToRad(object.transform.rotationDeg.z),
        'XYZ',
      ),
    )
    .normalize();
  const toCamera = camera.position.clone().sub(centerWorld).normalize();
  const alignment = direction.dot(toCamera);
  let relativeToCamera: NonNullable<LayoutObject['facing']>['relativeToCamera'];
  if (alignment >= 0.6) {
    relativeToCamera = 'toward-camera';
  } else if (alignment <= -0.6) {
    relativeToCamera = 'away-from-camera';
  } else {
    const centerScreen = centerWorld.clone().project(camera);
    const forwardScreen = centerWorld.clone().add(direction).project(camera);
    relativeToCamera =
      forwardScreen.x < centerScreen.x ? 'screen-left' : 'screen-right';
  }
  return {
    worldDirection: {
      x: round(direction.x),
      y: round(direction.y),
      z: round(direction.z),
    },
    relativeToCamera,
  };
}

function depthBand(
  depthMeters: number,
  targetDistanceMeters: number,
): LayoutObject['screen']['depthBand'] {
  if (depthMeters <= 0) return 'behind-camera';
  const referenceDistance = Math.max(targetDistanceMeters, 0.1);
  if (depthMeters < referenceDistance * 0.65) return 'foreground';
  if (depthMeters > referenceDistance * 1.35) return 'background';
  return 'midground';
}

function createCamera(document: SceneDocument) {
  const camera = new PerspectiveCamera(
    50,
    document.output.width / document.output.height,
  );
  camera.filmGauge = FILM_GAUGE_MM;
  camera.setFocalLength(document.outputCamera.focalLengthMm);
  camera.position.set(
    document.outputCamera.position.x,
    document.outputCamera.position.y,
    document.outputCamera.position.z,
  );
  camera.lookAt(
    document.outputCamera.target.x,
    document.outputCamera.target.y,
    document.outputCamera.target.z,
  );
  camera.rotateZ(MathUtils.degToRad(document.outputCamera.rollDeg));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function projectObject(
  object: SceneObject,
  camera: PerspectiveCamera,
  targetDistanceMeters: number,
  references: ReferenceArtifact[],
  groupId: string | null,
): LayoutObject {
  const worldBounds = getSceneObjectBounds(object);
  const centerWorld = new Vector3(
    worldBounds.center.x,
    worldBounds.center.y,
    worldBounds.center.z,
  );
  const centerCamera = centerWorld
    .clone()
    .applyMatrix4(camera.matrixWorldInverse);
  const depthMeters = -centerCamera.z;
  const projectedCorners = boundsCorners(worldBounds)
    .map((corner) => ({
      camera: corner.clone().applyMatrix4(camera.matrixWorldInverse),
      projected: corner.clone().project(camera),
    }))
    .filter(({ camera: cameraPoint }) => cameraPoint.z < -0.01);
  const centerProjected = centerWorld.clone().project(camera);
  const center =
    depthMeters <= 0
      ? null
      : {
          x: round((centerProjected.x + 1) / 2),
          y: round((1 - centerProjected.y) / 2),
        };
  const bounds =
    projectedCorners.length === 0
      ? null
      : (() => {
          const xs = projectedCorners.map(
            ({ projected }) => (projected.x + 1) / 2,
          );
          const ys = projectedCorners.map(
            ({ projected }) => (1 - projected.y) / 2,
          );
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          return {
            x: round(minX),
            y: round(minY),
            width: round(maxX - minX),
            height: round(maxY - minY),
          };
        })();
  const clippedBounds = bounds === null ? null : clipBounds(bounds);
  const fullyOutside = clippedBounds === null;
  const partial =
    bounds !== null &&
    (projectedCorners.length < 8 ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.x + bounds.width > 1 ||
      bounds.y + bounds.height > 1);
  const status: LayoutObject['screen']['status'] =
    depthMeters <= 0 || projectedCorners.length === 0
      ? 'behind-camera'
      : fullyOutside
        ? 'outside'
        : partial
          ? 'partial'
          : 'visible';
  const role = roleForObject(object);
  const appearanceReferenceIds = references
    .filter(
      ({ enabled, targetObjectId }) => enabled && targetObjectId === object.id,
    )
    .map(({ id }) => id);

  return {
    objectId: object.id,
    name: object.name,
    kind: object.kind,
    role,
    guideColor: object.color,
    guideColorOnly: true,
    proxyVisualization: {
      opacity: object.visualization.proxyOpacity,
    },
    appearanceIntent: object.appearanceIntent,
    groupId,
    semanticMeaning: object.semantic?.meaning || null,
    generationNotes: object.semantic?.generationNotes || null,
    worldBounds: {
      center: {
        x: round(worldBounds.center.x),
        y: round(worldBounds.center.y),
        z: round(worldBounds.center.z),
      },
      size: {
        x: round(worldBounds.size.x),
        y: round(worldBounds.size.y),
        z: round(worldBounds.size.z),
      },
    },
    yawDeg: round(object.transform.rotationDeg.y),
    facing: mannequinFacing(object, centerWorld, camera),
    poseId: object.mannequinPose?.id ?? null,
    screen: {
      status,
      center,
      bounds,
      clippedBounds,
      occupancy:
        clippedBounds === null
          ? 0
          : round(clippedBounds.width * clippedBounds.height),
      depthMeters: round(depthMeters),
      depthBand: depthBand(depthMeters, targetDistanceMeters),
      positionLabel:
        center === null ? null : screenPositionLabel(center.x, center.y),
    },
    appearanceReferenceIds,
    preserve:
      role === 'subject'
        ? ['screen placement', 'scale', 'depth', 'pose', 'facing direction']
        : ['screen placement', 'scale', 'depth', 'occlusion relationship'],
    reinterpret:
      role === 'subject'
        ? ['face', 'body appearance', 'hair', 'clothing', 'surface detail']
        : role === 'environment'
          ? ['materials', 'lighting detail', 'environment appearance']
          : ['real-world meaning', 'materials', 'color', 'surface detail'],
  };
}

function intersectionArea(left: ScreenBounds, right: ScreenBounds) {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  );
  return width * height;
}

function potentialOcclusions(objects: LayoutObject[]) {
  const candidates = objects.filter(
    ({ role, screen }) =>
      role !== 'environment' && screen.clippedBounds !== null,
  );
  return candidates.flatMap((left, leftIndex) =>
    candidates.slice(leftIndex + 1).flatMap((right) => {
      const near =
        left.screen.depthMeters <= right.screen.depthMeters ? left : right;
      const far = near === left ? right : left;
      const nearBounds = near.screen.clippedBounds!;
      const farBounds = far.screen.clippedBounds!;
      const overlap = intersectionArea(nearBounds, farBounds);
      const farArea = farBounds.width * farBounds.height;
      const ratio = farArea <= 0 ? 0 : overlap / farArea;
      return ratio < 0.01
        ? []
        : [
            {
              nearObjectId: near.objectId,
              farObjectId: far.objectId,
              farObjectOverlap: round(Math.min(1, ratio)),
            },
          ];
    }),
  );
}

export function createLayoutSpec(
  document: SceneDocument,
  references: ReferenceArtifact[] = [],
): LayoutSpec {
  const camera = createCamera(document);
  const targetDistanceMeters = new Vector3(
    document.outputCamera.position.x,
    document.outputCamera.position.y,
    document.outputCamera.position.z,
  ).distanceTo(
    new Vector3(
      document.outputCamera.target.x,
      document.outputCamera.target.y,
      document.outputCamera.target.z,
    ),
  );
  const included = document.objects.filter(
    ({ visible, exportable }) => visible && exportable,
  );
  const objects = included.map((object) => {
    const groupId =
      document.groups.find(({ memberObjectIds }) =>
        memberObjectIds.includes(object.id),
      )?.id ?? null;
    return projectObject(
      object,
      camera,
      targetDistanceMeters,
      references,
      groupId,
    );
  });

  return layoutSpecSchema.parse({
    version: 2,
    sceneId: document.id,
    output: {
      width: document.output.width,
      height: document.output.height,
      aspectRatioId: document.output.aspectRatioId,
    },
    camera: {
      ...document.outputCamera,
      targetDistanceMeters: round(targetDistanceMeters),
    },
    authority: {
      preserveFromLayout: [
        'camera viewpoint, focal length, perspective and crop',
        'subject and object screen placement and scale',
        'pose and facing direction',
        'foreground, midground and background depth order',
        'occlusion relationships',
      ],
      reinterpretForFinalFrame: [
        'proxy colors and primitive geometry appearance',
        'materials, textures and surface detail',
        'character identity, face, hair and clothing',
        'environment appearance and generated extras',
      ],
      referencePriority: [
        'layout for spatial composition',
        'target-bound character references for appearance only',
        'background references for location and environment appearance',
        'style references for rendering treatment',
        'user direction for semantic meaning and exceptions',
      ],
    },
    objects,
    potentialOcclusions: potentialOcclusions(objects),
    containment: document.spatialRelations.flatMap((relation) =>
      relation.type === 'contains'
        ? [
            {
              relationId: relation.id,
              containerObjectId: relation.containerObjectId,
              containedObjectId: relation.containedObjectId,
              visibility: relation.visibility,
            },
          ]
        : [],
    ),
    mirrors: document.spatialRelations.flatMap((relation) => {
      if (relation.type !== 'reflects') return [];
      const mirror = document.objects.find(
        ({ id }) => id === relation.mirrorObjectId,
      );
      if (
        mirror === undefined ||
        mirror.kind !== 'plane' ||
        mirror.appearanceIntent.surfaceType !== 'mirror'
      ) {
        return [];
      }
      const layoutMirror = objects.find(
        ({ objectId }) => objectId === mirror.id,
      );
      const plane = getPlanarMirrorWorldPlane(mirror);
      return [
        {
          relationId: relation.id,
          mirrorObjectId: mirror.id,
          reflectedObjectIds: relation.reflectedObjectIds,
          screenBounds: layoutMirror?.screen.bounds ?? null,
          ...plane,
        },
      ];
    }),
    omittedObjectIds: document.objects
      .filter(({ visible, exportable }) => !visible || !exportable)
      .map(({ id }) => id),
  });
}
