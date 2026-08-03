import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { CompanionConnection } from './companionConnection';
import {
  CompanionClient,
  companionRuntimeSchema,
  type CompanionBrowserClient,
  type CompanionRuntimeStatus,
  type GenerationRecord,
  type ReferenceArtifact,
} from './companionClient';
import {
  parseConversationUpdate,
  type ConversationUpdate,
} from './conversationEvents';
import {
  clearSceneAssistantThread,
  readSceneAssistantThread,
  storeSceneAssistantThread,
} from './conversationSession';
import {
  createImageGenerationPrompt,
  createImageRefinementPrompt,
  createSceneAssistantPrompt,
} from './sceneAssistantPrompt';
import { parseGenerationUpdate } from './generationEvents';
import { createLayoutSpec } from './layoutSpec';
import { sceneDocumentSchema } from '../editor/persistence/sceneSchema';
import { getMaximumReferenceImages } from '../../shared/imageInputBudget';

type ConnectionPhase = 'disconnected' | 'connecting' | 'ready' | 'error';
type AssistantView = 'conversation' | 'contract';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface SceneAssistantPanelProps {
  connection: CompanionConnection | null;
  connectionError?: string | null;
  onDisconnect?: () => void;
  getSceneContext?: () => unknown;
  getSelectedReferences?: () => ReferenceArtifact[];
  captureLayout?: (() => Promise<Blob>) | null;
  clientFactory?: (connection: CompanionConnection) => CompanionBrowserClient;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  onRefinementModeChange?: (active: boolean) => void;
  refinementSource?: GenerationRecord | null;
  onRefinementSourceChange?: (generation: GenerationRecord | null) => void;
}

interface ConnectedSceneAssistantProps {
  connection: CompanionConnection;
  onDisconnect?: () => void;
  getSceneContext: () => unknown;
  getSelectedReferences: () => ReferenceArtifact[];
  captureLayout: (() => Promise<Blob>) | null;
  clientFactory: (connection: CompanionConnection) => CompanionBrowserClient;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  onRefinementModeChange: (active: boolean) => void;
  refinementSource?: GenerationRecord | null;
  onRefinementSourceChange: (generation: GenerationRecord | null) => void;
}

const defaultClientFactory = (connection: CompanionConnection) =>
  new CompanionClient(connection);
const emptySceneContext = () => null;
const emptySelectedReferences = () => [];
const defaultCreateObjectUrl = (blob: Blob) => URL.createObjectURL(blob);
const defaultRevokeObjectUrl = (url: string) => URL.revokeObjectURL(url);
const ignoreRefinementModeChange = () => undefined;
const ignoreRefinementSourceChange = () => undefined;

function accountLabel(runtime: CompanionRuntimeStatus) {
  if (runtime.account?.type === 'chatgpt') {
    return `ChatGPT · ${runtime.account.planType}`;
  }
  if (runtime.account?.type === 'apiKey') return 'OpenAI API Key';
  if (runtime.account?.type === 'amazonBedrock') return 'Amazon Bedrock';
  return '로그인 필요';
}

function connectionLabel(phase: ConnectionPhase) {
  if (phase === 'ready') return '연결됨';
  if (phase === 'connecting') return '연결 중';
  if (phase === 'error') return '연결 오류';
  return '연결 안 됨';
}

function PanelHeading({ phase }: { phase: ConnectionPhase }) {
  return (
    <div className="assistant-heading">
      <div>
        <p className="eyebrow">Local Codex</p>
        <h2 id="assistant-title">Scene Assistant</h2>
      </div>
      <span
        className={`assistant-connection assistant-connection--${phase}`}
        role="status"
        aria-label="Companion 연결 상태"
      >
        {connectionLabel(phase)}
      </span>
    </div>
  );
}

function upsertAssistantMessage(
  messages: ChatMessage[],
  itemId: string,
  text: string,
  append: boolean,
): ChatMessage[] {
  const id = `assistant-${itemId}`;
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) return [...messages, { id, role: 'assistant' as const, text }];
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? { ...message, text: append ? message.text + text : text }
      : message,
  );
}

