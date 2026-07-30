import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorStore } from '../state/editorStore';
import type { TransformMode } from '../types';

interface StatusBarProps {
  store: StoreApi<EditorStore>;
}

const TRANSFORM_MODE_LABELS: Record<TransformMode, string> = {
  translate: '이동',
  rotate: '회전',
  scale: '크기',
};

export function StatusBar({ store }: StatusBarProps) {
  const selectedObject = useStore(store, (state) =>
    state.document.objects.find(({ id }) => id === state.selectedObjectId),
  );
  const transformMode = useStore(store, (state) => state.transformMode);
  const aspectRatioId = useStore(
    store,
    (state) => state.document.output.aspectRatioId,
  );
  const statusMessage = useStore(store, (state) => state.statusMessage);
  const summary = `${
    selectedObject === undefined ? '선택 없음' : `${selectedObject.name} 선택됨`
  } · ${TRANSFORM_MODE_LABELS[transformMode]} 모드 · ${aspectRatioId}`;

  return (
    <footer className="status-bar" aria-live="polite">
      {statusMessage === null ? summary : `${statusMessage} · ${summary}`}
    </footer>
  );
}
