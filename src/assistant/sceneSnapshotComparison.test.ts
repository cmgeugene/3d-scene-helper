import { describe, expect, it } from 'vitest';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';
import { compareSceneDocuments } from './sceneSnapshotComparison';

function documents() {
  const snapshot = createStarterSceneDocument({
    documentId: 'scene-test',
    floorId: 'floor-test',
    mannequinId: 'person-test',
  });
  return { snapshot, current: structuredClone(snapshot) };
}

describe('compareSceneDocuments', () => {
  it('위치가 같아도 camera target과 roll 변경값을 구체적으로 설명한다', () => {
    const { snapshot, current } = documents();
    current.outputCamera.target.x = 1.25;
    current.outputCamera.rollDeg = 9;

    const camera = compareSceneDocuments(current, snapshot).differences.find(
      ({ id }) => id === 'camera',
    );

    expect(camera?.detail).toContain('target');
    expect(camera?.detail).toContain('(0, 1.6, 0) → 현재 (1.25, 1.6, 0)');
    expect(camera?.detail).toContain('roll');
    expect(camera?.detail).toContain('0° → 현재 9°');
    expect(camera?.detail).not.toContain('위치');
  });

  it('object 회전·크기·dimensions와 의미 메모의 실제 변경값을 설명한다', () => {
    const { snapshot, current } = documents();
    const object = current.objects.find(({ id }) => id === 'person-test')!;
    object.transform.rotationDeg.y = 45;
    object.transform.scale = { x: 1.2, y: 1.1, z: 0.9 };
    object.dimensions.x = 1.5;
    object.semantic = {
      meaning: '정민',
      generationNotes: '빨간 모자를 유지',
    };

    const differences = compareSceneDocuments(current, snapshot).differences;
    const transform = differences.find(
      ({ id }) => id === 'transform:person-test',
    );
    const semantic = differences.find(
      ({ id }) => id === 'semantic:person-test',
    );

    expect(transform?.detail).toContain('회전');
    expect(transform?.detail).toContain('(0, 0, 0) → 현재 (0, 45, 0)');
    expect(transform?.detail).toContain('scale');
    expect(transform?.detail).toContain('dimensions');
    expect(semantic?.detail).toContain('의미');
    expect(semantic?.detail).toContain('정민');
    expect(semantic?.detail).toContain('생성 메모');
    expect(semantic?.detail).toContain('빨간 모자를 유지');
  });

  it('scene name과 object kind/appearance 변경을 누락하지 않는다', () => {
    const { snapshot, current } = documents();
    current.name = '현재 장면';
    const object = current.objects.find(({ id }) => id === 'floor-test')!;
    object.kind = 'cube';
    object.name = '현재 상자';
    object.color = '#ff0000';
    object.visible = false;
    object.exportable = false;

    const differences = compareSceneDocuments(current, snapshot).differences;

    expect(differences.find(({ id }) => id === 'scene-name')?.detail).toContain(
      '현재 장면',
    );
    const appearance = differences.find(
      ({ id }) => id === 'appearance:floor-test',
    );
    expect(appearance?.detail).toContain('종류');
    expect(appearance?.detail).toContain('이름');
    expect(appearance?.detail).toContain('색상');
    expect(appearance?.detail).toContain('가시성');
    expect(appearance?.detail).toContain('출력 포함');
  });
});
