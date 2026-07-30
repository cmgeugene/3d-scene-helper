import type { SceneDocument } from '../editor/persistence/sceneSchema';
import { loadSceneDocument } from '../editor/persistence/sceneCodec';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';
import { createEditorStore } from '../editor/state/editorStore';

function createStarterDocument(): SceneDocument {
  return createStarterSceneDocument({
    documentId: 'starter-scene',
    floorId: 'starter-floor',
    mannequinId: 'starter-mannequin',
  });
}

export function createAppEditorStore(
  storage: Storage,
  idFactory: () => string = () => globalThis.crypto.randomUUID(),
) {
  let initialDocument = createStarterDocument();
  let restoreError: string | null = null;

  try {
    initialDocument = loadSceneDocument(storage) ?? initialDocument;
  } catch (error) {
    restoreError = `자동 저장 장면을 복원하지 못했습니다. 기존 저장 데이터는 보존했습니다. ${
      error instanceof Error ? error.message : '파일 형식을 확인하세요.'
    }`;
  }

  const store = createEditorStore({ initialDocument, idFactory });
  if (restoreError !== null) store.getState().setStatusMessage(restoreError);
  return store;
}
