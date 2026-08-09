import { Euler, MathUtils, Vector3 } from 'three';
import {
  MANNEQUIN_FORWARD_AXIS,
  computeMannequinCinematicLandmarks,
  type MannequinCinematicLandmarks,
  type MannequinVector3,
} from '../mannequin/mannequinRig';
import type { SceneObject } from '../persistence/sceneSchema';
import {
  getSceneObjectBounds,
  type SceneObjectBounds,
} from '../scene/sceneObjectModel';

export type Vec3 = MannequinVector3;

export interface CinematicSubjectProfile {
  objectId: string;
  bounds: SceneObjectBounds;
  landmarks: MannequinCinematicLandmarks;
  outline: readonly Vec3[];
  basis: {
    forward: Vec3;
    right: Vec3;
    up: Vec3;
    faceForward: Vec3;
  };
}

function plainVector(vector: Vector3): Vec3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function rootRotation(object: SceneObject) {
  return new Euler(
    MathUtils.degToRad(object.transform.rotationDeg.x),
    MathUtils.degToRad(object.transform.rotationDeg.y),
    MathUtils.degToRad(object.transform.rotationDeg.z),
    'XYZ',
  );
}

function localPointToWorld(
  point: Vec3,
  object: SceneObject,
  rotation: Euler,
): Vec3 {
  return plainVector(
    new Vector3(
      point.x * (object.dimensions.x / 0.5) * object.transform.scale.x,
      point.y * (object.dimensions.y / 1.7) * object.transform.scale.y,
      point.z * (object.dimensions.z / 0.3) * object.transform.scale.z,
    )
      .applyEuler(rotation)
      .add(
        new Vector3(
          object.transform.position.x,
          object.transform.position.y,
          object.transform.position.z,
        ),
      ),
  );
}

function localDirectionToWorld(direction: Vec3, rotation: Euler): Vec3 {
  return plainVector(
    new Vector3(direction.x, direction.y, direction.z)
      .applyEuler(rotation)
      .normalize(),
  );
}

export function createCinematicSubjectProfile(
  object: SceneObject,
): CinematicSubjectProfile | null {
  if (object.kind !== 'mannequin' || object.mannequinPose === undefined) {
    return null;
  }

  const rotation = rootRotation(object);
  const localLandmarks = computeMannequinCinematicLandmarks(
    object.mannequinPose,
    object.mannequinBodyType ?? 'standard',
  );
  const landmarks = Object.fromEntries(
    Object.entries(localLandmarks).map(([name, point]) => [
      name,
      name === 'faceForward'
        ? localDirectionToWorld(point, rotation)
        : localPointToWorld(point, object, rotation),
    ]),
  ) as unknown as MannequinCinematicLandmarks;
  const outlineKeys = [
    'headTop',
    'headLeft',
    'headRight',
    'leftShoulder',
    'rightShoulder',
    'leftHand',
    'rightHand',
    'leftHip',
    'rightHip',
    'leftKnee',
    'rightKnee',
    'leftFoot',
    'rightFoot',
  ] as const satisfies readonly (keyof MannequinCinematicLandmarks)[];

  return {
    objectId: object.id,
    bounds: getSceneObjectBounds(object),
    landmarks,
    outline: outlineKeys.map((key) => landmarks[key]),
    basis: {
      forward: localDirectionToWorld(MANNEQUIN_FORWARD_AXIS, rotation),
      right: localDirectionToWorld({ x: 1, y: 0, z: 0 }, rotation),
      up: localDirectionToWorld({ x: 0, y: 1, z: 0 }, rotation),
      faceForward: landmarks.faceForward,
    },
  };
}
