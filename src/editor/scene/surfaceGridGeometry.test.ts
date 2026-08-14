import { describe, expect, it } from 'vitest';
import { createSurfaceGridLines } from './surfaceGridGeometry';

describe('surfaceGridGeometry', () => {
  it('builds a bounded 0.5m grid with major lines every 1m', () => {
    const lines = createSurfaceGridLines(2, 2);

    expect(lines).toHaveLength(10);
    expect(lines.filter(({ major }) => major)).toHaveLength(6);
    expect(lines.filter(({ major }) => !major)).toHaveLength(4);
    expect(lines).toContainEqual({
      major: true,
      start: [-1, -1],
      end: [-1, 1],
    });
    expect(lines).toContainEqual({
      major: false,
      start: [-0.5, -1],
      end: [-0.5, 1],
    });
    for (const line of lines) {
      for (const [x, z] of [line.start, line.end]) {
        expect(Math.abs(x)).toBeLessThanOrEqual(1);
        expect(Math.abs(z)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps 0.5m world spacing under non-uniform parent scale', () => {
    const createScaledLines = createSurfaceGridLines as (
      width: number,
      depth: number,
      scale: { x: number; z: number },
    ) => ReturnType<typeof createSurfaceGridLines>;
    const lines = createScaledLines(2, 2, { x: 2, z: 0.5 });
    const verticalWorldX = lines
      .filter(({ start, end }) => start[1] !== end[1])
      .map(({ start }) => start[0] * 2);
    const horizontalWorldZ = lines
      .filter(({ start, end }) => start[0] !== end[0])
      .map(({ start }) => start[1] * 0.5);
    const verticalMajorWorldX = lines
      .filter(({ major, start, end }) => major && start[1] !== end[1])
      .map(({ start }) => start[0] * 2);
    const horizontalMajorWorldZ = lines
      .filter(({ major, start, end }) => major && start[0] !== end[0])
      .map(({ start }) => start[1] * 0.5);

    expect(verticalWorldX).toHaveLength(9);
    expect(horizontalWorldZ).toHaveLength(3);
    expect([verticalWorldX.at(0), verticalWorldX.at(-1)]).toEqual([-2, 2]);
    expect([horizontalWorldZ.at(0), horizontalWorldZ.at(-1)]).toEqual([
      -0.5, 0.5,
    ]);
    expect(verticalMajorWorldX).toEqual([-2, -1, 0, 1, 2]);
    expect(horizontalMajorWorldZ).toEqual([0]);
    for (const coordinates of [verticalWorldX, horizontalWorldZ]) {
      for (let index = 1; index < coordinates.length; index += 1) {
        expect(coordinates[index] - coordinates[index - 1]).toBeCloseTo(0.5, 9);
      }
    }
    for (const coordinates of [verticalMajorWorldX, horizontalMajorWorldZ]) {
      for (let index = 1; index < coordinates.length; index += 1) {
        expect(coordinates[index] - coordinates[index - 1]).toBeCloseTo(1, 9);
      }
    }
    expect(
      lines
        .filter(({ major }) => major)
        .map(({ start }) => [start[0] * 2, start[1] * 0.5]),
    ).toEqual(
      expect.arrayContaining([
        [-2, -0.5],
        [-1, -0.5],
        [0, -0.5],
        [1, -0.5],
        [2, -0.5],
        [-2, 0],
      ]),
    );
  });
});
