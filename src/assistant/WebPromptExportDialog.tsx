import { useEffect, useRef, useState } from 'react';

interface WebPromptExportDialogProps {
  prompt: string;
  attachmentLabels: string[];
  warnings: string[];
  onClose: () => void;
  copyText?: (text: string) => Promise<void>;
}

const defaultCopyText = async (text: string) => {
  if (navigator.clipboard?.writeText === undefined) {
    throw new Error('이 브라우저에서는 클립보드 복사를 사용할 수 없습니다.');
  }
  await navigator.clipboard.writeText(text);
};

export function WebPromptExportDialog({
  prompt,
  attachmentLabels,
  warnings,
  onClose,
  copyText = defaultCopyText,
}: WebPromptExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    copyButtonRef.current?.focus();
  }, []);

  const handleCopy = async () => {
    try {
      await copyText(prompt);
      setCopyStatus('copied');
      setCopyError(null);
    } catch (reason) {
      setCopyStatus('error');
      setCopyError(
        reason instanceof Error
          ? reason.message
          : '프롬프트를 복사하지 못했습니다.',
      );
    }
  };

  return (
    <div
      className="web-prompt-export-backdrop"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button, textarea, [href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => !element.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="web-prompt-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-prompt-export-title"
      >
        <header>
          <p className="eyebrow">Manual GPT web fallback</p>
          <h2 id="web-prompt-export-title">GPT 웹용 프롬프트 내보내기</h2>
          <p>
            아래 순서대로 이미지를 GPT 웹에 첨부한 뒤 프롬프트를 붙여 넣으세요.
          </p>
        </header>

        <ol className="web-prompt-export-attachments">
          {attachmentLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>

        {warnings.length === 0 ? null : (
          <div className="web-prompt-export-warnings">
            <strong>생성 전 확인 사항</strong>
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <label htmlFor="web-prompt-export-value">GPT 웹용 생성 프롬프트</label>
        <textarea
          id="web-prompt-export-value"
          value={prompt}
          readOnly
          rows={16}
        />
        <p className="web-prompt-export-note">
          GPT 웹에서 만든 결과는 프로젝트 생성 기록에 자동으로 등록되지
          않습니다.
        </p>
        {copyError === null ? null : <p role="alert">{copyError}</p>}
        <div className="web-prompt-export-actions">
          <button type="button" onClick={onClose}>
            닫기
          </button>
          <button
            ref={copyButtonRef}
            type="button"
            onClick={() => void handleCopy()}
          >
            {copyStatus === 'copied' ? '복사됨' : '프롬프트 복사'}
          </button>
        </div>
      </div>
    </div>
  );
}
