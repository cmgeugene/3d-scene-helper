import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { ASPECT_RATIO_PRESETS } from '../presets/aspectRatios';
import type { EditorStore } from '../state/editorStore';
import type { GuideVisibility } from '../types';

interface TopToolbarProps {
  store: StoreApi<EditorStore>;
}

const GUIDE_OPTIONS: ReadonlyArray<{
  key: keyof GuideVisibility;
  label: string;
}> = [
  { key: 'thirds', label: '3분할선' },
  { key: 'center', label: '중앙 십자선' },
  { key: 'actionSafe', label: '액션 안전 영역' },
  { key: 'titleSafe', label: '타이틀 안전 영역' },
];

export function TopToolbar({ store }: TopToolbarProps) {
  const output = useStore(store, (state) => state.document.output);
  const guideVisibility = useStore(store, (state) => state.guideVisibility);
  const resetScene = useStore(store, (state) => state.resetScene);
  const setOutput = useStore(store, (state) => state.setOutput);
  const setGuideVisibility = useStore(
    store,
    (state) => state.setGuideVisibility,
  );

  return (
    <header className="top-toolbar">
      <h1>I2V 3D Scene Helper</h1>
      <nav className="toolbar-actions" aria-label="장면 도구">
        <div className="toolbar-group" role="group" aria-label="장면 시작">
          <button type="button" onClick={resetScene}>
            새 장면
          </button>
          <button type="button" onClick={resetScene}>
            기본 장면으로 초기화
          </button>
        </div>

        <label className="toolbar-field">
          <span>화면비</span>
          <select
            value={output.aspectRatioId}
            onChange={(event) => {
              const preset = ASPECT_RATIO_PRESETS.find(
                ({ id }) => id === event.currentTarget.value,
              );
              if (preset !== undefined) {
                setOutput({
                  aspectRatioId: preset.id,
                  ...preset.defaultOutput,
                  mode: output.mode,
                });
              }
            }}
          >
            {ASPECT_RATIO_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="guide-controls">
          <legend>구도 가이드</legend>
          {GUIDE_OPTIONS.map(({ key, label }) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={guideVisibility[key]}
                onChange={(event) => {
                  setGuideVisibility({ [key]: event.currentTarget.checked });
                }}
              />
              <span>{label}</span>
            </label>
          ))}
          <button
            className="guide-clear"
            type="button"
            onClick={() => {
              setGuideVisibility({
                thirds: false,
                center: false,
                actionSafe: false,
                titleSafe: false,
                motion: false,
              });
            }}
          >
            모든 가이드 숨기기
          </button>
        </fieldset>

        <div className="toolbar-group" role="group" aria-label="파일과 출력">
          <button
            type="button"
            disabled
            title="로컬 저장은 S08에서 제공됩니다."
          >
            로컬 저장
          </button>
          <button
            type="button"
            disabled
            title="장면 불러오기는 S08에서 제공됩니다."
          >
            최근 장면 열기
          </button>
          <button
            type="button"
            disabled
            title="JSON 가져오기는 S08에서 제공됩니다."
          >
            JSON 가져오기
          </button>
          <button
            type="button"
            disabled
            title="JSON 내보내기는 S08에서 제공됩니다."
          >
            JSON 내보내기
          </button>
          <button
            type="button"
            disabled
            title="PNG 내보내기는 S09에서 제공됩니다."
          >
            PNG 내보내기
          </button>
        </div>
      </nav>
    </header>
  );
}
