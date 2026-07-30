import { useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { MAX_SCENE_NOTES_LENGTH } from '../constants';
import type { SceneObject } from '../persistence/sceneSchema';
import { CAMERA_SHOT_PRESETS, LENS_PRESETS } from '../presets/cameras';
import { LIGHTING_PRESETS } from '../presets/lighting';
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

const SUBJECT_MOTION_PRESETS = [
  { id: 'left', label: '왼쪽', direction: { x: -1, y: 0, z: 0 } },
  { id: 'right', label: '오른쪽', direction: { x: 1, y: 0, z: 0 } },
  { id: 'up', label: '위쪽', direction: { x: 0, y: 1, z: 0 } },
  { id: 'down', label: '아래쪽', direction: { x: 0, y: -1, z: 0 } },
  { id: 'forward', label: '앞쪽', direction: { x: 0, y: 0, z: -1 } },
  { id: 'back', label: '뒤쪽', direction: { x: 0, y: 0, z: 1 } },
] as const;

const CAMERA_MOTION_PRESETS = [
  {
    id: 'pan',
    label: '팬 오른쪽',
    motionType: 'pan',
    direction: { x: 1, y: 0, z: 0 },
  },
  {
    id: 'tilt',
    label: '틸트 업',
    motionType: 'tilt',
    direction: { x: 0, y: 1, z: 0 },
  },
  {
    id: 'dolly',
    label: '돌리 인',
    motionType: 'dolly',
    direction: { x: 0, y: 0, z: -1 },
  },
  {
    id: 'orbit',
    label: '오빗 오른쪽',
    motionType: 'orbit',
    direction: { x: 1, y: 0, z: 0 },
  },
] as const;

const DEFERRED_PANEL_MESSAGES: Record<
  Exclude<EditorPanel, 'scene' | 'camera' | 'lighting'>,
  string
> = {
  output: '출력 설정은 내보내기 구성 단계에서 제공됩니다.',
};

function SubjectMotionControls({
  store,
  selectedObject,
}: InspectorProps & { selectedObject: SceneObject | undefined }) {
  const guide = useStore(store, (state) => state.document.subjectMotionGuide);
  const sceneNotes = useStore(store, (state) => state.document.sceneNotes);
  const selectedPreset = SUBJECT_MOTION_PRESETS.find(
    ({ label }) => label === guide?.label,
  );
  const ownedGuide =
    guide?.subjectId === selectedObject?.id ? guide : undefined;

  return (
    <fieldset className="object-controls">
      <legend>I2V 모션 메모</legend>
      <label>
        <span>피사체 방향</span>
        <select
          aria-label="피사체 모션 방향"
          value={ownedGuide === undefined ? '' : (selectedPreset?.id ?? '')}
          disabled={selectedObject === undefined}
          onChange={(event) => {
            if (event.currentTarget.value === '') {
              store.getState().setSubjectMotionGuide(null);
              return;
            }
            const preset = SUBJECT_MOTION_PRESETS.find(
              ({ id }) => id === event.currentTarget.value,
            );
            if (preset !== undefined && selectedObject !== undefined) {
              store.getState().setSubjectMotionGuide({
                subjectId: selectedObject.id,
                direction: preset.direction,
                strength: ownedGuide?.strength ?? 0.5,
                label: preset.label,
              });
            }
          }}
        >
          <option value="">없음</option>
          {SUBJECT_MOTION_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>피사체 강도</span>
        <input
          aria-label="피사체 모션 강도"
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={ownedGuide?.strength ?? 0.5}
          disabled={ownedGuide === undefined}
          onChange={(event) => {
            if (ownedGuide !== undefined) {
              store.getState().setSubjectMotionGuide({
                ...ownedGuide,
                strength: Number(event.currentTarget.value),
              });
            }
          }}
        />
      </label>
      <label>
        <span>장면 노트</span>
        <textarea
          aria-label="장면 노트"
          maxLength={MAX_SCENE_NOTES_LENGTH}
          rows={3}
          value={sceneNotes}
          onChange={(event) => {
            store.getState().setSceneNotes(event.currentTarget.value);
          }}
        />
      </label>
      <small>
        {sceneNotes.length}/{MAX_SCENE_NOTES_LENGTH}
      </small>
    </fieldset>
  );
}

function CameraControls({ store }: InspectorProps) {
  const camera = useStore(store, (state) => state.document.outputCamera);
  const motionGuide = useStore(
    store,
    (state) => state.document.cameraMotionGuide,
  );
  const selectedMotionPreset = CAMERA_MOTION_PRESETS.find(
    ({ motionType }) => motionType === motionGuide?.motionType,
  );

  return (
    <div className="camera-controls">
      <label className="camera-field">
        <span>렌즈</span>
        <select
          aria-label="렌즈"
          value={camera.focalLengthMm}
          onChange={(event) => {
            const focalLengthMm = Number(event.currentTarget.value);
            const preset = LENS_PRESETS.find(
              (candidate) => candidate.focalLengthMm === focalLengthMm,
            );
            if (preset !== undefined) {
              store.getState().setCameraLens(preset.focalLengthMm);
            }
          }}
        >
          {LENS_PRESETS.map((preset) => (
            <option key={preset.focalLengthMm} value={preset.focalLengthMm}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>샷 프리셋</legend>
        <div className="shot-grid">
          {CAMERA_SHOT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                store.getState().applyCameraShot(preset.id);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="camera-actions">
        <button
          type="button"
          onClick={() => {
            store.getState().frameSelected();
          }}
        >
          선택 프레임 맞춤
        </button>
        <button
          type="button"
          onClick={() => {
            store.getState().lookAtSelected();
          }}
        >
          선택 바라보기
        </button>
      </div>
      <fieldset>
        <legend>I2V 카메라 모션</legend>
        <label className="camera-field">
          <span>유형과 방향</span>
          <select
            aria-label="카메라 모션"
            value={selectedMotionPreset?.id ?? ''}
            onChange={(event) => {
              if (event.currentTarget.value === '') {
                store.getState().setCameraMotionGuide(null);
                return;
              }
              const preset = CAMERA_MOTION_PRESETS.find(
                ({ id }) => id === event.currentTarget.value,
              );
              if (preset !== undefined) {
                store.getState().setCameraMotionGuide({
                  motionType: preset.motionType,
                  direction: preset.direction,
                  strength: motionGuide?.strength ?? 0.5,
                  label: preset.label,
                });
              }
            }}
          >
            <option value="">없음</option>
            {CAMERA_MOTION_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="camera-field">
          <span>강도</span>
          <input
            aria-label="카메라 모션 강도"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={motionGuide?.strength ?? 0.5}
            disabled={motionGuide === undefined}
            onChange={(event) => {
              if (motionGuide !== undefined) {
                store.getState().setCameraMotionGuide({
                  ...motionGuide,
                  strength: Number(event.currentTarget.value),
                });
              }
            }}
          />
        </label>
      </fieldset>
    </div>
  );
}

interface LightingNumberInputProps {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}

function LightingNumberInput({
  ariaLabel,
  value,
  min,
  max,
  onCommit,
}: LightingNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commitDraft = () => {
    if (draft !== null) {
      const nextValue = Number(draft);
      if (
        draft.trim() !== '' &&
        Number.isFinite(nextValue) &&
        nextValue >= min &&
        nextValue <= max
      ) {
        onCommit(nextValue);
      }
    }
    setDraft(null);
  };

  return (
    <input
      aria-label={ariaLabel}
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      onFocus={() => {
        setDraft(String(value));
      }}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(null);
        }
      }}
      onBlur={commitDraft}
    />
  );
}

function LightingControls({ store }: InspectorProps) {
  const lighting = useStore(store, (state) => state.document.lighting);
  const backgroundColor = useStore(
    store,
    (state) => state.document.background.color,
  );

  const setKeyDirection = (axis: (typeof AXES)[number], value: number) => {
    if (!Number.isFinite(value)) return;
    store.getState().setLighting({
      ...lighting,
      key: {
        ...lighting.key,
        direction: { ...lighting.key.direction, [axis]: value },
      },
    });
  };

  return (
    <div className="lighting-controls">
      <label className="lighting-field">
        <span>프리셋</span>
        <select
          aria-label="조명 프리셋"
          value={lighting.presetId}
          onChange={(event) => {
            const preset = LIGHTING_PRESETS.find(
              ({ id }) => id === event.currentTarget.value,
            );
            if (preset !== undefined) {
              store.getState().applyLightingPreset(preset.id);
            }
          }}
        >
          {LIGHTING_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <label className="lighting-field">
        <span>노출</span>
        <LightingNumberInput
          ariaLabel="노출"
          value={lighting.exposure}
          min={0.1}
          max={3}
          onCommit={(exposure) => {
            store.getState().setLighting({ ...lighting, exposure });
          }}
        />
      </label>
      <label className="lighting-field">
        <span>배경</span>
        <input
          aria-label="배경 색상"
          type="color"
          value={backgroundColor}
          onChange={(event) => {
            store.getState().setBackgroundColor(event.currentTarget.value);
          }}
        />
      </label>
      <fieldset>
        <legend>키 라이트 방향</legend>
        <div className="axis-fields">
          {AXES.map((axis) => (
            <label key={axis}>
              <span>{axis.toUpperCase()}</span>
              <LightingNumberInput
                ariaLabel={`키 라이트 방향 ${axis.toUpperCase()}`}
                value={lighting.key.direction[axis]}
                min={-3}
                max={3}
                onCommit={(value) => {
                  setKeyDirection(axis, value);
                }}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <label className="lighting-toggle">
        <input
          type="checkbox"
          checked={lighting.shadows.enabled}
          onChange={(event) => {
            store.getState().setLighting({
              ...lighting,
              shadows: {
                ...lighting.shadows,
                enabled: event.currentTarget.checked,
              },
            });
          }}
        />
        <span>그림자</span>
      </label>
      <button
        type="button"
        onClick={() => {
          store.getState().resetLightingPreset();
        }}
      >
        프리셋으로 재설정
      </button>
    </div>
  );
}

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
            <SubjectMotionControls
              store={store}
              selectedObject={selectedObject}
            />
          </>
        ) : activePanel === 'camera' ? (
          <CameraControls store={store} />
        ) : activePanel === 'lighting' ? (
          <LightingControls store={store} />
        ) : (
          <p className="panel-placeholder">
            {DEFERRED_PANEL_MESSAGES[activePanel]}
          </p>
        )}
      </div>
    </section>
  );
}