function ConnectedSceneAssistant({
  connection,
  onDisconnect,
  getSceneContext,
  getSelectedReferences,
  captureLayout,
  clientFactory,
  createObjectUrl,
  revokeObjectUrl,
  onRefinementModeChange,
  refinementSource: controlledRefinementSource,
  onRefinementSourceChange,
}: ConnectedSceneAssistantProps) {
  const client = useMemo(
    () => clientFactory(connection),
    [clientFactory, connection],
  );
  const [phase, setPhase] = useState<ConnectionPhase>('connecting');
  const [runtime, setRuntime] = useState<CompanionRuntimeStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [activeView, setActiveView] = useState<AssistantView>('conversation');
  const restoredThreadId = useMemo(() => readSceneAssistantThread(), []);
  const [threadId, setThreadId] = useState<string | null>(restoredThreadId);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [generation, setGeneration] = useState<GenerationRecord | null>(null);
  const [internalRefinementSource, setInternalRefinementSource] =
    useState<GenerationRecord | null>(null);
  const refinementSource =
    controlledRefinementSource === undefined
      ? internalRefinementSource
      : controlledRefinementSource;
  const [generationPreviewUrl, setGenerationPreviewUrl] = useState<
    string | null
  >(null);
  const [generationPhase, setGenerationPhase] = useState<
    'rendering' | 'uploading' | 'generating' | 'importing' | null
  >(null);
  const threadIdRef = useRef<string | null>(restoredThreadId);
  const threadReadyRef = useRef(false);
  const activeTurnIdRef = useRef<string | null>(null);
  const messageSequence = useRef(0);
  const generationPreviewUrlRef = useRef<string | null>(null);

  const changeRefinementSource = useCallback(
    (next: GenerationRecord | null) => {
      setInternalRefinementSource(next);
      onRefinementSourceChange(next);
    },
    [onRefinementSourceChange],
  );

  useEffect(() => {
    onRefinementModeChange(refinementSource !== null);
  }, [onRefinementModeChange, refinementSource]);

  useEffect(
    () => () => onRefinementModeChange(false),
    [onRefinementModeChange],
  );

  const displayGeneration = useCallback(
    async (nextGeneration: GenerationRecord, signal?: AbortSignal) => {
      setGeneration(nextGeneration);
      if (nextGeneration.status === 'inProgress') {
        setGenerationPhase(
          nextGeneration.result === null ? 'generating' : 'importing',
        );
      } else {
        setGenerationPhase(null);
      }
      if (nextGeneration.result === null) return;
      const blob = await client.loadGenerationBlob(nextGeneration.id, signal);
      if (signal?.aborted) return;
      const nextUrl = createObjectUrl(blob);
      const previousUrl = generationPreviewUrlRef.current;
      generationPreviewUrlRef.current = nextUrl;
      setGenerationPreviewUrl(nextUrl);
      if (previousUrl !== null) revokeObjectUrl(previousUrl);
    },
    [client, createObjectUrl, revokeObjectUrl],
  );

  const ensureThread = useCallback(async () => {
    let currentThreadId = threadIdRef.current;
    if (currentThreadId === null) {
      currentThreadId = await client.startThread();
    } else if (!threadReadyRef.current) {
      currentThreadId = await client.startThread(currentThreadId);
    }
    threadIdRef.current = currentThreadId;
    threadReadyRef.current = true;
    setThreadId(currentThreadId);
    storeSceneAssistantThread(currentThreadId);
    return currentThreadId;
  }, [client]);

  const retry = useCallback(() => {
    setPhase('connecting');
    setConnectionError(null);
    setRetryNonce((value) => value + 1);
  }, []);

  const applyConversationUpdate = useCallback((update: ConversationUpdate) => {
    if (update.threadId !== threadIdRef.current) return;

    if (update.type === 'agent-delta') {
      setMessages((current) =>
        upsertAssistantMessage(current, update.itemId, update.delta, true),
      );
      return;
    }

    if (update.type === 'agent-completed') {
      setMessages((current) =>
        upsertAssistantMessage(current, update.itemId, update.text, false),
      );
      return;
    }

    if (update.type === 'turn-error') {
      setConversationError(
        update.willRetry ? `${update.error} 재시도 중입니다.` : update.error,
      );
      if (!update.willRetry) {
        activeTurnIdRef.current = null;
        setActiveTurnId(null);
        setIsSubmitting(false);
      }
      return;
    }

    if (update.type === 'turn-completed') {
      activeTurnIdRef.current = null;
      setActiveTurnId(null);
      setIsSubmitting(false);
      setIsCancelling(false);
      if (update.status === 'failed') {
        setConversationError(update.error ?? 'Codex 응답 생성이 실패했습니다.');
      } else if (update.status === 'interrupted') {
        setConversationError('응답 생성을 중단했습니다.');
      } else {
        setConversationError(null);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void client
      .getRuntime(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setRuntime(value);
        setPhase(value.state === 'ready' ? 'ready' : 'connecting');
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setPhase('error');
        setConnectionError(
          reason instanceof Error
            ? reason.message
            : 'Companion에 연결하지 못했습니다.',
        );
      });
    void client
      .listGenerations(controller.signal)
      .then((generations) => {
        if (controller.signal.aborted) return;
        const latest = generations.at(-1);
        if (latest !== undefined) {
          return displayGeneration(latest, controller.signal);
        }
      })
      .catch(() => {
        // Runtime 연결 자체와 과거 생성 결과 복원은 독립적이다.
      });

    const unsubscribe = client.subscribe(
      (event) => {
        if (event.event === 'runtime') {
          const parsed = companionRuntimeSchema.safeParse(event.data);
          if (parsed.success) {
            setRuntime(parsed.data);
            setPhase(parsed.data.state === 'ready' ? 'ready' : 'connecting');
            setConnectionError(parsed.data.error);
          }
        }
        const update = parseConversationUpdate(event);
        if (update !== null) applyConversationUpdate(update);
        const generationUpdate = parseGenerationUpdate(event);
        if (generationUpdate?.type === 'record') {
          void displayGeneration(generationUpdate.generation).catch(
            (reason) => {
              setConversationError(
                reason instanceof Error
                  ? reason.message
                  : '생성 결과를 불러오지 못했습니다.',
              );
            },
          );
        } else if (generationUpdate?.type === 'error') {
          setGenerationPhase(null);
          setConversationError(generationUpdate.error);
        }
      },
      (reason) => {
        setPhase('error');
        setConnectionError(reason.message);
      },
    );

    return () => {
      controller.abort();
      unsubscribe();
      const previewUrl = generationPreviewUrlRef.current;
      if (previewUrl !== null) {
        generationPreviewUrlRef.current = null;
        revokeObjectUrl(previewUrl);
      }
    };
  }, [
    applyConversationUpdate,
    client,
    displayGeneration,
    retryNonce,
    revokeObjectUrl,
  ]);

  const submitMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const message = draft.trim();
      if (
        message === '' ||
        phase !== 'ready' ||
        activeTurnIdRef.current !== null ||
        isSubmitting
      ) {
        return;
      }

      messageSequence.current += 1;
      setMessages((current) => [
        ...current,
        {
          id: `user-${messageSequence.current}`,
          role: 'user',
          text: message,
        },
      ]);
      setDraft('');
      setConversationError(null);
      setIsSubmitting(true);

      try {
        const currentThreadId = await ensureThread();
        const selectedReferences = getSelectedReferences();
        const prompt = createSceneAssistantPrompt(
          message,
          getSceneContext(),
          selectedReferences,
        );
        const turnId = await client.startTurn(
          currentThreadId,
          prompt,
          selectedReferences.map(({ id }) => id),
        );
        activeTurnIdRef.current = turnId;
        setActiveTurnId(turnId);
      } catch (reason) {
        setConversationError(
          reason instanceof Error
            ? reason.message
            : '메시지를 전송하지 못했습니다.',
        );
        setIsSubmitting(false);
      }
    },
    [
      client,
      draft,
      getSceneContext,
      getSelectedReferences,
      ensureThread,
      isSubmitting,
      phase,
    ],
  );

  const generateImage = useCallback(async () => {
    const message = draft.trim();
    const sourceGeneration = refinementSource;
    const editing = sourceGeneration !== null;
    const selectedReferences = getSelectedReferences();
    const maximumReferences = getMaximumReferenceImages({
      includeLayout: true,
      includeSourceKeyframe: editing,
    });
    if (
      message === '' ||
      phase !== 'ready' ||
      captureLayout === null ||
      activeTurnIdRef.current !== null ||
      isSubmitting ||
      runtime?.capabilities?.imageGeneration === false
    ) {
      return;
    }
    if (selectedReferences.length > maximumReferences) {
      setConversationError(
        `현재 생성 구성에서는 레퍼런스를 최대 ${maximumReferences}장까지 선택할 수 있습니다. ${selectedReferences.length - maximumReferences}장을 해제해 주세요.`,
      );
      return;
    }

    messageSequence.current += 1;
    setMessages((current) => [
      ...current,
      {
        id: `user-${messageSequence.current}`,
        role: 'user',
        text: `${message} (${editing ? '키프레임 보정' : '이미지 생성'})`,
      },
    ]);
    setDraft('');
    setConversationError(null);
    const previousPreviewUrl = generationPreviewUrlRef.current;
    if (previousPreviewUrl !== null) {
      generationPreviewUrlRef.current = null;
      revokeObjectUrl(previousPreviewUrl);
    }
    setGenerationPreviewUrl(null);
    setGeneration(null);
    setIsSubmitting(true);
    setGenerationPhase('rendering');

    try {
      const parsedScene = sceneDocumentSchema.safeParse(getSceneContext());
      if (!parsedScene.success) {
        throw new Error('현재 장면을 LayoutSpec으로 해석하지 못했습니다.');
      }
      const scene = parsedScene.data;
      const layoutSpec = createLayoutSpec(scene, selectedReferences);
      const layout = await captureLayout();
      setGenerationPhase('uploading');
      const render = await client.createSceneRender(layout, scene.id);
      const currentThreadId = await ensureThread();
      const prompt =
        sourceGeneration === null
          ? createImageGenerationPrompt(scene, layoutSpec, selectedReferences)
          : createImageRefinementPrompt(
              message,
              scene,
              layoutSpec,
              sourceGeneration,
              selectedReferences,
            );
      setGenerationPhase('generating');
      const started = await client.startGeneration({
        threadId: currentThreadId,
        prompt,
        layoutRenderId: render.id,
        layoutSpec,
        sceneSnapshot: scene,
        referenceIds: selectedReferences.map(({ id }) => id),
        parentGenerationId: sourceGeneration?.id ?? null,
        sourceGenerationId:
          sourceGeneration === null
            ? (scene.generationSource?.generationId ?? null)
            : null,
        feedback: sourceGeneration === null ? null : message,
        generationMode: sourceGeneration === null ? 'fresh' : 'edit',
      });
      activeTurnIdRef.current = started.turnId;
      setActiveTurnId(started.turnId);
      setGeneration(started.generation);
    } catch (reason) {
      setGenerationPhase(null);
      setConversationError(
        reason instanceof Error
          ? reason.message
          : '이미지 생성을 시작하지 못했습니다.',
      );
      setIsSubmitting(false);
    }
  }, [
    captureLayout,
    client,
    draft,
    ensureThread,
    getSceneContext,
    getSelectedReferences,
    isSubmitting,
    phase,
    refinementSource,
    runtime?.capabilities?.imageGeneration,
    revokeObjectUrl,
  ]);

  const cancelTurn = useCallback(async () => {
    const currentThreadId = threadIdRef.current;
    const currentTurnId = activeTurnIdRef.current;
    if (currentThreadId === null || currentTurnId === null || isCancelling)
      return;
    setIsCancelling(true);
    try {
      await client.interruptTurn(currentThreadId, currentTurnId);
    } catch (reason) {
      setConversationError(
        reason instanceof Error
          ? reason.message
          : '응답을 중단하지 못했습니다.',
      );
      setIsCancelling(false);
    }
  }, [client, isCancelling]);

  const startNewConversation = useCallback(() => {
    if (activeTurnIdRef.current !== null) return;
    threadIdRef.current = null;
    threadReadyRef.current = false;
    setThreadId(null);
    setMessages([]);
    setConversationError(null);
    changeRefinementSource(null);
    clearSceneAssistantThread();
  }, [changeRefinementSource]);

  const busy = activeTurnId !== null || isSubmitting;
  const selectedReferences = getSelectedReferences();
  const maximumReferences = getMaximumReferenceImages({
    includeLayout: true,
    includeSourceKeyframe: refinementSource !== null,
  });
  const referenceSelectionOverLimit =
    selectedReferences.length > maximumReferences;
  const currentScene = sceneDocumentSchema.safeParse(getSceneContext());
  const layoutPreview = currentScene.success
    ? createLayoutSpec(currentScene.data, selectedReferences)
    : null;
  const previewObjects =
    layoutPreview?.objects
      .filter(({ role, screen }) =>
        role === 'environment' ? false : screen.status !== 'behind-camera',
      )
      .slice(0, 6) ?? [];

  return (
    <section
      className="scene-assistant-panel"
      aria-labelledby="assistant-title"
    >
      <PanelHeading phase={phase} />

      {phase === 'connecting' ? (
        <p className="assistant-message">
          Codex 런타임 상태를 확인하고 있습니다.
        </p>
      ) : null}

      {phase === 'ready' && runtime !== null ? (
        <div className="assistant-runtime-summary">
          <p>{accountLabel(runtime)}</p>
          <p title={runtime.version ?? undefined}>
            {runtime.version?.split(' ')[0] ?? 'Codex'}
          </p>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="assistant-error" role="alert">
          <p>{connectionError ?? 'Companion 연결을 확인해 주세요.'}</p>
          <button type="button" onClick={retry}>
            다시 연결
          </button>
        </div>
      ) : null}

      {phase === 'ready' ? (
        <div
          className="assistant-view-tabs"
          role="tablist"
          aria-label="Scene Assistant 보기"
        >
          <button
            id="assistant-tab-conversation"
            type="button"
            role="tab"
            aria-selected={activeView === 'conversation'}
            aria-controls="assistant-conversation-view"
            onClick={() => setActiveView('conversation')}
          >
            대화
          </button>
          <button
            id="assistant-tab-contract"
            type="button"
            role="tab"
            aria-selected={activeView === 'contract'}
            aria-controls="assistant-contract-view"
            onClick={() => setActiveView('contract')}
          >
            변환 계약
          </button>
        </div>
      ) : null}

      {phase === 'ready' && activeView === 'conversation' ? (
        <div
          id="assistant-conversation-view"
          className="assistant-conversation"
          role="tabpanel"
          aria-labelledby="assistant-tab-conversation"
        >
          <div className="assistant-conversation-heading">
            <p>{threadId === null ? '새 대화' : '장면 대화'}</p>
            {threadId !== null && !busy ? (
              <button type="button" onClick={startNewConversation}>
                새 대화
              </button>
            ) : null}
          </div>

          <div className="assistant-messages" aria-live="polite">
            {messages.length === 0 ? (
              <p className="assistant-empty-message">
                {threadId === null
                  ? '현재 3D 장면에 대해 설명하거나 의미를 지정해 보세요.'
                  : '이전 Codex task를 다음 메시지부터 이어갑니다.'}
              </p>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`assistant-chat-message assistant-chat-message--${message.role}`}
                >
                  <p className="assistant-chat-role">
                    {message.role === 'user' ? '나' : 'Scene Assistant'}
                  </p>
                  <p>{message.text}</p>
                </article>
              ))
            )}
            {busy ? (
              <p className="assistant-thinking" role="status">
                Scene Assistant가 장면을 해석하고 있습니다.
              </p>
            ) : null}
          </div>

          {conversationError !== null ? (
            <p className="assistant-conversation-error" role="alert">
              {conversationError}
            </p>
          ) : null}

          {generationPhase !== null ? (
            <p className="assistant-generation-status" role="status">
              {generationPhase === 'rendering'
                ? '현재 3D 구도를 캡처하고 있습니다.'
                : generationPhase === 'uploading'
                  ? '구도 렌더를 프로젝트에 보관하고 있습니다.'
                  : generationPhase === 'importing'
                    ? '생성 결과를 프로젝트로 가져오고 있습니다.'
                    : 'Codex가 이미지를 생성하고 있습니다.'}
            </p>
          ) : null}

          {generationPreviewUrl !== null &&
          generation !== null &&
          generation.result !== null ? (
            <figure className="assistant-generation-result">
              <img src={generationPreviewUrl} alt="Scene Assistant 생성 결과" />
              <figcaption>
                키프레임 v{generation.versionNumber} ·{' '}
                {generation.sceneSnapshot === null
                  ? '기존 기록(3D 복원 제한)'
                  : '소스 스냅샷 저장됨'}{' '}
                · {generation.result.width ?? '?'}×
                {generation.result.height ?? '?'}
              </figcaption>
            </figure>
          ) : null}

          <p
            className="assistant-generation-lineage"
            role="status"
            aria-label="이미지 생성 계보"
          >
            {refinementSource === null
              ? currentScene.success &&
                currentScene.data.generationSource !== undefined
                ? `fresh 새 생성 · 3D 출처 ${currentScene.data.generationSource.generationId} · 기존 결과 이미지 미사용`
                : 'fresh 새 생성 · 현재 3D 레이아웃 · 기존 결과 이미지 미사용'
              : `edit 보정 · 기존 결과 이미지 ${refinementSource.id} 기반`}
          </p>

          {refinementSource === null ? null : (
            <div className="assistant-refinement-mode" role="status">
              <div>
                <strong>키프레임 보정 모드</strong>
                <span>
                  v{refinementSource.versionNumber} · {refinementSource.id} 결과
                  + 현재 3D 레이아웃 · 레퍼런스 최대 {maximumReferences}장
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  changeRefinementSource(null);
                  setConversationError(null);
                }}
                disabled={busy}
              >
                보정 취소
              </button>
            </div>
          )}

          <form className="assistant-composer" onSubmit={submitMessage}>
            <label htmlFor="assistant-message">
              {refinementSource === null
                ? '장면에 대해 말하기'
                : '이 키프레임에서 바꿀 내용'}
            </label>
            {selectedReferences.length === 0 ? null : (
              <p className="assistant-reference-summary">
                레퍼런스 {selectedReferences.length}/{maximumReferences}개 · 총
                이미지 입력{' '}
                {selectedReferences.length +
                  (refinementSource === null ? 1 : 2)}
                /5
              </p>
            )}
            <textarea
              id="assistant-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                refinementSource === null
                  ? '예: 노란 오브젝트는 아웃포커스된 전봇대야.'
                  : '예: 전봇대가 가리는 비율만 조금 줄여줘.'
              }
              rows={3}
              disabled={busy}
            />
            {busy ? (
              <button
                className="assistant-cancel"
                type="button"
                onClick={cancelTurn}
                disabled={activeTurnId === null || isCancelling}
              >
                {isCancelling ? '중단 중…' : '응답 중단'}
              </button>
            ) : (
              <div className="assistant-actions">
                <button type="submit" disabled={draft.trim() === ''}>
                  보내기
                </button>
                <button
                  className="assistant-generate"
                  type="button"
                  onClick={() => void generateImage()}
                  disabled={
                    draft.trim() === '' ||
                    captureLayout === null ||
                    runtime?.capabilities?.imageGeneration === false ||
                    referenceSelectionOverLimit
                  }
                  title={
                    captureLayout === null
                      ? 'WebGL 뷰포트가 준비되면 사용할 수 있습니다.'
                      : runtime?.capabilities?.imageGeneration === false
                        ? '현재 Codex 런타임이 이미지 생성을 지원하지 않습니다.'
                        : referenceSelectionOverLimit
                          ? `레퍼런스를 ${maximumReferences}장 이하로 줄여 주세요.`
                          : undefined
                  }
                >
                  {refinementSource === null ? '이미지 생성' : '보정 생성'}
                </button>
              </div>
            )}
          </form>
        </div>
      ) : null}

      {phase === 'ready' && activeView === 'contract' ? (
        <div
          id="assistant-contract-view"
          className="assistant-contract-view"
          role="tabpanel"
          aria-labelledby="assistant-tab-contract"
        >
          {layoutPreview === null ? (
            <p className="assistant-empty-message">
              현재 장면에서 변환 계약을 계산할 수 없습니다.
            </p>
          ) : (
            <details className="assistant-layout-contract">
              <summary>3D → 키프레임 변환 계약 상세 보기</summary>
              <p>
                카메라 {layoutPreview.camera.focalLengthMm}mm · 출력{' '}
                {layoutPreview.output.width}×{layoutPreview.output.height}
              </p>
              <div className="assistant-layout-authority">
                <div>
                  <strong>3D에서 유지</strong>
                  <span>카메라·크롭·배치·포즈·깊이·가림</span>
                </div>
                <div>
                  <strong>최종 이미지에서 교체</strong>
                  <span>프록시 색·재질·외형·캐릭터 디테일</span>
                </div>
              </div>
              <p>
                프록시의 실제 의미는 오브젝트 이름과 아래 사용자 연출이
                결정합니다.
              </p>
              {previewObjects.length === 0 ? null : (
                <ul className="assistant-layout-objects">
                  {previewObjects.map((object) => (
                    <li key={object.objectId}>
                      <strong>{object.semanticMeaning ?? object.name}</strong>
                      <span>
                        {object.semanticMeaning === null
                          ? ''
                          : `${object.name} · `}
                        {object.screen.positionLabel ?? object.screen.status} ·{' '}
                        {object.screen.depthBand} · 화면{' '}
                        {Math.round(object.screen.occupancy * 100)}%
                        {object.facing === null
                          ? ''
                          : ` · ${object.facing.relativeToCamera}`}
                        {object.appearanceReferenceIds.length === 0
                          ? ''
                          : ` · 레퍼런스 ${object.appearanceReferenceIds.length}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {layoutPreview.potentialOcclusions.length === 0 ? null : (
                <p>
                  잠재 가림 관계 {layoutPreview.potentialOcclusions.length}개를
                  생성 제약으로 전달합니다.
                </p>
              )}
            </details>
          )}
        </div>
      ) : null}

      {onDisconnect !== undefined ? (
        <button
          className="assistant-disconnect"
          type="button"
          onClick={onDisconnect}
        >
          연결 정보 지우기
        </button>
      ) : null}
    </section>
  );
}

export function SceneAssistantPanel({
  connection,
  connectionError = null,
  onDisconnect,
  getSceneContext = emptySceneContext,
  getSelectedReferences = emptySelectedReferences,
  captureLayout = null,
  clientFactory = defaultClientFactory,
  createObjectUrl = defaultCreateObjectUrl,
  revokeObjectUrl = defaultRevokeObjectUrl,
  onRefinementModeChange = ignoreRefinementModeChange,
  refinementSource,
  onRefinementSourceChange = ignoreRefinementSourceChange,
}: SceneAssistantPanelProps) {
  if (connection === null) {
    return (
      <section
        className="scene-assistant-panel"
        aria-labelledby="assistant-title"
      >
        <PanelHeading phase="disconnected" />
        <p className="assistant-message">
          {connectionError ?? (
            <>
              Companion을 실행한 뒤 출력된 <strong>launchUrl</strong>로 편집기를
              여세요.
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <ConnectedSceneAssistant
      key={connection.url}
      connection={connection}
      onDisconnect={onDisconnect}
      getSceneContext={getSceneContext}
      getSelectedReferences={getSelectedReferences}
      captureLayout={captureLayout}
      clientFactory={clientFactory}
      createObjectUrl={createObjectUrl}
      revokeObjectUrl={revokeObjectUrl}
      onRefinementModeChange={onRefinementModeChange}
      refinementSource={refinementSource}
      onRefinementSourceChange={onRefinementSourceChange}
    />
  );
}
