import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
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
});
