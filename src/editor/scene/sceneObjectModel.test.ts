import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../persistence/sceneSchema';
import {
  getNextAssetPosition,
  getSceneObjectBounds,
  getSceneObjectModel,
} from './sceneObjectModel';

describe('sceneObjectModel', () => {
  it.each([
    ['floor', 'box'],
    ['cube', 'box'],
    ['sphere', 'sphere'],
    ['cylinder', 'cylinder'],
    ['plane', 'plane'],
    ['rounded-cube', 'rounded-cube'],
    ['bent-plane', 'bent-plane'],
    ['mannequin', 'mannequin'],
    ['room', 'room'],
  ] as const)('%s 문서 종류를 %s runtime model로 매핑한다', (kind, model) => {
    const object = createSceneObject(`object-${kind}`, { kind });

    expect(getSceneObjectModel(object)).toEqual({
      geometry: model,
      displayName: object.name,
      testName: `scene-object:${object.id}`,
      castShadow: kind !== 'floor' && kind !== 'plane',
      receiveShadow: true,
    });
  });

  it('직렬화 transform과 dimensions에서 회전을 포함한 world bounds를 계산한다', () => {
    const object = createSceneObject('cube-bounds', { kind: 'cube' });
    object.transform = {
      position: { x: 2, y: 1, z: -3 },
      rotationDeg: { x: 0, y: 90, z: 0 },
      scale: { x: 2, y: 0.5, z: 3 },
    };

    expect(getSceneObjectBounds(object)).toEqual({
      min: { x: 0.5, y: 0.75, z: -4 },
      max: { x: 3.5, y: 1.25, z: -2 },
      size: { x: 3, y: 0.5, z: 2 },
      center: { x: 2, y: 1, z: -3 },
    });
  });

  it('기본 마네킹 bounds 높이를 정확히 1.7m로 유지한다', () => {
    const mannequin = createSceneObject('mannequin-bounds', {
      kind: 'mannequin',
    });

    expect(getSceneObjectBounds(mannequin).size.y).toBe(1.7);
    expect(getSceneObjectBounds(mannequin).min.y).toBeCloseTo(0);
    expect(getSceneObjectBounds(mannequin).max.y).toBeCloseTo(1.7);
  });

  it('체형별 절차형 실루엣을 frame/selection bounds에 반영한다', () => {
    const standard = createSceneObject('standard-mannequin-bounds', {
      kind: 'mannequin',
    });
    const athletic = createSceneObject('athletic-mannequin-bounds', {
      kind: 'mannequin',
    });
    const heavy = createSceneObject('heavy-mannequin-bounds', {
      kind: 'mannequin',
    });
    athletic.mannequinBodyType = 'athletic';
    athletic.dimensions.y = 1.8;
    heavy.mannequinBodyType = 'heavy';

    const standardBounds = getSceneObjectBounds(standard);
    const athleticBounds = getSceneObjectBounds(athletic);
    const heavyBounds = getSceneObjectBounds(heavy);

    expect(athleticBounds.size.x).toBeGreaterThan(standardBounds.size.x + 0.01);
    expect(heavyBounds.size.x).toBeGreaterThan(standardBounds.size.x + 0.01);
    expect(heavyBounds.size.z).toBeGreaterThan(athleticBounds.size.z + 0.03);
    expect(athleticBounds.size.y).toBeCloseTo(1.8, 10);
    expect(heavyBounds.size.y).toBeCloseTo(standardBounds.size.y, 10);
  });

  it('마네킹 pose의 비대칭 local envelope를 root transform한 world bounds로 사용한다', () => {
    const mannequin = createSceneObject('posed-mannequin-bounds', {
      kind: 'mannequin',
    });
    if (mannequin.mannequinPose === undefined) throw new Error('pose required');
    mannequin.mannequinPose.id = 't';
    mannequin.mannequinPose.arms.left.shoulderRotationDeg.z = -90;
    mannequin.mannequinPose.arms.right.shoulderRotationDeg.z = 90;
    mannequin.mannequinPose.arms.left.elbowBendDeg = 0;
    mannequin.mannequinPose.arms.right.elbowBendDeg = 0;
    mannequin.transform.position = { x: 2, y: 1, z: -3 };
    mannequin.transform.scale = { x: 1.5, y: 1, z: 1 };

    const bounds = getSceneObjectBounds(mannequin);

    expect(bounds.size.x).toBeGreaterThan(2.2);
    expect(bounds.min.x).toBeLessThan(0.9);
    expect(bounds.max.x).toBeGreaterThan(3.1);
    expect(bounds.center.z).toBeLessThan(-3);
  });

  it('occupied meter positions를 피해 deterministic visible slot을 고른다', () => {
    const mannequin = createSceneObject('starter-mannequin', {
      kind: 'mannequin',
    });
    const leftObject = createSceneObject('left-object', { kind: 'cube' });
    leftObject.transform.position.x = -1.1;

    expect(getNextAssetPosition([mannequin])).toEqual({ x: -1.1, z: 0 });
    expect(getNextAssetPosition([mannequin, leftObject])).toEqual({
      x: 1.1,
      z: 0,
    });
    expect(getNextAssetPosition([mannequin])).toEqual({ x: -1.1, z: 0 });
  });

  it('기본 slot 수를 넘어도 이미 점유된 위치를 재사용하지 않는다', () => {
    const objects = [];
    const positions: Array<{ x: number; z: number }> = [];

    for (let index = 0; index < 20; index += 1) {
      const position = getNextAssetPosition(objects);
      positions.push(position);
      const object = createSceneObject(`object-${index}`, { kind: 'cube' });
      object.transform.position.x = position.x;
      object.transform.position.z = position.z;
      objects.push(object);
    }

    expect(new Set(positions.map(({ x, z }) => `${x}:${z}`)).size).toBe(20);
  });
});
