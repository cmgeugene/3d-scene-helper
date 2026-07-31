import { Canvas, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowHelper,
  PCFShadowMap,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Object3D,
} from 'three';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import { ASPECT_RATIO_VALUES, RENDER_LAYERS } from '../constants';
import { exportFrame, type FrameExportHandler } from '../export/exportFrame';
import type { MannequinPose } from '../mannequin/mannequinRig';
import type { SceneDocument } from '../persistence/sceneSchema';
import type { EditorStore } from '../state/editorStore';
import { CompositionGuides } from './CompositionGuides';
import { EditorNavigation } from './EditorNavigation';
import { LightingRig, SHADOW_BOUNDS_M } from './LightingRig';
import { MotionGuides } from './MotionGuides';
import { computeLetterbox, type LetterboxRectangle } from './cameraMath';
import { OutputCamera } from './OutputCamera';
import { SceneObject } from './SceneObject';
import { SelectionTransformControls } from './SelectionTransformControls';

interface SceneViewportProps {
  store: StoreApi<EditorStore>;
  onExportReady?: (exportFrame: FrameExportHandler | null) => void;
  onRuntimeFailure?: (message: string) => void;
}

function WebGLContextMonitor({
  onRuntimeFailure,
}: {
  onRuntimeFailure?: (message: string) => void;
}) {
  const canvas = useThree((state) => state.gl.domElement);

  useEffect(() => {
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onRuntimeFailure?.(
        'WebGL context가 손실되었습니다. 직렬화된 장면 데이터는 보존되었습니다. 페이지를 새로고침해 3D 표시를 복구하세요.',
      );
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    return () =>
      canvas.removeEventListener('webglcontextlost', handleContextLost);
  }, [canvas, onRuntimeFailure]);

  return null;
}

function moveToLayer(object: Object3D | null, layer: number) {
  object?.traverse((child) => {
    child.layers.set(layer);
  });
}

function EditorHelpers() {
  const helpers = useRef<Group>(null);

  useLayoutEffect(() => {
    moveToLayer(helpers.current, RENDER_LAYERS.editor);
  }, []);

  return (
    <group ref={helpers} name="EditorHelpers.layer1">
      <gridHelper
        name="EditorGrid.layer1"
        args={[20, 40, '#769ad0', '#405576']}
        position={[0, 0.02, 0]}
        raycast={() => undefined}
      />
      <axesHelper
        name="EditorAxes.layer1"
        args={[1]}
        position={[0, 0.025, 0]}
        raycast={() => undefined}
      />
    </group>
  );
}

function publishFacingHelperDiagnostic(
  runtimeCanvas: HTMLCanvasElement,
  rootName: string,
) {
  if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
    runtimeCanvas.dataset.facingHelper = rootName;
  }
}

function clearFacingHelperDiagnostic(
  runtimeCanvas: HTMLCanvasElement,
  rootName: string,
) {
  if (
    IS_EDITOR_TEST_BRIDGE_ENABLED &&
    runtimeCanvas.dataset.facingHelper === rootName
  ) {
    delete runtimeCanvas.dataset.facingHelper;
  }
}

function SelectedSubjectFacingHelper({
  root,
  object,
}: {
  root: Group;
  object: SceneDocument['objects'][number];
}) {
  const helper = useMemo(() => {
    const facingHelper = new ArrowHelper(
      new Vector3(0, 0, -1),
      new Vector3(0, 0, 0),
      Math.max(object.dimensions.y * 0.45, 0.4),
      '#78d8ff',
      0.16,
      0.09,
    );
    facingHelper.name = 'SelectedSubjectFacingHelper.layer1';
    facingHelper.position.set(0, 0, -object.dimensions.z / 2);
    moveToLayer(facingHelper, RENDER_LAYERS.editor);
    facingHelper.traverse((child) => {
      child.raycast = () => undefined;
    });
    return facingHelper;
  }, [object.dimensions.y, object.dimensions.z]);
  const runtimeCanvas = useThree((state) => state.gl.domElement);

  useLayoutEffect(() => {
    root.add(helper);
    publishFacingHelperDiagnostic(runtimeCanvas, root.name);

    return () => {
      root.remove(helper);
      clearFacingHelperDiagnostic(runtimeCanvas, root.name);
      helper.dispose();
    };
  }, [helper, root, runtimeCanvas]);

  return null;
}

