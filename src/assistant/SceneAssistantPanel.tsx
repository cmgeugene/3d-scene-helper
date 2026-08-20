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
  type NormalizedStartGenerationInput,
  type ReferenceArtifact,
  startGenerationInputSchema,
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
  createWebImageGenerationPrompt,
  createWebImageRefinementPrompt,
} from './sceneAssistantPrompt';
import { WebPromptExportDialog } from './WebPromptExportDialog';
import {
  DEFAULT_OAUTH_IMAGE_SETTINGS,
  readOAuthImageSettings,
  writeOAuthImageSettings,
} from './oauthImageSettings';
import {
  OAUTH_IMAGE_MODELS,
  OAUTH_IMAGE_QUALITIES,
} from '../../shared/oauthImageOptions';
import { parseGenerationUpdate } from './generationEvents';
import { parseSpecPatchProposalUpdate } from './specPatchProposalEvents';
import { RuntimeRequestCard } from './RuntimeRequestCard';
import {
  runtimeRequestSchema,
  type RuntimeRequest,
  type RuntimeRequestResponse,
} from '../../shared/runtimeRequest';
import { createLayoutSpec } from './layoutSpec';
import {
  sceneDocumentSchema,
  type SceneDocument,
} from '../editor/persistence/sceneSchema';
import {
  evaluateSpecPatchProposal,
  type SpecPatchEvaluation,
  type SpecPatchProposal,
} from '../editor/persistence/specPatchProposal';
import { getMaximumReferenceImages } from '../../shared/imageInputBudget';
import {
  createGenerationPreflightFingerprint,
  evaluateGenerationPreflight,
  type GenerationPreflightIssue,
} from '../../shared/generationPreflight';
import {
  createRefinementDirective,
  type RefinementDirective,
} from '../../shared/refinementDirective';
import {
  clearGenerationRequestRecovery,
  readGenerationRequestRecovery,
  storeGenerationRequestRecovery,
  type GenerationRequestRecovery,
} from './generationRequestRecovery';
import type { ConversationTaskMetadata } from '../../shared/conversationMetadata';
import { referencePromptManifest } from '../../shared/generationPromptEvidence';

type ConnectionPhase =
  'disconnected' | 'connecting' | 'reconnecting' | 'ready' | 'error';
type AssistantView = 'conversation' | 'contract';

const MAX_AUTOMATIC_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000] as const;

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
  storage?: Storage;
  onRefinementModeChange?: (active: boolean) => void;
  refinementSource?: GenerationRecord | null;
  onRefinementSourceChange?: (generation: GenerationRecord | null) => void;
  onApplySpecPatchProposal?: (
    proposal: SpecPatchProposal,
  ) => SpecPatchEvaluation;
  onConversationReset?: () => void;
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
  storage: Storage;
  onRefinementModeChange: (active: boolean) => void;
  refinementSource?: GenerationRecord | null;
  onRefinementSourceChange: (generation: GenerationRecord | null) => void;
  onApplySpecPatchProposal: (
    proposal: SpecPatchProposal,
  ) => SpecPatchEvaluation;
  onConversationReset: () => void;
}

const defaultClientFactory = (connection: CompanionConnection) =>
  new CompanionClient(connection);
const emptySceneContext = () => null;
const emptySelectedReferences = () => [];
const defaultCreateObjectUrl = (blob: Blob) => URL.createObjectURL(blob);
const defaultRevokeObjectUrl = (url: string) => URL.revokeObjectURL(url);

function createGenerationRequestId(sceneId: string) {
  const entropy =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `generation-${sceneId.slice(0, 80)}-${entropy}`;
}

function revokeAfterRender(
  revokeObjectUrl: (url: string) => void,
  url: string,
) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => revokeObjectUrl(url)),
    );
    return;
  }
  setTimeout(() => revokeObjectUrl(url), 32);
}
const ignoreRefinementModeChange = () => undefined;
const ignoreRefinementSourceChange = () => undefined;
const ignoreConversationReset = () => undefined;
const unavailableSpecPatchApply = (): never => {
  throw new Error('Semantic Scene Spec 변경 적용기가 연결되지 않았습니다.');
};

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
  if (phase === 'reconnecting') return '재연결 중';
  if (phase === 'error') return '연결 오류';
  return '연결 안 됨';
}

