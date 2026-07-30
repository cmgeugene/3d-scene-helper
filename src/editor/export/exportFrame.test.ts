import {
  LinearSRGBColorSpace,
  Scene,
  Vector3,
  Vector4,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import {
  calculateAspectLockedDimensions,
  createExportCamera,
  createPngFilename,
  exportFrame,
  flipPixelRows,
  getExportVisibilityPolicy,
  OUTPUT_PRESETS,
  validateOutputDimensions,
} from './exportFrame';

describe('exportFrame pure output model', () => {
  it('canonical landscape, portrait, square, cinematic presets을 제공한다', () => {
    expect(
      OUTPUT_PRESETS.map(({ id, aspectRatioId, width, height }) => ({
        id,
        aspectRatioId,
        width,
        height,
      })),
    ).toEqual([
      {
        id: '1280x720',
        aspectRatioId: '16:9',
        width: 1280,
        height: 720,
      },
      {
        id: '1920x1080',
        aspectRatioId: '16:9',
        width: 1920,
        height: 1080,
      },
      {
        id: '1080x1920',
        aspectRatioId: '9:16',
        width: 1080,
        height: 1920,
      },
      {
        id: 'square',
        aspectRatioId: '1:1',
        width: 1080,
        height: 1080,
      },
      {
        id: 'cinematic',
        aspectRatioId: '2.39:1',
        width: 1920,
        height: 804,
      },
    ]);
  });

  it.each([
    ['width', 1280, '16:9', { width: 1280, height: 720 }],
    ['height', 1920, '9:16', { width: 1080, height: 1920 }],
  ] as const)(
    '%s edit은 active aspect에 맞춰 반대 dimension을 재계산한다',
    (editedDimension, value, aspectRatioId, expected) => {
      expect(
        calculateAspectLockedDimensions(aspectRatioId, editedDimension, value),
      ).toEqual(expected);
    },
  );

  it('height edit은 active aspect에 맞춰 반대 dimension을 재계산한다', () => {
    expect(calculateAspectLockedDimensions('9:16', 'height', 1600)).toEqual({
      width: 900,
      height: 1600,
    });
    expect(calculateAspectLockedDimensions('9:16', 'height', 1000)).toEqual({
      width: 563,
      height: 1000,
    });
  });

  it('64..4096 integer 범위를 허용하고 입력 또는 계산 결과가 범위를 벗어나면 거부한다', () => {
    expect(calculateAspectLockedDimensions('1:1', 'width', 64)).toEqual({
      width: 64,
      height: 64,
    });
    expect(calculateAspectLockedDimensions('1:1', 'height', 4096)).toEqual({
      width: 4096,
      height: 4096,
    });

    expect(() => calculateAspectLockedDimensions('16:9', 'width', 63)).toThrow(
      /64.*4096/,
    );
    expect(() =>
      calculateAspectLockedDimensions('16:9', 'height', 4097),
    ).toThrow(/64.*4096/);
    expect(() =>
      calculateAspectLockedDimensions('16:9', 'width', 1280.5),
    ).toThrow(/integer/);
    expect(() => calculateAspectLockedDimensions('16:9', 'width', 64)).toThrow(
      /64.*4096/,
    );
    expect(() =>
      calculateAspectLockedDimensions('16:9', 'height', 4096),
    ).toThrow(/64.*4096/);
  });

  it('canonical cinematic preset은 허용하되 arbitrary 1px aspect mismatch는 stretch하지 않고 거부한다', () => {
    expect(
      validateOutputDimensions('2.39:1', { width: 1920, height: 804 }),
    ).toEqual({ width: 1920, height: 804 });

    expect(() =>
      validateOutputDimensions('1:1', { width: 100, height: 99 }),
    ).toThrow(/aspect ratio/);
    expect(() =>
      validateOutputDimensions('16:9', { width: 1280, height: 719 }),
    ).toThrow(/aspect ratio/);
    expect(() =>
      validateOutputDimensions('16:9', { width: 1080, height: 1920 }),
    ).toThrow(/aspect ratio/);

    expect(
      validateOutputDimensions('16:9', { width: 113, height: 64 }),
    ).toEqual({ width: 113, height: 64 });
    expect(
      validateOutputDimensions('9:16', { width: 64, height: 113 }),
    ).toEqual({ width: 64, height: 113 });
  });

  it.each([
    ['  ../My Scene: Take 01.PNG  ', 'My-Scene-Take-01.png'],
    ['장면 초안', '장면-초안.png'],
    ['<>:"/\\|?*', 'scene.png'],
    ['.PNG', 'scene.png'],
  ])(
    'unsafe filename %j을 sanitized PNG filename으로 만든다',
    (name, expected) => {
      expect(createPngFilename(name)).toBe(expected);
    },
  );

  it('clean mode는 scene layer 0만 포함하고 composition helper를 숨긴다', () => {
    expect(
      getExportVisibilityPolicy('clean', {
        thirds: true,
        center: true,
        actionSafe: true,
        titleSafe: true,
        motion: true,
      }),
    ).toEqual({
      layerMask: 1,
      compositionGuides: {
        thirds: false,
        center: false,
        actionSafe: false,
        titleSafe: false,
      },
    });
  });

  it('reference mode는 scene+reference layer와 active composition flags만 포함한다', () => {
    const policy = getExportVisibilityPolicy('reference', {
      thirds: true,
      center: false,
      actionSafe: true,
      titleSafe: false,
      motion: true,
    });

    expect(policy).toEqual({
      layerMask: 5,
      compositionGuides: {
        thirds: true,
        center: false,
        actionSafe: true,
        titleSafe: false,
      },
    });
    expect(policy.layerMask & (1 << 1)).toBe(0);
  });
});

function createExportDocument(mode: 'clean' | 'reference' = 'clean') {
  const document = createStarterSceneDocument({
    documentId: 'export-runtime',
    floorId: 'export-floor',
    mannequinId: 'export-mannequin',
  });
  document.output = {
    aspectRatioId: '1:1',
    width: 64,
    height: 64,
    mode,
  };
  document.outputCamera = {
    position: { x: 1, y: 2, z: 6 },
    target: { x: -0.25, y: 1.25, z: 0.5 },
    focalLengthMm: 35,
    rollDeg: 12,
  };
  return document;
}

function createRendererDouble(throwDuringReadback = false) {
  const originalTarget = { name: 'original-target' };
  let target: unknown = originalTarget;
  let pixelRatio = 2;
  let viewport = new Vector4(3, 4, 320, 180);
  let scissor = new Vector4(5, 6, 300, 160);
  let scissorTest = true;
  const setPixelRatio = vi.fn((value: number) => {
    pixelRatio = value;
  });
  const render = vi.fn();
  const readRenderTargetPixels = vi.fn(
    (
      _target: unknown,
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      pixels: Uint8Array,
    ) => {
      if (throwDuringReadback) throw new Error('readback failed');
      pixels.fill(23);
    },
  );
  let contextLost = false;
  let maxTextureSize = 8192;
  let maxRenderbufferSize = 8192;
  const context = {
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_RENDERBUFFER_SIZE: 0x84e8,
    isContextLost: () => contextLost,
    getParameter: (parameter: number) =>
      parameter === 0x0d33 ? maxTextureSize : maxRenderbufferSize,
  };
  const renderer = {
    outputColorSpace: LinearSRGBColorSpace,
    toneMappingExposure: 0.75,
    getRenderTarget: () => target,
    setRenderTarget: (value: unknown) => {
      target = value;
    },
    getPixelRatio: () => pixelRatio,
    setPixelRatio,
    getViewport: (result: Vector4) => result.copy(viewport),
    setViewport: (value: Vector4) => {
      viewport = value.clone();
    },
    getScissor: (result: Vector4) => result.copy(scissor),
    setScissor: (value: Vector4) => {
      scissor = value.clone();
    },
    getScissorTest: () => scissorTest,
    setScissorTest: (value: boolean) => {
      scissorTest = value;
    },
    getContext: () => context,
    render,
    readRenderTargetPixels,
  } as unknown as WebGLRenderer;

  return {
    renderer,
    originalTarget,
    render,
    readRenderTargetPixels,
    setPixelRatio,
    setContextLost: (value: boolean) => {
      contextLost = value;
    },
    setRenderLimits: (texture: number, renderbuffer: number) => {
      maxTextureSize = texture;
      maxRenderbufferSize = renderbuffer;
    },
    readState: () => ({
      target,
      pixelRatio,
      viewport: viewport.toArray(),
      scissor: scissor.toArray(),
      scissorTest,
      outputColorSpace: renderer.outputColorSpace,
      toneMappingExposure: renderer.toneMappingExposure,
    }),
  };
}

function createCanvasDouble(blob = new Blob(['png'], { type: 'image/png' })) {
  const imageData = { data: new Uint8ClampedArray(64 * 64 * 4) };
  const context = {
    createImageData: vi.fn(() => imageData),
    putImageData: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    lineWidth: 1,
    strokeStyle: '',
    setLineDash: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
    remove: vi.fn(),
  } as unknown as HTMLCanvasElement;
  return { blob, canvas, context, imageData };
}

describe('exportFrame offscreen runtime', () => {
  it('saved OutputCamera와 output aspect로 layer-isolated export camera를 재구성한다', () => {
    const document = createExportDocument('reference');
    const camera = createExportCamera(document, 5);
    const projectedTarget = new Vector3(
      document.outputCamera.target.x,
      document.outputCamera.target.y,
      document.outputCamera.target.z,
    ).project(camera);

    expect(camera.position.toArray()).toEqual([1, 2, 6]);
    expect(camera.aspect).toBe(1);
    expect(camera.filmGauge).toBe(36);
    expect(camera.getFocalLength()).toBeCloseTo(35, 8);
    expect(camera.layers.mask).toBe(5);
    expect(projectedTarget.x).toBeCloseTo(0, 6);
    expect(projectedTarget.y).toBeCloseTo(0, 6);
  });

  it('WebGL bottom-up readPixels rows를 PNG top-down 순서로 수직 반전한다', () => {
    const bottomUp = new Uint8Array([
      1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255,
    ]);

    expect([...flipPixelRows(bottomUp, 2, 2)]).toEqual([
      3, 0, 0, 255, 4, 0, 0, 255, 1, 0, 0, 255, 2, 0, 0, 255,
    ]);
  });

  it('pixelRatio=1 offscreen target을 PNG blob으로 만들고 reference guides를 합성한 뒤 상태와 자원을 복구한다', async () => {
    const runtime = createRendererDouble();
    const target = {
      texture: { colorSpace: LinearSRGBColorSpace },
      dispose: vi.fn(),
    } as unknown as WebGLRenderTarget;
    const createRenderTarget = vi.fn(() => target);
    const canvas = createCanvasDouble();
    const result = await exportFrame(
      {
        renderer: runtime.renderer,
        scene: new Scene(),
        document: createExportDocument('reference'),
        guideVisibility: {
          thirds: true,
          center: true,
          actionSafe: true,
          titleSafe: true,
          motion: true,
        },
      },
      { createRenderTarget, createCanvas: () => canvas.canvas },
    );

    expect(result).toBe(canvas.blob);
    expect(createRenderTarget).toHaveBeenCalledWith(64, 64);
    expect(runtime.setPixelRatio).toHaveBeenNthCalledWith(1, 1);
    expect(runtime.render).toHaveBeenCalledOnce();
    expect(runtime.readRenderTargetPixels).toHaveBeenCalledOnce();
    expect(canvas.context.putImageData).toHaveBeenCalledOnce();
    expect(canvas.context.stroke).toHaveBeenCalled();
    expect(canvas.context.strokeRect).toHaveBeenCalledTimes(2);
    expect(target.dispose).toHaveBeenCalledOnce();
    expect(runtime.readState()).toEqual({
      target: runtime.originalTarget,
      pixelRatio: 2,
      viewport: [3, 4, 320, 180],
      scissor: [5, 6, 300, 160],
      scissorTest: true,
      outputColorSpace: LinearSRGBColorSpace,
      toneMappingExposure: 0.75,
    });
    expect(canvas.canvas.width).toBe(0);
    expect(canvas.canvas.height).toBe(0);
  });

  it('mid-capture readback 예외에서도 renderer state를 복구하고 GPU target을 dispose한다', async () => {
    const runtime = createRendererDouble(true);
    const target = {
      texture: { colorSpace: LinearSRGBColorSpace },
      dispose: vi.fn(),
    } as unknown as WebGLRenderTarget;
    const createCanvas = vi.fn(() => createCanvasDouble().canvas);

    await expect(
      exportFrame(
        {
          renderer: runtime.renderer,
          scene: new Scene(),
          document: createExportDocument(),
          guideVisibility: {
            thirds: false,
            center: false,
            actionSafe: false,
            titleSafe: false,
            motion: false,
          },
        },
        { createRenderTarget: () => target, createCanvas },
      ),
    ).rejects.toThrow('readback failed');

    expect(createCanvas).not.toHaveBeenCalled();
    expect(target.dispose).toHaveBeenCalledOnce();
    expect(runtime.readState()).toEqual({
      target: runtime.originalTarget,
      pixelRatio: 2,
      viewport: [3, 4, 320, 180],
      scissor: [5, 6, 300, 160],
      scissorTest: true,
      outputColorSpace: LinearSRGBColorSpace,
      toneMappingExposure: 0.75,
    });
  });

  it('render-target setup 초기 예외에서도 생성된 GPU target을 dispose한다', async () => {
    const runtime = createRendererDouble();
    const dispose = vi.fn();
    const target = {
      get texture() {
        throw new Error('texture setup failed');
      },
      dispose,
    } as unknown as WebGLRenderTarget;
    const createCanvas = vi.fn(() => createCanvasDouble().canvas);

    await expect(
      exportFrame(
        {
          renderer: runtime.renderer,
          scene: new Scene(),
          document: createExportDocument(),
          guideVisibility: {
            thirds: false,
            center: false,
            actionSafe: false,
            titleSafe: false,
            motion: false,
          },
        },
        { createRenderTarget: () => target, createCanvas },
      ),
    ).rejects.toThrow('texture setup failed');

    expect(dispose).toHaveBeenCalledOnce();
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it('lost WebGL context 또는 hardware render-target limit을 성공 PNG로 오인하지 않는다', async () => {
    const lostRuntime = createRendererDouble();
    lostRuntime.setContextLost(true);
    const lostTargetFactory = vi.fn();

    await expect(
      exportFrame(
        {
          renderer: lostRuntime.renderer,
          scene: new Scene(),
          document: createExportDocument(),
          guideVisibility: {
            thirds: false,
            center: false,
            actionSafe: false,
            titleSafe: false,
            motion: false,
          },
        },
        {
          createRenderTarget: lostTargetFactory,
          createCanvas: () => createCanvasDouble().canvas,
        },
      ),
    ).rejects.toThrow(/WebGL context/i);
    expect(lostTargetFactory).not.toHaveBeenCalled();

    const limitedRuntime = createRendererDouble();
    limitedRuntime.setRenderLimits(2048, 2048);
    const oversizedDocument = createExportDocument();
    oversizedDocument.output = {
      aspectRatioId: '1:1',
      width: 4096,
      height: 4096,
      mode: 'clean',
    };
    const limitedTargetFactory = vi.fn();

    await expect(
      exportFrame(
        {
          renderer: limitedRuntime.renderer,
          scene: new Scene(),
          document: oversizedDocument,
          guideVisibility: {
            thirds: false,
            center: false,
            actionSafe: false,
            titleSafe: false,
            motion: false,
          },
        },
        {
          createRenderTarget: limitedTargetFactory,
          createCanvas: () => createCanvasDouble().canvas,
        },
      ),
    ).rejects.toThrow(/2048/);
    expect(limitedTargetFactory).not.toHaveBeenCalled();
  });
});
