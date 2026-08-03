import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useStore, type StoreApi } from 'zustand';
import { SceneAssistantPanel } from '../../assistant/SceneAssistantPanel';
import { KeyframeWorkspace } from '../../assistant/KeyframeWorkspace';
import { ReferenceManager } from '../../assistant/ReferenceManager';
import type {
  CompanionBrowserClient,
  GenerationRecord,
  ReferenceArtifact,
} from '../../assistant/companionClient';
import type { CompanionConnection } from '../../assistant/companionConnection';
import {
  IMAGEGEN_MAX_INPUT_IMAGES,
  getMaximumReferenceImages,
} from '../../../shared/imageInputBudget';
import type { FrameExportHandler } from '../export/exportFrame';
import type { EditorStore } from '../state/editorStore';
import { AssetPanel } from './AssetPanel';
import {
  ASSISTANT_PANEL_COLLAPSED_STORAGE_KEY,
  ASSISTANT_PANEL_DEFAULT_WIDTH,
  ASSISTANT_PANEL_MAX_VIEWPORT_RATIO,
  ASSISTANT_PANEL_MAX_WIDTH,
  ASSISTANT_PANEL_MIN_WIDTH,
  ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
} from '../constants';
import { EditorShortcuts } from './EditorShortcuts';
import { Inspector } from './Inspector';
import { Outliner } from './Outliner';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import { StatusBar } from './StatusBar';
import { TopToolbar } from './TopToolbar';

export type WebGLState = 'checking' | 'available' | 'fallback';

const SceneViewport = lazy(() =>
  import('../scene/SceneViewport').then((module) => ({
    default: module.SceneViewport,
  })),
);

interface EditorShellProps {
  store: StoreApi<EditorStore>;
  webGLState: WebGLState;
  canvasEnabled?: boolean;
  storage?: Storage;
  companionConnection?: CompanionConnection | null;
  companionConnectionError?: string | null;
  onDisconnectCompanion?: () => void;
  assistantClientFactory?: (
    connection: CompanionConnection,
  ) => CompanionBrowserClient;
  createAssistantObjectUrl?: (blob: Blob) => string;
  revokeAssistantObjectUrl?: (url: string) => void;
}

interface RuntimeFailure {
  kind: 'context-loss' | 'render-error';
  message: string;
}

const WEBGL_MESSAGES: Record<WebGLState, string> = {
  checking: 'WebGL 지원 여부를 확인하고 있습니다.',
  available: 'WebGL을 사용할 수 있습니다.',
  fallback: 'WebGL을 사용할 수 없어 기본 안내 화면을 표시합니다.',
};

function maxAssistantPanelWidth() {
  return Math.max(
    ASSISTANT_PANEL_MIN_WIDTH,
    Math.min(
      ASSISTANT_PANEL_MAX_WIDTH,
      Math.round(window.innerWidth * ASSISTANT_PANEL_MAX_VIEWPORT_RATIO),
    ),
  );
}

function clampAssistantPanelWidth(width: number) {
  return Math.min(
    maxAssistantPanelWidth(),
    Math.max(ASSISTANT_PANEL_MIN_WIDTH, Math.round(width)),
  );
}

function readAssistantPanelWidth(storage: Storage) {
  try {
    const storedWidth = Number(
      storage.getItem(ASSISTANT_PANEL_WIDTH_STORAGE_KEY),
    );
    return Number.isFinite(storedWidth) && storedWidth > 0
      ? clampAssistantPanelWidth(storedWidth)
      : clampAssistantPanelWidth(ASSISTANT_PANEL_DEFAULT_WIDTH);
  } catch {
    return clampAssistantPanelWidth(ASSISTANT_PANEL_DEFAULT_WIDTH);
  }
}

