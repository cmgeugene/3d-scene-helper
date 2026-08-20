import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { SceneObject, SpatialRelation } from '../persistence/sceneSchema';
import { MANNEQUIN_BODY_TYPE_PRESETS } from '../mannequin/mannequinBodyType';
import {
  MAX_GENERATION_NOTES_LENGTH,
  MAX_OBJECT_NAME_LENGTH,
  MAX_SEMANTIC_MEANING_LENGTH,
} from '../constants';
import { CAMERA_SHOT_PRESETS, LENS_PRESETS } from '../presets/cameras';
import { LIGHTING_PRESETS } from '../presets/lighting';
import {
  PHOTOGRAPHIC_F_STOPS,
  getPhotographicFStopAtIndex,
  getPhotographicFStopIndex,
} from '../scene/lensDepthOfField';
import type { EditorStore } from '../state/editorStore';
import type { EditorPanel } from '../types';
import { SemanticSceneSpecEditor } from './SemanticSceneSpecEditor';

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
  { id: 'semantic', label: '연출' },
  { id: 'camera', label: '카메라' },
  { id: 'lighting', label: '조명' },
  { id: 'output', label: '출력' },
];

const MANNEQUIN_POSE_OPTIONS = [
  { id: 'default', label: '기본 서기' },
  { id: 'a', label: 'A 포즈' },
  { id: 't', label: 'T 포즈' },
  { id: 'walk-ready', label: '걷기 준비' },
] as const;

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
  Exclude<EditorPanel, 'scene' | 'semantic' | 'camera' | 'lighting'>,
  string
> = {
  output: '출력 설정은 내보내기 구성 단계에서 제공됩니다.',
};

function SubjectMotionControls({
  store,
  selectedObject,
}: InspectorProps & { selectedObject: SceneObject | undefined }) {
  const guide = useStore(store, (state) => state.document.subjectMotionGuide);
  const selectedPreset = SUBJECT_MOTION_PRESETS.find(
    ({ label }) => label === guide?.label,
  );
  const ownedGuide =
    guide?.subjectId === selectedObject?.id ? guide : undefined;

  return (
    <fieldset className="object-controls">
      <legend>움직임 구도 가이드</legend>
      <label>
        <span>피사체 이동 방향</span>
        <select
          aria-label="피사체 이동 방향"
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
    </fieldset>
  );
}

function DepthOfFieldSlider({ store }: InspectorProps) {
  const camera = useStore(store, (state) => state.document.outputCamera);
  const committedIndex = getPhotographicFStopIndex(camera.depthOfField.fStop);
  const [draftIndex, setDraftIndex] = useState<number | null>(null);
  const draftIndexRef = useRef<number | null>(null);
  const pointerActiveRef = useRef(false);
  const sliderIndex = draftIndex ?? committedIndex;
  const displayedFStop =
    draftIndex === null
      ? camera.depthOfField.fStop
      : getPhotographicFStopAtIndex(draftIndex);
  const maxIndex = PHOTOGRAPHIC_F_STOPS.length - 1;

  const clearPointerDraft = () => {
    pointerActiveRef.current = false;
    draftIndexRef.current = null;
    setDraftIndex(null);
  };
  const commitPointerDraft = () => {
    if (!pointerActiveRef.current) return;
    const nextIndex = draftIndexRef.current;
    clearPointerDraft();
    if (nextIndex !== null && nextIndex !== committedIndex) {
      store.getState().setCameraFStop(getPhotographicFStopAtIndex(nextIndex));
    }
  };

  return (
    <div className="depth-slider-field">
      <div className="depth-slider-heading">
        <label htmlFor="camera-depth-slider">조리개/심도</label>
        <output htmlFor="camera-depth-slider">f/{displayedFStop}</output>
      </div>
      <input
        id="camera-depth-slider"
        aria-label="조리개/심도"
        aria-valuetext={`f/${displayedFStop}`}
        type="range"
        min={0}
        max={maxIndex}
        step={1}
        value={sliderIndex}
        disabled={camera.depthOfField.apertureMode !== 'manual'}
        onPointerDown={() => {
          pointerActiveRef.current = true;
          draftIndexRef.current = committedIndex;
          setDraftIndex(committedIndex);
        }}
        onChange={(event) => {
          if (!pointerActiveRef.current) return;
          const nextIndex = Number(event.currentTarget.value);
          if (!Number.isFinite(nextIndex)) return;
          draftIndexRef.current = nextIndex;
          setDraftIndex(nextIndex);
        }}
        onPointerUp={commitPointerDraft}
        onPointerCancel={clearPointerDraft}
        onBlur={commitPointerDraft}
        onKeyDown={(event) => {
          let nextIndex: number | undefined;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            nextIndex = committedIndex - 1;
          } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            nextIndex = committedIndex + 1;
          } else if (event.key === 'Home') {
            nextIndex = 0;
          } else if (event.key === 'End') {
            nextIndex = maxIndex;
          }
          if (nextIndex === undefined) return;
          event.preventDefault();
          clearPointerDraft();
          const nextFStop = getPhotographicFStopAtIndex(nextIndex);
          if (nextFStop !== camera.depthOfField.fStop) {
            store.getState().setCameraFStop(nextFStop);
          }
        }}
      />
      <div className="depth-slider-guidance" aria-hidden="true">
        <span>얕은 심도·강한 아웃포커스</span>
        <span>깊은 심도·약한 아웃포커스</span>
      </div>
    </div>
  );
}

