import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AddableSceneObjectKind } from '../persistence/sceneSchema';
import { getNextAssetPosition } from '../scene/sceneObjectModel';
import type { EditorStore } from '../state/editorStore';

interface AssetPanelProps {
  store: StoreApi<EditorStore>;
}

const ASSETS: ReadonlyArray<{
  kind: AddableSceneObjectKind;
  label: string;
}> = [
  { kind: 'cube', label: '큐브' },
  { kind: 'sphere', label: '구' },
  { kind: 'cylinder', label: '원기둥' },
  { kind: 'plane', label: '평면' },
  { kind: 'rounded-cube', label: '라운드 큐브' },
  { kind: 'bent-plane', label: '곡면' },
  { kind: 'triangle', label: '정삼각형' },
  { kind: 'mannequin', label: '마네킹' },
  { kind: 'room', label: '방 세트' },
];

export function AssetPanel({ store }: AssetPanelProps) {
  const objects = useStore(store, (state) => state.document.objects);
  const addObject = useStore(store, (state) => state.addObject);

  return (
    <section className="asset-panel" aria-labelledby="asset-panel-title">
      <h2 id="asset-panel-title">오브젝트 추가</h2>
      <p className="panel-description">장면에 배치할 기본 형태를 고르세요.</p>
      <div className="asset-grid">
        {ASSETS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            aria-label={`${label} 추가`}
            onClick={() => {
              addObject({
                kind,
                position:
                  kind === 'room'
                    ? { x: 0, z: 0 }
                    : getNextAssetPosition(objects),
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
