import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import {
  clearCompanionConnection,
  COMPANION_SESSION_KEY,
  consumeCompanionConnection,
  discoverCompanionConnection,
} from '../assistant/companionConnection';
import { EditorShell, type WebGLState } from '../editor/components/EditorShell';
import { AUTOSAVE_DEBOUNCE_MS, SCENE_STORAGE_KEY } from '../editor/constants';
import {
  encodeSceneDocument,
  parseSceneDocument,
  saveSceneDocument,
} from '../editor/persistence/sceneCodec';
import type { EditorStore } from '../editor/state/editorStore';
import { createAppEditorStore } from './createAppEditorStore';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from './runtimeMode';

const editorStore = createAppEditorStore(window.localStorage);

declare global {
  interface Window {
    __I2V_EDITOR_STORE__?: typeof editorStore;
  }
}

if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
  window.__I2V_EDITOR_STORE__ = editorStore;
}

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

interface AppProps {
  canvasEnabled?: boolean;
  store?: StoreApi<EditorStore>;
  storage?: Storage;
}

function sceneContentFingerprint(document: EditorStore['document']) {
  return encodeSceneDocument({
    ...document,
    sceneRevision: 0,
    specRevision: 0,
  });
}

function storedSceneHasSameContent(
  serialized: string | null,
  document: EditorStore['document'],
) {
  if (serialized === null) return false;
  try {
    return (
      sceneContentFingerprint(parseSceneDocument(serialized)) ===
      sceneContentFingerprint(document)
    );
  } catch {
    return false;
  }
}

export function App({
  canvasEnabled = true,
  store = editorStore,
  storage = window.localStorage,
}: AppProps) {
  const [webGLState, setWebGLState] = useState<WebGLState>('checking');
  const [companionState, setCompanionState] = useState(() =>
    consumeCompanionConnection({
      hash: window.location.hash,
      pathname: window.location.pathname,
      search: window.location.search,
      storage: window.sessionStorage,
      replaceUrl: (url) => window.history.replaceState(null, '', url),
    }),
  );
  const skipCompanionDiscoveryRef = useRef(false);
  const disconnectCompanion = useCallback(() => {
    skipCompanionDiscoveryRef.current = true;
    clearCompanionConnection(window.sessionStorage);
    setCompanionState({ connection: null, error: null });
  }, []);

  useEffect(() => {
    if (
      companionState.connection !== null ||
      skipCompanionDiscoveryRef.current
    ) {
      return;
    }
    let cancelled = false;
    void discoverCompanionConnection().then((connection) => {
      if (cancelled || connection === null) return;
      window.sessionStorage.setItem(
        COMPANION_SESSION_KEY,
        JSON.stringify(connection),
      );
      setCompanionState({ connection, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [companionState.connection]);

  useEffect(() => {
    const nextState = canUseWebGL() ? 'available' : 'fallback';
    const update = window.setTimeout(() => {
      setWebGLState(nextState);
    }, 0);

    return () => {
      window.clearTimeout(update);
    };
  }, []);

  useEffect(() => {
    let autosaveTimer: number | null = null;
    const readStoredScene = () => {
      try {
        return storage.getItem(SCENE_STORAGE_KEY);
      } catch {
        return null;
      }
    };
    let persistedBaseline = readStoredScene();
    let hasExternalConflict = false;
    const conflictMessage =
      '다른 탭에서 로컬 장면이 변경되었습니다. 최근 장면 열기로 변경 내용을 확인한 뒤 다시 저장하세요.';
    const clearAutosaveTimer = () => {
      if (autosaveTimer === null) return;
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SCENE_STORAGE_KEY) return;
      if (event.newValue === persistedBaseline) return;
      hasExternalConflict = true;
      clearAutosaveTimer();
      store.getState().setStatusMessage(conflictMessage);
    };
    const unsubscribe = store.subscribe((state, previousState) => {
      if (!state.isDirty && previousState.isDirty) {
        persistedBaseline = readStoredScene();
        hasExternalConflict = false;
      }
      if (state.document === previousState.document) return;

      clearAutosaveTimer();
      if (!state.isDirty) {
        const storedScene = readStoredScene();
        const shouldPersistRevision =
          encodeSceneDocument(state.document) !== storedScene &&
          (storedSceneHasSameContent(storedScene, state.document) ||
            (storedScene === null && previousState.isDirty));
        persistedBaseline = storedScene;
        hasExternalConflict = false;
        if (!shouldPersistRevision) return;
      }

      const documentToPersist = state.document;
      const previousSerialized = encodeSceneDocument(previousState.document);
      autosaveTimer = window.setTimeout(() => {
        autosaveTimer = null;
        const storedScene = readStoredScene();
        if (
          hasExternalConflict ||
          (storedScene !== persistedBaseline &&
            storedScene !== previousSerialized)
        ) {
          hasExternalConflict = true;
          store.getState().setStatusMessage(conflictMessage);
          return;
        }
        try {
          persistedBaseline = saveSceneDocument(storage, documentToPersist);
          hasExternalConflict = false;
          store.getState().markDocumentPersisted(documentToPersist);
          store.getState().setStatusMessage('장면을 자동 저장했습니다.');
        } catch (error) {
          store
            .getState()
            .setStatusMessage(
              error instanceof Error
                ? error.message
                : '장면을 자동 저장하지 못했습니다.',
            );
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    });
    window.addEventListener('storage', handleStorage);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorage);
      clearAutosaveTimer();
    };
  }, [storage, store]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!store.getState().isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [store]);

  return (
    <EditorShell
      store={store}
      storage={storage}
      webGLState={webGLState}
      canvasEnabled={canvasEnabled}
      companionConnection={companionState.connection}
      companionConnectionError={companionState.error}
      onDisconnectCompanion={disconnectCompanion}
    />
  );
}
