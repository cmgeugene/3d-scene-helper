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