function RuntimeScene({ store }: { store: StoreApi<EditorStore> }) {
  const document = useStore(store, (state) => state.document);
  const objects = useStore(store, (state) => state.document.objects);
  const selectedObjectId = useStore(store, (state) => state.selectedObjectId);
  const background = useStore(store, (state) => state.document.background);
  const lighting = useStore(store, (state) => state.document.lighting);
  const selectObject = useStore(store, (state) => state.selectObject);
  const transformMode = useStore(store, (state) => state.transformMode);
  const mannequinTool = useStore(store, (state) => state.mannequinTool);
  const motionGuidesVisible = useStore(
    store,
    (state) => state.guideVisibility.motion,
  );
  const [objectRoots, setObjectRoots] = useState(
    () => new Map<string, Group>(),
  );
  const [transformDragging, setTransformDragging] = useState(false);
  const [runtimeMannequinPoses, setRuntimeMannequinPoses] = useState(
    () => new Map<string, MannequinPose>(),
  );
  const setRuntimeMannequinPose = useCallback(
    (id: string, pose: MannequinPose | null) => {
      setRuntimeMannequinPoses((current) => {
        const previous = current.get(id);
        if (pose === null && previous === undefined) return current;
        if (pose !== null && previous === pose) return current;
        const next = new Map(current);
        if (pose === null) next.delete(id);
        else next.set(id, pose);
        return next;
      });
    },
    [],
  );
  const handleSelectedRuntimePoseChange = useCallback(
    (pose: MannequinPose | null) => {
      if (selectedObjectId !== null) {
        setRuntimeMannequinPose(selectedObjectId, pose);
      }
    },
    [selectedObjectId, setRuntimeMannequinPose],
  );
  const handleRootReady = useCallback((id: string, root: Group | null) => {
    setObjectRoots((current) => {
      const previous = current.get(id);
      if (root === null && previous === undefined) return current;
      if (root !== null && previous === root) return current;
      const next = new Map(current);
      if (root === null) next.delete(id);
      else next.set(id, root);
      return next;
    });
  }, []);
  const selectedObject = useMemo(
    () => objects.find(({ id }) => id === selectedObjectId),
    [objects, selectedObjectId],
  );
  const selectedRoot =
    selectedObject === undefined
      ? undefined
      : objectRoots.get(selectedObject.id);
  const validSelectedRoot =
    selectedRoot?.name === `scene-object:${selectedObject?.id}` &&
    selectedRoot.userData.sceneObjectId === selectedObject?.id
      ? selectedRoot
      : undefined;

  return (
    <>
      <color attach="background" args={[background.color]} />
      <OutputCamera store={store} />
      <EditorNavigation store={store} enabled={!transformDragging} />
      <LightingRig lighting={lighting} />
      <group name="SceneContent.layer0">
        {objects.map((object) => (
          <SceneObject
            key={object.id}
            object={object}
            selected={selectedObjectId === object.id}
            onSelect={selectObject}
            onRootReady={handleRootReady}
            runtimeMannequinPose={runtimeMannequinPoses.get(object.id)}
            mannequinIK={
              selectedObjectId === object.id &&
              object.kind === 'mannequin' &&
              mannequinTool === 'ik'
                ? {
                    store,
                    pose:
                      runtimeMannequinPoses.get(object.id) ??
                      object.mannequinPose!,
                    onRuntimePoseChange: handleSelectedRuntimePoseChange,
                    onDraggingChange: setTransformDragging,
                  }
                : undefined
            }
          />
        ))}
      </group>
      {selectedObject !== undefined && validSelectedRoot !== undefined ? (
        <>
          {selectedObject.kind !== 'mannequin' || mannequinTool !== 'ik' ? (
            <SelectionTransformControls
              key={`${selectedObject.id}:${transformMode}`}
              store={store}
              object={validSelectedRoot}
              objectData={selectedObject}
              onDraggingChange={setTransformDragging}
            />
          ) : null}
          <SelectedSubjectFacingHelper
            root={validSelectedRoot}
            object={selectedObject}
          />
        </>
      ) : null}
      {motionGuidesVisible ? <MotionGuides document={document} /> : null}
      <EditorHelpers />
    </>
  );
}

function ExportFrameBridge({
  onExportReady,
}: {
  onExportReady: (exportFrame: FrameExportHandler | null) => void;
}) {
  const renderer = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useLayoutEffect(() => {
    const handler: FrameExportHandler = (request) =>
      exportFrame({ ...request, renderer, scene });
    onExportReady(handler);
    return () => onExportReady(null);
  }, [onExportReady, renderer, scene]);

  return null;
}

export function SceneViewport({
  store,
  onExportReady,
  onRuntimeFailure,
}: SceneViewportProps) {
  const outputAspectId = useStore(
    store,
    (state) => state.document.output.aspectRatioId,
  );
  const outputAspect = ASPECT_RATIO_VALUES[outputAspectId];
  const guideVisibility = useStore(store, (state) => state.guideVisibility);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<LetterboxRectangle | null>(null);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;

    const updateFrame = () => {
      if (surface.clientWidth <= 0 || surface.clientHeight <= 0) return;
      setFrame(
        computeLetterbox(
          surface.clientWidth,
          surface.clientHeight,
          outputAspect,
        ),
      );
    };
    updateFrame();
    const observer = new ResizeObserver(updateFrame);
    observer.observe(surface);
    return () => {
      observer.disconnect();
    };
  }, [outputAspect]);

  return (
    <div ref={surfaceRef} className="scene-viewport-surface">
      <Canvas
        className="scene-canvas"
        role="img"
        aria-label="3D 장면 캔버스"
        data-color-space="srgb"
        data-shadow-bounds={`${SHADOW_BOUNDS_M}m`}
        data-grid-size="20m"
        data-axes-origin="0,0.025,0"
        shadows="percentage"
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
        onCreated={({ gl, camera }) => {
          gl.outputColorSpace = SRGBColorSpace;
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = PCFShadowMap;
          camera.layers.enable(RENDER_LAYERS.editor);
          camera.layers.enable(RENDER_LAYERS.reference);
        }}
        onPointerMissed={() => {
          store.getState().selectObject(null);
        }}
      >
        <WebGLContextMonitor onRuntimeFailure={onRuntimeFailure} />
        <RuntimeScene store={store} />
        {onExportReady === undefined ? null : (
          <ExportFrameBridge onExportReady={onExportReady} />
        )}
      </Canvas>
      {frame === null ? null : (
        <div
          className="camera-frame"
          data-camera-frame="true"
          data-output-aspect={outputAspect}
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
          }}
        >
          <CompositionGuides visibility={guideVisibility} />
        </div>
      )}
      <div className="viewport-guidance" aria-hidden="true">
        <span className="eyebrow">기본 장면 준비 완료</span>
        <span>기본 마네킹을 선택하고 화면비와 가이드를 정해 보세요.</span>
      </div>
    </div>
  );
}
