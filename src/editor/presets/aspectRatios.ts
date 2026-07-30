import { ASPECT_RATIO_VALUES } from '../constants';
import type { SceneDocument } from '../persistence/sceneSchema';

export type AspectRatioId = SceneDocument['output']['aspectRatioId'];

export interface AspectRatioPreset {
  id: AspectRatioId;
  label: string;
  value: number;
  defaultOutput: {
    width: number;
    height: number;
  };
}

export const ASPECT_RATIO_PRESETS = [
  {
    id: '16:9',
    label: '16:9',
    value: ASPECT_RATIO_VALUES['16:9'],
    defaultOutput: { width: 1920, height: 1080 },
  },
  {
    id: '9:16',
    label: '9:16',
    value: ASPECT_RATIO_VALUES['9:16'],
    defaultOutput: { width: 1080, height: 1920 },
  },
  {
    id: '1:1',
    label: '1:1',
    value: ASPECT_RATIO_VALUES['1:1'],
    defaultOutput: { width: 1080, height: 1080 },
  },
  {
    id: '2.39:1',
    label: '2.39:1',
    value: ASPECT_RATIO_VALUES['2.39:1'],
    defaultOutput: { width: 1920, height: 804 },
  },
] as const satisfies readonly AspectRatioPreset[];
