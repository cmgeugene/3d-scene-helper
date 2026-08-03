import { lazy, Suspense, useMemo, useState } from 'react';
import type { SceneDocument } from '../editor/persistence/sceneSchema';
import { createEditorStore } from '../editor/state/editorStore';

const LazySceneViewport = lazy(() =>
  import('../editor/scene/SceneViewport').then(({ SceneViewport }) => ({
    default: SceneViewport,
  })),
);

interface SceneSnapshotPreviewProps {
  document: SceneDocument;
  canvasEnabled: boolean;
}

function createPreviewStore(document: SceneDocument) {
  return createEditorStore({
    initialDocument: structuredClone(document),
    idFactory: () => {
      throw new Error('읽기 전용 sceneSnapshot에는 ID를 생성할 수 없습니다.');
    },
  });
}

export function SceneSnapshotPreview({
  document,
  canvasEnabled,
}: SceneSnapshotPreviewProps) {
  const previewStore = useMemo(() => createPreviewStore(document), [document]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  return (
    <div
      className="scene-snapshot-preview"
      role="img"
      aria-label="생성 당시 3D 씬 읽기 전용 미리보기"
      data-scene-id={document.id}
    >
      {canvasEnabled && runtimeError === null ? (
        <Suspense
          fallback={
            <span className="scene-snapshot-preview-fallback">
              읽기 전용 3D 미리보기를 불러오는 중…
            </span>
          }
        >
          <LazySceneViewport
            store={previewStore}
            readOnly
            onRuntimeFailure={setRuntimeError}
          />
        </Suspense>
      ) : (
        <span className="scene-snapshot-preview-fallback">
          {runtimeError ??
            `읽기 전용 미리보기 · ${document.outputCamera.focalLengthMm}mm · ${document.objects.length} objects`}
        </span>
      )}
      <span className="scene-snapshot-preview-caption" aria-hidden="true">
        snapshot {document.id} · {document.outputCamera.focalLengthMm}mm ·{' '}
        {document.objects.length} objects · 편집 입력 차단
      </span>
    </div>
  );
}
