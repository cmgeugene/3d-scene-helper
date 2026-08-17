interface Scale3 {
  x: number;
  y: number;
  z: number;
}

const PLANE_AXES = {
  XY: ['x', 'y'],
  XZ: ['x', 'z'],
  YZ: ['y', 'z'],
} as const;

function ratio(current: number, initial: number) {
  if (!Number.isFinite(initial) || initial === 0) return 1;
  const value = current / initial;
  return Number.isFinite(value) ? value : 1;
}

function keepPositive(value: number) {
  if (!Number.isFinite(value) || value <= 0) return Number.EPSILON;
  return value;
}

export function constrainPlaneScale(
  axis: string | null | undefined,
  initial: Scale3,
  current: Scale3,
): Scale3 {
  if (axis !== 'XY' && axis !== 'XZ' && axis !== 'YZ') return current;

  const [first, second] = PLANE_AXES[axis];
  const firstRatio = ratio(current[first], initial[first]);
  const secondRatio = ratio(current[second], initial[second]);
  const factor =
    Math.abs(firstRatio - 1) >= Math.abs(secondRatio - 1)
      ? firstRatio
      : secondRatio;

  return {
    ...current,
    [first]: keepPositive(initial[first] * factor),
    [second]: keepPositive(initial[second] * factor),
  };
}
