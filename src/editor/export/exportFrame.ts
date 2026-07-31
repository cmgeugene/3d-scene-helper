import {
  ASPECT_RATIO_VALUES,
  FILM_GAUGE_MM,
  OUTPUT_DIMENSION_RANGE,
  RENDER_LAYERS,
  SAFE_AREA_INSETS,
} from '../constants';
import {
  MathUtils,
  PerspectiveCamera,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three';
import {
  isAspectLockedOutputSize,
  type SceneDocument,
} from '../persistence/sceneSchema';
import type { GuideVisibility } from '../types';

export type OutputPresetId =
  '1280x720' | '1920x1080' | '1080x1920' | 'square' | 'cinematic';

export interface OutputPreset {
  id: OutputPresetId;
  label: string;
  aspectRatioId: SceneDocument['output']['aspectRatioId'];
  width: number;
  height: number;
}

export type CompositionGuideVisibility = Pick<
  GuideVisibility,
  'thirds' | 'center' | 'actionSafe' | 'titleSafe'
>;

export interface ExportVisibilityPolicy {
  layerMask: number;
  compositionGuides: CompositionGuideVisibility;
}

export interface FrameExportRequest {
  document: SceneDocument;
  guideVisibility: GuideVisibility;
}

export type FrameExportHandler = (request: FrameExportRequest) => Promise<Blob>;

interface FrameExportRuntimeRequest extends FrameExportRequest {
  renderer: WebGLRenderer;
  scene: Scene;
}

interface ExportFrameDependencies {
  createRenderTarget: (
    width: number,
    height: number,
    samples: number,
  ) => WebGLRenderTarget;
  createCanvas: () => HTMLCanvasElement;
}

const EXPORT_SUPERSAMPLE_SCALE = 2;
const MAX_SUPERSAMPLED_RENDER_PIXELS = 3840 * 2160;

export function calculateExportRenderSize(
  width: number,
  height: number,
  maxRenderTargetSize: number,
): { width: number; height: number; scale: 1 | 2 } {
  const supersampledWidth = width * EXPORT_SUPERSAMPLE_SCALE;
  const supersampledHeight = height * EXPORT_SUPERSAMPLE_SCALE;
  const canSupersample =
    supersampledWidth <= maxRenderTargetSize &&
    supersampledHeight <= maxRenderTargetSize &&
    supersampledWidth * supersampledHeight <= MAX_SUPERSAMPLED_RENDER_PIXELS;

  return canSupersample
    ? { width: supersampledWidth, height: supersampledHeight, scale: 2 }
    : { width, height, scale: 1 };
}

export function calculateExportSampleCount(
  width: number,
  height: number,
): 0 | 4 {
  return width * height <= MAX_SUPERSAMPLED_RENDER_PIXELS ? 4 : 0;
}

export function shouldIncludeMotionGuides(
  mode: SceneDocument['output']['mode'],
  motionVisible: boolean,
) {
  return mode === 'reference' && motionVisible;
}

export function getExportVisibilityPolicy(
  mode: SceneDocument['output']['mode'],
  guideVisibility: Readonly<GuideVisibility>,
): ExportVisibilityPolicy {
  if (mode === 'clean') {
    return {
      layerMask: 1 << RENDER_LAYERS.scene,
      compositionGuides: {
        thirds: false,
        center: false,
        actionSafe: false,
        titleSafe: false,
      },
    };
  }

  return {
    layerMask:
      (1 << RENDER_LAYERS.scene) |
      (shouldIncludeMotionGuides(mode, guideVisibility.motion)
        ? 1 << RENDER_LAYERS.reference
        : 0),
    compositionGuides: {
      thirds: guideVisibility.thirds,
      center: guideVisibility.center,
      actionSafe: guideVisibility.actionSafe,
      titleSafe: guideVisibility.titleSafe,
    },
  };
}

function assertOutputDimension(value: number): void {
  if (!Number.isInteger(value)) {
    throw new TypeError('Output dimensions must be integer pixels.');
  }
  if (
    value < OUTPUT_DIMENSION_RANGE.min ||
    value > OUTPUT_DIMENSION_RANGE.max
  ) {
    throw new RangeError(
      `Output dimensions must be ${OUTPUT_DIMENSION_RANGE.min}..${OUTPUT_DIMENSION_RANGE.max} pixels.`,
    );
  }
}

export function createPngFilename(name: string): string {
  const sanitizedBase = name
    .normalize('NFKC')
    .trim()
    .replace(/\.png$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '');

  return `${sanitizedBase || 'scene'}.png`;
}

export function downloadPngBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = createPngFilename(filename);
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function validateOutputDimensions(
  aspectRatioId: SceneDocument['output']['aspectRatioId'],
  dimensions: Readonly<{ width: number; height: number }>,
): { width: number; height: number } {
  assertOutputDimension(dimensions.width);
  assertOutputDimension(dimensions.height);

  if (!isAspectLockedOutputSize(aspectRatioId, dimensions)) {
    throw new RangeError(
      'Output dimensions must match the active aspect ratio.',
    );
  }

  return { width: dimensions.width, height: dimensions.height };
}

export function calculateAspectLockedDimensions(
  aspectRatioId: SceneDocument['output']['aspectRatioId'],
  editedDimension: 'width' | 'height',
  value: number,
): { width: number; height: number } {
  const aspect = ASPECT_RATIO_VALUES[aspectRatioId];
  const dimensions =
    editedDimension === 'width'
      ? { width: value, height: Math.round(value / aspect) }
      : { width: Math.round(value * aspect), height: value };

  return validateOutputDimensions(aspectRatioId, dimensions);
}

export function createExportCamera(
  document: SceneDocument,
  layerMask: number,
): PerspectiveCamera {
  const cameraData = document.outputCamera;
  const camera = new PerspectiveCamera(
    50,
    ASPECT_RATIO_VALUES[document.output.aspectRatioId],
    0.1,
    100,
  );
  camera.position.set(
    cameraData.position.x,
    cameraData.position.y,
    cameraData.position.z,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(cameraData.target.x, cameraData.target.y, cameraData.target.z);
  camera.rotateZ(MathUtils.degToRad(cameraData.rollDeg));
  camera.filmGauge = FILM_GAUGE_MM;
  camera.setFocalLength(cameraData.focalLengthMm);
  camera.updateProjectionMatrix();
  camera.layers.mask = layerMask;
  camera.updateMatrixWorld(true);
  return camera;
}

export function flipPixelRows(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const rowLength = width * 4;
  if (pixels.length !== rowLength * height) {
    throw new RangeError('Pixel buffer does not match the output dimensions.');
  }

  const temporaryRow = new Uint8Array(rowLength);
  for (let row = 0; row < Math.floor(height / 2); row += 1) {
    const oppositeRow = height - row - 1;
    const topOffset = row * rowLength;
    const bottomOffset = oppositeRow * rowLength;
    temporaryRow.set(pixels.subarray(topOffset, topOffset + rowLength));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowLength);
    pixels.set(temporaryRow, bottomOffset);
  }
  return new Uint8ClampedArray(
    pixels.buffer,
    pixels.byteOffset,
    pixels.byteLength,
  );
}

function assertRendererCanExport(
  renderer: WebGLRenderer,
  width: number,
  height: number,
) {
  const context = renderer.getContext();
  if (context.isContextLost()) {
    throw new Error(
      'WebGL context가 손실되어 PNG를 만들 수 없습니다. 장면을 다시 연 뒤 재시도해 주세요.',
    );
  }

  const maxTextureSize = Number(context.getParameter(context.MAX_TEXTURE_SIZE));
  const maxRenderbufferSize = Number(
    context.getParameter(context.MAX_RENDERBUFFER_SIZE),
  );
  const maxRenderTargetSize = Math.min(maxTextureSize, maxRenderbufferSize);
  if (
    !Number.isFinite(maxRenderTargetSize) ||
    maxRenderTargetSize <= 0 ||
    width > maxRenderTargetSize ||
    height > maxRenderTargetSize
  ) {
    throw new RangeError(
      `이 GPU의 최대 PNG 출력 크기는 ${maxRenderTargetSize}×${maxRenderTargetSize}입니다.`,
    );
  }

  return { context, maxRenderTargetSize };
}

function drawCompositionGuides(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  visibility: CompositionGuideVisibility,
) {
  const strokeLines = (
    positions: ReadonlyArray<readonly [number, number, number, number]>,
  ) => {
    if (positions.length === 0) return;
    context.beginPath();
    for (const [fromX, fromY, toX, toY] of positions) {
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
    }
    context.stroke();
  };

  context.save();
  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeStyle = 'rgba(236, 245, 255, 0.72)';
  if (visibility.thirds) {
    strokeLines([
      [width / 3, 0, width / 3, height],
      [(width * 2) / 3, 0, (width * 2) / 3, height],
      [0, height / 3, width, height / 3],
      [0, (height * 2) / 3, width, (height * 2) / 3],
    ]);
  }
  if (visibility.center) {
    context.strokeStyle = 'rgba(126, 216, 255, 0.88)';
    strokeLines([
      [width / 2, 0, width / 2, height],
      [0, height / 2, width, height / 2],
    ]);
  }

  context.setLineDash([
    Math.max(2, Math.round(Math.min(width, height) * 0.006)),
  ]);
  if (visibility.actionSafe) {
    const insetX = width * SAFE_AREA_INSETS.action;
    const insetY = height * SAFE_AREA_INSETS.action;
    context.strokeStyle = 'rgba(255, 213, 126, 0.86)';
    context.strokeRect(insetX, insetY, width - insetX * 2, height - insetY * 2);
  }
  if (visibility.titleSafe) {
    const insetX = width * SAFE_AREA_INSETS.title;
    const insetY = height * SAFE_AREA_INSETS.title;
    context.strokeStyle = 'rgba(255, 157, 178, 0.88)';
    context.strokeRect(insetX, insetY, width - insetX * 2, height - insetY * 2);
  }
  context.restore();
}

function encodeCanvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('브라우저가 PNG 데이터를 만들지 못했습니다.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

const DEFAULT_EXPORT_DEPENDENCIES: ExportFrameDependencies = {
  createRenderTarget: (width, height, samples) =>
    new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
    }),
  createCanvas: () => document.createElement('canvas'),
};

