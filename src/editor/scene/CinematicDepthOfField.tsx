import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { PerspectiveCamera, Vector2 } from 'three';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import { RENDER_LAYERS } from '../constants';
import type { EditorStore } from '../state/editorStore';
import {
  createLensDepthOfFieldPipeline,
  type LensDepthOfFieldPipeline,
} from './depthOfFieldPipeline';
import { getDepthOfFieldRuntimeParameters } from './lensDepthOfField';

const roundDiagnosticValue = (value: number) => Number(value.toFixed(6));

function publishRuntimeDepthOfField(
  domElement: HTMLCanvasElement,
  parameters: ReturnType<typeof getDepthOfFieldRuntimeParameters>,
) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
  domElement.dataset.runtimeDof = JSON.stringify({
    enabled: parameters.enabled,
    focusDistanceM: roundDiagnosticValue(parameters.focusDistanceM),
    focalLengthMm: roundDiagnosticValue(parameters.focalLengthMm),
    fStop: roundDiagnosticValue(parameters.fStop),
    aperture: roundDiagnosticValue(parameters.aperture),
    maxBlur: roundDiagnosticValue(parameters.maxBlur),
  });
}

export function CinematicDepthOfField({
  store,
}: {
  store: StoreApi<EditorStore>;
}) {
  const renderer = useThree((state) => state.gl);
  const domElement = useThree((state) => state.gl.domElement);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const cameraData = useStore(store, (state) => state.document.outputCamera);
  const pipelineRef = useRef<LensDepthOfFieldPipeline | null>(null);
  const parameters = useMemo(
    () => getDepthOfFieldRuntimeParameters(cameraData),
    [cameraData],
  );

  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const initialSize = renderer.getSize(new Vector2());
    const pipeline = createLensDepthOfFieldPipeline({
      renderer,
      scene,
      camera,
      width: initialSize.x,
      height: initialSize.y,
      pixelRatio: renderer.getPixelRatio(),
      renderToScreen: true,
      parameters: getDepthOfFieldRuntimeParameters(
        store.getState().document.outputCamera,
      ),
      baseLayerMask: 1 << RENDER_LAYERS.scene,
      overlayLayerMask: 1 << RENDER_LAYERS.editor,
    });
    pipelineRef.current = pipeline;
    return () => {
      if (pipelineRef.current === pipeline) pipelineRef.current = null;
      pipeline.dispose();
    };
  }, [camera, renderer, scene, store]);

  useLayoutEffect(() => {
    pipelineRef.current?.setSize(width, height, renderer.getPixelRatio());
  }, [height, renderer, width]);

  useLayoutEffect(() => {
    pipelineRef.current?.update(parameters);
  }, [parameters]);

  useFrame(() => {
    const pipeline = pipelineRef.current;
    if (pipeline === null) return;
    pipeline.render();
    publishRuntimeDepthOfField(domElement, parameters);
  }, 1);

  useLayoutEffect(
    () => () => {
      if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
        delete domElement.dataset.runtimeDof;
      }
    },
    [domElement],
  );

  return null;
}
