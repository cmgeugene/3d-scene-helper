import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import {
  calculateAspectLockedDimensions,
  createPngFilename,
  downloadPngBlob,
  OUTPUT_PRESETS,
  validateOutputDimensions,
  type FrameExportHandler,
  type OutputPresetId,
} from '../export/exportFrame';
import { sceneDocumentSchema } from '../persistence/sceneSchema';
import {
  ASPECT_RATIO_PRESETS,
  type AspectRatioId,
} from '../presets/aspectRatios';
import type { EditorStore } from '../state/editorStore';

interface ExportDialogProps {
  store: StoreApi<EditorStore>;
  exportFrame: FrameExportHandler;
  onClose: () => void;
  download?: (blob: Blob, filename: string) => void;
}

type ResolutionSelection = OutputPresetId | 'custom';
type DimensionName = 'width' | 'height';

const DIMENSION_ERROR = '너비와 높이는 각각 64..4096 픽셀의 정수여야 합니다.';

function findSelectedPreset(output: EditorStore['document']['output']) {
  return OUTPUT_PRESETS.find(
    (preset) =>
      preset.aspectRatioId === output.aspectRatioId &&
      preset.width === output.width &&
      preset.height === output.height,
  );
}

export function ExportDialog({
  store,
  exportFrame,
  onClose,
  download = downloadPngBlob,
}: ExportDialogProps) {
  const currentOutput = useStore(store, (state) => state.document.output);
  const filenameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialPreset = findSelectedPreset(currentOutput);
  const [filename, setFilename] = useState('i2v-start-frame');
  const [aspectRatioId, setAspectRatioId] = useState<AspectRatioId>(
    currentOutput.aspectRatioId,
  );
  const [resolution, setResolution] = useState<ResolutionSelection>(
    initialPreset?.id ?? 'custom',
  );
  const [widthDraft, setWidthDraft] = useState(String(currentOutput.width));
  const [heightDraft, setHeightDraft] = useState(String(currentOutput.height));
  const [mode, setMode] = useState<'clean' | 'reference'>('clean');
  const [invalidDimension, setInvalidDimension] =
    useState<DimensionName | null>(null);
  const [dimensionError, setDimensionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const parsedDimensions = useMemo(
    () => ({ width: Number(widthDraft), height: Number(heightDraft) }),
    [heightDraft, widthDraft],
  );

  useEffect(() => {
    filenameRef.current?.focus();
  }, []);

  const closeWithoutExport = () => {
    if (isBusy) return;
    store
      .getState()
      .setExportState({ status: 'idle', progress: 0, error: null });
    onClose();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWithoutExport();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const applyDimensions = (
    nextAspectRatioId: AspectRatioId,
    width: number,
    height: number,
  ) => {
    setAspectRatioId(nextAspectRatioId);
    setWidthDraft(String(width));
    setHeightDraft(String(height));
    setInvalidDimension(null);
    setDimensionError(null);
    setExportError(null);
  };

  const handleDimensionChange = (
    dimension: DimensionName,
    rawValue: string,
  ) => {
    if (dimension === 'width') setWidthDraft(rawValue);
    else setHeightDraft(rawValue);
    setResolution('custom');
    setExportError(null);

    if (rawValue.trim() === '') {
      setInvalidDimension(dimension);
      setDimensionError(DIMENSION_ERROR);
      return;
    }

    try {
      const locked = calculateAspectLockedDimensions(
        aspectRatioId,
        dimension,
        Number(rawValue),
      );
      setWidthDraft(String(locked.width));
      setHeightDraft(String(locked.height));
      setInvalidDimension(null);
      setDimensionError(null);
    } catch {
      setInvalidDimension(dimension);
      setDimensionError(DIMENSION_ERROR);
    }
  };

  const handleSubmit = async () => {
    if (isBusy || dimensionError !== null) return;

    let dimensions: { width: number; height: number };
    try {
      dimensions = validateOutputDimensions(aspectRatioId, parsedDimensions);
    } catch {
      setInvalidDimension('width');
      setDimensionError(DIMENSION_ERROR);
      return;
    }

    const output = {
      aspectRatioId,
      ...dimensions,
      mode,
    } as const;
    const state = store.getState();
    const document = sceneDocumentSchema.parse({
      ...structuredClone(state.document),
      output,
    });

    setIsBusy(true);
    setExportError(null);
    state.setExportState({ status: 'preparing', progress: 0.1, error: null });
    state.setExportState({ status: 'exporting', progress: 0.5, error: null });

    try {
      const blob = await exportFrame({
        document,
        guideVisibility: structuredClone(state.guideVisibility),
      });
      const safeFilename = createPngFilename(filename);
      download(blob, safeFilename);
      store.getState().setOutput(output);
      store
        .getState()
        .setExportState({ status: 'complete', progress: 1, error: null });
      store
        .getState()
        .setStatusMessage(
          `${dimensions.width}×${dimensions.height} PNG를 내보냈습니다.`,
        );
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '알 수 없는 출력 오류입니다.';
      setExportError(message);
      store
        .getState()
        .setExportState({ status: 'error', progress: 0, error: message });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="export-dialog-backdrop">
      <div
        ref={dialogRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id="export-dialog-title">PNG 내보내기</h2>

        <label className="export-dialog-field">
          <span>파일 이름</span>
          <span className="export-filename-input">
            <input
              ref={filenameRef}
              aria-label="파일 이름"
              value={filename}
              disabled={isBusy}
              onChange={(event) => setFilename(event.currentTarget.value)}
            />
            <span aria-hidden="true">.png</span>
          </span>
        </label>

        <label className="export-dialog-field">
          <span>화면비</span>
          <select
            value={aspectRatioId}
            disabled={isBusy}
            onChange={(event) => {
              const nextAspectRatioId = event.currentTarget
                .value as AspectRatioId;
              const aspectPreset = ASPECT_RATIO_PRESETS.find(
                ({ id }) => id === nextAspectRatioId,
              );
              if (aspectPreset === undefined) return;
              const preset = OUTPUT_PRESETS.find(
                ({ aspectRatioId: presetAspect }) =>
                  presetAspect === nextAspectRatioId,
              );
              if (preset !== undefined) {
                setResolution(preset.id);
                applyDimensions(
                  preset.aspectRatioId,
                  preset.width,
                  preset.height,
                );
              } else {
                setResolution('custom');
                applyDimensions(
                  nextAspectRatioId,
                  aspectPreset.defaultOutput.width,
                  aspectPreset.defaultOutput.height,
                );
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

        <label className="export-dialog-field">
          <span>해상도</span>
          <select
            value={resolution}
            disabled={isBusy}
            onChange={(event) => {
              const value = event.currentTarget.value as ResolutionSelection;
              setResolution(value);
              if (value === 'custom') return;
              const preset = OUTPUT_PRESETS.find(({ id }) => id === value);
              if (preset !== undefined) {
                applyDimensions(
                  preset.aspectRatioId,
                  preset.width,
                  preset.height,
                );
              }
            }}
          >
            {OUTPUT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value="custom">사용자 지정</option>
          </select>
        </label>

        <fieldset className="export-custom-dimensions">
          <legend>사용자 지정</legend>
          <label>
            <span>너비</span>
            <input
              aria-label="사용자 지정 너비"
              type="number"
              inputMode="numeric"
              min="64"
              max="4096"
              step="1"
              value={widthDraft}
              disabled={isBusy || resolution !== 'custom'}
              aria-invalid={invalidDimension === 'width'}
              onChange={(event) =>
                handleDimensionChange('width', event.currentTarget.value)
              }
            />
          </label>
          <span aria-hidden="true">×</span>
          <label>
            <span>높이</span>
            <input
              aria-label="사용자 지정 높이"
              type="number"
              inputMode="numeric"
              min="64"
              max="4096"
              step="1"
              value={heightDraft}
              disabled={isBusy || resolution !== 'custom'}
              aria-invalid={invalidDimension === 'height'}
              onChange={(event) =>
                handleDimensionChange('height', event.currentTarget.value)
              }
            />
          </label>
          <span aria-label="활성 화면비 잠금" title="활성 화면비 잠금">
            🔒
          </span>
        </fieldset>

        <fieldset className="export-mode-options" disabled={isBusy}>
          <legend>출력 내용</legend>
          <label>
            <input
              type="radio"
              name="export-mode"
              value="clean"
              checked={mode === 'clean'}
              onChange={() => setMode('clean')}
            />
            깨끗한 프레임
          </label>
          <label>
            <input
              type="radio"
              name="export-mode"
              value="reference"
              checked={mode === 'reference'}
              onChange={() => setMode('reference')}
            />
            참조 포함
          </label>
        </fieldset>

        <p className="export-summary">
          결과: {widthDraft || '—'}×{heightDraft || '—'} PNG · sRGB
        </p>
        {dimensionError === null ? null : (
          <p className="export-error" role="alert">
            {dimensionError}
          </p>
        )}
        {exportError === null ? null : (
          <p className="export-error" role="alert">
            PNG를 만들지 못했습니다. 장면은 그대로 보존되었습니다. {exportError}
          </p>
        )}
        {isBusy ? (
          <p className="export-progress" role="status">
            PNG를 만드는 중입니다…
          </p>
        ) : null}

        <div className="export-dialog-actions">
          <button type="button" disabled={isBusy} onClick={closeWithoutExport}>
            취소
          </button>
          <button
            type="button"
            disabled={isBusy || dimensionError !== null}
            onClick={() => void handleSubmit()}
          >
            PNG 내보내기
          </button>
        </div>
      </div>
    </div>
  );
}
