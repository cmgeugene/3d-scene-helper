import { Color, NoColorSpace } from 'three';
import type {
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { getDepthOfFieldRuntimeParameters } from './lensDepthOfField';

export type DepthOfFieldRuntimeParameters = ReturnType<
  typeof getDepthOfFieldRuntimeParameters
>;

interface DisposablePassLike {
  enabled: boolean;
  dispose: () => void;
}

interface BokehPassLike extends DisposablePassLike {
  uniforms: {
    focus: { value: number };
    aperture: { value: number };
    maxblur: { value: number };
  };
}

interface EffectComposerLike {
  renderToScreen: boolean;
  readBuffer: WebGLRenderTarget;
  addPass: (pass: DisposablePassLike) => void;
  setPixelRatio: (pixelRatio: number) => void;
  setSize: (width: number, height: number) => void;
  render: () => void;
  dispose: () => void;
}

interface OverlayMaterialLike {
  color?: Color;
  emissive?: Color;
  map?: { colorSpace: string } | null;
}

function prepareOffscreenOverlayColors(scene: Scene, layerMask: number) {
  const restorations: Array<() => void> = [];
  const visited = new Set<OverlayMaterialLike>();
  scene.traverse((object) => {
    if ((object.layers.mask & layerMask) === 0) return;
    const materialValue = (
      object as typeof object & {
        material?: OverlayMaterialLike | OverlayMaterialLike[];
      }
    ).material;
    const materials = Array.isArray(materialValue)
      ? materialValue
      : materialValue === undefined
        ? []
        : [materialValue];
    for (const material of materials) {
      if (visited.has(material)) continue;
      visited.add(material);
      for (const key of ['color', 'emissive'] as const) {
        const color = material[key];
        if (color === undefined) continue;
        const previous = color.clone();
        color.convertLinearToSRGB();
        restorations.push(() => color.copy(previous));
      }
      if (material.map !== null && material.map !== undefined) {
        const map = material.map;
        const previousColorSpace = map.colorSpace;
        map.colorSpace = NoColorSpace;
        restorations.push(() => {
          map.colorSpace = previousColorSpace;
        });
      }
    }
  });
  return () => {
    for (const restore of restorations.reverse()) restore();
  };
}

export interface DepthOfFieldComposerDependencies {
  createComposer: (
    renderer: WebGLRenderer,
    target?: WebGLRenderTarget,
  ) => EffectComposerLike;
  createRenderPass: (
    scene: Scene,
    camera: PerspectiveCamera,
  ) => DisposablePassLike;
  createBokehPass: (
    scene: Scene,
    camera: PerspectiveCamera,
    parameters: { focus: number; aperture: number; maxblur: number },
  ) => BokehPassLike;
  createOutputPass: () => DisposablePassLike;
}

const DEFAULT_DEPENDENCIES: DepthOfFieldComposerDependencies = {
  createComposer: (renderer, target) =>
    new EffectComposer(renderer, target) as unknown as EffectComposerLike,
  createRenderPass: (scene, camera) => new RenderPass(scene, camera),
  createBokehPass: (scene, camera, parameters) =>
    new BokehPass(scene, camera, parameters) as unknown as BokehPassLike,
  createOutputPass: () => new OutputPass(),
};

export interface CreateLensDepthOfFieldPipelineRequest {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  target?: WebGLRenderTarget;
  width: number;
  height: number;
  pixelRatio: number;
  renderToScreen: boolean;
  parameters: DepthOfFieldRuntimeParameters;
  baseLayerMask?: number;
  overlayLayerMask?: number;
}

export interface LensDepthOfFieldPipeline {
  render: () => WebGLRenderTarget;
  setSize: (width: number, height: number, pixelRatio: number) => void;
  update: (parameters: DepthOfFieldRuntimeParameters) => void;
  dispose: () => void;
}

export function createLensDepthOfFieldPipeline(
  request: CreateLensDepthOfFieldPipelineRequest,
  dependencies: DepthOfFieldComposerDependencies = DEFAULT_DEPENDENCIES,
): LensDepthOfFieldPipeline {
  let composer: EffectComposerLike | null = null;
  let renderPass: DisposablePassLike | null = null;
  let bokehPass: BokehPassLike | null = null;

  let outputPass: DisposablePassLike | null = null;
  let disposed = false;

  const disposeAllocated = () => {
    if (disposed) return;
    disposed = true;
    renderPass?.dispose();
    bokehPass?.dispose();

    outputPass?.dispose();
    composer?.dispose();
  };

  try {
    composer = dependencies.createComposer(request.renderer, request.target);
    renderPass = dependencies.createRenderPass(request.scene, request.camera);
    bokehPass = dependencies.createBokehPass(request.scene, request.camera, {
      focus: request.parameters.focusDistanceM,
      aperture: request.parameters.aperture,
      maxblur: request.parameters.maxBlur,
    });
    outputPass = dependencies.createOutputPass();
    composer.addPass(renderPass);
    composer.addPass(bokehPass);
    composer.addPass(outputPass);
    composer.renderToScreen = request.renderToScreen;
    composer.setPixelRatio(request.pixelRatio);
    composer.setSize(request.width, request.height);
  } catch (error) {
    disposeAllocated();
    throw error;
  }

  const update = (parameters: DepthOfFieldRuntimeParameters) => {
    if (disposed || bokehPass === null) return;
    bokehPass.enabled = parameters.enabled;
    bokehPass.uniforms.focus.value = parameters.focusDistanceM;
    bokehPass.uniforms.aperture.value = parameters.aperture;
    bokehPass.uniforms.maxblur.value = parameters.maxBlur;
  };
  update(request.parameters);

  return {
    render: () => {
      if (disposed || composer === null) {
        throw new Error('Depth-of-field pipeline has been disposed.');
      }
      const previousOverrideMaterial = request.scene.overrideMaterial;
      const previousAutoClear = request.renderer.autoClear;
      const previousRenderTarget = request.renderer.getRenderTarget();
      const previousClearColor = request.renderer.getClearColor(new Color());
      const previousClearAlpha = request.renderer.getClearAlpha();
      const previousCameraLayerMask = request.camera.layers.mask;
      const previousBackground = request.scene.background;
      try {
        request.camera.layers.mask =
          request.baseLayerMask ?? previousCameraLayerMask;
        composer.render();
        const overlayLayerMask = request.overlayLayerMask ?? 0;
        if (overlayLayerMask !== 0) {
          const outputTarget = request.renderToScreen
            ? previousRenderTarget
            : composer.readBuffer;
          if (outputTarget !== null) {
            outputTarget.texture.colorSpace = NoColorSpace;
          }
          request.camera.layers.mask = overlayLayerMask;
          request.scene.background = null;
          request.renderer.autoClear = false;
          request.renderer.setRenderTarget(outputTarget);
          request.renderer.clearDepth();
          const restoreOverlayColors = request.renderToScreen
            ? () => undefined
            : prepareOffscreenOverlayColors(request.scene, overlayLayerMask);
          try {
            request.renderer.render(request.scene, request.camera);
          } finally {
            restoreOverlayColors();
          }
        }
      } finally {
        request.camera.layers.mask = previousCameraLayerMask;
        request.scene.background = previousBackground;
        request.scene.overrideMaterial = previousOverrideMaterial;
        request.renderer.autoClear = previousAutoClear;
        request.renderer.setClearColor(previousClearColor);
        request.renderer.setClearAlpha(previousClearAlpha);
        request.renderer.setRenderTarget(previousRenderTarget);
      }
      return composer.readBuffer;
    },
    setSize: (width, height, pixelRatio) => {
      if (disposed || composer === null) return;
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    update,
    dispose: disposeAllocated,
  };
}
