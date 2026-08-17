import { Color } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  MANNEQUIN_FOCUS_CONTOUR_POLICY,
  createMannequinFocusContourMaterialSet,
  disposeMannequinFocusContourMaterialSet,
  getMannequinFocusContourColor,
  getMannequinFocusContourMaterialState,
  setMannequinFocusContourMaterialSetEnabled,
} from './mannequinFocusContours';

interface TestShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function createShaderDouble(): TestShader {
  return {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader:
      '#include <common>\nvoid main() {\nvec4 diffuseColor = vec4( diffuse, opacity );\n#include <color_fragment>\n}',
  };
}

describe('mannequin focus contour materials', () => {
  it('uses restrained finite physical spacing, widths, and tint-preserving charcoal blend', () => {
    expect(MANNEQUIN_FOCUS_CONTOUR_POLICY).toMatchObject({
      axialSpacingM: 0.1,
      limbSpacingM: 0.0725,
      colorBlend: 0.42,
    });
    for (const value of Object.values(MANNEQUIN_FOCUS_CONTOUR_POLICY)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
    expect(MANNEQUIN_FOCUS_CONTOUR_POLICY.axialLineWidthM).toBeLessThan(
      MANNEQUIN_FOCUS_CONTOUR_POLICY.axialSpacingM * 0.1,
    );
    expect(MANNEQUIN_FOCUS_CONTOUR_POLICY.limbLineWidthM).toBeLessThan(
      MANNEQUIN_FOCUS_CONTOUR_POLICY.limbSpacingM * 0.1,
    );

    const redTint = getMannequinFocusContourColor('#cc3333');
    const grayTint = getMannequinFocusContourColor('#a8a8a8');
    expect(redTint.equals(grayTint)).toBe(false);
    expect(redTint.r).toBeGreaterThan(redTint.g);
    expect(redTint.r).toBeGreaterThan(new Color('#30343a').r);
  });

  it('owns stable per-instance standard materials and toggles uniforms without recompilation', () => {
    const first = createMannequinFocusContourMaterialSet('#cc3333', '#b82e2e');
    const second = createMannequinFocusContourMaterialSet('#a8a8a8', '#979797');

    expect(first.axial).not.toBe(second.axial);
    expect(first.limb).not.toBe(second.limb);
    expect(first.joint).not.toBe(second.joint);
    expect(first.axial.roughness).toBe(0.58);
    expect(first.axial.metalness).toBe(0.015);
    expect(first.axial.emissiveIntensity).toBe(0.06);
    expect(first.axial.customProgramCacheKey()).toBe(
      second.axial.customProgramCacheKey(),
    );
    expect(first.limb.customProgramCacheKey()).toBe(
      second.limb.customProgramCacheKey(),
    );
    expect(first.axial.customProgramCacheKey()).not.toBe(
      first.limb.customProgramCacheKey(),
    );

    const beforeVersion = first.axial.version;
    setMannequinFocusContourMaterialSetEnabled(first, true);
    expect(getMannequinFocusContourMaterialState(first.axial).enabled).toBe(
      true,
    );
    expect(getMannequinFocusContourMaterialState(first.limb).enabled).toBe(
      true,
    );
    expect(getMannequinFocusContourMaterialState(first.joint).enabled).toBe(
      true,
    );
    expect(first.axial.version).toBe(beforeVersion);
    setMannequinFocusContourMaterialSetEnabled(first, true);
    expect(first.axial.version).toBe(beforeVersion);

    disposeMannequinFocusContourMaterialSet(first);
    disposeMannequinFocusContourMaterialSet(second);
  });

  it('injects local-space antialiased bands before lighting and keeps the axial centerline bounded to front surfaces', () => {
    const materials = createMannequinFocusContourMaterialSet(
      '#a8a8a8',
      '#979797',
    );
    const axialShader = createShaderDouble();
    const limbShader = createShaderDouble();

    materials.axial.onBeforeCompile(axialShader as never, {} as never);
    materials.limb.onBeforeCompile(limbShader as never, {} as never);

    expect(axialShader.vertexShader).toContain('vMannequinContourPosition');
    expect(axialShader.vertexShader).toContain(
      'length( modelMatrix[ 0 ].xyz )',
    );
    expect(axialShader.fragmentShader).toContain('fwidth');
    expect(axialShader.fragmentShader).toContain('focusContourCenterline');
    expect(axialShader.fragmentShader).toContain('focusContourFrontMask');
    expect(limbShader.fragmentShader).toContain('focusContourBand');
    expect(limbShader.fragmentShader).not.toContain('focusContourCenterline');
    expect(axialShader.uniforms.uFocusContourEnabled?.value).toBe(0);
    expect(axialShader.uniforms.uFocusContourSpacingM?.value).toBe(0.1);

    disposeMannequinFocusContourMaterialSet(materials);
  });

  it('disposes every owned material exactly once through the explicit lifecycle boundary', () => {
    const materials = createMannequinFocusContourMaterialSet(
      '#a8a8a8',
      '#979797',
    );
    const disposals = Object.values(materials).map((material) =>
      vi.spyOn(material, 'dispose'),
    );

    disposeMannequinFocusContourMaterialSet(materials);

    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
