import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  createSceneObject,
  createStarterSceneDocument,
} from '../persistence/sceneSchema';
import { createEditorStore } from '../state/editorStore';
import { Outliner } from './Outliner';

const IDS = {
  documentId: 'scene-outliner',
  floorId: 'floor-outliner',
  mannequinId: 'mannequin-outliner',
} as const;

function createTestStore() {
  return createEditorStore({
    initialDocument: createStarterSceneDocument(IDS),
    idFactory: () => 'unused',
  });
}

describe('Outliner', () => {
  it('잠금 토글과 행 선택의 클릭 영역을 분리하고 잠긴 행도 선택한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    render(<Outliner store={store} />);

    const rowSelection = screen.getByRole('button', { name: 'Mannequin' });
    const lock = screen.getByRole('button', {
      name: 'Mannequin 뷰포트 선택 잠금',
    });

    await user.click(lock);
    expect(lock).toHaveAttribute('aria-pressed', 'true');
    expect(lock).toHaveAttribute('title', '뷰포트 선택 잠금 해제');
    expect(store.getState().selectedObjectId).toBeNull();

    await user.click(rowSelection);
    expect(rowSelection).toHaveAttribute('aria-pressed', 'true');
    expect(store.getState().selectedObjectId).toBe(IDS.mannequinId);
    expect(
      store.getState().document.objects.find(({ id }) => id === IDS.mannequinId)
        ?.viewportSelectionLocked,
    ).toBe(true);
  });

  it('다중 선택을 그룹화하고 translate-only 이동 후 그룹 해제한다', async () => {
    const user = userEvent.setup();
    const document = createStarterSceneDocument(IDS);
    document.objects.push(
      createSceneObject('cube-a', { kind: 'cube', name: 'Cube A' }),
      createSceneObject('cube-b', { kind: 'cube', name: 'Cube B' }),
    );
    const store = createEditorStore({
      initialDocument: document,
      idFactory: () => 'group-1',
    });
    render(<Outliner store={store} />);

    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('button', { name: 'Cube A' }));
    await user.click(screen.getByRole('button', { name: 'Cube B' }));
    await user.keyboard('{/Control}');
    expect(screen.getByText('2개 선택')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '그룹화' }));
    expect(
      screen.getByRole('button', { name: 'Group 1 그룹 선택' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText('회전·스케일은 아직 지원하지 않습니다.'),
    ).toBeVisible();

    await user.clear(screen.getByLabelText('그룹 이동 X'));
    await user.type(screen.getByLabelText('그룹 이동 X'), '1');
    await user.clear(screen.getByLabelText('그룹 이동 Z'));
    await user.type(screen.getByLabelText('그룹 이동 Z'), '-2');
    await user.click(screen.getByRole('button', { name: '이동 적용' }));

    expect(
      store.getState().document.objects.find(({ id }) => id === 'cube-a')
        ?.transform.position,
    ).toMatchObject({ x: 1, z: -2 });
    expect(
      store.getState().document.objects.find(({ id }) => id === 'cube-b')
        ?.transform.position,
    ).toMatchObject({ x: 1, z: -2 });

    await user.click(screen.getByRole('button', { name: 'Group 1 그룹 해제' }));
    expect(store.getState().document.groups).toEqual([]);
  });
});
