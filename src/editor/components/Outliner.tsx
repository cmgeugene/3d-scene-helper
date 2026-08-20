import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorStore } from '../state/editorStore';

interface OutlinerProps {
  store: StoreApi<EditorStore>;
}

export function Outliner({ store }: OutlinerProps) {
  const objects = useStore(store, (state) => state.document.objects);
  const selectedObjectId = useStore(store, (state) => state.selectedObjectId);
  const selectObject = useStore(store, (state) => state.selectObject);
  const setObjectViewportSelectionLocked = useStore(
    store,
    (state) => state.setObjectViewportSelectionLocked,
  );

  return (
    <section className="outliner" aria-labelledby="outliner-title">
      <h2 id="outliner-title">장면 목록</h2>
      <ul className="outliner-list">
        {objects.map((object) => (
          <li key={object.id} className="outliner-row">
            <button
              type="button"
              className="outliner-item"
              aria-label={object.name}
              aria-pressed={selectedObjectId === object.id}
              onClick={() => {
                selectObject(object.id);
              }}
            >
              <span className="object-visibility" aria-hidden="true">
                {object.visible ? '●' : '○'}
              </span>
              <span>{object.name}</span>
            </button>
            <button
              type="button"
              className="outliner-lock"
              aria-label={`${object.name} 뷰포트 선택 잠금`}
              aria-pressed={object.viewportSelectionLocked}
              title={
                object.viewportSelectionLocked
                  ? '뷰포트 선택 잠금 해제'
                  : '뷰포트 선택 잠금'
              }
              onClick={() => {
                setObjectViewportSelectionLocked(
                  object.id,
                  !object.viewportSelectionLocked,
                );
              }}
            >
              <span aria-hidden="true">
                {object.viewportSelectionLocked ? '🔒' : '🔓'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
