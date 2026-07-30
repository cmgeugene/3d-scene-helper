import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import { createEditorStore } from '../state/editorStore';
import { EditorShortcuts } from './EditorShortcuts';
import { Inspector } from './Inspector';
import { isSceneShortcutTarget } from './shortcutTarget';

const MANNEQUIN_ID = 'mannequin-test';

function createTestStore(generatedIds: string[] = []) {
  const ids = [...generatedIds];
  return createEditorStore({
    initialDocument: createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: MANNEQUIN_ID,
    }),
    idFactory: () => ids.shift() ?? 'generated-test',
  });
}

describe('Inspector', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
    store.getState().selectObject(MANNEQUIN_ID);
  });

  it('숫자 transform을 local draft로 편집하고 blur에서 한 번 commit한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);
    const positionX = screen.getByLabelText('위치 X');
    const documentBeforeEdit = store.getState().document;
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    await user.clear(positionX);
    await user.type(positionX, '2.5');

    expect(store.getState().document).toBe(documentBeforeEdit);
    fireEvent.blur(positionX);

    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID)
        ?.transform.position.x,
    ).toBe(2.5);
    expect(documentChanges).toBe(1);
    expect(store.getState().inProgressTransform).toBeNull();
    unsubscribe();
  });

  it('Enter로 numeric draft를 한 번 commit하고 Inspector 값을 동기화한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);
    const rotationY = screen.getByLabelText('회전 Y');
    let documentChanges = 0;
    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.document !== previousState.document) documentChanges += 1;
    });

    await user.clear(rotationY);
    await user.type(rotationY, '45{Enter}');

    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID)
        ?.transform.rotationDeg.y,
    ).toBe(45);
    expect(rotationY).toHaveValue(45);
    expect(documentChanges).toBe(1);
    unsubscribe();
  });

  it('0 이하 scale draft를 거부하고 committed 값을 복원한다', async () => {
    const user = userEvent.setup();
    render(<Inspector store={store} />);
    const scaleX = screen.getByLabelText('크기 X');
    const documentBeforeEdit = store.getState().document;

    await user.clear(scaleX);
    await user.type(scaleX, '0');
    fireEvent.blur(scaleX);

    expect(store.getState().document).toBe(documentBeforeEdit);
    expect(scaleX).toHaveValue(1);
    expect(scaleX).toHaveAttribute('aria-invalid', 'true');
  });

  it('색상/표시와 duplicate/delete inspector action을 document에 반영한다', async () => {
    const user = userEvent.setup();
    store = createTestStore(['mannequin-copy']);
    store.getState().selectObject(MANNEQUIN_ID);
    render(<Inspector store={store} />);

    fireEvent.change(screen.getByLabelText('색상'), {
      target: { value: '#123456' },
    });
    await user.click(screen.getByRole('checkbox', { name: '표시' }));

    expect(
      store.getState().document.objects.find(({ id }) => id === MANNEQUIN_ID),
    ).toMatchObject({ color: '#123456', visible: false });

    await user.click(screen.getByRole('button', { name: '복제' }));
    expect(store.getState().selectedObjectId).toBe('mannequin-copy');
    expect(store.getState().document.objects).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: '삭제' }));
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().document.objects).toHaveLength(2);
  });
});

describe('EditorShortcuts', () => {
  it('input/textarea/select/contenteditable target을 scene shortcut에서 제외한다', () => {
    for (const tagName of ['input', 'textarea', 'select']) {
      expect(isSceneShortcutTarget(document.createElement(tagName))).toBe(true);
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.append(child);
    expect(isSceneShortcutTarget(child)).toBe(true);
    expect(isSceneShortcutTarget(document.createElement('button'))).toBe(false);
  });

  it('W/E/R, duplicate, delete, Escape를 처리하고 focused input에서는 무시한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore(['mannequin-copy']);
    store.getState().selectObject(MANNEQUIN_ID);
    render(
      <>
        <EditorShortcuts store={store} />
        <input aria-label="편집 입력" />
      </>,
    );

    await user.keyboard('wEr');
    expect(store.getState().transformMode).toBe('scale');

    const input = screen.getByLabelText('편집 입력');
    await user.click(input);
    await user.keyboard('{Delete}');
    expect(store.getState().selectedObjectId).toBe(MANNEQUIN_ID);

    input.blur();
    await user.keyboard('{Control>}d{/Control}');
    expect(store.getState().selectedObjectId).toBe('mannequin-copy');

    store.getState().beginTransform();
    await user.keyboard('{Escape}');
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().inProgressTransform).toBeNull();

    store.getState().selectObject('mannequin-copy');
    await user.keyboard('{Backspace}');
    expect(
      store
        .getState()
        .document.objects.some(({ id }) => id === 'mannequin-copy'),
    ).toBe(false);
  });
});
