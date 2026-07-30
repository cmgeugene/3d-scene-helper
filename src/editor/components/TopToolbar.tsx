import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { FrameExportHandler } from '../export/exportFrame';
import {
  encodeSceneDocument,
  importSceneDocument,
  loadSceneDocument,
  saveSceneDocument,
} from '../persistence/sceneCodec';
import { ASPECT_RATIO_PRESETS } from '../presets/aspectRatios';
import { MAX_SCENE_STORAGE_BYTES } from '../constants';
import type { EditorStore } from '../state/editorStore';
import type { GuideVisibility } from '../types';
import { ExportDialog } from './ExportDialog';

interface TopToolbarProps {
  store: StoreApi<EditorStore>;
  storage: Storage;
  frameExporter: FrameExportHandler | null;
}

const GUIDE_OPTIONS: ReadonlyArray<{
  key: keyof GuideVisibility;
  label: string;
  compactLabel?: string;
}> = [
  { key: 'thirds', label: '3분할선' },
  { key: 'center', label: '중앙 십자선' },
  { key: 'actionSafe', label: '액션 안전 영역' },
  { key: 'titleSafe', label: '타이틀 안전 영역' },
  { key: 'motion', label: '모션 가이드', compactLabel: '모션' },
];

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(file);
  });
}

