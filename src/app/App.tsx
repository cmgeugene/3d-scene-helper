import { useEffect, useState } from 'react';
import { EditorShell, type WebGLState } from '../editor/components/EditorShell';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';
import { createEditorStore } from '../editor/state/editorStore';

const editorStore = createEditorStore({
  initialDocument: createStarterSceneDocument({
    documentId: 'starter-scene',
    floorId: 'starter-floor',
    mannequinId: 'starter-mannequin',
  }),
  idFactory: () => globalThis.crypto.randomUUID(),
});

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

  return <EditorShell store={editorStore} webGLState={webGLState} />;
}