function readAssistantPanelCollapsed(storage: Storage) {
  try {
    return storage.getItem(ASSISTANT_PANEL_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

const WORKSPACE_MODE_STORAGE_KEY = 'i2v.workspace.mode.v1';

function readWorkspaceMode(storage: Storage): 'scene' | 'keyframe' {
  try {
    return storage.getItem(WORKSPACE_MODE_STORAGE_KEY) === 'keyframe'
      ? 'keyframe'
      : 'scene';
  } catch {
    return 'scene';
  }
}

function ViewportPlaceholder({ webGLState }: { webGLState: WebGLState }) {
  return (
    <div
      className="viewport-placeholder"
      role={webGLState === 'fallback' ? 'alert' : undefined}
    >
      <p className="eyebrow">기본 장면 준비 완료</p>
      <h2>구도를 시작해 보세요</h2>
      <p>
        {webGLState === 'fallback'
          ? 'WebGL을 사용할 수 없어 3D 장면을 표시할 수 없습니다.'
          : '기본 마네킹을 선택하고 화면비와 가이드를 정해 보세요.'}
      </p>
    </div>
  );
}

export function EditorShell({
  store,
  webGLState,
  canvasEnabled = false,
  storage = window.localStorage,
  companionConnection = null,
  companionConnectionError = null,
  onDisconnectCompanion,
  assistantClientFactory,
  createAssistantObjectUrl,
  revokeAssistantObjectUrl,
}: EditorShellProps) {
  const [frameExporter, setFrameExporter] = useState<FrameExportHandler | null>(
    null,
  );
  const [runtimeFailure, setRuntimeFailure] = useState<RuntimeFailure | null>(
    null,
  );
  const [selectedReferences, setSelectedReferences] = useState<
    ReferenceArtifact[]
  >([]);
  const [refinementModeActive, setRefinementModeActive] = useState(false);
  const [refinementSource, setRefinementSource] =
    useState<GenerationRecord | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<'scene' | 'keyframe'>(() =>
    readWorkspaceMode(storage),
  );
  const [assistantPanelWidth, setAssistantPanelWidth] = useState(() =>
    readAssistantPanelWidth(storage),
  );
  const [assistantPanelCollapsed, setAssistantPanelCollapsed] = useState(() =>
    readAssistantPanelCollapsed(storage),
  );
  const [assistantPanelExpanded, setAssistantPanelExpanded] = useState(false);
  const [resizingAssistantPanel, setResizingAssistantPanel] = useState(false);
  const resizeStart = useRef({ pointerX: 0, width: assistantPanelWidth });
  const widthBeforeExpand = useRef(assistantPanelWidth);
  const sceneObjects = useStore(store, (state) => state.document.objects);
  const referenceTargets = useMemo(
    () =>
      sceneObjects
        .filter(({ kind }) => kind === 'mannequin')
        .map(({ id, name }) => ({ id, name })),
    [sceneObjects],
  );
  const getSelectedReferences = useCallback(
    () => selectedReferences,
    [selectedReferences],
  );
  const maximumSelectedReferences = getMaximumReferenceImages({
    includeLayout: true,
    includeSourceKeyframe: refinementModeActive,
  });
  const reservedGenerationImages =
    IMAGEGEN_MAX_INPUT_IMAGES - maximumSelectedReferences;
  const captureAssistantLayout = useCallback(async () => {
    if (frameExporter === null) {
      throw new Error('3D 뷰포트가 아직 캡처를 준비하지 못했습니다.');
    }
    const state = store.getState();
    return frameExporter({
      document: {
        ...state.document,
        output: { ...state.document.output, mode: 'reference' },
      },
      guideVisibility: state.guideVisibility,
    });
  }, [frameExporter, store]);
  const handleExportReady = useCallback(
    (nextExporter: FrameExportHandler | null) => {
      setFrameExporter(() => nextExporter);
    },
    [],
  );
  const handleRuntimeFailure = useCallback((message: string) => {
    setRuntimeFailure({ kind: 'context-loss', message });
  }, []);
  const handleViewportError = useCallback(() => {
    setRuntimeFailure({
      kind: 'render-error',
      message:
        '3D 뷰포트를 표시하지 못했습니다. 직렬화된 장면 데이터는 보존되었습니다.',
    });
  }, []);
  const effectiveWebGLState: WebGLState =
    runtimeFailure === null ? webGLState : 'fallback';

  useEffect(() => {
    try {
      storage.setItem(
        ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
        String(assistantPanelWidth),
      );
    } catch {
      // UI preferences should not make the editor unusable when storage fails.
    }
  }, [assistantPanelWidth, storage]);

  useEffect(() => {
    try {
      storage.setItem(
        ASSISTANT_PANEL_COLLAPSED_STORAGE_KEY,
        String(assistantPanelCollapsed),
      );
    } catch {
      // UI preferences should not make the editor unusable when storage fails.
    }
  }, [assistantPanelCollapsed, storage]);

  useEffect(() => {
    try {
      storage.setItem(WORKSPACE_MODE_STORAGE_KEY, workspaceMode);
    } catch {
      // Workspace preference should not make the editor unusable.
    }
  }, [storage, workspaceMode]);

  useEffect(() => {
    if (!resizingAssistantPanel) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      setAssistantPanelExpanded(false);
      setAssistantPanelWidth(
        clampAssistantPanelWidth(
          resizeStart.current.width +
            (resizeStart.current.pointerX - event.clientX),
        ),
      );
    };
    const handlePointerUp = () => setResizingAssistantPanel(false);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    document.body.classList.add('is-resizing-assistant-panel');
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.classList.remove('is-resizing-assistant-panel');
    };
  }, [resizingAssistantPanel]);

  useEffect(() => {
    const handleWindowResize = () => {
      setAssistantPanelWidth((width) => clampAssistantPanelWidth(width));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const beginAssistantPanelResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (assistantPanelCollapsed) return;
    resizeStart.current = {
      pointerX: event.clientX,
      width: assistantPanelWidth,
    };
    setResizingAssistantPanel(true);
    event.preventDefault();
  };

  const resizeAssistantPanelWithKeyboard = (
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    const step = event.shiftKey ? 64 : 16;
    let nextWidth: number | null = null;
    if (event.key === 'ArrowLeft') nextWidth = assistantPanelWidth + step;
    if (event.key === 'ArrowRight') nextWidth = assistantPanelWidth - step;
    if (event.key === 'Home') nextWidth = ASSISTANT_PANEL_MIN_WIDTH;
    if (event.key === 'End') nextWidth = maxAssistantPanelWidth();
    if (nextWidth === null) return;
    event.preventDefault();
    setAssistantPanelExpanded(false);
    setAssistantPanelWidth(clampAssistantPanelWidth(nextWidth));
  };

  const toggleAssistantPanelExpanded = () => {
    if (assistantPanelExpanded) {
      setAssistantPanelWidth(
        clampAssistantPanelWidth(widthBeforeExpand.current),
      );
      setAssistantPanelExpanded(false);
      return;
    }
    widthBeforeExpand.current = assistantPanelWidth;
    setAssistantPanelWidth(maxAssistantPanelWidth());
    setAssistantPanelExpanded(true);
  };

  const workspaceStyle = {
    '--assistant-panel-width': `${assistantPanelWidth}px`,
  } as CSSProperties;
  const workspaceModeSwitch = (
    <div className="workspace-mode-switch" role="group" aria-label="작업 모드">
      <button
        type="button"
        aria-pressed={workspaceMode === 'scene'}
        onClick={() => setWorkspaceMode('scene')}
      >
        3D 씬
      </button>
      <button
        type="button"
        aria-pressed={workspaceMode === 'keyframe'}
        onClick={() => setWorkspaceMode('keyframe')}
      >
        키프레임
      </button>
    </div>
  );

  return (
    <main className="editor-shell">
      {workspaceMode === 'scene' ? <EditorShortcuts store={store} /> : null}
      <div className={`desktop-editor desktop-editor--${workspaceMode}`}>
        {workspaceMode === 'scene' ? (
          <TopToolbar
            store={store}
            storage={storage}
            frameExporter={frameExporter}
            exportUnavailable={runtimeFailure !== null}
            titleAccessory={workspaceModeSwitch}
          />
        ) : (
          <header className="top-toolbar keyframe-toolbar">
            <div className="toolbar-brand">
              <h1>I2V 3D Scene Helper</h1>
              {workspaceModeSwitch}
            </div>
            <span>Generation workspace</span>
          </header>
        )}
        {workspaceMode === 'scene' ? (
          <div
            className={`editor-workspace${assistantPanelCollapsed ? ' editor-workspace--assistant-collapsed' : ''}`}
            style={workspaceStyle}
          >
            <aside className="left-panel" aria-label="에셋과 장면">
              <AssetPanel store={store} />
              <Outliner store={store} />
            </aside>
            <section className="viewport-panel" aria-label="장면 뷰포트">
              {canvasEnabled && webGLState === 'available' ? (
                <SceneErrorBoundary onError={handleViewportError}>
                  <Suspense
                    fallback={<ViewportPlaceholder webGLState={webGLState} />}
                  >
                    <SceneViewport
                      store={store}
                      onExportReady={handleExportReady}
                      onRuntimeFailure={handleRuntimeFailure}
                    />
                  </Suspense>
                </SceneErrorBoundary>
              ) : (
                <ViewportPlaceholder webGLState={webGLState} />
              )}
              {runtimeFailure?.kind !== 'context-loss' ? null : (
                <div className="viewport-placeholder" role="alert">
                  <p className="eyebrow">WebGL 연결 오류</p>
                  <h2>장면 데이터는 안전합니다</h2>
                  <p>{runtimeFailure.message}</p>
                </div>
              )}
              <p
                className={`webgl-status webgl-status--${effectiveWebGLState}`}
                role="status"
                data-webgl-state={effectiveWebGLState}
              >
                {WEBGL_MESSAGES[effectiveWebGLState]}
              </p>
            </section>
            <div
              className="assistant-panel-resizer"
              role="separator"
              aria-label="우측 패널 너비 조절"
              aria-orientation="vertical"
              aria-valuemin={ASSISTANT_PANEL_MIN_WIDTH}
              aria-valuemax={maxAssistantPanelWidth()}
              aria-valuenow={assistantPanelWidth}
              tabIndex={assistantPanelCollapsed ? -1 : 0}
              onPointerDown={beginAssistantPanelResize}
              onKeyDown={resizeAssistantPanelWithKeyboard}
            />
            <aside className="inspector-panel" aria-label="속성">
              {assistantPanelCollapsed ? (
                <div className="assistant-dock-collapsed">
                  <button
                    type="button"
                    aria-label="우측 패널 펼치기"
                    title="우측 패널 펼치기"
                    onClick={() => setAssistantPanelCollapsed(false)}
                  >
                    ‹
                  </button>
                  <span>Assistant</span>
                </div>
              ) : (
                <>
                  <div className="assistant-dock-toolbar">
                    <span>우측 패널 · {assistantPanelWidth}px</span>
                    <div>
                      <button
                        type="button"
                        onClick={toggleAssistantPanelExpanded}
                      >
                        {assistantPanelExpanded ? '이전 너비' : '넓게'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssistantPanelCollapsed(true)}
                      >
                        접기
                      </button>
                    </div>
                  </div>
                  <Inspector store={store} />
                  <SceneAssistantPanel
                    connection={companionConnection}
                    connectionError={companionConnectionError}
                    onDisconnect={onDisconnectCompanion}
                    getSceneContext={() => store.getState().document}
                    getSelectedReferences={getSelectedReferences}
                    captureLayout={
                      frameExporter === null ? null : captureAssistantLayout
                    }
                    onRefinementModeChange={setRefinementModeActive}
                    refinementSource={refinementSource}
                    onRefinementSourceChange={setRefinementSource}
                    clientFactory={assistantClientFactory}
                    createObjectUrl={createAssistantObjectUrl}
                    revokeObjectUrl={revokeAssistantObjectUrl}
                  />
                </>
              )}
            </aside>
          </div>
        ) : (
          <KeyframeWorkspace
            connection={companionConnection}
            storage={storage}
            clientFactory={assistantClientFactory}
            createObjectUrl={createAssistantObjectUrl}
            revokeObjectUrl={revokeAssistantObjectUrl}
            onRefine={(generation) => {
              setRefinementSource(generation);
              setWorkspaceMode('scene');
            }}
          />
        )}
        {workspaceMode === 'scene' ? (
          <ReferenceManager
            connection={companionConnection}
            targets={referenceTargets}
            maximumSelected={maximumSelectedReferences}
            reservedInputImages={reservedGenerationImages}
            onSelectionChange={setSelectedReferences}
          />
        ) : null}
        <StatusBar store={store} />
      </div>
      <section
        className="unsupported-notice"
        aria-labelledby="unsupported-title"
      >
        <p className="eyebrow">지원 화면 안내</p>
        <h1 id="unsupported-title">데스크톱 화면이 필요합니다</h1>
        <p>이 편집기는 1280×720 이상의 데스크톱 화면이 필요합니다.</p>
      </section>
    </main>
  );
}
