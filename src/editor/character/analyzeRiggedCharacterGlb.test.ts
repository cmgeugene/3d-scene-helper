import { describe, expect, it } from 'vitest';
import { Bone, Group } from 'three';
import {
  analyzeRiggedCharacterGlb,
  detectHumanoidIkBoneMap,
} from './analyzeRiggedCharacterGlb';

describe('analyzeRiggedCharacterGlb', () => {
  it('GLB 확장자가 아닌 파일을 즉시 거부한다', async () => {
    await expect(
      analyzeRiggedCharacterGlb(new File(['x'], 'character.fbx')),
    ).rejects.toThrow('GLB 파일만');
  });

  it('Meshy/Mixamo 방식의 휴머노이드 팔·다리 체인을 찾는다', () => {
    const scene = new Group();
    const names = [
      'mixamorigLeftArm',
      'mixamorigLeftForeArm',
      'mixamorigLeftHand',
      'mixamorigRightArm',
      'mixamorigRightForeArm',
      'mixamorigRightHand',
      'mixamorigLeftUpLeg',
      'mixamorigLeftLeg',
      'mixamorigLeftFoot',
      'mixamorigRightUpLeg',
      'mixamorigRightLeg',
      'mixamorigRightFoot',
    ];
    for (const name of names) {
      const bone = new Bone();
      bone.name = name;
      scene.add(bone);
    }

    expect(detectHumanoidIkBoneMap(scene)).toMatchObject({
      leftHand: {
        root: 'mixamorigLeftArm',
        middle: 'mixamorigLeftForeArm',
        effector: 'mixamorigLeftHand',
      },
      rightFoot: {
        root: 'mixamorigRightUpLeg',
        middle: 'mixamorigRightLeg',
        effector: 'mixamorigRightFoot',
      },
    });
  });
});
