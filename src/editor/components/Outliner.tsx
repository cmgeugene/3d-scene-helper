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

  return (
    <section className="outliner" aria-labelledby="outliner-title">
      <h2 id="outliner-title">장면 목록</h2>
      <ul className="outliner-list">
        {objects.map((object) => (
          <li key={object.id}>
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
          </li>
        ))}
      </ul>
    </section>
  );
}
