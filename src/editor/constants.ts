export const SCENE_DOCUMENT_VERSION = 2 as const;
export const FILM_GAUGE_MM = 36 as const;
export const MANNEQUIN_REFERENCE_HEIGHT_M = 1.7 as const;
export const MAX_SCENE_NOTES_LENGTH = 2000 as const;
export const MAX_OBJECT_NAME_LENGTH = 120 as const;
export const MAX_SEMANTIC_MEANING_LENGTH = 240 as const;
export const MAX_GENERATION_NOTES_LENGTH = 1000 as const;
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
export const LEGACY_SCENE_STORAGE_KEYS = [
  `${STORAGE_NAMESPACE}:scene:v1`,
] as const;
export const MAX_SCENE_STORAGE_BYTES = 4 * 1024 * 1024;
export const AUTOSAVE_DEBOUNCE_MS = 500 as const;
export const ASSISTANT_PANEL_WIDTH_STORAGE_KEY = `${STORAGE_NAMESPACE}:assistant-panel-width:v1`;
export const ASSISTANT_PANEL_COLLAPSED_STORAGE_KEY = `${STORAGE_NAMESPACE}:assistant-panel-collapsed:v1`;
export const ASSISTANT_PANEL_DEFAULT_WIDTH = 420 as const;
export const ASSISTANT_PANEL_MIN_WIDTH = 320 as const;
export const ASSISTANT_PANEL_MAX_WIDTH = 720 as const;
export const ASSISTANT_PANEL_MAX_VIEWPORT_RATIO = 0.45 as const;
