import {
  Color,
  MeshStandardMaterial,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from 'three';

export const MANNEQUIN_FOCUS_CONTOUR_POLICY = Object.freeze({
  axialSpacingM: 0.1,
  limbSpacingM: 0.0725,
  axialLineWidthM: 0.006,
  limbLineWidthM: 0.005,
  centerlineWidthM: 0.0045,
  colorBlend: 0.42,
  charcoalHex: '#30343a',
});

type ContourRegion = 'axial' | 'limb';

interface FocusContourRuntime {
  region: ContourRegion;
  enabled: IUniform<number>;
  spacingM: IUniform<number>;
  halfWidthM: IUniform<number>;
  centerlineHalfWidthM: IUniform<number>;
  color: IUniform<Color>;
}

export interface MannequinFocusContourMaterialSet {
  axial: MeshStandardMaterial;
  limb: MeshStandardMaterial;
  joint: MeshStandardMaterial;
}

const MATERIAL_RUNTIME = new WeakMap<
  MeshStandardMaterial,
  FocusContourRuntime
>();

export function getMannequinFocusContourColor(color: string | Color): Color {
  return new Color(color).lerp(
    new Color(MANNEQUIN_FOCUS_CONTOUR_POLICY.charcoalHex),
    MANNEQUIN_FOCUS_CONTOUR_POLICY.colorBlend,
  );
}

function createMaterial(
  color: string,
  region: ContourRegion,
): MeshStandardMaterial {
  const baseColor = new Color(color);
  const spacingM =
    region === 'axial'
      ? MANNEQUIN_FOCUS_CONTOUR_POLICY.axialSpacingM
      : MANNEQUIN_FOCUS_CONTOUR_POLICY.limbSpacingM;
  const lineWidthM =
    region === 'axial'
      ? MANNEQUIN_FOCUS_CONTOUR_POLICY.axialLineWidthM
      : MANNEQUIN_FOCUS_CONTOUR_POLICY.limbLineWidthM;
  const runtime: FocusContourRuntime = {
    region,
    enabled: { value: 0 },
    spacingM: { value: spacingM },
    halfWidthM: { value: lineWidthM / 2 },
    centerlineHalfWidthM: {
      value: MANNEQUIN_FOCUS_CONTOUR_POLICY.centerlineWidthM / 2,
    },
    color: { value: getMannequinFocusContourColor(baseColor) },
  };
  const material = new MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor,
    emissiveIntensity: 0.06,
    roughness: 0.58,
    metalness: 0.015,
  });
  material.name = `Mannequin.focus-contour.${region}`;
  material.customProgramCacheKey = () =>
    `mannequin-focus-contours-v1:${region}`;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uFocusContourEnabled = runtime.enabled;
    shader.uniforms.uFocusContourSpacingM = runtime.spacingM;
    shader.uniforms.uFocusContourHalfWidthM = runtime.halfWidthM;
    shader.uniforms.uFocusContourCenterlineHalfWidthM =
      runtime.centerlineHalfWidthM;
    shader.uniforms.uFocusContourColor = runtime.color;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vMannequinContourPosition;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 focusContourObjectScale = vec3(
  length( modelMatrix[ 0 ].xyz ),
  length( modelMatrix[ 1 ].xyz ),
  length( modelMatrix[ 2 ].xyz )
);
vMannequinContourPosition = position * focusContourObjectScale;`,
      );

    const centerlineShader =
      region === 'axial'
        ? `
float focusContourCenterlineAa = max(
  fwidth(vMannequinContourPosition.x),
  0.00025
);
float focusContourCenterline = 1.0 - smoothstep(
  uFocusContourCenterlineHalfWidthM,
  uFocusContourCenterlineHalfWidthM + focusContourCenterlineAa,
  abs(vMannequinContourPosition.x)
);
float focusContourFrontMask = 1.0 - smoothstep(
  -0.006,
  0.006,
  vMannequinContourPosition.z
);
focusContourCenterline *= focusContourFrontMask;`
        : '';
    const combinedMask =
      region === 'axial'
        ? 'max(focusContourBand, focusContourCenterline)'
        : 'focusContourBand';
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vMannequinContourPosition;
uniform float uFocusContourEnabled;
uniform float uFocusContourSpacingM;
uniform float uFocusContourHalfWidthM;
uniform float uFocusContourCenterlineHalfWidthM;
uniform vec3 uFocusContourColor;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float focusContourBandDistance = abs(
  fract(vMannequinContourPosition.y / uFocusContourSpacingM + 0.5) - 0.5
) * uFocusContourSpacingM;
float focusContourBandAa = max(
  fwidth(vMannequinContourPosition.y),
  0.00025
);
float focusContourBand = 1.0 - smoothstep(
  uFocusContourHalfWidthM,
  uFocusContourHalfWidthM + focusContourBandAa,
  focusContourBandDistance
);${centerlineShader}
float focusContourMask = clamp(
  ${combinedMask} * uFocusContourEnabled,
  0.0,
  1.0
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  uFocusContourColor,
  focusContourMask
);`,
      );
  };
  MATERIAL_RUNTIME.set(material, runtime);
  return material;
}

export function createMannequinFocusContourMaterialSet(
  bodyColor: string,
  jointColor: string,
): MannequinFocusContourMaterialSet {
  return {
    axial: createMaterial(bodyColor, 'axial'),
    limb: createMaterial(bodyColor, 'limb'),
    joint: createMaterial(jointColor, 'limb'),
  };
}

export function setMannequinFocusContourMaterialSetEnabled(
  materials: MannequinFocusContourMaterialSet,
  enabled: boolean,
): void {
  for (const material of Object.values(materials)) {
    const runtime = MATERIAL_RUNTIME.get(material);
    if (runtime !== undefined) runtime.enabled.value = enabled ? 1 : 0;
  }
}

export function getMannequinFocusContourMaterialState(
  material: MeshStandardMaterial,
) {
  const runtime = MATERIAL_RUNTIME.get(material);
  if (runtime === undefined) {
    throw new TypeError('Material is not a mannequin focus-contour material.');
  }
  return {
    region: runtime.region,
    enabled: runtime.enabled.value === 1,
    spacingM: runtime.spacingM.value,
    lineWidthM: runtime.halfWidthM.value * 2,
    centerlineWidthM: runtime.centerlineHalfWidthM.value * 2,
    color: runtime.color.value.clone(),
  };
}

export function disposeMannequinFocusContourMaterialSet(
  materials: MannequinFocusContourMaterialSet,
): void {
  for (const material of Object.values(materials)) material.dispose();
}
