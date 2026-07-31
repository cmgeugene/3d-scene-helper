import { lazy, Suspense, useCallback, useState } from 'react';
import type { StoreApi } from 'zustand';
import type { FrameExportHandler } from '../export/exportFrame';
import type { EditorStore } from '../state/editorStore';
import { AssetPanel } from './AssetPanel';
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
}: EditorShellProps) {
  const [frameExporter, setFrameExporter] = useState<FrameExportHandler | null>(
    null,
  );
  const [runtimeFailure, setRuntimeFailure] = useState<RuntimeFailure | null>(
    null,
  );
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

  return (
    <main className="editor-shell">
      <EditorShortcuts store={store} />
      <div className="desktop-editor">
        <TopToolbar
          store={store}
          storage={storage}
          frameExporter={frameExporter}
          exportUnavailable={runtimeFailure !== null}
        />
        <div className="editor-workspace">
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
          <aside className="inspector-panel" aria-label="속성">
            <Inspector store={store} />
          </aside>
        </div>
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
