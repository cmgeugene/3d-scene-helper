import type { StoreApi } from 'zustand';
import type { EditorStore } from '../state/editorStore';
import { AssetPanel } from './AssetPanel';
import { Inspector } from './Inspector';
import { Outliner } from './Outliner';
import { StatusBar } from './StatusBar';
import { TopToolbar } from './TopToolbar';

export type WebGLState = 'checking' | 'available' | 'fallback';

interface EditorShellProps {
  store: StoreApi<EditorStore>;
  webGLState: WebGLState;
}

const WEBGL_MESSAGES: Record<WebGLState, string> = {
  checking: 'WebGL 지원 여부를 확인하고 있습니다.',
  available: 'WebGL을 사용할 수 있습니다.',
  fallback: 'WebGL을 사용할 수 없어 기본 안내 화면을 표시합니다.',
};

export function EditorShell({ store, webGLState }: EditorShellProps) {
  return (
    <main className="editor-shell">
      <div className="desktop-editor">
        <TopToolbar store={store} />
        <div className="editor-workspace">
          <aside className="left-panel" aria-label="에셋과 장면">
            <AssetPanel />
            <Outliner store={store} />
          </aside>
          <section className="viewport-panel" aria-label="장면 뷰포트">
            <div className="viewport-placeholder">
              <p className="eyebrow">기본 장면 준비 완료</p>
              <h2>구도를 시작해 보세요</h2>
              <p>기본 마네킹을 선택하고 화면비와 가이드를 정해 보세요.</p>
            </div>
            <p
              className={`webgl-status webgl-status--${webGLState}`}
              role="status"
              data-webgl-state={webGLState}
            >
              {WEBGL_MESSAGES[webGLState]}
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
