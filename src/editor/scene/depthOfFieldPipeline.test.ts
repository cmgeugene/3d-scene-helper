import { describe, expect, it, vi } from 'vitest';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { Color, PerspectiveCamera, Scene } from 'three';
import {
  createLensDepthOfFieldPipeline,
  type DepthOfFieldComposerDependencies,
} from './depthOfFieldPipeline';

function createFixture(throwOn: 'none' | 'output-pass' | 'render' = 'none') {
  const renderPass = { dispose: vi.fn(), enabled: true };
  const bokehPass = {
    dispose: vi.fn(),
    enabled: true,
    uniforms: {
      focus: { value: 0 },
      aperture: { value: 0 },
      maxblur: { value: 0 },
    },
  };
  const outputPass = { dispose: vi.fn(), enabled: true };
  const outputTarget = {
    name: 'dof-output',
    texture: { colorSpace: '' },
  } as unknown as WebGLRenderTarget;
  const composer = {
    renderToScreen: true,
    readBuffer: outputTarget,
    addPass: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(() => {
      if (throwOn === 'render') throw new Error('composer render failed');
    }),
    dispose: vi.fn(),
  };
  const dependencies: DepthOfFieldComposerDependencies = {
    createComposer: vi.fn(() => composer),
    createRenderPass: vi.fn(() => renderPass),
    createBokehPass: vi.fn(() => bokehPass),
    createOutputPass: vi.fn(() => {
      if (throwOn === 'output-pass') throw new Error('output pass failed');
      return outputPass;
    }),
  };
  return {
    bokehPass,
    composer,
    dependencies,
    outputPass,
    outputTarget,
    renderPass,
  };
}

function createRendererDouble() {
  let target: WebGLRenderTarget | null = null;
  let clearColor = new Color('#000000');
  let clearAlpha = 1;
  return {
    autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget: vi.fn((next: WebGLRenderTarget | null) => {
      target = next;
    }),
    getClearColor: (result: Color) => result.copy(clearColor),
    setClearColor: (next: Color) => {
      clearColor = next.clone();
    },
    getClearAlpha: () => clearAlpha,
    setClearAlpha: (next: number) => {
      clearAlpha = next;
    },
    clearDepth: vi.fn(),
    render: vi.fn(),
  } as unknown as WebGLRenderer;
}

const camera = new PerspectiveCamera(50, 1, 0.1, 100);
const parameters = {
  enabled: true,
  focusDistanceM: 5,
  focalLengthMm: 50,
  fStop: 2.8,
  aperture: 0.0008,
  maxBlur: 0.008,
};

