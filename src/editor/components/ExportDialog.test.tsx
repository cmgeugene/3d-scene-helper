import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FrameExportHandler } from '../export/exportFrame';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import { createEditorStore } from '../state/editorStore';
import { ExportDialog } from './ExportDialog';

function createTestStore() {
  return createEditorStore({
    initialDocument: createStarterSceneDocument({
      documentId: 'export-scene',
      floorId: 'export-floor',
      mannequinId: 'export-mannequin',
    }),
    idFactory: () => 'unused',
  });
}

describe('ExportDialog', () => {
  it('fixed preset과 clean 기본값을 표시하고 active aspect에 custom dimensions를 잠근다', async () => {
    const user = userEvent.setup();
    render(
      <ExportDialog
        store={createTestStore()}
        exportFrame={vi.fn()}
        onClose={vi.fn()}
        download={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'PNG 내보내기' })).toBeVisible();
    expect(screen.getByLabelText('파일 이름')).toHaveValue('i2v-start-frame');
    expect(screen.getByRole('radio', { name: '깨끗한 프레임' })).toBeChecked();
    expect(screen.getByLabelText('해상도')).toHaveValue('1920x1080');

    await user.selectOptions(screen.getByLabelText('해상도'), '1080x1920');
    expect(screen.getByLabelText('화면비')).toHaveValue('9:16');
    expect(screen.getByLabelText('사용자 지정 너비')).toHaveValue(1080);
    expect(screen.getByLabelText('사용자 지정 높이')).toHaveValue(1920);

    await user.selectOptions(screen.getByLabelText('해상도'), 'custom');
    await user.clear(screen.getByLabelText('사용자 지정 너비'));
    await user.type(screen.getByLabelText('사용자 지정 너비'), '720');
    expect(screen.getByLabelText('사용자 지정 높이')).toHaveValue(1280);

    await user.clear(screen.getByLabelText('사용자 지정 높이'));
    await user.type(screen.getByLabelText('사용자 지정 높이'), '1000');
    expect(screen.getByLabelText('사용자 지정 너비')).toHaveValue(563);
  });

  it('64..4096 밖의 custom dimension은 거부하고 export를 실행하지 않는다', async () => {
    const user = userEvent.setup();
    const exportFrame = vi.fn<FrameExportHandler>();
    render(
      <ExportDialog
        store={createTestStore()}
        exportFrame={exportFrame}
        onClose={vi.fn()}
        download={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('해상도'), 'custom');
    await user.clear(screen.getByLabelText('사용자 지정 너비'));
    await user.type(screen.getByLabelText('사용자 지정 너비'), '63');

    expect(screen.getByLabelText('사용자 지정 너비')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/64.*4096/);
    expect(screen.getByRole('button', { name: 'PNG 내보내기' })).toBeDisabled();
    expect(exportFrame).not.toHaveBeenCalled();
  });

  it('busy 중 중복 실행을 막고 sanitized real-download payload와 output을 완료한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const blob = new Blob(['png'], { type: 'image/png' });
    let resolveExport!: (value: Blob) => void;
    const exportFrame = vi.fn<FrameExportHandler>(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    const download = vi.fn();
    const onClose = vi.fn();
    render(
      <ExportDialog
        store={store}
        exportFrame={exportFrame}
        onClose={onClose}
        download={download}
      />,
    );

    await user.selectOptions(screen.getByLabelText('해상도'), '1280x720');
    await user.clear(screen.getByLabelText('파일 이름'));
    await user.type(screen.getByLabelText('파일 이름'), '../내 시작 프레임:*?');
    await user.click(screen.getByRole('radio', { name: '참조 포함' }));
    await user.click(screen.getByRole('button', { name: 'PNG 내보내기' }));

    expect(screen.getByText('PNG를 만드는 중입니다…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'PNG 내보내기' })).toBeDisabled();
    expect(exportFrame).toHaveBeenCalledTimes(1);
    expect(exportFrame.mock.calls[0][0]).toMatchObject({
      document: {
        output: {
          aspectRatioId: '16:9',
          width: 1280,
          height: 720,
          mode: 'reference',
        },
      },
      guideVisibility: store.getState().guideVisibility,
    });

    await act(async () => resolveExport(blob));
    await waitFor(() => {
      expect(download).toHaveBeenCalledWith(blob, '내-시작-프레임.png');
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(store.getState().document.output).toEqual({
      aspectRatioId: '16:9',
      width: 1280,
      height: 720,
      mode: 'reference',
    });
    expect(store.getState().exportState).toMatchObject({
      status: 'complete',
      progress: 1,
      error: null,
    });
  });

  it('capture 실패는 error를 표시하고 live document를 보존하며 재시도를 허용한다', async () => {
    const user = userEvent.setup();
    const store = createTestStore();
    const initialDocument = store.getState().document;
    const exportFrame = vi
      .fn<FrameExportHandler>()
      .mockRejectedValueOnce(new Error('GPU readback failed'))
      .mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    render(
      <ExportDialog
        store={store}
        exportFrame={exportFrame}
        onClose={vi.fn()}
        download={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'PNG 내보내기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /PNG를 만들지 못했습니다.*GPU readback failed/,
    );
    expect(store.getState().document).toBe(initialDocument);
    expect(store.getState().exportState).toMatchObject({
      status: 'error',
      error: 'GPU readback failed',
    });
    expect(screen.getByRole('button', { name: 'PNG 내보내기' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'PNG 내보내기' }));
    await waitFor(() => expect(exportFrame).toHaveBeenCalledTimes(2));
  });

  it('파일 이름에 초기 focus를 두고 Escape/취소로 출력 없이 닫는다', async () => {
    const user = userEvent.setup();
    const exportFrame = vi.fn<FrameExportHandler>();
    const onClose = vi.fn();
    render(
      <ExportDialog
        store={createTestStore()}
        exportFrame={exportFrame}
        onClose={onClose}
        download={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('파일 이름')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(exportFrame).not.toHaveBeenCalled();
  });

  it('modal 내부 keydown이 editor 전역 shortcut으로 전파되지 않는다', async () => {
    const user = userEvent.setup();
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    render(
      <ExportDialog
        store={createTestStore()}
        exportFrame={vi.fn()}
        onClose={vi.fn()}
        download={vi.fn()}
      />,
    );

    screen.getByRole('button', { name: '취소' }).focus();
    await user.keyboard('{Delete}');

    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKeyDown);
  });
});
