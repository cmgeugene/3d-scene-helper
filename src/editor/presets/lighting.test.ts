import { describe, expect, it } from 'vitest';
import { MAX_SHADOW_MAP_SIZE } from '../constants';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import { applyLightingPreset, LIGHTING_PRESETS } from './lighting';

const IDS = {
  documentId: 'lighting-test',
  floorId: 'lighting-floor',
  mannequinId: 'lighting-mannequin',
};

describe('lighting presets', () => {
  it('five restrained presets are unique, bounded, and serializable', () => {
    expect(LIGHTING_PRESETS.map(({ id }) => id)).toEqual([
      'neutral-studio',
      'daylight',
      'sunset',
      'night',
      'cinematic-backlight',
    ]);
    expect(
      new Set(
        LIGHTING_PRESETS.map((preset) =>
          JSON.stringify({
            lighting: preset.value,
            backgroundColor: preset.backgroundColor,
          }),
        ),
      ).size,
    ).toBe(5);

    for (const preset of LIGHTING_PRESETS) {
      expect(preset.value.environmentIntensity).toBeGreaterThan(0);
      expect(preset.value.exposure).toBeGreaterThan(0);
      expect(preset.value.shadows.mapSize).toBeLessThanOrEqual(
        MAX_SHADOW_MAP_SIZE,
      );
      expect(() => structuredClone(preset.value)).not.toThrow();
    }
  });

  it('applies a preset without mutating the input, camera, objects, or preset constants', () => {
    const document = createStarterSceneDocument(IDS);
    const original = structuredClone(document);
    const presetBefore = structuredClone(LIGHTING_PRESETS[2]);

    const next = applyLightingPreset(document, 'sunset');

    expect(next).not.toBe(document);
    expect(next.lighting).toEqual(LIGHTING_PRESETS[2].value);
    expect(next.background.color).toBe(LIGHTING_PRESETS[2].backgroundColor);
    expect(next.outputCamera).toEqual(original.outputCamera);
    expect(next.objects).toEqual(original.objects);
    expect(document).toEqual(original);

    next.lighting.key.direction.x = 99;
    expect(LIGHTING_PRESETS[2]).toEqual(presetBefore);
    expect(document.lighting.key.direction.x).toBe(
      original.lighting.key.direction.x,
    );
  });

  it('rejects an unknown preset without changing the source document', () => {
    const document = createStarterSceneDocument(IDS);
    const original = structuredClone(document);

    expect(() => applyLightingPreset(document, 'horror')).toThrow(RangeError);
    expect(document).toEqual(original);
  });
});
