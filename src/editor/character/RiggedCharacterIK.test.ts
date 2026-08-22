import { Bone, Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { solveRiggedCharacterIkChain } from './riggedCharacterIkSolver';

describe('solveRiggedCharacterIkChain', () => {
  it('두 관절 체인의 effector를 목표점으로 이동시킨다', () => {
    const scene = new Group();
    const root = new Bone();
    const middle = new Bone();
    const effector = new Bone();
    middle.position.set(1, 0, 0);
    effector.position.set(1, 0, 0);
    scene.add(root);
    root.add(middle);
    middle.add(effector);
    scene.updateWorldMatrix(true, true);
    const target = new Vector3(1, 1, 0);
    const before = effector.getWorldPosition(new Vector3()).distanceTo(target);

    solveRiggedCharacterIkChain({ root, middle, effector }, target, 12);

    const after = effector.getWorldPosition(new Vector3()).distanceTo(target);
    expect(after).toBeLessThan(before * 0.01);
  });
});
