import { describe, expect, it } from 'vitest';
import {
  PHOTOGRAPHIC_F_STOPS,
  createLensDepthOfFieldSettings,
  getAutoApertureForLens,
  getDepthOfFieldRuntimeParameters,
  getFocusDistanceM,
  getPhotographicFStopAtIndex,
  getPhotographicFStopIndex,
} from './lensDepthOfField';

describe('lens-aware depth of field optics', () => {
  it('exposes a deterministic ordered photographic stop scale with exact lens presets', () => {
    expect(PHOTOGRAPHIC_F_STOPS).toEqual([
      1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9,
      10, 11, 13, 14, 16, 18, 20, 22,
    ]);
    expect(PHOTOGRAPHIC_F_STOPS[0]).toBe(1.4);
    expect(PHOTOGRAPHIC_F_STOPS.at(-1)).toBe(22);
    expect(
      [18, 24, 35, 50, 85].map((lens) =>
        getPhotographicFStopIndex(getAutoApertureForLens(lens)),
      ),
    ).toEqual([15, 12, 9, 6, 3]);
  });

  it('maps slider indices deterministically with endpoint clamping and rejects non-finite values', () => {
    expect(getPhotographicFStopAtIndex(-10)).toBe(1.4);
    expect(getPhotographicFStopAtIndex(0)).toBe(1.4);
    expect(getPhotographicFStopAtIndex(6)).toBe(2.8);
    expect(getPhotographicFStopAtIndex(999)).toBe(22);
    expect(getPhotographicFStopIndex(0.7)).toBe(0);
    expect(getPhotographicFStopIndex(2.7)).toBe(6);
    expect(getPhotographicFStopIndex(30)).toBe(24);
    expect(() => getPhotographicFStopAtIndex(Number.NaN)).toThrow(RangeError);
    expect(() => getPhotographicFStopIndex(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });

  it('uses deterministic automatic aperture presets and derives focus only from camera target', () => {
    expect(
      [18, 24, 35, 50, 85].map((focalLengthMm) =>
        getAutoApertureForLens(focalLengthMm),
      ),
    ).toEqual([8, 5.6, 4, 2.8, 2]);

    const camera = {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 4, y: 6, z: 15 },
      focalLengthMm: 50,
      depthOfField: createLensDepthOfFieldSettings(true),
    };
    expect(getFocusDistanceM(camera)).toBe(13);
    expect(getDepthOfFieldRuntimeParameters(camera)).toMatchObject({
      enabled: true,
      focusDistanceM: 13,
      focalLengthMm: 50,
      fStop: 2.8,
      aperture: 0.002,
    });
  });

  it('rejects unsupported lenses, invalid f-stops, and degenerate/non-finite camera vectors', () => {
    expect(() => getAutoApertureForLens(40)).toThrow(RangeError);
    expect(() =>
      getDepthOfFieldRuntimeParameters({
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        focalLengthMm: 50,
        depthOfField: {
          enabled: true,
          apertureMode: 'manual',
          fStop: 1.3,
        },
      }),
    ).toThrow(RangeError);
    expect(() =>
      getFocusDistanceM({
        position: { x: Number.NaN, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 1 },
      }),
    ).toThrow(RangeError);
  });

  it('maps wider apertures and longer lenses to a restrained stronger blur', () => {
    const at18 = getDepthOfFieldRuntimeParameters({
      position: { x: 0, y: 0, z: -5 },
      target: { x: 0, y: 0, z: 0 },
      focalLengthMm: 18,
      depthOfField: {
        enabled: true,
        apertureMode: 'auto',
        fStop: 8,
      },
    });
    const at85 = getDepthOfFieldRuntimeParameters({
      position: { x: 0, y: 0, z: -5 },
      target: { x: 0, y: 0, z: 0 },
      focalLengthMm: 85,
      depthOfField: {
        enabled: true,
        apertureMode: 'auto',
        fStop: 2,
      },
    });

    expect(at85.aperture).toBeGreaterThan(at18.aperture);
    expect(at85.maxBlur).toBeGreaterThan(at18.maxBlur);
    expect(at18.maxBlur).toBeGreaterThan(0);
    expect(at85.maxBlur).toBeLessThanOrEqual(0.012);
  });
});
