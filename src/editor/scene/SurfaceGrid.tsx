import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Vector3,
  type LineSegments,
} from 'three';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import {
  createSurfaceGridLines,
  type SurfaceGridLine,
} from './surfaceGridGeometry';

type SurfaceGridKind = 'floor' | 'room' | 'cube' | 'plane';

interface SurfaceGridProps {
  color: string;
  depth: number;
  kind: SurfaceGridKind;
  parentScale: Readonly<{ x: number; z: number }>;
  positionY: number;
  width: number;
}

const mountedGridKinds = new WeakMap<
  HTMLCanvasElement,
  Map<SurfaceGridKind, number>
>();
const mountedGridLineCounts = new WeakMap<
  HTMLCanvasElement,
  Map<SurfaceGridKind, Map<object, number>>
>();
const GRID_KIND_ORDER: readonly SurfaceGridKind[] = [
  'floor',
  'room',
  'cube',
  'plane',
];
const SURFACE_GRID_VISIBILITY_EVENT = 'i2v:e2e-surface-grid-visibility';

function publishGridKinds(
  runtimeCanvas: HTMLCanvasElement,
  kind: SurfaceGridKind,
  delta: 1 | -1,
) {
  const counts = mountedGridKinds.get(runtimeCanvas) ?? new Map();
  const nextCount = Math.max(0, (counts.get(kind) ?? 0) + delta);
  if (nextCount === 0) counts.delete(kind);
  else counts.set(kind, nextCount);
  if (counts.size === 0) {
    mountedGridKinds.delete(runtimeCanvas);
    delete runtimeCanvas.dataset.surfaceGridKinds;
    return;
  }
  mountedGridKinds.set(runtimeCanvas, counts);
  runtimeCanvas.dataset.surfaceGridKinds = GRID_KIND_ORDER.filter(
    (candidate) => (counts.get(candidate) ?? 0) > 0,
  ).join(',');
}

function publishGridLineCount(
  runtimeCanvas: HTMLCanvasElement,
  kind: SurfaceGridKind,
  instance: object,
  lineCount: number | null,
) {
  const countsByKind = mountedGridLineCounts.get(runtimeCanvas) ?? new Map();
  const counts = countsByKind.get(kind) ?? new Map<object, number>();
  if (lineCount === null) counts.delete(instance);
  else counts.set(instance, lineCount);
  if (counts.size === 0) countsByKind.delete(kind);
  else countsByKind.set(kind, counts);
  if (countsByKind.size === 0) mountedGridLineCounts.delete(runtimeCanvas);
  else mountedGridLineCounts.set(runtimeCanvas, countsByKind);

  const total = [...(countsByKind.get(kind)?.values() ?? [])].reduce(
    (sum, count) => sum + count,
    0,
  );
  const datasetKey = `${kind}GridLineCount` as const;
  if (total === 0) delete runtimeCanvas.dataset[datasetKey];
  else runtimeCanvas.dataset[datasetKey] = String(total);
}

function createLineGeometry(lines: readonly SurfaceGridLine[], major: boolean) {
  const positions: number[] = [];
  for (const line of lines) {
    if (line.major !== major) continue;
    positions.push(line.start[0], 0, line.start[1]);
    positions.push(line.end[0], 0, line.end[1]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function gridColors(surfaceColor: string) {
  const base = new Color(surfaceColor);
  const contrast = new Color(
    base.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45 ? '#24364d' : '#dbe8f2',
  );
  return {
    major: `#${base.clone().lerp(contrast, 0.82).getHexString()}`,
    minor: `#${base.clone().lerp(contrast, 0.56).getHexString()}`,
  };
}

export function SurfaceGrid({
  color,
  depth,
  kind,
  parentScale,
  positionY,
  width,
}: SurfaceGridProps) {
  const runtimeCanvas = useThree((state) => state.gl.domElement);
  const groupRef = useRef<Group>(null);
  const worldScale = useMemo(() => new Vector3(), []);
  const instance = useMemo(() => ({}), []);
  const [effectiveScale, setEffectiveScale] = useState(() => ({
    x: Math.abs(parentScale.x),
    z: Math.abs(parentScale.z),
  }));
  const lines = useMemo(
    () => createSurfaceGridLines(width, depth, effectiveScale),
    [depth, effectiveScale, width],
  );
  const majorGeometry = useMemo(() => createLineGeometry(lines, true), [lines]);
  const minorGeometry = useMemo(
    () => createLineGeometry(lines, false),
    [lines],
  );
  const colors = useMemo(() => gridColors(color), [color]);

  useFrame(() => {
    const group = groupRef.current;
    if (group === null) return;
    group.getWorldScale(worldScale);
    const x = Math.abs(worldScale.x);
    const z = Math.abs(worldScale.z);
    setEffectiveScale((current) =>
      Math.abs(current.x - x) < 1e-4 && Math.abs(current.z - z) < 1e-4
        ? current
        : { x, z },
    );
  });

  useLayoutEffect(() => {
    return () => {
      majorGeometry.dispose();
      minorGeometry.dispose();
    };
  }, [majorGeometry, minorGeometry]);

  useLayoutEffect(() => {
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
    publishGridKinds(runtimeCanvas, kind, 1);
    return () => publishGridKinds(runtimeCanvas, kind, -1);
  }, [kind, runtimeCanvas]);

  useLayoutEffect(() => {
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
    publishGridLineCount(runtimeCanvas, kind, instance, lines.length);
    return () => publishGridLineCount(runtimeCanvas, kind, instance, null);
  }, [instance, kind, lines.length, runtimeCanvas]);

  useLayoutEffect(() => {
    if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
    const setTestVisibility = (event: Event) => {
      const visible = (event as CustomEvent<{ visible?: unknown }>).detail
        ?.visible;
      if (typeof visible === 'boolean' && groupRef.current !== null) {
        groupRef.current.visible = visible;
      }
    };
    runtimeCanvas.addEventListener(
      SURFACE_GRID_VISIBILITY_EVENT,
      setTestVisibility,
    );
    return () =>
      runtimeCanvas.removeEventListener(
        SURFACE_GRID_VISIBILITY_EVENT,
        setTestVisibility,
      );
  }, [runtimeCanvas]);

  const common = {
    dispose: null,
    position: [0, positionY, 0] as const,
    raycast: (() => undefined) as LineSegments['raycast'],
  };

  return (
    <group ref={groupRef} name={`${kind}.surface-grid`}>
      <lineSegments {...common} geometry={minorGeometry} renderOrder={2}>
        <lineBasicMaterial
          color={colors.minor}
          transparent
          opacity={0.62}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <lineSegments {...common} geometry={majorGeometry} renderOrder={3}>
        <lineBasicMaterial
          color={colors.major}
          transparent
          opacity={0.92}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
