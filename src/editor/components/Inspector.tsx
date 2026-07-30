import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { SceneObject } from '../persistence/sceneSchema';
import type { EditorStore } from '../state/editorStore';
import type { EditorPanel } from '../types';

interface InspectorProps {
  store: StoreApi<EditorStore>;
}

const AXES = ['x', 'y', 'z'] as const;
const TRANSFORM_GROUPS: ReadonlyArray<{
  key: keyof SceneObject['transform'];
  label: string;
}> = [
  { key: 'position', label: '위치' },
  { key: 'rotationDeg', label: '회전' },
  { key: 'scale', label: '크기' },
];

const PANEL_OPTIONS: ReadonlyArray<{
  id: EditorPanel;
  label: string;
}> = [
  { id: 'scene', label: '장면' },
  { id: 'camera', label: '카메라' },
  { id: 'lighting', label: '조명' },
  { id: 'output', label: '출력' },
];

const DEFERRED_PANEL_MESSAGES: Record<Exclude<EditorPanel, 'scene'>, string> = {
  camera: '카메라 설정은 카메라 구성 단계에서 제공됩니다.',
  lighting: '조명 설정은 조명 구성 단계에서 제공됩니다.',
  output: '출력 설정은 내보내기 구성 단계에서 제공됩니다.',
};

export function Inspector({ store }: InspectorProps) {
  const selectedObject = useStore(store, (state) =>
    state.document.objects.find(({ id }) => id === state.selectedObjectId),
  );
  const activePanel = useStore(store, (state) => state.activePanel);
  const setActivePanel = useStore(store, (state) => state.setActivePanel);

  return (
    <section className="inspector" aria-labelledby="inspector-title">
      <h2 id="inspector-title">속성</h2>
      <div className="inspector-tabs" role="tablist" aria-label="속성 패널">
        {PANEL_OPTIONS.map(({ id, label }) => (
          <button
            key={id}
            id={`inspector-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activePanel === id}
            aria-controls={`inspector-panel-${id}`}
            onClick={() => {
              setActivePanel(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id={`inspector-panel-${activePanel}`}
        role="tabpanel"
        aria-labelledby={`inspector-tab-${activePanel}`}
      >
        {activePanel === 'scene' ? (
          <>
            <p className="selection-summary">
              {selectedObject?.name ?? '선택한 오브젝트가 없습니다.'}
            </p>
            <div className="transform-fields">
              {TRANSFORM_GROUPS.map(({ key, label }) => (
                <fieldset key={key}>
                  <legend>{label}</legend>
                  <div className="axis-fields">
                    {AXES.map((axis) => (
                      <label key={axis}>
                        <span>{axis.toUpperCase()}</span>
                        <input
                          aria-label={`${label} ${axis.toUpperCase()}`}
                          type="number"
                          step={key === 'rotationDeg' ? 1 : 0.01}
                          value={selectedObject?.transform[key][axis] ?? ''}
                          disabled={selectedObject === undefined}
                          readOnly
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </>
        ) : (
          <p className="panel-placeholder">
            {DEFERRED_PANEL_MESSAGES[activePanel]}
          </p>
        )}
      </div>
    </section>
  );
}
