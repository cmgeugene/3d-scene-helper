const THREAD_STORAGE_KEY = 'i2v.scene-assistant.thread.v1';

export function readSceneAssistantThread(storage: Storage = sessionStorage) {
  const threadId = storage.getItem(THREAD_STORAGE_KEY);
  return threadId === null || threadId.trim() === '' ? null : threadId;
}

export function storeSceneAssistantThread(
  threadId: string,
  storage: Storage = sessionStorage,
) {
  storage.setItem(THREAD_STORAGE_KEY, threadId);
}

export function clearSceneAssistantThread(storage: Storage = sessionStorage) {
  storage.removeItem(THREAD_STORAGE_KEY);
}
