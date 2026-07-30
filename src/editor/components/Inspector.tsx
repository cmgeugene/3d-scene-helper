import { useState } from 'react';
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

function createTransformDraft(object: SceneObject | undefined) {
  if (object === undefined) return {};
  return Object.fromEntries(
    TRANSFORM_GROUPS.flatMap(({ key }) =>
      AXES.map((axis) => [
        `${key}.${axis}`,
        String(object.transform[key][axis]),
      ]),
    ),
  );
}

export function Inspector({ store }: InspectorProps) {
  const selectedObject = useStore(store, (state) =>
    state.document.objects.find(({ id }) => id === state.selectedObjectId),
  );
  const activePanel = useStore(store, (state) => state.activePanel);
  const setActivePanel = useStore(store, (state) => state.setActivePanel);
  const [draftObject, setDraftObject] = useState(selectedObject);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    createTransformDraft(selectedObject),
  );
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());

  if (draftObject !== selectedObject) {
    setDraftObject(selectedObject);
    setDraft(createTransformDraft(selectedObject));
    setInvalidFields(new Set());
  }

  const commitDraft = (
    key: keyof SceneObject['transform'],
    axis: (typeof AXES)[number],
  ) => {
    if (selectedObject === undefined) return;
    const field = `${key}.${axis}`;
    const rawValue = draft[field] ?? '';
    const value = Number(rawValue);
    const valid =
      rawValue.trim() !== '' &&
      Number.isFinite(value) &&
      (key !== 'scale' || value > 0);

    if (!valid) {
      setDraft((current) => ({
        ...current,
        [field]: String(selectedObject.transform[key][axis]),
      }));
      setInvalidFields((current) => new Set(current).add(field));
      return;
    }

    const transform = structuredClone(selectedObject.transform);
    transform[key][axis] = value;
    store.getState().beginTransform();
    store.getState().commitTransform(transform);
  };

  return (
    <section className="inspector" aria-labelledby="inspector-title">
      <h2 id="inspector-title">속성</h2>
      <div className="inspector-tabs" role="group" aria-label="속성 패널">
        {PANEL_OPTIONS.map(({ id, label }) => (
          <button
            key={id}
            id={`inspector-tab-${id}`}
            type="button"
            aria-pressed={activePanel === id}
            aria-controls="inspector-panel"
            onClick={() => {
              setActivePanel(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="inspector-panel"
        role="region"
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
                          value={draft[`${key}.${axis}`] ?? ''}
                          disabled={selectedObject === undefined}
                          aria-invalid={invalidFields.has(`${key}.${axis}`)}
                          onChange={(event) => {
                            const field = `${key}.${axis}`;
                            const value = event.currentTarget.value;
                            setInvalidFields((current) => {
                              const next = new Set(current);
                              next.delete(field);
                              return next;
                            });
                            setDraft((current) => ({
                              ...current,
                              [field]: value,
                            }));
                          }}
                          onBlur={() => {
                            commitDraft(key, axis);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter')
                              event.currentTarget.blur();
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <fieldset className="object-controls">
              <legend>오브젝트</legend>
              <label>
                <span>색상</span>
                <input
                  aria-label="색상"
                  type="color"
                  value={selectedObject?.color ?? '#000000'}
                  disabled={selectedObject === undefined}
                  onChange={(event) => {
                    if (selectedObject !== undefined) {
                      store
                        .getState()
                        .setObjectColor(
                          selectedObject.id,
                          event.currentTarget.value,
                        );
                    }
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={selectedObject?.visible ?? false}
                  disabled={selectedObject === undefined}
                  onChange={(event) => {
                    if (selectedObject !== undefined) {
                      store
                        .getState()
                        .setObjectVisibility(
                          selectedObject.id,
                          event.currentTarget.checked,
                        );
                    }
                  }}
                />
                <span>표시</span>
              </label>
              <div className="object-actions">
                <button
                  type="button"
                  disabled={selectedObject === undefined}
                  onClick={() => {
                    if (selectedObject !== undefined) {
                      store.getState().duplicateObject(selectedObject.id);
                    }
                  }}
                >
                  복제
                </button>
                <button
                  type="button"
                  disabled={selectedObject === undefined}
                  onClick={() => {
                    if (selectedObject !== undefined) {
                      store.getState().deleteObject(selectedObject.id);
                    }
                  }}
                >
                  삭제
                </button>
              </div>
            </fieldset>
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