export async function exportFrame(
  request: FrameExportRuntimeRequest,
  dependencies: ExportFrameDependencies = DEFAULT_EXPORT_DEPENDENCIES,
): Promise<Blob> {
  const { renderer, scene, document, guideVisibility } = request;
  const { width, height } = validateOutputDimensions(
    document.output.aspectRatioId,
    document.output,
  );
  const policy = getExportVisibilityPolicy(
    document.output.mode,
    guideVisibility,
  );
  const { context, maxRenderTargetSize } = assertRendererCanExport(
    renderer,
    width,
    height,
  );
  const renderSize = calculateExportRenderSize(
    width,
    height,
    maxRenderTargetSize,
  );
  const renderWidth = renderSize.width;
  const renderHeight = renderSize.height;
  const sampleCount = calculateExportSampleCount(renderWidth, renderHeight);
  const camera = createExportCamera(document, policy.layerMask);
  const pixels = (() => {
    let target: WebGLRenderTarget | null = null;
    try {
      target = dependencies.createRenderTarget(
        renderWidth,
        renderHeight,
        sampleCount,
      );
      target.texture.colorSpace = SRGBColorSpace;
      const targetPixels = new Uint8Array(renderWidth * renderHeight * 4);
      const previousTarget = renderer.getRenderTarget();
      const previousPixelRatio = renderer.getPixelRatio();
      const previousViewport = renderer.getViewport(new Vector4());
      const previousScissor = renderer.getScissor(new Vector4());
      const previousScissorTest = renderer.getScissorTest();
      const previousOutputColorSpace = renderer.outputColorSpace;
      const previousToneMappingExposure = renderer.toneMappingExposure;

      try {
        renderer.setPixelRatio(1);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMappingExposure = document.lighting.exposure;
        renderer.setRenderTarget(target);
        renderer.setViewport(new Vector4(0, 0, renderWidth, renderHeight));
        renderer.setScissor(new Vector4(0, 0, renderWidth, renderHeight));
        renderer.setScissorTest(false);
        renderer.render(scene, camera);
        renderer.setRenderTarget(previousTarget);
        renderer.readRenderTargetPixels(
          target,
          0,
          0,
          renderWidth,
          renderHeight,
          targetPixels,
        );
        if (context.isContextLost()) {
          throw new Error(
            'WebGL context가 출력 중 손실되어 PNG를 만들지 못했습니다. 재시도해 주세요.',
          );
        }
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setPixelRatio(previousPixelRatio);
        renderer.setViewport(previousViewport);
        renderer.setScissor(previousScissor);
        renderer.setScissorTest(previousScissorTest);
        renderer.outputColorSpace = previousOutputColorSpace;
        renderer.toneMappingExposure = previousToneMappingExposure;
      }

      return targetPixels;
    } finally {
      target?.dispose();
    }
  })();

  const sourceCanvas = dependencies.createCanvas();
  let outputCanvas: HTMLCanvasElement | null = null;
  try {
    sourceCanvas.width = renderWidth;
    sourceCanvas.height = renderHeight;
    const sourceContext = sourceCanvas.getContext('2d');
    if (sourceContext === null) {
      throw new Error('PNG 인코딩을 위한 2D Canvas를 만들지 못했습니다.');
    }
    const imageData = sourceContext.createImageData(renderWidth, renderHeight);
    imageData.data.set(flipPixelRows(pixels, renderWidth, renderHeight));
    sourceContext.putImageData(imageData, 0, 0);

    if (renderSize.scale === 1) {
      drawCompositionGuides(
        sourceContext,
        width,
        height,
        policy.compositionGuides,
      );
      return await encodeCanvasPng(sourceCanvas);
    }

    outputCanvas = dependencies.createCanvas();
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputContext = outputCanvas.getContext('2d');
    if (outputContext === null) {
      throw new Error('PNG 인코딩을 위한 2D Canvas를 만들지 못했습니다.');
    }
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(sourceCanvas, 0, 0, width, height);
    drawCompositionGuides(
      outputContext,
      width,
      height,
      policy.compositionGuides,
    );
    return await encodeCanvasPng(outputCanvas);
  } finally {
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    sourceCanvas.remove();
    if (outputCanvas !== null) {
      outputCanvas.width = 0;
      outputCanvas.height = 0;
      outputCanvas.remove();
    }
  }
}

export const OUTPUT_PRESETS = [
  {
    id: '1280x720',
    label: 'HD (1280×720)',
    aspectRatioId: '16:9',
    width: 1280,
    height: 720,
  },
  {
    id: '1920x1080',
    label: 'Full HD (1920×1080)',
    aspectRatioId: '16:9',
    width: 1920,
    height: 1080,
  },
  {
    id: '1080x1920',
    label: '세로 Full HD (1080×1920)',
    aspectRatioId: '9:16',
    width: 1080,
    height: 1920,
  },
  {
    id: 'square',
    label: '정사각형 (1080×1080)',
    aspectRatioId: '1:1',
    width: 1080,
    height: 1080,
  },
  {
    id: 'cinematic',
    label: '시네마틱 (1920×804)',
    aspectRatioId: '2.39:1',
    width: 1920,
    height: 804,
  },
] as const satisfies readonly OutputPreset[];
