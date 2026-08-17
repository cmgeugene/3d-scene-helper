import { describe, expect, it } from 'vitest';
import { constrainPlaneScale } from './planeScaleConstraint';

describe('constrainPlaneScale', () => {
  it('keeps XY plane scale factors equal from the dominant drag axis', () => {
    expect(
      constrainPlaneScale('XY', { x: 1, y: 1, z: 2 }, { x: 1.5, y: 6, z: 2 }),
    ).toEqual({ x: 6, y: 6, z: 2 });
  });

  it('scales XZ and YZ planes together without changing the unused axis', () => {
    expect(
      constrainPlaneScale('XZ', { x: 2, y: 3, z: 2 }, { x: 3, y: 3, z: 4 }),
    ).toEqual({ x: 4, y: 3, z: 4 });
    expect(
      constrainPlaneScale('YZ', { x: 2, y: 1, z: 1 }, { x: 2, y: 2, z: 1.25 }),
    ).toEqual({ x: 2, y: 2, z: 2 });
  });

  it('leaves single-axis and XYZ uniform scales unchanged', () => {
    const current = { x: 1.2, y: 3, z: 0.8 };
    expect(constrainPlaneScale('X', { x: 1, y: 1, z: 1 }, current)).toEqual(
      current,
    );
    expect(constrainPlaneScale('XYZ', { x: 1, y: 1, z: 1 }, current)).toEqual(
      current,
    );
    expect(constrainPlaneScale(null, { x: 1, y: 1, z: 1 }, current)).toEqual(
      current,
    );
  });
});
