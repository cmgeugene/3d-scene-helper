import { useEffect, useState } from 'react';

type WebGLState = 'checking' | 'available' | 'fallback';

const WEBGL_MESSAGES: Record<WebGLState, string> = {
  checking: 'WebGL 지원 여부를 확인하고 있습니다.',
  available: 'WebGL을 사용할 수 있습니다.',
  fallback: 'WebGL을 사용할 수 없어 기본 안내 화면을 표시합니다.',
};

function canUseWebGL() {
  const canvas = document.createElement('canvas');

  try {
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');

    if (context === null) {
      return false;
    }

    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    canvas.remove();
  }
}

export function App() {
  const [webGLState, setWebGLState] = useState<WebGLState>('checking');

  useEffect(() => {
    const nextState = canUseWebGL() ? 'available' : 'fallback';
    const update = window.setTimeout(() => {
      setWebGLState(nextState);
    }, 0);

    return () => {
      window.clearTimeout(update);
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="intro" aria-labelledby="product-name">
        <p className="eyebrow">브라우저 환경 점검</p>
        <h1 id="product-name">I2V 3D Scene Helper</h1>
        <p className="description">
          이 화면은 기본 실행 환경만 확인합니다. 3D 편집 기능은 아직 제공하지
          않습니다.
        </p>
        <p
          className={`webgl-status webgl-status--${webGLState}`}
          role="status"
          data-webgl-state={webGLState}
        >
          {WEBGL_MESSAGES[webGLState]}
        </p>
      </section>
    </main>
  );
}
