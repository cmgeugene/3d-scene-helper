import { describe, expect, it, vi } from 'vitest';
import {
  PLANAR_MIRROR_TEXTURE_SIZE,
  createPlanarReflector,
  disposePlanarReflector,
} from './planarMirrorResource';

describe('planar mirror resource lifecycle', () => {
  it('고정 반사 target을 만들고 geometry/material/target을 한 번씩 해제한다', () => {
    const reflector = createPlanarReflector(4, 2, '#d9e3ea');
    const renderTarget = reflector.getRenderTarget();
    const geometryDispose = vi.spyOn(reflector.geometry, 'dispose');
    const material = Array.isArray(reflector.material)
      ? reflector.material[0]
      : reflector.material;
    if (material === undefined) throw new Error('Expected reflector material');
    const materialDispose = vi.spyOn(material, 'dispose');
    const targetDispose = vi.spyOn(renderTarget, 'dispose');

    expect(renderTarget.width).toBe(PLANAR_MIRROR_TEXTURE_SIZE);
    expect(renderTarget.height).toBe(PLANAR_MIRROR_TEXTURE_SIZE);
    expect(reflector.rotation.x).toBeCloseTo(-Math.PI / 2);

    disposePlanarReflector(reflector);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(targetDispose).toHaveBeenCalledOnce();
  });
});