function CameraControls({ store }: InspectorProps) {
  const camera = useStore(store, (state) => state.document.outputCamera);
  const focusContoursEnabled = useStore(
    store,
    (state) => state.document.mannequinAppearance.focusContoursEnabled,
  );
  const motionGuide = useStore(
    store,
    (state) => state.document.cameraMotionGuide,
  );
  const selectedMotionPreset = CAMERA_MOTION_PRESETS.find(
    ({ motionType }) => motionType === motionGuide?.motionType,
  );
  const layoutGuide = useStore(store, (state) => state.layoutGuide);

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
        <legend>시네마틱 심도</legend>
        <label className="camera-field">
          <input
            aria-label="심도 사용"
            type="checkbox"
            checked={camera.depthOfField.enabled}
            onChange={(event) => {
              store
                .getState()
                .setCameraDepthOfFieldEnabled(event.currentTarget.checked);
            }}
          />
          <span>시네마틱 심도 사용</span>
        </label>
        <label className="camera-field">
          <input
            aria-label="마네킹 초점 확인 등고선"
            type="checkbox"
            checked={focusContoursEnabled}
            onChange={(event) => {
              store
                .getState()
                .setMannequinFocusContoursEnabled(event.currentTarget.checked);
            }}
          />
          <span>마네킹 초점 확인 등고선</span>
        </label>
        <div role="radiogroup" aria-label="조리개 모드">
          <label>
            <input
              type="radio"
              name="camera-aperture-mode"
              aria-label="자동 조리개"
              checked={camera.depthOfField.apertureMode === 'auto'}
              onChange={() => store.getState().setCameraApertureMode('auto')}
            />
            <span>자동</span>
          </label>
          <label>
            <input
              type="radio"
              name="camera-aperture-mode"
              aria-label="수동 조리개"
              checked={camera.depthOfField.apertureMode === 'manual'}
              onChange={() => store.getState().setCameraApertureMode('manual')}
            />
            <span>수동</span>
          </label>
        </div>
        <DepthOfFieldSlider store={store} />
        <p>
          타겟 평면을 선명하게 유지하는 시네마틱 심도 근사입니다. 등고선은 모든
          마네킹과 PNG 표면에 함께 적용됩니다.
        </p>
      </fieldset>
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
      <fieldset>
        <legend>레이아웃 가이드 이미지</legend>
        <p>
          OutputCamera 프레임에만 겹칩니다. Clean PNG와 생성 첨부에는 들어가지
          않습니다.
        </p>
        <label className="camera-field">
          <span>이미지</span>
          <input
            aria-label="레이아웃 가이드 이미지"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              store.getState().setLayoutGuideFile(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
        <label className="camera-field">
          <span>불투명도 {Math.round(layoutGuide.opacity * 100)}%</span>
          <input
            aria-label="레이아웃 가이드 불투명도"
            type="range"
            min={0}
            max={100}
            step={1}
            disabled={layoutGuide.objectUrl === null}
            value={Math.round(layoutGuide.opacity * 100)}
            onChange={(event) => {
              store
                .getState()
                .setLayoutGuideOpacity(Number(event.currentTarget.value) / 100);
            }}
          />
        </label>
        {layoutGuide.fileName === null ? null : <p>{layoutGuide.fileName}</p>}
        <button
          type="button"
          disabled={layoutGuide.objectUrl === null}
          onClick={() => store.getState().setLayoutGuideFile(null)}
        >
          가이드 이미지 제거
        </button>
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
            store.getState().targetSelected();
          }}
        >
          선택을 타겟·초점으로 (T)
        </button>
      </div>
      <fieldset>
        <legend>카메라 이동 가이드</legend>
        <label className="camera-field">
          <span>이동 유형과 방향</span>
          <select
            aria-label="카메라 이동 방향"
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
      </fieldset>
    </div>
  );
}

