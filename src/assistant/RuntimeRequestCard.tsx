import { useState } from 'react';
import type {
  RuntimeRequest,
  RuntimeRequestResponse,
} from '../../shared/runtimeRequest';

interface RuntimeRequestCardProps {
  request: RuntimeRequest;
  busy: boolean;
  onRespond(response: RuntimeRequestResponse): Promise<void>;
}

export function RuntimeRequestCard({
  request,
  busy,
  onRespond,
}: RuntimeRequestCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherQuestions, setOtherQuestions] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);

  const respond = async (response: RuntimeRequestResponse) => {
    setError(null);
    try {
      await onRespond(response);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'App Server 요청에 응답하지 못했습니다.',
      );
    }
  };

  const submitAnswers = async () => {
    const responseAnswers: Record<string, string[]> = {};
    for (const question of request.questions) {
      const answer = answers[question.id]?.trim() ?? '';
      if (answer === '') {
        setError(`“${question.header}” 항목에 답변해 주세요.`);
        return;
      }
      responseAnswers[question.id] = [answer];
    }
    await respond({ action: 'answer', answers: responseAnswers });
  };

  return (
    <article
      className="assistant-runtime-request"
      aria-label={`${request.title}: ${request.itemId}`}
    >
      <header>
        <div>
          <p className="eyebrow">
            {request.kind === 'userInput'
              ? 'Codex 사용자 입력 요청'
              : 'Codex 승인 요청'}
          </p>
          <h3>{request.title}</h3>
        </div>
        <span>응답 대기</span>
      </header>

      <dl className="assistant-runtime-request-meta">
        <div>
          <dt>출처</dt>
          <dd>
            thread {request.threadId} · turn {request.turnId}
          </dd>
        </div>
        {request.reason === null ? null : (
          <div>
            <dt>요청 이유</dt>
            <dd>{request.reason}</dd>
          </div>
        )}
        <div>
          <dt>영향</dt>
          <dd>{request.impact}</dd>
        </div>
        {request.cwd === null ? null : (
          <div>
            <dt>경로</dt>
            <dd className="assistant-runtime-request-code">{request.cwd}</dd>
          </div>
        )}
      </dl>

      {request.kind !== 'userInput' ? (
        <div className="assistant-runtime-request-actions">
          <button
            type="button"
            onClick={() => void respond({ action: 'approve' })}
            disabled={busy}
          >
            이번 요청 승인
          </button>
          <button
            type="button"
            onClick={() => void respond({ action: 'decline' })}
            disabled={busy}
          >
            거부
          </button>
        </div>
      ) : (
        <div className="assistant-runtime-questions">
          {request.questions.map((question) => {
            const useOther = otherQuestions.has(question.id);
            const inputType = question.isSecret ? 'password' : 'text';
            return (
              <fieldset key={question.id}>
                <legend>{question.header}</legend>
                <p>{question.question}</p>
                {question.options === null ? null : (
                  <div className="assistant-runtime-options">
                    {question.options.map((option) => (
                      <label key={option.label}>
                        <input
                          type="radio"
                          name={`runtime-question-${request.id}-${question.id}`}
                          checked={
                            !useOther && answers[question.id] === option.label
                          }
                          onChange={() => {
                            setOtherQuestions((current) => {
                              const next = new Set(current);
                              next.delete(question.id);
                              return next;
                            });
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: option.label,
                            }));
                          }}
                        />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </label>
                    ))}
                    {question.isOther ? (
                      <label>
                        <input
                          type="radio"
                          name={`runtime-question-${request.id}-${question.id}`}
                          checked={useOther}
                          onChange={() => {
                            setOtherQuestions((current) =>
                              new Set(current).add(question.id),
                            );
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: '',
                            }));
                          }}
                        />
                        <span>
                          <strong>직접 입력</strong>
                          <small>목록에 없는 답변을 입력합니다.</small>
                        </span>
                      </label>
                    ) : null}
                  </div>
                )}
                {question.options === null || useOther ? (
                  <input
                    type={inputType}
                    aria-label={`${question.header} 답변`}
                    autoComplete="off"
                    value={answers[question.id] ?? ''}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                  />
                ) : null}
                {question.isSecret ? (
                  <small>
                    비밀 답변은 프로젝트 metadata에 저장하지 않습니다.
                  </small>
                ) : null}
              </fieldset>
            );
          })}
          <button
            type="button"
            onClick={() => void submitAnswers()}
            disabled={busy}
          >
            답변 보내기
          </button>
        </div>
      )}

      {error === null ? null : (
        <p className="assistant-runtime-request-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
