import { Bone, Quaternion, Vector3 } from 'three';

export interface BoneChain {
  root: Bone;
  middle: Bone;
  effector: Bone;
}

const jointWorld = new Vector3();
const effectorWorld = new Vector3();
const towardEffector = new Vector3();
const towardTarget = new Vector3();
const parentWorldQuaternion = new Quaternion();
const parentWorldInverse = new Quaternion();
const worldDelta = new Quaternion();
const localDelta = new Quaternion();

export function solveRiggedCharacterIkChain(
  chain: BoneChain,
  target: Vector3,
  iterations = 8,
) {
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const joint of [chain.middle, chain.root]) {
      joint.getWorldPosition(jointWorld);
      chain.effector.getWorldPosition(effectorWorld);
      towardEffector.copy(effectorWorld).sub(jointWorld);
      towardTarget.copy(target).sub(jointWorld);
      if (
        towardEffector.lengthSq() < 1e-10 ||
        towardTarget.lengthSq() < 1e-10
      ) {
        continue;
      }
      towardEffector.normalize();
      towardTarget.normalize();
      worldDelta.setFromUnitVectors(towardEffector, towardTarget);
      if (joint.parent === null) parentWorldQuaternion.identity();
      else joint.parent.getWorldQuaternion(parentWorldQuaternion);
      parentWorldInverse.copy(parentWorldQuaternion).invert();
      localDelta
        .copy(parentWorldInverse)
        .multiply(worldDelta)
        .multiply(parentWorldQuaternion);
      joint.quaternion.premultiply(localDelta).normalize();
      joint.updateWorldMatrix(true, true);
    }
  }
}