interface LightingNumberInputProps {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}

function LightingNumberInput({
  ariaLabel,
  value,
  min,
  max,
  disabled = false,
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
      disabled={disabled}
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
  return {
    ...Object.fromEntries(
      TRANSFORM_GROUPS.flatMap(({ key }) =>
        AXES.map((axis) => [
          `${key}.${axis}`,
          String(object.transform[key][axis]),
        ]),
      ),
    ),
    name: object.name,
    'semantic.meaning': object.semantic?.meaning ?? '',
    'semantic.generationNotes': object.semantic?.generationNotes ?? '',
    'visualization.proxyOpacity': String(object.visualization.proxyOpacity),
    'appearanceIntent.materialNotes': object.appearanceIntent.materialNotes,
  };
}

export function Inspector({ store }: InspectorProps) {
  const objects = useStore(store, (state) => state.document.objects);
  const spatialRelations = useStore(
    store,
    (state) => state.document.spatialRelations,
  );
  const selectedObject = useStore(store, (state) =>
    state.document.objects.find(({ id }) => id === state.selectedObjectId),
  );
  const activePanel = useStore(store, (state) => state.activePanel);
  const mannequinTool = useStore(store, (state) => state.mannequinTool);
  const setActivePanel = useStore(store, (state) => state.setActivePanel);
  const [draftObject, setDraftObject] = useState(selectedObject);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    createTransformDraft(selectedObject),
  );
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [containedObjectId, setContainedObjectId] = useState('');
  const [containmentVisibility, setContainmentVisibility] = useState<
    'occluded' | 'through-opening' | 'through-transparent-surface' | 'cutaway'
  >('occluded');
  const [containmentError, setContainmentError] = useState(false);
  const [mirrorError, setMirrorError] = useState(false);

  if (draftObject !== selectedObject) {
    setDraftObject(selectedObject);
    setDraft(createTransformDraft(selectedObject));
    setInvalidFields(new Set());
    setContainedObjectId('');
    setContainmentVisibility('occluded');
    setContainmentError(false);
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

  const commitObjectName = () => {
    if (selectedObject === undefined) return;
    const name = (draft.name ?? '').trim();
    if (name === '' || name.length > MAX_OBJECT_NAME_LENGTH) {
      setDraft((current) => ({ ...current, name: selectedObject.name }));
      setInvalidFields((current) => new Set(current).add('name'));
      return;
    }
    store.getState().renameObject(selectedObject.id, name);
  };

  const commitSemantic = () => {
    if (selectedObject === undefined) return;
    const meaning = (draft['semantic.meaning'] ?? '').trim();
    const generationNotes = (draft['semantic.generationNotes'] ?? '').trim();
    store
      .getState()
      .setObjectSemantic(
        selectedObject.id,
        meaning === '' && generationNotes === ''
          ? undefined
          : { meaning, generationNotes },
      );
  };

  const commitProxyOpacity = () => {
    if (selectedObject === undefined) return;
    const field = 'visualization.proxyOpacity';
    const value = Number(draft[field]);
    if (!Number.isFinite(value) || value < 0.05 || value > 1) {
      setDraft((current) => ({
        ...current,
        [field]: String(selectedObject.visualization.proxyOpacity),
      }));
      setInvalidFields((current) => new Set(current).add(field));
      return;
    }
    store.getState().setObjectProxyOpacity(selectedObject.id, value);
  };

  const commitMaterialNotes = () => {
    if (selectedObject === undefined) return;
    store.getState().setObjectAppearanceIntent(selectedObject.id, {
      ...selectedObject.appearanceIntent,
      materialNotes: (draft['appearanceIntent.materialNotes'] ?? '').trim(),
    });
  };

  const containmentRelations = spatialRelations.filter(
    (relation): relation is Extract<SpatialRelation, { type: 'contains' }> =>
      relation.type === 'contains' &&
      relation.containerObjectId === selectedObject?.id,
  );
  const containmentCandidates = objects.filter(
    ({ id }) => id !== selectedObject?.id,
  );
  const reflectionRelation = spatialRelations.find(
    (relation): relation is Extract<SpatialRelation, { type: 'reflects' }> =>
      relation.type === 'reflects' &&
      relation.mirrorObjectId === selectedObject?.id,
  );
  const reflectedObjectIds = reflectionRelation?.reflectedObjectIds ?? [];
  const reflectionCandidates = objects.filter(
    (object) =>
      object.id !== selectedObject?.id &&
      object.appearanceIntent.surfaceType !== 'mirror',
  );
  const effectiveContainedObjectId = containmentCandidates.some(
    ({ id }) => id === containedObjectId,
  )
    ? containedObjectId
    : (containmentCandidates[0]?.id ?? '');

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
              <label className="object-text-field">
                <span>이름</span>
                <input
                  aria-label="오브젝트 이름"
                  type="text"
                  value={draft.name ?? ''}
                  maxLength={MAX_OBJECT_NAME_LENGTH}
                  disabled={selectedObject === undefined}
                  aria-invalid={invalidFields.has('name')}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setInvalidFields((current) => {
                      const next = new Set(current);
                      next.delete('name');
                      return next;
                    });
                    setDraft((current) => ({ ...current, name }));
                  }}
                  onBlur={commitObjectName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
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
            <fieldset className="object-controls">
              <legend>이미지 생성 의미</legend>
              <label className="object-text-field">
                <span>실제 의미</span>
                <input
                  aria-label="오브젝트 실제 의미"
                  type="text"
                  placeholder="예: 빨간 원형 포차 테이블 상판"
                  value={draft['semantic.meaning'] ?? ''}
                  maxLength={MAX_SEMANTIC_MEANING_LENGTH}
                  disabled={selectedObject === undefined}
                  onChange={(event) => {
                    const meaning = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      'semantic.meaning': meaning,
                    }));
                  }}
                  onBlur={commitSemantic}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
              <label className="object-text-field">
                <span>생성 메모</span>
                <textarea
                  aria-label="오브젝트 생성 메모"
                  placeholder="예: 3D 위치와 크기는 유지하고 광택 있는 빨간 플라스틱으로 표현"
                  value={draft['semantic.generationNotes'] ?? ''}
                  maxLength={MAX_GENERATION_NOTES_LENGTH}
                  rows={3}
                  disabled={selectedObject === undefined}
                  onChange={(event) => {
                    const generationNotes = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      'semantic.generationNotes': generationNotes,
                    }));
                  }}
                  onBlur={commitSemantic}
                />
              </label>
            </fieldset>
            <fieldset className="object-controls">
              <legend>프록시 표시와 최종 표면</legend>
              <label className="object-text-field">
                <span>프록시 불투명도</span>
                <input
                  aria-label="프록시 불투명도"
                  type="number"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={draft['visualization.proxyOpacity'] ?? ''}
                  disabled={selectedObject === undefined}
                  aria-invalid={invalidFields.has('visualization.proxyOpacity')}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setInvalidFields((current) => {
                      const next = new Set(current);
                      next.delete('visualization.proxyOpacity');
                      return next;
                    });
                    setDraft((current) => ({
                      ...current,
                      'visualization.proxyOpacity': value,
                    }));
                  }}
                  onBlur={commitProxyOpacity}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
              <span className="field-help">
                편집과 내부 배치 확인용 표시입니다. 최종 이미지의 투명 재질을
                의미하지 않습니다.
              </span>
              <label className="object-text-field">
                <span>최종 표면 타입</span>
                <select
                  aria-label="최종 표면 타입"
                  value={
                    selectedObject?.appearanceIntent.surfaceType ?? 'opaque'
                  }
                  disabled={selectedObject === undefined}
                  onChange={(event) => {
                    if (selectedObject === undefined) return;
                    store
                      .getState()
                      .setObjectAppearanceIntent(selectedObject.id, {
                        ...selectedObject.appearanceIntent,
                        surfaceType: event.currentTarget.value as
                          'opaque' | 'transparent' | 'translucent' | 'mirror',
                      });
                  }}
                >
                  <option value="opaque">불투명</option>
                  <option value="transparent">투명</option>
                  <option value="translucent">반투명</option>
                  <option
                    value="mirror"
                    disabled={selectedObject?.kind !== 'plane'}
                  >
                    평면 거울
                  </option>
                </select>
              </label>
              <label className="object-text-field">
                <span>최종 재질 메모</span>
                <textarea
                  aria-label="최종 재질 메모"
                  value={draft['appearanceIntent.materialNotes'] ?? ''}
                  maxLength={MAX_GENERATION_NOTES_LENGTH}
                  rows={2}
                  disabled={selectedObject === undefined}
                  onChange={(event) => {
                    const materialNotes = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      'appearanceIntent.materialNotes': materialNotes,
                    }));
                  }}
                  onBlur={commitMaterialNotes}
                />
              </label>
            </fieldset>
            {selectedObject?.kind === 'plane' &&
            selectedObject.appearanceIntent.surfaceType === 'mirror' ? (
              <fieldset className="object-controls">
                <legend>평면 거울 반사</legend>
                <span className="field-help">
                  거울에 반드시 비쳐야 할 기존 오브젝트를 지정합니다. 곡면·재귀
                  반사는 지원하지 않습니다.
                </span>
                {reflectionCandidates.length === 0 ? (
                  <span className="field-help">선택할 대상이 없습니다.</span>
                ) : (
                  <div
                    className="mirror-target-list"
                    role="group"
                    aria-label="거울 반사 대상"
                  >
                    {reflectionCandidates.map((candidate) => (
                      <label key={candidate.id}>
                        <input
                          type="checkbox"
                          aria-label={`${candidate.name} 반사 대상`}
                          checked={reflectedObjectIds.includes(candidate.id)}
                          onChange={(event) => {
                            if (selectedObject === undefined) return;
                            const nextTargetIds = event.currentTarget.checked
                              ? [...reflectedObjectIds, candidate.id]
                              : reflectedObjectIds.filter(
                                  (objectId) => objectId !== candidate.id,
                                );
                            const updated = store
                              .getState()
                              .setMirrorReflectionTargets(
                                selectedObject.id,
                                nextTargetIds,
                              );
                            setMirrorError(!updated);
                          }}
                        />
                        <span>{candidate.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                {mirrorError ? (
                  <span role="alert">
                    유효하지 않은 반사 대상은 저장할 수 없습니다.
                  </span>
                ) : null}
                {reflectedObjectIds.length === 0 ? (
                  <span className="field-help">
                    아직 지정된 필수 반사 대상이 없습니다.
                  </span>
                ) : null}
              </fieldset>
            ) : null}
            <fieldset className="object-controls">
              <legend>내부 오브젝트 관계</legend>
              <label className="object-text-field">
                <span>내부 오브젝트</span>
                <select
                  aria-label="내부 오브젝트"
                  value={effectiveContainedObjectId}
                  disabled={
                    selectedObject === undefined ||
                    containmentCandidates.length === 0
                  }
                  onChange={(event) => {
                    setContainedObjectId(event.currentTarget.value);
                    setContainmentError(false);
                  }}
                >
                  {containmentCandidates.map((object) => (
                    <option key={object.id} value={object.id}>
                      {object.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="object-text-field">
                <span>최종 가시성</span>
                <select
                  aria-label="내부 오브젝트 가시성"
                  value={containmentVisibility}
                  disabled={selectedObject === undefined}
                  onChange={(event) => {
                    setContainmentVisibility(
                      event.currentTarget.value as typeof containmentVisibility,
                    );
                    setContainmentError(false);
                  }}
                >
                  <option value="occluded">외부에서 보이지 않음</option>
                  <option value="through-opening">열린 부분을 통해 보임</option>
                  <option value="through-transparent-surface">
                    투명 표면을 통해 보임
                  </option>
                  <option value="cutaway">컷어웨이로 내부 표시</option>
                </select>
              </label>
              <button
                type="button"
                disabled={
                  selectedObject === undefined ||
                  effectiveContainedObjectId === ''
                }
                onClick={() => {
                  if (selectedObject === undefined) return;
                  const created = store
                    .getState()
                    .addContainmentRelation(
                      selectedObject.id,
                      effectiveContainedObjectId,
                      containmentVisibility,
                    );
                  setContainmentError(created === null);
                }}
              >
                내부 관계 추가
              </button>
              {containmentError ? (
                <span role="alert">
                  중복, 순환 또는 유효하지 않은 내부 관계는 추가할 수 없습니다.
                </span>
              ) : null}
              {containmentRelations.length === 0 ? (
                <span className="field-help">등록된 내부 관계가 없습니다.</span>
              ) : (
                <ul className="containment-list" aria-label="내부 관계 목록">
                  {containmentRelations.map((relation) => (
                    <li key={relation.id}>
                      <span>
                        {objects.find(
                          ({ id }) => id === relation.containedObjectId,
                        )?.name ?? relation.containedObjectId}{' '}
                        · {relation.visibility}
                      </span>
                      <button
                        type="button"
                        aria-label={`${relation.id} 내부 관계 삭제`}
                        onClick={() => {
                          store.getState().removeSpatialRelation(relation.id);
                        }}
                      >
                        삭제
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            {selectedObject?.kind === 'mannequin' ? (
              <>
                <fieldset className="object-controls">
                  <legend>마네킹 체형</legend>
                  <div className="shot-grid">
                    {MANNEQUIN_BODY_TYPE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={
                          (selectedObject.mannequinBodyType ?? 'standard') ===
                          preset.id
                        }
                        onClick={() => {
                          store
                            .getState()
                            .applyMannequinBodyTypePreset(preset.id);
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="object-controls">
                  <legend>마네킹 포즈</legend>
                  <div className="shot-grid">
                    {MANNEQUIN_POSE_OPTIONS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={
                          selectedObject.mannequinPose?.id === preset.id
                        }
                        onClick={() => {
                          store.getState().applyMannequinPosePreset(preset.id);
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="object-actions">
                    <button
                      type="button"
                      aria-pressed={mannequinTool === 'object'}
                      onClick={() => {
                        store.getState().setMannequinTool('object');
                      }}
                    >
                      오브젝트 변형
                    </button>
                    <button
                      type="button"
                      aria-pressed={mannequinTool === 'ik'}
                      onClick={() => {
                        store.getState().setMannequinTool('ik');
                      }}
                    >
                      손 IK · 발/팔꿈치/무릎
                    </button>
                  </div>
                </fieldset>
              </>
            ) : null}
            <SubjectMotionControls
              store={store}
              selectedObject={selectedObject}
            />
          </>
        ) : activePanel === 'semantic' ? (
          <SemanticSceneSpecEditor store={store} />
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
