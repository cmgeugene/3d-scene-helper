export const SCENE_DOCUMENT_VERSION = 1 as const;
export const FILM_GAUGE_MM = 36 as const;
export const MANNEQUIN_REFERENCE_HEIGHT_M = 1.7 as const;
export const MAX_SCENE_NOTES_LENGTH = 2000 as const;
export const OUTPUT_DIMENSION_RANGE = { min: 64, max: 4096 } as const;
export const MAX_SHADOW_MAP_SIZE = 1024 as const;

export const RENDER_LAYERS = {
  scene: 0,
  editor: 1,
  reference: 2,
} as const;

export const SAFE_AREA_INSETS = {
  action: 0.05,
  title: 0.1,
} as const;

export const ASPECT_RATIO_VALUES = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '2.39:1': 2.39,
} as const;

export const STORAGE_NAMESPACE = 'i2v-3d-scene-helper' as const;
export const SCENE_STORAGE_KEY = `${STORAGE_NAMESPACE}:scene:v${SCENE_DOCUMENT_VERSION}`;
