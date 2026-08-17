import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DEBOUNCE_MS, SCENE_STORAGE_KEY } from '../editor/constants';
import { encodeSceneDocument } from '../editor/persistence/sceneCodec';
import {
  createSceneObject,
  createStarterSceneDocument,
} from '../editor/persistence/sceneSchema';
import { App } from './App';
import { createAppEditorStore } from './createAppEditorStore';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('App', () => {
  it('제품명을 최상위 제목으로 표시한다', () => {
    render(<App canvasEnabled={false} />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'I2V 3D Scene Helper',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: '에셋과 장면' }),
    ).toBeInTheDocument();
  });

  it('WebGL을 사용할 수 없으면 명시적인 대체 안내를 표시한다', async () => {
    render(<App canvasEnabled={false} />);

    expect(
      await screen.findByText(
        'WebGL을 사용할 수 없어 기본 안내 화면을 표시합니다.',
      ),
    ).toBeInTheDocument();
  });

  it('WebGL 컨텍스트를 만들 수 있으면 사용 가능 상태를 표시한다', async () => {
    const loseContext = vi.fn();
    const context = {
      getExtension: vi.fn(() => ({ loseContext })),
    } as unknown as WebGLRenderingContext;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(
      context,
    );

    render(<App canvasEnabled={false} />);

    expect(
      await screen.findByText('WebGL을 사용할 수 있습니다.'),
    ).toBeInTheDocument();
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('valid autosave를 초기 scene으로 복원하고 malformed autosave는 덮어쓰지 않는다', () => {
    const saved = createStarterSceneDocument({
      documentId: 'saved-scene',
      floorId: 'saved-floor',
      mannequinId: 'saved-mannequin',
    });
    saved.name = 'Restored scene';
    const validStorage = createMemoryStorage({
      [SCENE_STORAGE_KEY]: encodeSceneDocument(saved),
    });

    expect(createAppEditorStore(validStorage).getState()).toMatchObject({
      document: { id: 'saved-scene', name: 'Restored scene' },
      isDirty: false,
    });

    const malformed = '{"version":1}';
    const invalidStorage = createMemoryStorage({
      [SCENE_STORAGE_KEY]: malformed,
    });
    const fallback = createAppEditorStore(invalidStorage).getState();
    expect(fallback.document.id).toBe('starter-scene');
    expect(fallback.statusMessage).toMatch(
      /자동 저장 장면을 복원하지 못했습니다/,
    );
    expect(invalidStorage.getItem(SCENE_STORAGE_KEY)).toBe(malformed);
  });

  it('복원된 autosave를 새 장면과 기본 장면 초기화 기준으로 재사용하지 않는다', () => {
    const runReset = (buttonName: '새 장면' | '기본 장면으로 초기화') => {
      const saved = createStarterSceneDocument({
        documentId: 'saved-scene',
        floorId: 'saved-floor',
        mannequinId: 'saved-mannequin',
      });
      saved.objects.push(createSceneObject('saved-cube', { kind: 'cube' }));
      const savedJson = encodeSceneDocument(saved);
      const storage = createMemoryStorage({ [SCENE_STORAGE_KEY]: savedJson });
      const store = createAppEditorStore(storage, () => 'unsaved-sphere');
      store.getState().selectObject('saved-cube');
      store.getState().setHoveredObject('saved-cube');
      store.getState().beginTransform();
      store.getState().addObject({ kind: 'sphere' });
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const view = render(
        <App canvasEnabled={false} store={store} storage={storage} />,
      );

      act(() => screen.getByRole('button', { name: buttonName }).click());

      const state = store.getState();
      expect(confirm).toHaveBeenCalledOnce();
      expect(state.document.objects.some(({ kind }) => kind === 'cube')).toBe(
        false,
      );
      expect(state).toMatchObject({
        history: { past: [], future: [] },
        canUndo: false,
        canRedo: false,
        selectedObjectId: null,
        hoveredObjectId: null,
        inProgressTransform: null,
        inProgressMannequinPose: null,
        isDirty: true,
      });
      expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(savedJson);
      view.unmount();
      confirm.mockRestore();
      return state.document.objects.map(({ kind }) => kind);
    };

    expect(runReset('새 장면')).toEqual([]);
    expect(runReset('기본 장면으로 초기화')).toEqual(['floor', 'mannequin']);
  });

  it('document mutation을 debounce autosave하고 persisted 전 dirty 상태에서만 beforeunload를 막는다', () => {
    vi.useFakeTimers();
    const storage = createMemoryStorage();
    const store = createAppEditorStore(storage);
    render(<App canvasEnabled={false} store={store} storage={storage} />);

    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);

    act(() => {
      store.getState().addObject({ kind: 'cube' });
    });
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    expect(store.getState().isDirty).toBe(true);
    expect(storage.getItem(SCENE_STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(
      encodeSceneDocument(store.getState().document),
    );
    expect(store.getState().isDirty).toBe(false);
    const persistedUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(persistedUnload);
    expect(persistedUnload.defaultPrevented).toBe(false);
  });

  it('pending autosave가 persisted document replacement를 뒤늦게 덮어쓰지 않는다', () => {
    vi.useFakeTimers();
    const persisted = createStarterSceneDocument({
      documentId: 'persisted-scene',
      floorId: 'persisted-floor',
      mannequinId: 'persisted-mannequin',
    });
    persisted.name = 'Persisted scene';
    const persistedJson = encodeSceneDocument(persisted);
    const storage = createMemoryStorage({ [SCENE_STORAGE_KEY]: persistedJson });
    const store = createAppEditorStore(storage);
    render(<App canvasEnabled={false} store={store} storage={storage} />);

    act(() => {
      store.getState().addObject({ kind: 'cube' });
      store.getState().replaceDocument(persisted, true);
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(persistedJson);
    expect(store.getState()).toMatchObject({
      document: { id: 'persisted-scene', name: 'Persisted scene' },
      isDirty: false,
    });
  });

  it('다른 탭이 변경한 autosave를 stale local document로 덮어쓰지 않는다', () => {
    vi.useFakeTimers();
    const local = createStarterSceneDocument({
      documentId: 'local-scene',
      floorId: 'local-floor',
      mannequinId: 'local-mannequin',
    });
    const localJson = encodeSceneDocument(local);
    const storage = createMemoryStorage({ [SCENE_STORAGE_KEY]: localJson });
    const store = createAppEditorStore(storage);
    render(<App canvasEnabled={false} store={store} storage={storage} />);

    const external = createStarterSceneDocument({
      documentId: 'external-scene',
      floorId: 'external-floor',
      mannequinId: 'external-mannequin',
    });
    external.name = 'Edited in another tab';
    const externalJson = encodeSceneDocument(external);
    storage.setItem(SCENE_STORAGE_KEY, externalJson);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: SCENE_STORAGE_KEY,
        oldValue: localJson,
        newValue: externalJson,
      }),
    );

    act(() => {
      store.getState().addObject({ kind: 'cube' });
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(storage.getItem(SCENE_STORAGE_KEY)).toBe(externalJson);
    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().statusMessage).toMatch(/다른 탭.*최근 장면 열기/);
  });
});
