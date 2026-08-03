import type { LayoutSpec } from './layoutSpecSchema';

export const TEST_LAYOUT_SPEC: LayoutSpec = {
  version: 1,
  sceneId: 'scene-test',
  output: { width: 1920, height: 1080, aspectRatioId: '16:9' },
  camera: {
    position: { x: 0, y: 1.6, z: -5 },
    target: { x: 0, y: 1.6, z: 0 },
    focalLengthMm: 50,
    rollDeg: 0,
    targetDistanceMeters: 5,
  },
  authority: {
    preserveFromLayout: ['camera', 'screen placement', 'depth and occlusion'],
    reinterpretForFinalFrame: ['proxy appearance'],
    referencePriority: ['layout for composition'],
  },
  objects: [],
  potentialOcclusions: [],
  omittedObjectIds: [],
};
