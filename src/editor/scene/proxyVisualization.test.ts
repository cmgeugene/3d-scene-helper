import { MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { applyProxyOpacityToMaterial } from './proxyVisualization';

describe('applyProxyOpacityToMaterial', () => {
  it('proxy opacity를 base material에 곱하고 1에서 원래 상태를 복원한다', () => {
    const material = new MeshStandardMaterial({ opacity: 0.8 });
    material.transparent = true;
    material.depthWrite = true;

    applyProxyOpacityToMaterial(material, 0.25);
    expect(material.opacity).toBeCloseTo(0.2);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);

    applyProxyOpacityToMaterial(material, 1);
    expect(material.opacity).toBeCloseTo(0.8);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    material.dispose();

    const alphaMappedMaterial = new MeshStandardMaterial({ opacity: 1 });
    alphaMappedMaterial.transparent = true;
    applyProxyOpacityToMaterial(alphaMappedMaterial, 0.25);
    applyProxyOpacityToMaterial(alphaMappedMaterial, 1);
    expect(alphaMappedMaterial.opacity).toBe(1);
    expect(alphaMappedMaterial.transparent).toBe(true);
    alphaMappedMaterial.dispose();
  });
});
