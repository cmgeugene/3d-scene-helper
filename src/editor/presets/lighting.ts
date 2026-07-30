import { MAX_SHADOW_MAP_SIZE } from '../constants';
import type { SceneDocument } from '../persistence/sceneSchema';

type LightingValue = SceneDocument['lighting'];

export interface LightingPreset {
  id: LightingValue['presetId'];
  label: string;
  backgroundColor: SceneDocument['background']['color'];
  value: LightingValue;
}

export const LIGHTING_PRESETS = [
  {
    id: 'neutral-studio',
    label: '중립 스튜디오',
    backgroundColor: '#d8d8d8',
    value: {
      presetId: 'neutral-studio',
      environmentIntensity: 0.35,
      key: { color: '#ffffff', intensity: 1, direction: { x: 1, y: 2, z: 1 } },
      fill: {
        color: '#dce7ff',
        intensity: 0.5,
        direction: { x: -1, y: 1, z: 1 },
      },
      rim: {
        color: '#ffffff',
        intensity: 0.35,
        direction: { x: 0, y: 1, z: -1 },
      },
      exposure: 1,
      shadows: { enabled: true, softness: 0.5, mapSize: MAX_SHADOW_MAP_SIZE },
    },
  },
  {
    id: 'daylight',
    label: '주광',
    backgroundColor: '#bcdcff',
    value: {
      presetId: 'daylight',
      environmentIntensity: 0.55,
      key: {
        color: '#fff7df',
        intensity: 1.2,
        direction: { x: -1, y: 2, z: 1 },
      },
      fill: {
        color: '#b8d8ff',
        intensity: 0.45,
        direction: { x: 1, y: 1, z: 0 },
      },
      rim: {
        color: '#ffffff',
        intensity: 0.25,
        direction: { x: 0, y: 1, z: -1 },
      },
      exposure: 1,
      shadows: { enabled: true, softness: 0.35, mapSize: MAX_SHADOW_MAP_SIZE },
    },
  },
  {
    id: 'sunset',
    label: '일몰',
    backgroundColor: '#6f4058',
    value: {
      presetId: 'sunset',
      environmentIntensity: 0.25,
      key: {
        color: '#ff9a5c',
        intensity: 1.3,
        direction: { x: -1, y: 1, z: 1 },
      },
      fill: {
        color: '#7356a8',
        intensity: 0.35,
        direction: { x: 1, y: 1, z: 0 },
      },
      rim: {
        color: '#ffd4a3',
        intensity: 0.55,
        direction: { x: 0, y: 1, z: -1 },
      },
      exposure: 1,
      shadows: { enabled: true, softness: 0.6, mapSize: MAX_SHADOW_MAP_SIZE },
    },
  },
  {
    id: 'night',
    label: '야간',
    backgroundColor: '#10172b',
    value: {
      presetId: 'night',
      environmentIntensity: 0.15,
      key: {
        color: '#8fb8ff',
        intensity: 0.75,
        direction: { x: 1, y: 2, z: 1 },
      },
      fill: {
        color: '#384b73',
        intensity: 0.25,
        direction: { x: -1, y: 1, z: 0 },
      },
      rim: {
        color: '#b9d5ff',
        intensity: 0.65,
        direction: { x: 0, y: 1, z: -1 },
      },
      exposure: 0.9,
      shadows: { enabled: true, softness: 0.45, mapSize: MAX_SHADOW_MAP_SIZE },
    },
  },
  {
    id: 'cinematic-backlight',
    label: '시네마틱 역광',
    backgroundColor: '#24232b',
    value: {
      presetId: 'cinematic-backlight',
      environmentIntensity: 0.2,
      key: {
        color: '#ffd1a3',
        intensity: 0.65,
        direction: { x: 1, y: 1, z: 1 },
      },
      fill: {
        color: '#6d83b5',
        intensity: 0.3,
        direction: { x: -1, y: 1, z: 0 },
      },
      rim: {
        color: '#fff1d6',
        intensity: 1.4,
        direction: { x: 0, y: 1, z: -1 },
      },
      exposure: 1,
      shadows: { enabled: true, softness: 0.55, mapSize: MAX_SHADOW_MAP_SIZE },
    },
  },
] as const satisfies readonly LightingPreset[];
