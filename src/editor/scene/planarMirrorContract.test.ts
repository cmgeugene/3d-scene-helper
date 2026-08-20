import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../persistence/sceneSchema';
import { getPlanarMirrorWorldPlane } from './planarMirrorContract';

describe('getPlanarMirrorWorldPlane', () => {
  it('plane local +Y normal을 object rotation과 같은 world 방향으로 변환한다', () => {
    const mirror = createSceneObject('mirror', { kind: 'plane' });
    mirror.appearanceIntent.surfaceType = 'mirror';
    mirror.transform.position = { x: 1, y: 2, z: 3 };
    mirror.transform.rotationDeg.x = -90;

    expect(getPlanarMirrorWorldPlane(mirror)).toEqual({
      pointWorld: { x: 1, y: 2, z: 3 },
      normalWorld: { x: 0, y: 0, z: -1 },
    });
  });
});
