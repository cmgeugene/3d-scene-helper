import type { Material } from 'three';

export function applyProxyOpacityToMaterial(
  material: Material,
  proxyOpacity: number,
) {
  const baseOpacity =
    typeof material.userData.proxyBaseOpacity === 'number'
      ? material.userData.proxyBaseOpacity
      : material.opacity;
  const baseDepthWrite =
    typeof material.userData.proxyBaseDepthWrite === 'boolean'
      ? material.userData.proxyBaseDepthWrite
      : material.depthWrite;
  const baseTransparent =
    typeof material.userData.proxyBaseTransparent === 'boolean'
      ? material.userData.proxyBaseTransparent
      : material.transparent;
  material.userData.proxyBaseOpacity = baseOpacity;
  material.userData.proxyBaseDepthWrite = baseDepthWrite;
  material.userData.proxyBaseTransparent = baseTransparent;
  material.opacity = baseOpacity * proxyOpacity;
  material.transparent = baseTransparent || material.opacity < 1;
  material.depthWrite = proxyOpacity >= 1 && baseDepthWrite;
  material.needsUpdate = true;
}
