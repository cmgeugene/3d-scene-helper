import { useEffect } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorStore } from '../state/editorStore';
import { isSceneShortcutTarget } from './shortcutTarget';

interface EditorShortcutsProps {
  store: StoreApi<EditorStore>;
}

export function EditorShortcuts({ store }: EditorShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSceneShortcutTarget(event.target)) return;

      const state = store.getState();
      const key = event.key.toLowerCase();
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (key === 'w' || key === 'e' || key === 'r')
      ) {
        state.setTransformMode(
          key === 'w' ? 'translate' : key === 'e' ? 'rotate' : 'scale',
        );
        event.preventDefault();
        return;
      }

      if (key === 'd' && (event.metaKey || event.ctrlKey)) {
        if (state.selectedObjectId !== null) {
          state.duplicateObject(state.selectedObjectId);
        }
        event.preventDefault();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selectedObjectId !== null) {
          state.deleteObject(state.selectedObjectId);
        }
        event.preventDefault();
        return;
      }

      if (event.key === 'Escape') {
        state.cancelTransform();
        state.selectObject(null);
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [store]);

  return null;
}
