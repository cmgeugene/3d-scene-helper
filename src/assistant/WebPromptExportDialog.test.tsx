import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WebPromptExportDialog } from './WebPromptExportDialog';

describe('WebPromptExportDialog', () => {
  it('프롬프트 원문을 복사하고 완료 상태를 알린다', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async () => undefined);

    render(
      <WebPromptExportDialog
        prompt="manual web prompt"
        attachmentLabels={['3D 레이아웃 렌더', '캐릭터 레퍼런스']}
        warnings={['가림 관계를 확인하세요.']}
        onClose={() => undefined}
        copyText={copyText}
      />,
    );

    await user.click(screen.getByRole('button', { name: '프롬프트 복사' }));

    expect(copyText).toHaveBeenCalledWith('manual web prompt');
    expect(screen.getByRole('button', { name: '복사됨' })).toBeVisible();
    expect(screen.getByText('가림 관계를 확인하세요.')).toBeVisible();
  });

  it('Escape 키로 닫는다', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <WebPromptExportDialog
        prompt="prompt"
        attachmentLabels={['3D 레이아웃 렌더']}
        warnings={[]}
        onClose={onClose}
      />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