function sceneDownloadName(name: string) {
  const safeName = name
    .trim()
    .replace(/[^a-z0-9가-힣._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${safeName || 'scene'}.json`;
}

export function TopToolbar({ store, storage, frameExporter }: TopToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const importGenerationRef = useRef(0);
  const [isImporting, setIsImporting] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const output = useStore(store, (state) => state.document.output);
  const selectedObjectId = useStore(store, (state) => state.selectedObjectId);
  const transformMode = useStore(store, (state) => state.transformMode);
  const guideVisibility = useStore(store, (state) => state.guideVisibility);
  const canUndo = useStore(store, (state) => state.canUndo);
  const canRedo = useStore(store, (state) => state.canRedo);
  const resetScene = useStore(store, (state) => state.resetScene);
  const setOutput = useStore(store, (state) => state.setOutput);
  const setGuideVisibility = useStore(
    store,
    (state) => state.setGuideVisibility,
  );
  const confirmDocumentReplacement = () =>
    !store.getState().isDirty ||
    window.confirm(
      '저장되지 않은 변경 사항이 있습니다. 현재 장면을 교체하시겠습니까?',
    );
  const closeExportDialog = () => {
    setIsExportDialogOpen(false);
    window.requestAnimationFrame(() => exportButtonRef.current?.focus());
  };

  return (
    <header className="top-toolbar">
      <h1>I2V 3D Scene Helper</h1>
      <nav className="toolbar-actions" aria-label="장면 도구">
        <div className="toolbar-group" role="group" aria-label="장면 시작">
          <button
            type="button"
            onClick={() => {
              if (confirmDocumentReplacement()) resetScene();
            }}
          >
            새 장면
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmDocumentReplacement()) resetScene();
            }}
          >
            기본 장면으로 초기화
          </button>
        </div>

        <div
          className="toolbar-group toolbar-history"
          role="group"
          aria-label="실행 기록"
        >
          <button
            type="button"
            disabled={!canUndo}
            onClick={() => store.getState().undo()}
          >
            실행 취소
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={() => store.getState().redo()}
          >
            다시 실행
          </button>
        </div>

        <div className="toolbar-group" role="group" aria-label="오브젝트 조작">
          {(
            [
              ['translate', '이동 (W)'],
              ['rotate', '회전 (E)'],
              ['scale', '크기 (R)'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={transformMode === mode}
              onClick={() => {
                store.getState().setTransformMode(mode);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={selectedObjectId === null}
            onClick={() => {
              if (selectedObjectId !== null) {
                store.getState().duplicateObject(selectedObjectId);
              }
            }}
          >
            복제
          </button>
          <button
            type="button"
            disabled={selectedObjectId === null}
            onClick={() => {
              if (selectedObjectId !== null) {
                store.getState().deleteObject(selectedObjectId);
              }
            }}
          >
            삭제
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
          {GUIDE_OPTIONS.map(({ key, label, compactLabel }) => (
            <label key={key}>
              <input
                type="checkbox"
                aria-label={label}
                checked={guideVisibility[key]}
                onChange={(event) => {
                  setGuideVisibility({ [key]: event.currentTarget.checked });
                }}
              />
              <span>{compactLabel ?? label}</span>
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
            onClick={() => {
              const document = store.getState().document;
              try {
                saveSceneDocument(storage, document);
                store.getState().markDocumentPersisted(document);
                store
                  .getState()
                  .setStatusMessage('장면을 로컬에 저장했습니다.');
              } catch (error) {
                store
                  .getState()
                  .setStatusMessage(
                    error instanceof Error
                      ? error.message
                      : '장면을 로컬에 저장하지 못했습니다.',
                  );
              }
            }}
          >
            로컬 저장
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                const document = loadSceneDocument(storage);
                if (document === null) {
                  store
                    .getState()
                    .setStatusMessage('불러올 로컬 장면이 없습니다.');
                  return;
                }
                if (!confirmDocumentReplacement()) {
                  store
                    .getState()
                    .setStatusMessage('로컬 장면 열기를 취소했습니다.');
                  return;
                }
                store.getState().replaceDocument(document, true);
                store.getState().setStatusMessage('로컬 장면을 열었습니다.');
              } catch (error) {
                store
                  .getState()
                  .setStatusMessage(
                    error instanceof Error
                      ? error.message
                      : '로컬 장면을 열지 못했습니다.',
                  );
              }
            }}
          >
            최근 장면 열기
          </button>
          <button
            type="button"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            JSON 가져오기
          </button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            tabIndex={-1}
            accept="application/json,.json"
            aria-label="장면 JSON 파일"
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (file === undefined) return;
              const generation = ++importGenerationRef.current;
              setIsImporting(true);

              try {
                if (file.size > MAX_SCENE_STORAGE_BYTES) {
                  throw new Error(
                    '장면 JSON이 크기 제한을 초과했습니다. 더 작은 장면 파일을 선택하세요.',
                  );
                }
                const serialized = await readFileText(file);
                if (generation !== importGenerationRef.current) return;
                let replaced = false;
                importSceneDocument(serialized, (document) => {
                  if (!confirmDocumentReplacement()) return;
                  store.getState().replaceDocument(document, false);
                  replaced = true;
                });
                store
                  .getState()
                  .setStatusMessage(
                    replaced
                      ? 'JSON 장면을 가져왔습니다.'
                      : 'JSON 장면 가져오기를 취소했습니다.',
                  );
              } catch (error) {
                store
                  .getState()
                  .setStatusMessage(
                    error instanceof Error
                      ? error.message
                      : 'JSON 장면을 가져오지 못했습니다.',
                  );
              } finally {
                if (generation === importGenerationRef.current) {
                  input.value = '';
                  setIsImporting(false);
                }
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              const document = store.getState().document;
              try {
                const blob = new Blob([encodeSceneDocument(document)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const anchor = window.document.createElement('a');
                anchor.href = url;
                anchor.download = sceneDownloadName(document.name);
                window.document.body.append(anchor);
                anchor.click();
                anchor.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 0);
                store.getState().setStatusMessage('장면 JSON을 내보냈습니다.');
              } catch (error) {
                store
                  .getState()
                  .setStatusMessage(
                    error instanceof Error
                      ? error.message
                      : '장면 JSON을 내보내지 못했습니다.',
                  );
              }
            }}
          >
            JSON 내보내기
          </button>
          <button
            ref={exportButtonRef}
            type="button"
            disabled={frameExporter === null}
            title={
              frameExporter === null
                ? '3D 장면이 준비되면 PNG를 내보낼 수 있습니다.'
                : undefined
            }
            onClick={() => setIsExportDialogOpen(true)}
          >
            PNG 내보내기
          </button>
        </div>
      </nav>
      {isExportDialogOpen && frameExporter !== null ? (
        <ExportDialog
          store={store}
          exportFrame={frameExporter}
          onClose={closeExportDialog}
        />
      ) : null}
    </header>
  );
}