function formatSpecPatchValue(value: unknown) {
  if (value === '') return '(비어 있음)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function formatTransform(
  transform: SceneDocument['objects'][number]['transform'],
) {
  const vector = ({ x, y, z }: { x: number; y: number; z: number }) =>
    `(${x}, ${y}, ${z})`;
  return `위치 ${vector(transform.position)} · 회전 ${vector(transform.rotationDeg)} · 크기 ${vector(transform.scale)}`;
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
  storage,
  onRefinementModeChange,
  refinementSource: controlledRefinementSource,
  onRefinementSourceChange,
  onApplySpecPatchProposal,
  onConversationReset,
}: ConnectedSceneAssistantProps) {
  const client = useMemo(
    () => clientFactory(connection),
    [clientFactory, connection],
  );
  const [phase, setPhase] = useState<ConnectionPhase>('connecting');
  const [runtime, setRuntime] = useState<CompanionRuntimeStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [reconnectDelayMs, setReconnectDelayMs] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [imageSettings, setImageSettings] = useState(() =>
    typeof localStorage === 'undefined'
      ? DEFAULT_OAUTH_IMAGE_SETTINGS
      : readOAuthImageSettings(localStorage),
  );
  const [refinementPreserveDraft, setRefinementPreserveDraft] = useState('');
  const [activeView, setActiveView] = useState<AssistantView>('conversation');
  const restoredThreadId = useMemo(() => readSceneAssistantThread(), []);
  const [threadId, setThreadId] = useState<string | null>(restoredThreadId);
  const [savedTask, setSavedTask] = useState<ConversationTaskMetadata | null>(
    null,
  );
  const [conversationDecisionRequired, setConversationDecisionRequired] =
    useState(false);
  const [conversationSessionLoading, setConversationSessionLoading] = useState(
    client.getConversationSession !== undefined,
  );
  const [sessionActionInFlight, setSessionActionInFlight] = useState(false);
  const [runtimeRequests, setRuntimeRequests] = useState<RuntimeRequest[]>([]);
  const [runtimeRequestActionId, setRuntimeRequestActionId] = useState<
    string | null
  >(null);
  const [runtimeRequestError, setRuntimeRequestError] = useState<string | null>(
    null,
  );
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(
    null,
  );
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [pendingSpecPatch, setPendingSpecPatch] = useState<{
    proposal: SpecPatchProposal;
    evaluation: SpecPatchEvaluation;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [generation, setGeneration] = useState<GenerationRecord | null>(null);
  const [generationRequestRecovery, setGenerationRequestRecovery] =
    useState<GenerationRequestRecovery | null>(() =>
      readGenerationRequestRecovery(storage),
    );
  const [pendingGenerationPreflight, setPendingGenerationPreflight] = useState<{
    fingerprint: string;
    warnings: GenerationPreflightIssue[];
  } | null>(null);
  const [webPromptExport, setWebPromptExport] = useState<{
    prompt: string;
    attachmentLabels: string[];
    warnings: string[];
  } | null>(null);
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
  const completedTurnIdsRef = useRef(new Set<string>());
  const messageSequence = useRef(0);
  const generationPreviewUrlRef = useRef<string | null>(null);
  const handledProposalIdsRef = useRef(new Set<string>());
  const generationLaunchInFlightRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const conversationActivatedRef = useRef(false);

  const changeRefinementSource = useCallback(
    (next: GenerationRecord | null) => {
      setInternalRefinementSource(next);
      setRefinementPreserveDraft('');
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

  useEffect(() => {
    if (activeTurnId === null && !isSubmitting) {
      generationLaunchInFlightRef.current = false;
    }
  }, [activeTurnId, isSubmitting]);

  const displayGeneration = useCallback(
    async (nextGeneration: GenerationRecord, signal?: AbortSignal) => {
      setGeneration(nextGeneration);
      if (nextGeneration.status === 'inProgress') {
        threadIdRef.current = nextGeneration.threadId;
        setThreadId(nextGeneration.threadId);
        storeSceneAssistantThread(nextGeneration.threadId);
        activeTurnIdRef.current = nextGeneration.turnId;
        setActiveTurnId(nextGeneration.turnId);
        setIsSubmitting(true);
        setIsCancelling(false);
        setGenerationPhase(
          nextGeneration.result === null ? 'generating' : 'importing',
        );
      } else {
        generationLaunchInFlightRef.current = false;
        if (activeTurnIdRef.current === nextGeneration.turnId) {
          activeTurnIdRef.current = null;
          setActiveTurnId(null);
        }
        setIsSubmitting(false);
        setIsCancelling(false);
        setGenerationPhase(null);
        if (nextGeneration.status === 'failed') {
          setConversationError(
            nextGeneration.error ?? '이미지 생성이 실패했습니다.',
          );
        } else if (nextGeneration.status === 'interrupted') {
          setConversationError(
            nextGeneration.error ?? '이미지 생성을 중단했습니다.',
          );
        }
      }
      const recovery = readGenerationRequestRecovery(storage);
      if (
        recovery !== null &&
        nextGeneration.requestId === recovery.input.requestId
      ) {
        clearGenerationRequestRecovery(storage);
        setGenerationRequestRecovery(null);
      }
      if (nextGeneration.result === null) return;
      const blob = await client.loadGenerationBlob(nextGeneration.id, signal);
      if (signal?.aborted) return;
      const nextUrl = createObjectUrl(blob);
      const previousUrl = generationPreviewUrlRef.current;
      generationPreviewUrlRef.current = nextUrl;
      setGenerationPreviewUrl(nextUrl);
      if (previousUrl !== null) revokeAfterRender(revokeObjectUrl, previousUrl);
    },
    [client, createObjectUrl, revokeObjectUrl, storage],
  );

  const ensureThread = useCallback(async () => {
    if (conversationDecisionRequired || conversationSessionLoading) {
      throw new Error('저장된 Codex task를 재개할지 먼저 선택해 주세요.');
    }
    let currentThreadId = threadIdRef.current;
    if (currentThreadId === null) {
      currentThreadId = await client.startThread();
    } else if (!threadReadyRef.current) {
      currentThreadId = await client.startThread(currentThreadId);
    }
    threadIdRef.current = currentThreadId;
    threadReadyRef.current = true;
    conversationActivatedRef.current = true;
    setThreadId(currentThreadId);
    storeSceneAssistantThread(currentThreadId);
    return currentThreadId;
  }, [client, conversationDecisionRequired, conversationSessionLoading]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current === null) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const resetReconnectState = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    setReconnectDelayMs(null);
  }, [clearReconnectTimer]);

  const retry = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    setReconnectDelayMs(null);
    setPhase('connecting');
    setConnectionError(null);
    setRetryNonce((value) => value + 1);
  }, [clearReconnectTimer]);

  const scheduleReconnect = useCallback(
    (reason: string) => {
      if (reconnectTimerRef.current !== null) return;
      const attempt = reconnectAttemptRef.current + 1;
      if (attempt > MAX_AUTOMATIC_RECONNECT_ATTEMPTS) {
        setPhase('error');
        setConnectionError(
          `${reason} 자동 재연결을 완료하지 못했습니다. Companion 실행 상태를 확인해 주세요.`,
        );
        setReconnectDelayMs(null);
        return;
      }
      const delay = RECONNECT_DELAYS_MS[attempt - 1]!;
      threadReadyRef.current = false;
      if (client.getConversationSession !== undefined) {
        setConversationSessionLoading(true);
      }
      setPhase('reconnecting');
      setConnectionError(reason);
      setReconnectAttempt(attempt);
      setReconnectDelayMs(delay);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        reconnectAttemptRef.current = attempt;
        setReconnectDelayMs(null);
        setRetryNonce((value) => value + 1);
      }, delay);
    },
    [client],
  );

  useEffect(
    () => () => {
      clearReconnectTimer();
    },
    [clearReconnectTimer],
  );

  const trackStartedTurn = useCallback((turnId: string) => {
    if (completedTurnIdsRef.current.delete(turnId)) {
      setIsSubmitting(false);
      return false;
    }
    activeTurnIdRef.current = turnId;
    setActiveTurnId(turnId);
    return true;
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
        completedTurnIdsRef.current.add(update.turnId);
        if (activeTurnIdRef.current === update.turnId) {
          activeTurnIdRef.current = null;
          setActiveTurnId(null);
        }
        setIsSubmitting(false);
      }
      return;
    }

    if (update.type === 'turn-completed') {
      completedTurnIdsRef.current.add(update.turnId);
      if (activeTurnIdRef.current === update.turnId) {
        activeTurnIdRef.current = null;
        setActiveTurnId(null);
      }
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

  const upsertRuntimeRequest = useCallback((request: RuntimeRequest) => {
    setRuntimeRequests((current) => {
      const index = current.findIndex(({ id }) => id === request.id);
      if (index < 0) return [...current, request].slice(-50);
      const next = [...current];
      next[index] = request;
      return next;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (client.getConversationSession !== undefined) {
      void client
        .getConversationSession(controller.signal)
        .then((session) => {
          if (controller.signal.aborted) return;
          setSavedTask(session.activeTask);
          setConversationSessionLoading(false);
          setConversationError((current) =>
            current?.startsWith('프로젝트 대화 metadata를 불러오지 못했습니다.')
              ? null
              : current,
          );
          if (session.activeTask === null) {
            threadIdRef.current = null;
            threadReadyRef.current = false;
            setThreadId(null);
            setConversationDecisionRequired(false);
            clearSceneAssistantThread();
            return;
          }
          const activeTask = session.activeTask;
          const knownTurnId = activeTurnIdRef.current;
          if (
            knownTurnId !== null &&
            activeTask.lastTurnId === knownTurnId &&
            activeTask.lastTurnStatus !== 'inProgress'
          ) {
            activeTurnIdRef.current = null;
            setActiveTurnId(null);
            setIsSubmitting(false);
            setIsCancelling(false);
          }
          if (
            conversationActivatedRef.current &&
            threadIdRef.current === activeTask.threadId
          ) {
            setThreadId(activeTask.threadId);
            setConversationDecisionRequired(false);
            return;
          }
          threadIdRef.current = null;
          threadReadyRef.current = false;
          setThreadId(null);
          setConversationDecisionRequired(true);
        })
        .catch((reason) => {
          if (controller.signal.aborted) return;
          setConversationSessionLoading(false);
          setConversationError(
            reason instanceof Error
              ? `프로젝트 대화 metadata를 불러오지 못했습니다. ${reason.message}`
              : '프로젝트 대화 metadata를 불러오지 못했습니다.',
          );
        });
    }
    if (client.listRuntimeRequests !== undefined) {
      void client
        .listRuntimeRequests(controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setRuntimeRequests(result.requests);
          setRuntimeRequestError((current) =>
            current?.startsWith('Codex 요청 목록을 불러오지 못했습니다.')
              ? null
              : current,
          );
        })
        .catch((reason) => {
          if (controller.signal.aborted) return;
          setRuntimeRequestError(
            reason instanceof Error
              ? `Codex 요청 목록을 불러오지 못했습니다. ${reason.message}`
              : 'Codex 요청 목록을 불러오지 못했습니다.',
          );
        });
    }
    void client
      .getRuntime(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setRuntime(value);
        if (value.state === 'ready') {
          resetReconnectState();
          setPhase('ready');
          setConnectionError(null);
        } else if (value.state === 'failed') {
          resetReconnectState();
          setPhase('error');
          setConnectionError(value.error ?? 'Codex App Server가 실패했습니다.');
        } else {
          setPhase('connecting');
        }
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        scheduleReconnect(
          reason instanceof Error
            ? reason.message
            : 'Companion에 연결하지 못했습니다.',
        );
      });
    void client
      .listGenerations(controller.signal)
      .then((generations) => {
        if (controller.signal.aborted) return;
        const recovery = readGenerationRequestRecovery(storage);
        if (recovery !== null) {
          const recovered = generations.find(
            ({ requestId }) => requestId === recovery.input.requestId,
          );
          if (recovered !== undefined) {
            clearGenerationRequestRecovery(storage);
            setGenerationRequestRecovery(null);
          } else {
            setGenerationRequestRecovery(recovery);
            setConversationError(
              '이전 generation 요청의 응답을 확인하지 못했습니다. 같은 request ID로 안전하게 다시 확인할 수 있습니다.',
            );
          }
        }
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
            if (parsed.data.state === 'ready') {
              resetReconnectState();
              setPhase('ready');
              setConnectionError(null);
            } else if (parsed.data.state === 'failed') {
              resetReconnectState();
              setPhase('error');
              setConnectionError(
                parsed.data.error ?? 'Codex App Server가 실패했습니다.',
              );
            } else {
              setPhase('connecting');
              setConnectionError(parsed.data.error);
            }
          }
        }
        const specPatchUpdate = parseSpecPatchProposalUpdate(event);
        if (specPatchUpdate?.type === 'proposal') {
          try {
            const scene = sceneDocumentSchema.parse(getSceneContext());
            const evaluation = evaluateSpecPatchProposal(
              scene,
              specPatchUpdate.proposal,
            );
            setPendingSpecPatch({
              proposal: specPatchUpdate.proposal,
              evaluation,
            });
            setProposalError(null);
          } catch (reason) {
            setPendingSpecPatch(null);
            setProposalError(
              reason instanceof Error
                ? reason.message
                : 'Semantic Scene Spec 변경안을 검증하지 못했습니다.',
            );
          }
        } else if (specPatchUpdate?.type === 'error') {
          setPendingSpecPatch(null);
          setProposalError(specPatchUpdate.error);
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
        if (event.event === 'runtime-request') {
          const request = runtimeRequestSchema.safeParse(event.data);
          if (request.success) upsertRuntimeRequest(request.data);
        }
      },
      (reason) => {
        scheduleReconnect(reason.message);
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
    getSceneContext,
    retryNonce,
    revokeObjectUrl,
    resetReconnectState,
    scheduleReconnect,
    storage,
    upsertRuntimeRequest,
  ]);

  const submitMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const message = draft.trim();
      if (
        message === '' ||
        phase !== 'ready' ||
        activeTurnIdRef.current !== null ||
        isSubmitting ||
        conversationDecisionRequired ||
        conversationSessionLoading
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
        const conversationReferenceManifest = referencePromptManifest(
          selectedReferences,
          0,
        );
        const referenceIds = conversationReferenceManifest.map(({ id }) => id);
        const scene = sceneDocumentSchema.safeParse(getSceneContext());
        const turnId =
          client.startConversationTurn === undefined
            ? await client.startTurn(currentThreadId, prompt, referenceIds)
            : await client.startConversationTurn(
                currentThreadId,
                prompt,
                referenceIds,
                {
                  kind: 'conversation',
                  userMessage: message,
                  sceneRevision: scene.success
                    ? scene.data.sceneRevision
                    : null,
                  specRevision: scene.success ? scene.data.specRevision : null,
                  ...(conversationReferenceManifest.length === 0
                    ? {}
                    : {
                        referenceBindings: conversationReferenceManifest.map(
                          ({
                            attachmentIndex,
                            id,
                            name,
                            role,
                            targetObjectId,
                            use,
                            exclude,
                          }) => ({
                            conversationAttachmentIndex: attachmentIndex,
                            id,
                            name,
                            role,
                            targetObjectId,
                            use,
                            exclude,
                          }),
                        ),
                      }),
                },
              );
        trackStartedTurn(turnId);
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
      trackStartedTurn,
      conversationDecisionRequired,
      conversationSessionLoading,
    ],
  );

  const requestSpecPatchProposal = useCallback(async () => {
    const message = draft.trim();
    if (
      message === '' ||
      phase !== 'ready' ||
      activeTurnIdRef.current !== null ||
      isSubmitting ||
      conversationDecisionRequired ||
      conversationSessionLoading
    ) {
      return;
    }
    if (client.startSpecPatchProposal === undefined) {
      setConversationError(
        'Companion이 structured 변경안을 지원하지 않습니다.',
      );
      return;
    }
    const parsedScene = sceneDocumentSchema.safeParse(getSceneContext());
    if (!parsedScene.success) {
      setConversationError(
        '현재 SceneDocument를 변경안 요청으로 해석하지 못했습니다.',
      );
      return;
    }
    const scene: SceneDocument = parsedScene.data;
    messageSequence.current += 1;
    const requestId = `spec-patch-${scene.id}-${scene.sceneRevision}-${messageSequence.current}`;
    setMessages((current) => [
      ...current,
      {
        id: `user-${messageSequence.current}`,
        role: 'user',
        text: message,
      },
    ]);
    setDraft('');
    setPendingSpecPatch(null);
    setProposalError(null);
    setConversationError(null);
    setIsSubmitting(true);
    try {
      const currentThreadId = await ensureThread();
      const started = await client.startSpecPatchProposal({
        threadId: currentThreadId,
        requestId,
        baseSceneRevision: scene.sceneRevision,
        baseSpecRevision: scene.specRevision,
        userMessage: message,
        sceneDocument: scene,
      });
      trackStartedTurn(started.turnId);
    } catch (reason) {
      setConversationError(
        reason instanceof Error
          ? reason.message
          : 'Semantic Scene Spec 변경안을 요청하지 못했습니다.',
      );
      setIsSubmitting(false);
    }
  }, [
    client,
    draft,
    ensureThread,
    getSceneContext,
    isSubmitting,
    phase,
    trackStartedTurn,
    conversationDecisionRequired,
    conversationSessionLoading,
  ]);

  const generateImage = useCallback(
    async (acknowledgeWarnings = false) => {
      const message = draft.trim();
      const sourceGeneration = refinementSource;
      const editing = sourceGeneration !== null;
      let refinementDirective: RefinementDirective | null = null;
      if (editing) {
        try {
          refinementDirective = createRefinementDirective(
            message,
            refinementPreserveDraft,
          );
        } catch (reason) {
          setConversationError(
            reason instanceof Error
              ? `보정 지시를 확인해 주세요. ${reason.message}`
              : '보정 지시를 구조화하지 못했습니다.',
          );
          return;
        }
      }
      const selectedReferences = getSelectedReferences();
      if (
        message === '' ||
        phase !== 'ready' ||
        captureLayout === null ||
        activeTurnIdRef.current !== null ||
        isSubmitting ||
        conversationDecisionRequired ||
        conversationSessionLoading ||
        generationLaunchInFlightRef.current ||
        (runtime?.imageProvider === 'oauth'
          ? runtime.oauth?.state !== 'ready'
          : runtime?.capabilities?.imageGeneration === false)
      ) {
        return;
      }
      const parsedScene = sceneDocumentSchema.safeParse(getSceneContext());
      if (!parsedScene.success) {
        setConversationError(
          '현재 SceneDocument를 생성 전 검사에 사용할 수 없습니다.',
        );
        return;
      }
      const scene = parsedScene.data;
      let layoutSpec: ReturnType<typeof createLayoutSpec>;
      try {
        layoutSpec = createLayoutSpec(scene, selectedReferences);
      } catch (reason) {
        setConversationError(
          reason instanceof Error
            ? reason.message
            : '현재 장면을 LayoutSpec으로 해석하지 못했습니다.',
        );
        return;
      }
      const preflightInput = {
        scene,
        layoutSpec,
        references: selectedReferences,
        includeLayout: true,
        includeSourceKeyframe: editing,
      };
      const preflight = evaluateGenerationPreflight(preflightInput);
      if (preflight.blockers.length > 0) {
        setPendingGenerationPreflight(null);
        setConversationError(
          `생성 전 무결성 검사 실패: ${preflight.blockers.map(({ message: blockerMessage }) => blockerMessage).join(' ')}`,
        );
        return;
      }
      const preflightFingerprint =
        createGenerationPreflightFingerprint(preflightInput);
      if (
        preflight.warnings.length > 0 &&
        (!acknowledgeWarnings ||
          pendingGenerationPreflight?.fingerprint !== preflightFingerprint)
      ) {
        setPendingGenerationPreflight({
          fingerprint: preflightFingerprint,
          warnings: preflight.warnings,
        });
        setConversationError(null);
        return;
      }

      generationLaunchInFlightRef.current = true;
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
      setPendingGenerationPreflight(null);
      setConversationError(null);
      const previousPreviewUrl = generationPreviewUrlRef.current;
      if (previousPreviewUrl !== null) {
        generationPreviewUrlRef.current = null;
        revokeAfterRender(revokeObjectUrl, previousPreviewUrl);
      }
      setGenerationPreviewUrl(null);
      setGeneration(null);
      setIsSubmitting(true);
      setGenerationPhase('rendering');

      try {
        const layout = await captureLayout();
        setGenerationPhase('uploading');
        const render = await client.createSceneRender(layout, scene.id);
        const currentThreadId = await ensureThread();
        const prompt =
          sourceGeneration === null
            ? createImageGenerationPrompt(scene, layoutSpec, selectedReferences)
            : createImageRefinementPrompt(
                refinementDirective!,
                scene,
                layoutSpec,
                sourceGeneration,
                selectedReferences,
              );
        setGenerationPhase('generating');
        const generationInput: NormalizedStartGenerationInput =
          startGenerationInputSchema.parse({
            requestId: createGenerationRequestId(scene.id),
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
            refinementDirective,
            generationMode: sourceGeneration === null ? 'fresh' : 'edit',
            acknowledgedPreflightWarningIds: preflight.warnings.map(
              ({ id }) => id,
            ),
            imageModel: imageSettings.model,
            imageQuality: imageSettings.quality,
          });
        storeGenerationRequestRecovery(storage, generationInput);
        const started = await client.startGeneration(generationInput);
        clearGenerationRequestRecovery(storage);
        setGenerationRequestRecovery(null);
        if (
          started.generation.status !== 'inProgress' ||
          trackStartedTurn(started.turnId)
        ) {
          await displayGeneration(started.generation);
        }
      } catch (reason) {
        const recovery = readGenerationRequestRecovery(storage);
        if (recovery !== null) setGenerationRequestRecovery(recovery);
        setGenerationPhase(null);
        setConversationError(
          reason instanceof Error
            ? reason.message
            : '이미지 생성을 시작하지 못했습니다.',
        );
        setIsSubmitting(false);
      } finally {
        generationLaunchInFlightRef.current = false;
      }
    },
    [
      captureLayout,
      client,
      draft,
      ensureThread,
      getSceneContext,
      getSelectedReferences,
      isSubmitting,
      pendingGenerationPreflight?.fingerprint,
      phase,
      refinementPreserveDraft,
      refinementSource,
      runtime,
      imageSettings,
      revokeObjectUrl,
      storage,
      displayGeneration,
      trackStartedTurn,
      conversationDecisionRequired,
      conversationSessionLoading,
    ],
  );

  const exportPromptToWeb = useCallback(() => {
    const message = draft.trim();
    const sourceGeneration = refinementSource;
    const editing = sourceGeneration !== null;
    let refinementDirective: RefinementDirective | null = null;
    if (editing) {
      try {
        refinementDirective = createRefinementDirective(
          message,
          refinementPreserveDraft,
        );
      } catch (reason) {
        setConversationError(
          reason instanceof Error
            ? `보정 지시를 확인해 주세요. ${reason.message}`
            : '보정 지시를 구조화하지 못했습니다.',
        );
        return;
      }
    }
    const selectedReferences = getSelectedReferences();
    if (
      message === '' ||
      phase !== 'ready' ||
      activeTurnIdRef.current !== null ||
      isSubmitting ||
      conversationDecisionRequired ||
      conversationSessionLoading
    ) {
      return;
    }
    const parsedScene = sceneDocumentSchema.safeParse(getSceneContext());
    if (!parsedScene.success) {
      setConversationError(
        '현재 SceneDocument를 웹용 프롬프트로 내보낼 수 없습니다.',
      );
      return;
    }
    const scene = parsedScene.data;
    let layoutSpec: ReturnType<typeof createLayoutSpec>;
    try {
      layoutSpec = createLayoutSpec(scene, selectedReferences);
    } catch (reason) {
      setConversationError(
        reason instanceof Error
          ? reason.message
          : '현재 장면을 LayoutSpec으로 해석하지 못했습니다.',
      );
      return;
    }
    const preflight = evaluateGenerationPreflight({
      scene,
      layoutSpec,
      references: selectedReferences,
      includeLayout: true,
      includeSourceKeyframe: editing,
    });
    if (preflight.blockers.length > 0) {
      setConversationError(
        `내보내기 전 무결성 검사 실패: ${preflight.blockers.map(({ message: blockerMessage }) => blockerMessage).join(' ')}`,
      );
      return;
    }

    const referenceManifest = referencePromptManifest(
      selectedReferences,
      editing ? 2 : 1,
    );
    setWebPromptExport({
      prompt:
        sourceGeneration === null
          ? createWebImageGenerationPrompt(
              scene,
              layoutSpec,
              selectedReferences,
              message,
            )
          : createWebImageRefinementPrompt(
              refinementDirective!,
              scene,
              layoutSpec,
              sourceGeneration,
              selectedReferences,
            ),
      attachmentLabels: [
        '현재 OutputCamera의 3D 레이아웃 렌더 · 공간 기준 · 고정',
        ...(editing
          ? [
              `보정 원본 키프레임 v${sourceGeneration.versionNumber} (${sourceGeneration.id}) · 외형 기준`,
            ]
          : []),
        ...referenceManifest.map(
          ({ name, role }) => `레퍼런스 · ${name} (${role})`,
        ),
      ],
      warnings: preflight.warnings.map(
        ({ message: warningMessage }) => warningMessage,
      ),
    });
    setConversationError(null);
  }, [
    conversationDecisionRequired,
    conversationSessionLoading,
    draft,
    getSceneContext,
    getSelectedReferences,
    isSubmitting,
    phase,
    refinementPreserveDraft,
    refinementSource,
  ]);

  const retryRecoveredGenerationRequest = useCallback(async () => {
    if (
      generationRequestRecovery === null ||
      generationLaunchInFlightRef.current ||
      activeTurnIdRef.current !== null ||
      isSubmitting
    ) {
      return;
    }
    generationLaunchInFlightRef.current = true;
    setIsSubmitting(true);
    setGenerationPhase('generating');
    setConversationError(null);
    try {
      await ensureThread();
      const started = await client.startGeneration(
        generationRequestRecovery.input,
      );
      clearGenerationRequestRecovery(storage);
      setGenerationRequestRecovery(null);
      if (
        started.generation.status !== 'inProgress' ||
        trackStartedTurn(started.turnId)
      ) {
        await displayGeneration(started.generation);
      }
    } catch (reason) {
      setGenerationPhase(null);
      setConversationError(
        reason instanceof Error
          ? `generation 요청을 다시 확인하지 못했습니다. ${reason.message}`
          : 'generation 요청을 다시 확인하지 못했습니다.',
      );
      setIsSubmitting(false);
    } finally {
      generationLaunchInFlightRef.current = false;
    }
  }, [
    client,
    displayGeneration,
    ensureThread,
    generationRequestRecovery,
    isSubmitting,
    storage,
    trackStartedTurn,
  ]);

  const applyPendingSpecPatch = useCallback(() => {
    if (pendingSpecPatch === null) return;
    const requestId = pendingSpecPatch.proposal.requestId;
    if (handledProposalIdsRef.current.has(requestId)) return;
    handledProposalIdsRef.current.add(requestId);
    try {
      onApplySpecPatchProposal(pendingSpecPatch.proposal);
      setPendingSpecPatch(null);
      setProposalError(null);
    } catch (reason) {
      setPendingSpecPatch(null);
      setProposalError(
        reason instanceof Error
          ? reason.message
          : 'Semantic Scene Spec 변경안을 적용하지 못했습니다.',
      );
    }
  }, [onApplySpecPatchProposal, pendingSpecPatch]);

  const cancelTurn = useCallback(async () => {
    const currentThreadId = threadIdRef.current;
    const currentTurnId = activeTurnIdRef.current;
    if (currentThreadId === null || currentTurnId === null || isCancelling)
      return;
    setIsCancelling(true);
    try {
      await client.interruptTurn(currentThreadId, currentTurnId);
      activeTurnIdRef.current = null;
      setActiveTurnId(null);
      setIsSubmitting(false);
      setIsCancelling(false);
      generationLaunchInFlightRef.current = false;
    } catch (reason) {
      setConversationError(
        reason instanceof Error
          ? reason.message
          : '응답을 중단하지 못했습니다.',
      );
      setIsCancelling(false);
    }
  }, [client, isCancelling]);

  const activateSavedConversation = useCallback(async () => {
    if (savedTask === null || sessionActionInFlight) return;
    setSessionActionInFlight(true);
    setConversationError(null);
    try {
      const resumedThreadId = await client.startThread(savedTask.threadId);
      threadIdRef.current = resumedThreadId;
      threadReadyRef.current = true;
      conversationActivatedRef.current = true;
      setThreadId(resumedThreadId);
      setConversationDecisionRequired(false);
      storeSceneAssistantThread(resumedThreadId);
    } catch (reason) {
      setConversationError(
        reason instanceof Error
          ? `저장된 Codex task를 재개하지 못했습니다. 새 task를 시작할 수 있습니다. ${reason.message}`
          : '저장된 Codex task를 재개하지 못했습니다. 새 task를 시작할 수 있습니다.',
      );
    } finally {
      setSessionActionInFlight(false);
    }
  }, [client, savedTask, sessionActionInFlight]);

  const startNewConversation = useCallback(async () => {
    if (activeTurnIdRef.current !== null || sessionActionInFlight) return;
    setSessionActionInFlight(true);
    setConversationError(null);
    try {
      if (client.getConversationSession === undefined) {
        threadIdRef.current = null;
        threadReadyRef.current = false;
        setThreadId(null);
        clearSceneAssistantThread();
      } else {
        const nextThreadId = await client.startThread();
        threadIdRef.current = nextThreadId;
        threadReadyRef.current = true;
        conversationActivatedRef.current = true;
        setThreadId(nextThreadId);
        storeSceneAssistantThread(nextThreadId);
      }
      setSavedTask(null);
      setConversationDecisionRequired(false);
      setMessages([]);
      changeRefinementSource(null);
      onConversationReset();
    } catch (reason) {
      setConversationError(
        reason instanceof Error
          ? `새 Codex task를 시작하지 못했습니다. ${reason.message}`
          : '새 Codex task를 시작하지 못했습니다.',
      );
    } finally {
      setSessionActionInFlight(false);
    }
  }, [
    changeRefinementSource,
    client,
    onConversationReset,
    sessionActionInFlight,
  ]);

  const respondToRuntimeRequest = useCallback(
    async (requestId: string, response: RuntimeRequestResponse) => {
      if (client.respondRuntimeRequest === undefined) {
        throw new Error(
          '현재 Companion이 App Server 요청 응답을 지원하지 않습니다.',
        );
      }
      setRuntimeRequestActionId(requestId);
      setRuntimeRequestError(null);
      try {
        upsertRuntimeRequest(
          await client.respondRuntimeRequest(requestId, response),
        );
      } catch (reason) {
        const error =
          reason instanceof Error
            ? reason
            : new Error('App Server 요청에 응답하지 못했습니다.');
        setRuntimeRequestError(error.message);
        throw error;
      } finally {
        setRuntimeRequestActionId(null);
      }
    },
    [client, upsertRuntimeRequest],
  );

  const busy = activeTurnId !== null || isSubmitting || sessionActionInFlight;
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

      {phase === 'reconnecting' ? (
        <div className="assistant-reconnect" role="status">
          <strong>
            Companion 자동 재연결 {reconnectAttempt}/
            {MAX_AUTOMATIC_RECONNECT_ATTEMPTS}
          </strong>
          <p>
            {connectionError ?? 'Companion 연결이 끊겼습니다.'}
            {reconnectDelayMs === null
              ? ' 상태를 다시 확인하고 있습니다.'
              : ` ${(reconnectDelayMs / 1_000).toFixed(1)}초 뒤 상태를 다시 확인합니다.`}
          </p>
          <button type="button" onClick={retry}>
            지금 다시 연결
          </button>
          <small>
            진행 여부가 불명확한 turn은 자동으로 다시 실행하지 않습니다.
          </small>
        </div>
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
            <p>
              {conversationDecisionRequired
                ? '프로젝트 대화 선택'
                : threadId === null
                  ? '새 대화'
                  : '장면 대화'}
            </p>
            {threadId !== null && !busy && !conversationDecisionRequired ? (
              <button type="button" onClick={() => void startNewConversation()}>
                새 대화
              </button>
            ) : null}
          </div>

          {conversationSessionLoading ? (
            <p className="assistant-session-loading" role="status">
              프로젝트의 저장된 Codex task를 확인하고 있습니다.
            </p>
          ) : null}

          {!conversationDecisionRequired || savedTask === null ? null : (
            <article
              className="assistant-session-choice"
              aria-label="저장된 Codex task 선택"
            >
              <header>
                <strong>저장된 대화를 이어갈까요?</strong>
                <span>{savedTask.threadId}</span>
              </header>
              <dl>
                <div>
                  <dt>최근 요청</dt>
                  <dd>{savedTask.lastUserMessage ?? '기록 없음'}</dd>
                </div>
                <div>
                  <dt>최근 응답 요약</dt>
                  <dd>{savedTask.lastAssistantSummary ?? '기록 없음'}</dd>
                </div>
                <div>
                  <dt>진행 상태</dt>
                  <dd>
                    turn {savedTask.turnCount}개 ·{' '}
                    {savedTask.lastTurnStatus ?? '시작 전'} · scene r
                    {savedTask.sceneRevision ?? '?'} · spec r
                    {savedTask.specRevision ?? '?'}
                  </dd>
                </div>
                {savedTask.generationIntent === null ? null : (
                  <div>
                    <dt>
                      다음 OAuth 생성 반영 의도 r
                      {savedTask.generationIntent.revision}
                    </dt>
                    <dd>
                      마지막 완료 대화를 자동 반영 ·{' '}
                      {savedTask.generationIntent.sourceTurnId}
                    </dd>
                  </div>
                )}
              </dl>
              <div>
                <button
                  type="button"
                  onClick={() => void activateSavedConversation()}
                  disabled={sessionActionInFlight}
                >
                  저장된 task 재개
                </button>
                <button
                  type="button"
                  onClick={() => void startNewConversation()}
                  disabled={sessionActionInFlight}
                >
                  새 task 시작
                </button>
              </div>
            </article>
          )}

          {runtimeRequests
            .filter(({ status }) => status === 'pending')
            .map((request) => (
              <RuntimeRequestCard
                key={request.id}
                request={request}
                busy={runtimeRequestActionId === request.id}
                onRespond={(response) =>
                  respondToRuntimeRequest(request.id, response)
                }
              />
            ))}

          {runtimeRequests
            .filter(({ status }) => status === 'expired')
            .slice(-1)
            .map((request) => (
              <article
                key={request.id}
                className="assistant-runtime-request assistant-runtime-request--expired"
                aria-label="만료된 Codex 요청"
              >
                <strong>{request.title}이 만료되었습니다.</strong>
                <p>
                  Companion 재시작으로 이전 App Server 연결에 응답할 수
                  없습니다. Codex가 다시 요청하면 새 카드에서 결정해 주세요.
                </p>
              </article>
            ))}

          {runtimeRequestError === null ? null : (
            <p className="assistant-conversation-error" role="alert">
              {runtimeRequestError}
            </p>
          )}

          <div className="assistant-messages" aria-live="polite">
            {messages.length === 0 ? (
              <p className="assistant-empty-message">
                {conversationDecisionRequired
                  ? 'task를 선택하기 전에는 대화나 생성을 시작하지 않습니다.'
                  : threadId === null
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

          {pendingSpecPatch === null ? null : (
            <article
              className="assistant-spec-patch-card"
              aria-label="장면 변경안"
            >
              <header>
                <p className="eyebrow">검증된 변경안</p>
                <h3>{pendingSpecPatch.proposal.message}</h3>
              </header>
              <dl className="assistant-spec-patch-changes">
                {pendingSpecPatch.evaluation.changes.map((change) => (
                  <div key={change.path}>
                    <dt>{change.path}</dt>
                    <dd>
                      <span>{formatSpecPatchValue(change.before)}</span>
                      <span aria-hidden="true">→</span>
                      <strong>{formatSpecPatchValue(change.after)}</strong>
                    </dd>
                  </div>
                ))}
                {pendingSpecPatch.evaluation.sceneCommandChanges.map(
                  (change) => (
                    <div key={`${change.type}:${change.objectId}`}>
                      <dt>
                        {change.objectName} ({change.objectId}) · 3D transform
                      </dt>
                      <dd>
                        <span>{formatTransform(change.before)}</span>
                        <span aria-hidden="true">→</span>
                        <strong>{formatTransform(change.after)}</strong>
                      </dd>
                    </div>
                  ),
                )}
              </dl>
              {pendingSpecPatch.proposal.warnings.length === 0 ? null : (
                <div className="assistant-spec-patch-warnings">
                  <strong>주의</strong>
                  <ul>
                    {pendingSpecPatch.proposal.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="assistant-spec-patch-actions">
                <button
                  type="button"
                  onClick={applyPendingSpecPatch}
                  disabled={
                    pendingSpecPatch.evaluation.changes.length === 0 &&
                    pendingSpecPatch.evaluation.sceneCommandChanges.length === 0
                  }
                >
                  변경안 적용
                </button>
                <button type="button" onClick={() => setPendingSpecPatch(null)}>
                  변경안 취소
                </button>
              </div>
            </article>
          )}

          {proposalError !== null ? (
            <p className="assistant-conversation-error" role="alert">
              {proposalError}
            </p>
          ) : null}

          {conversationError !== null ? (
            <p className="assistant-conversation-error" role="alert">
              {conversationError}
            </p>
          ) : null}

          {generationRequestRecovery === null ? null : (
            <article
              className="assistant-generation-recovery"
              aria-label="미확인 generation 요청 복구"
            >
              <strong>이전 생성 요청의 완료 여부를 확인하지 못했습니다.</strong>
              <span>
                request ID · {generationRequestRecovery.input.requestId}
              </span>
              <button
                type="button"
                onClick={() => void retryRecoveredGenerationRequest()}
                disabled={busy}
              >
                같은 요청 안전하게 다시 확인
              </button>
            </article>
          )}

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

          {generation?.requestId === undefined ||
          generation.requestId === null ? null : (
            <p
              className="assistant-generation-request-status"
              role="status"
              aria-label="generation 요청 상태"
            >
              request ID · {generation.requestId} ·{' '}
              {generation.status === 'inProgress'
                ? '진행 중'
                : generation.status === 'completed'
                  ? '완료'
                  : generation.status === 'failed'
                    ? '실패 · 새 요청으로 다시 시도 가능'
                    : '중단됨 · 새 요청으로 다시 시도 가능'}
            </p>
          )}

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
              : `edit 보정 · 현재 3D 레이아웃 공간 기준 고정 · 기존 결과 이미지 ${refinementSource.id} 외형 기준`}
          </p>

          {refinementSource === null ? null : (
            <div className="assistant-refinement-mode" role="status">
              <div>
                <strong>키프레임 보정 모드</strong>
                <span>
                  Image 1 현재 3D 레이아웃(공간 기준) · Image 2 v
                  {refinementSource.versionNumber} {refinementSource.id}
                  (외형 기준) · 레퍼런스 최대 {maximumReferences}장
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
            {pendingGenerationPreflight === null ? null : (
              <article
                className="assistant-preflight-card"
                aria-label="생성 전 충돌 경고"
              >
                <header>
                  <p className="eyebrow">Generation preflight</p>
                  <h3>확인이 필요한 충돌 가능성이 있습니다.</h3>
                </header>
                <ul>
                  {pendingGenerationPreflight.warnings.map((warning) => (
                    <li key={warning.id}>{warning.message}</li>
                  ))}
                </ul>
                <div className="assistant-preflight-actions">
                  <button
                    type="button"
                    onClick={() => void generateImage(true)}
                  >
                    경고 확인 후 생성
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingGenerationPreflight(null)}
                  >
                    생성 취소
                  </button>
                </div>
              </article>
            )}
            {refinementSource === null ? null : (
              <>
                <label htmlFor="assistant-refinement-preserve">
                  이 키프레임에서 유지할 요소
                </label>
                <textarea
                  id="assistant-refinement-preserve"
                  value={refinementPreserveDraft}
                  onChange={(event) =>
                    setRefinementPreserveDraft(event.target.value)
                  }
                  placeholder={'예: 전체 구도\n인물 의상과 정체성'}
                  rows={2}
                  disabled={busy}
                />
                <p className="assistant-refinement-directive-help">
                  유지·변경 항목을 한 줄에 하나씩 입력합니다. 같은 항목은 두
                  목록에 동시에 넣을 수 없습니다.
                </p>
              </>
            )}
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
              disabled={
                busy ||
                conversationDecisionRequired ||
                conversationSessionLoading
              }
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
                <div className="assistant-image-settings">
                  <label className="camera-field">
                    <span>모델</span>
                    <select
                      aria-label="이미지 모델"
                      value={imageSettings.model}
                      onChange={(event) => {
                        const next = {
                          ...imageSettings,
                          model: event.currentTarget.value,
                        };
                        setImageSettings(next);
                        writeOAuthImageSettings(localStorage, next);
                      }}
                    >
                      {(runtime?.oauth?.models.length
                        ? runtime.oauth.models
                        : OAUTH_IMAGE_MODELS
                      ).map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="camera-field">
                    <span>품질</span>
                    <select
                      aria-label="이미지 품질"
                      value={imageSettings.quality}
                      onChange={(event) => {
                        const next = {
                          ...imageSettings,
                          quality: event.currentTarget
                            .value as (typeof OAUTH_IMAGE_QUALITIES)[number],
                        };
                        setImageSettings(next);
                        writeOAuthImageSettings(localStorage, next);
                      }}
                    >
                      {OAUTH_IMAGE_QUALITIES.map((quality) => (
                        <option key={quality} value={quality}>
                          {quality}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="submit" disabled={draft.trim() === ''}>
                  보내기
                </button>
                <button
                  type="button"
                  onClick={() => void requestSpecPatchProposal()}
                  disabled={
                    draft.trim() === '' ||
                    client.startSpecPatchProposal === undefined
                  }
                >
                  변경안 제안
                </button>
                <button
                  className="assistant-generate"
                  type="button"
                  onClick={() => void generateImage()}
                  disabled={
                    draft.trim() === '' ||
                    captureLayout === null ||
                    (runtime?.imageProvider === 'oauth'
                      ? runtime.oauth?.state !== 'ready'
                      : runtime?.capabilities?.imageGeneration === false) ||
                    referenceSelectionOverLimit
                  }
                  title={
                    captureLayout === null
                      ? 'WebGL 뷰포트가 준비되면 사용할 수 있습니다.'
                      : runtime?.imageProvider === 'oauth' &&
                          runtime.oauth?.state !== 'ready'
                        ? (runtime.oauth?.error ??
                          'OAuth 이미지 프록시가 아직 준비되지 않았습니다.')
                        : runtime?.capabilities?.imageGeneration === false
                          ? '현재 Codex 런타임이 이미지 생성을 지원하지 않습니다.'
                          : referenceSelectionOverLimit
                            ? `레퍼런스를 ${maximumReferences}장 이하로 줄여 주세요.`
                            : undefined
                  }
                >
                  {refinementSource === null ? '이미지 생성' : '보정 생성'}
                </button>
                <button
                  className="assistant-web-export"
                  type="button"
                  onClick={exportPromptToWeb}
                  disabled={draft.trim() === '' || referenceSelectionOverLimit}
                  title={
                    referenceSelectionOverLimit
                      ? `레퍼런스를 ${maximumReferences}장 이하로 줄여 주세요.`
                      : 'GPT 웹에서 수동 생성할 프롬프트를 준비합니다.'
                  }
                >
                  웹으로 내보내기
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

      {webPromptExport === null ? null : (
        <WebPromptExportDialog
          prompt={webPromptExport.prompt}
          attachmentLabels={webPromptExport.attachmentLabels}
          warnings={webPromptExport.warnings}
          onClose={() => setWebPromptExport(null)}
        />
      )}
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
  storage = window.localStorage,
  onRefinementModeChange = ignoreRefinementModeChange,
  refinementSource,
  onRefinementSourceChange = ignoreRefinementSourceChange,
  onApplySpecPatchProposal = unavailableSpecPatchApply,
  onConversationReset = ignoreConversationReset,
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
              Companion이 켜져 있으면 이 페이지가 자동으로 연결됩니다. 같은
              컴퓨터에서 <code>npm run dev:all</code> 후{' '}
              <code>http://127.0.0.1:5173</code>을 여세요.
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
      storage={storage}
      onRefinementModeChange={onRefinementModeChange}
      refinementSource={refinementSource}
      onRefinementSourceChange={onRefinementSourceChange}
      onApplySpecPatchProposal={onApplySpecPatchProposal}
      onConversationReset={onConversationReset}
    />
  );
}