describe('lens depth-of-field composer lifecycle', () => {
  it('wires real optics into Bokeh, renders offscreen, resizes, and disposes every owned resource', () => {
    const renderer = createRendererDouble();
    const scene = new Scene();
    const fixture = createFixture();

    fixture.composer.render.mockImplementation(() => {
      expect(camera.layers.mask).toBe(1);
    });
    camera.layers.mask = 7;
    const target = {} as WebGLRenderTarget;
    const pipeline = createLensDepthOfFieldPipeline(
      {
        renderer,
        scene,
        camera,
        target,
        width: 640,
        height: 360,
        pixelRatio: 2,
        renderToScreen: false,
        parameters,
        baseLayerMask: 1,
        overlayLayerMask: 2,
      },
      fixture.dependencies,
    );

    expect(fixture.dependencies.createComposer).toHaveBeenCalledWith(
      renderer,
      target,
    );
    expect(fixture.composer.addPass).toHaveBeenCalledTimes(3);
    expect(fixture.composer.renderToScreen).toBe(false);
    expect(fixture.bokehPass.uniforms.focus.value).toBe(5);
    expect(fixture.bokehPass.uniforms.aperture.value).toBe(0.0008);
    expect(fixture.bokehPass.uniforms.maxblur.value).toBe(0.008);
    expect(pipeline.render()).toBe(fixture.outputTarget);
    expect(camera.layers.mask).toBe(7);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(fixture.outputTarget);
    expect(renderer.clearDepth).toHaveBeenCalledOnce();
    expect(renderer.render).toHaveBeenCalledWith(scene, camera);

    pipeline.update({ ...parameters, enabled: false, focusDistanceM: 7 });
    expect(fixture.bokehPass.enabled).toBe(false);
    expect(fixture.bokehPass.uniforms.focus.value).toBe(7);
    pipeline.setSize(800, 600, 1.5);
    expect(fixture.composer.setPixelRatio).toHaveBeenLastCalledWith(1.5);
    expect(fixture.composer.setSize).toHaveBeenLastCalledWith(800, 600);

    pipeline.dispose();
    pipeline.dispose();
    expect(fixture.renderPass.dispose).toHaveBeenCalledOnce();
    expect(fixture.bokehPass.dispose).toHaveBeenCalledOnce();

    expect(fixture.outputPass.dispose).toHaveBeenCalledOnce();
    expect(fixture.composer.dispose).toHaveBeenCalledOnce();
    camera.layers.mask = 1;
  });

  it('disposes partial allocations when setup fails and full allocations when render fails', () => {
    const renderer = createRendererDouble();
    const scene = new Scene();
    const setupFailure = createFixture('output-pass');
    expect(() =>
      createLensDepthOfFieldPipeline(
        {
          renderer,
          scene,
          camera,
          width: 64,
          height: 64,
          pixelRatio: 1,
          renderToScreen: true,
          parameters,
        },
        setupFailure.dependencies,
      ),
    ).toThrow('output pass failed');
    expect(setupFailure.renderPass.dispose).toHaveBeenCalledOnce();
    expect(setupFailure.bokehPass.dispose).toHaveBeenCalledOnce();
    expect(setupFailure.composer.dispose).toHaveBeenCalledOnce();

    const renderFailure = createFixture('render');
    const pipeline = createLensDepthOfFieldPipeline(
      {
        renderer,
        scene,
        camera,
        width: 64,
        height: 64,
        pixelRatio: 1,
        renderToScreen: true,
        parameters,
      },
      renderFailure.dependencies,
    );
    expect(() => pipeline.render()).toThrow('composer render failed');
    pipeline.dispose();
    expect(renderFailure.bokehPass.dispose).toHaveBeenCalledOnce();
    expect(renderFailure.composer.dispose).toHaveBeenCalledOnce();
  });

  it('restores scene override, clear state, and render target when Bokeh rendering throws', () => {
    const originalTarget = {
      name: 'original-target',
    } as unknown as WebGLRenderTarget;
    const dirtyTarget = {
      name: 'dirty-target',
    } as unknown as WebGLRenderTarget;
    const originalOverride = { name: 'original-material' };
    const dirtyOverride = { name: 'dirty-material' };
    let target: WebGLRenderTarget | null = originalTarget;
    let clearColor = new Color('#123456');
    let clearAlpha = 0.4;
    const renderer = {
      autoClear: true,
      getRenderTarget: () => target,
      setRenderTarget: (next: WebGLRenderTarget | null) => {
        target = next;
      },
      getClearColor: (result: Color) => result.copy(clearColor),
      setClearColor: (next: Color) => {
        clearColor = next.clone();
      },
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (next: number) => {
        clearAlpha = next;
      },
    } as unknown as WebGLRenderer;
    const scene = new Scene();
    scene.overrideMaterial = originalOverride as Scene['overrideMaterial'];
    const fixture = createFixture();
    fixture.composer.render.mockImplementation(() => {
      scene.overrideMaterial = dirtyOverride as Scene['overrideMaterial'];
      renderer.autoClear = false;
      renderer.setRenderTarget(dirtyTarget);
      renderer.setClearColor(new Color('#ffffff'));
      renderer.setClearAlpha(1);
      throw new Error('depth render failed');
    });
    const pipeline = createLensDepthOfFieldPipeline(
      {
        renderer,
        scene,
        camera,
        width: 64,
        height: 64,
        pixelRatio: 1,
        renderToScreen: true,
        parameters,
      },
      fixture.dependencies,
    );

    expect(() => pipeline.render()).toThrow('depth render failed');
    expect(scene.overrideMaterial).toBe(originalOverride);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.getRenderTarget()).toBe(originalTarget);
    expect(renderer.getClearColor(new Color()).getHexString()).toBe('123456');
    expect(renderer.getClearAlpha()).toBe(0.4);
    pipeline.dispose();
  });
});
