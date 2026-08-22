import { createHash, randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { createThreadStartGate } from './threadStartGate';
import type {
  AppServerStatus,
  CodexRuntime,
  TurnInput,
} from './appServerClient';
import type { JsonRpcNotification, JsonRpcServerRequest } from './jsonRpcPeer';
import { layoutSpecSchema } from '../shared/layoutSpecSchema';
import {
  FRESH_GENERATION_MAX_REFERENCES,
  getMaximumReferenceImages,
} from '../shared/imageInputBudget';
import { evaluateGenerationPreflight } from '../shared/generationPreflight';
import { refinementDirectiveSchema } from '../shared/refinementDirective';
import { conversationTurnMetadataInputSchema } from '../shared/conversationMetadata';
import { runtimeRequestResponseSchema } from '../shared/runtimeRequest';
import {
  createGenerationImageDescriptor,
  expectedGenerationImageBindings,
  GENERATION_IMAGE_CONTRACT_VERSION,
  generationImageRoleForReferenceKind,
} from '../shared/generationImageContract';
import { sceneDocumentSchema } from '../src/editor/persistence/sceneSchema';
import {
  SPEC_PATCH_PROPOSAL_JSON_SCHEMA,
  evaluateSpecPatchProposal,
  specPatchProposalSchema,
} from '../src/editor/persistence/specPatchProposal';
import { GenerationStore } from './generationStore';
import { ConversationStore } from './conversationStore';
import { RuntimeRequestStore } from './runtimeRequestStore';
import { resolveProjectArtifact } from './projectArtifacts';
import { createStaticEditor } from './staticEditor';
import { generateOAuthImageFromFiles } from './oauthImageRuntime';
import {
  compileImagegenSkillPrompt,
  IMAGEGEN_PROMPT_COMPILER_THREAD_SOURCE_PREFIX,
} from './imagegenSkillPromptCompiler';
import type {
  OAuthImageQuality,
  OAuthReasoningEffort,
} from './oauthImageProvider';
import type { OAuthProxyStatus } from './oauthProxy';
import {
  ReferenceInputError,
  ReferenceNotFoundError,
  ReferenceStore,
  referenceKindSchema,
  referenceMetadataInputSchema,
  toPublicReference,
} from './referenceStore';
import {
  RiggedCharacterInputError,
  RiggedCharacterNotFoundError,
  RiggedCharacterStore,
} from './riggedCharacterStore';
import { riggedCharacterAnalysisSchema } from '../shared/riggedCharacterAsset';

const threadBodySchema = z
  .object({
    mode: z.enum(['new', 'resume']).optional(),
    threadId: z.string().min(1).optional(),
  })
  .superRefine((body, context) => {
    if (body.mode === 'resume' && body.threadId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['threadId'],
        message: 'task 재개에는 thread ID가 필요합니다.',
      });
    }
    if (body.mode === 'new' && body.threadId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['threadId'],
        message: '새 task에는 기존 thread ID를 지정할 수 없습니다.',
      });
    }
  });

const turnBodySchema = z
  .object({
    threadId: z.string().min(1),
    prompt: z.string().min(1).max(100_000),
    attachments: z.array(z.string().min(1)).max(16).default([]),
    referenceIds: z.array(z.string().min(1)).max(16).default([]),
    layoutRenderId: z.string().min(1).optional(),
    sceneId: z.string().min(1).optional(),
    metadata: conversationTurnMetadataInputSchema.optional(),
  })
  .superRefine((body, context) => {
    if ((body.layoutRenderId === undefined) !== (body.sceneId === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['layoutRenderId'],
        message: '대화용 레이아웃 렌더와 장면 ID는 함께 지정해야 합니다.',
      });
    }
  });

const specPatchProposalRequestSchema = z.strictObject({
  threadId: z.string().min(1),
  requestId: z.string().trim().min(1).max(200),
  baseSceneRevision: z.number().int().nonnegative().safe(),
  baseSpecRevision: z.number().int().nonnegative().safe(),
  userMessage: z.string().trim().min(1).max(4_000),
  sceneDocument: sceneDocumentSchema,
});

const completedAgentMessageSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  item: z.object({
    type: z.literal('agentMessage'),
    id: z.string(),
    text: z.string(),
  }),
});

const interruptBodySchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
});

const referenceImportQuerySchema = z.object({
  name: z.string().min(1).max(120),
  kind: referenceKindSchema,
  fileName: z.string().min(1).max(255),
});

const riggedCharacterImportQuerySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(255),
  analysis: z.string().transform((value, context) => {
    try {
      return riggedCharacterAnalysisSchema.parse(JSON.parse(value) as unknown);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message:
          error instanceof Error
            ? `캐릭터 분석 정보가 올바르지 않습니다: ${error.message}`
            : '캐릭터 분석 정보가 올바르지 않습니다.',
      });
      return z.NEVER;
    }
  }),
});

const sceneRenderQuerySchema = z.object({
  sceneId: z.string().min(1).max(200),
});

const generationBodySchema = z
  .object({
    requestId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default(() => `legacy-generation-${randomBytes(16).toString('hex')}`),
    threadId: z.string().min(1),
    prompt: z.string().min(1).max(100_000),
    layoutSpec: layoutSpecSchema,
    sceneSnapshot: sceneDocumentSchema,
    parentGenerationId: z.string().min(1).nullable().default(null),
    sourceGenerationId: z.string().min(1).nullable().default(null),
    feedback: z.string().trim().min(1).max(4_000).nullable().default(null),
    refinementDirective: refinementDirectiveSchema.nullable().default(null),
    generationMode: z.enum(['fresh', 'edit']).default('fresh'),
    layoutRenderId: z.string().min(1),
    referenceIds: z
      .array(z.string().min(1))
      .max(
        FRESH_GENERATION_MAX_REFERENCES,
        `3D 레이아웃을 포함한 생성에서는 레퍼런스를 최대 ${FRESH_GENERATION_MAX_REFERENCES}장까지 사용할 수 있습니다.`,
      )
      .default([]),
    acknowledgedPreflightWarningIds: z
      .array(z.string().trim().min(1).max(300))
      .max(32)
      .default([]),
    imageModel: z.string().trim().min(1).max(80).optional(),
    imageQuality: z.enum(['low', 'medium', 'high', 'auto']).optional(),
  })
  .superRefine((body, context) => {
    const editing = body.generationMode === 'edit';
    if (editing && body.parentGenerationId === null) {
      context.addIssue({
        code: 'custom',
        path: ['parentGenerationId'],
        message: '보정 생성에는 원본 키프레임이 필요합니다.',
      });
    }
    if (!editing && body.parentGenerationId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['parentGenerationId'],
        message: '새 생성에는 부모 키프레임을 지정할 수 없습니다.',
      });
    }
    if (editing && body.sourceGenerationId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['sourceGenerationId'],
        message:
          '보정 생성은 parentGenerationId만 사용하며 3D 레이아웃 출처를 별도로 지정하지 않습니다.',
      });
    }
    if (editing && body.refinementDirective === null) {
      context.addIssue({
        code: 'custom',
        path: ['refinementDirective'],
        message: '보정 생성에는 구조화된 유지·변경 지시가 필요합니다.',
      });
    }
    if (!editing && body.refinementDirective !== null) {
      context.addIssue({
        code: 'custom',
        path: ['refinementDirective'],
        message: '새 생성에는 보정 지시를 지정할 수 없습니다.',
      });
    }
    const maximumReferences = getMaximumReferenceImages({
      includeLayout: true,
      includeSourceKeyframe: editing,
    });
    if (body.referenceIds.length > maximumReferences) {
      context.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: maximumReferences,
        inclusive: true,
        path: ['referenceIds'],
        message: `보정 원본과 3D 레이아웃을 포함하면 레퍼런스는 최대 ${maximumReferences}장까지 사용할 수 있습니다.`,
      });
    }
  });

const completedImageGenerationSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  item: z.object({
    type: z.literal('imageGeneration'),
    status: z.string(),
    revisedPrompt: z.string().nullable(),
    savedPath: z.string().optional(),
  }),
});

const completedTurnNotificationSchema = z.object({
  threadId: z.string(),
  turn: z.object({
    id: z.string(),
    status: z.enum(['completed', 'failed', 'interrupted', 'inProgress']),
    error: z.object({ message: z.string() }).nullable(),
  }),
});

const resolvedServerRequestNotificationSchema = z.object({
  threadId: z.string().min(1),
  requestId: z.union([z.string().min(1), z.number().int().safe()]),
});

export interface CompanionServerOptions {
  runtime: CodexRuntime;
  projectRoot: string;
  allowedOrigins: string[];
  token?: string;
  port?: number;
  editorRoot?: string;
  imageProvider?: 'codex' | 'oauth';
  oauthUrl?: string;
  imageModel?: string;
  imageQuality?: OAuthImageQuality;
  reasoningEffort?: OAuthReasoningEffort;
  oauthStatus?: OAuthProxyStatus;
  imagegenPromptCompiler?: typeof compileImagegenSkillPrompt;
  oauthImageGenerator?: typeof generateOAuthImageFromFiles;
}

export interface CompanionServerHandle {
  token: string;
  url: string;
  close(): Promise<void>;
}

interface SseClient {
  response: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

class RequestBodyTooLargeError extends Error {}
class GenerationRequestConflictError extends Error {}
class RuntimeRequestConflictError extends Error {}
class RuntimeRequestInputError extends Error {}

function generationRequestFingerprint(value: unknown) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

async function readBody(request: IncomingMessage, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maximumBytes)
      throw new RequestBodyTooLargeError('요청 본문이 너무 큽니다.');
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage) {
  const body = await readBody(request, 1_000_000);

  if (body.length === 0) return {};
  return JSON.parse(body.toString('utf8')) as unknown;
}

function writeSse(response: ServerResponse, event: string, value: unknown) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function createSpecPatchProposalPrompt(
  body: z.infer<typeof specPatchProposalRequestSchema>,
) {
  return `너는 I2V 3D Scene Helper의 구조화된 장면 변경 제안기다.
최종 응답은 App Server outputSchema가 요구하는 JSON 객체 하나만 반환한다.
requestId, baseSceneRevision, baseSpecRevision은 제공된 값을 그대로 사용한다.
specPatch는 승인된 Semantic Scene Spec 경로의 add/remove/replace만 사용한다.
3D 위치·회전·크기 변경은 specPatch가 아니라 sceneCommands의 setObjectTransform만 사용한다.
setObjectTransform은 현재 SceneDocument에 존재하는 정확한 objectId와 position, rotationDeg, scale 전체를 반환한다.
임의 object path, 배열 index path, 새 object 생성·삭제와 포즈 변경은 제안하지 않는다.
같은 objectId를 한 응답에서 두 번 변경하지 않는다.
확실하지 않거나 충돌 가능성이 있으면 warnings에 한국어로 설명하고, 안전한 변경이 없으면 specPatch와 sceneCommands를 모두 빈 배열로 둔다.

[요청 메타데이터]
${JSON.stringify({
  requestId: body.requestId,
  baseSceneRevision: body.baseSceneRevision,
  baseSpecRevision: body.baseSpecRevision,
})}

[사용자 메시지]
${body.userMessage}

[현재 SceneDocument]
${JSON.stringify(body.sceneDocument)}`;
}

async function startFreshThread(runtime: CodexRuntime, projectRoot: string) {
  const gate = createThreadStartGate(runtime);
  try {
    const threadId = await runtime.startThread(projectRoot);
    await gate.wait(threadId);
    return threadId;
  } finally {
    gate.dispose();
  }
}

export async function startCompanionServer(
  options: CompanionServerOptions,
): Promise<CompanionServerHandle> {
  const token = options.token ?? randomBytes(32).toString('base64url');
  const sseClients = new Set<SseClient>();
  const allowedOrigins = new Set(options.allowedOrigins);
  const referenceStore = new ReferenceStore(options.projectRoot);
  const riggedCharacterStore = new RiggedCharacterStore(options.projectRoot);
  const generationStore = new GenerationStore(options.projectRoot);
  const conversationStore = new ConversationStore(options.projectRoot);
  const oauthImageGenerator =
    options.oauthImageGenerator ?? generateOAuthImageFromFiles;
  const imagegenPromptCompiler =
    options.imagegenPromptCompiler ?? compileImagegenSkillPrompt;
  const runtimeRequestStore = new RuntimeRequestStore(options.projectRoot);
  const staticEditor =
    options.editorRoot === undefined
      ? null
      : await createStaticEditor(options.editorRoot);
  await conversationStore.recoverInProgressTask();
  await runtimeRequestStore.recoverPending();
  await generationStore.recoverInProgressGenerations(
    'Companion이 재시작되어 진행 중이던 이미지 생성을 중단 상태로 복구했습니다.',
  );
  const generationRequestQueue = new Map<string, Promise<void>>();
  const serializeGenerationRequest = async <T>(
    requestId: string,
    operation: () => Promise<T>,
  ) => {
    const previous = generationRequestQueue.get(requestId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    generationRequestQueue.set(requestId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (generationRequestQueue.get(requestId) === tail) {
        generationRequestQueue.delete(requestId);
      }
    }
  };
  const pendingSpecPatchProposals = new Map<
    string,
    z.infer<typeof specPatchProposalRequestSchema>
  >();
  const pendingRuntimeRequests = new Map<string, JsonRpcServerRequest>();
  const resolvingRuntimeRequests = new Set<string>();
  const suppressedCodexThreadIds = new Set<string>();

  const broadcast = (event: string, value: unknown) => {
    for (const client of sseClients) writeSse(client.response, event, value);
  };
  const handleStatus = (status: AppServerStatus) =>
    broadcast('runtime', status);
  const handleNotification = (notification: JsonRpcNotification) => {
    const notificationParams =
      notification.params !== null && typeof notification.params === 'object'
        ? notification.params
        : null;
    const directThreadId =
      notificationParams !== null &&
      'threadId' in notificationParams &&
      typeof notificationParams.threadId === 'string'
        ? notificationParams.threadId
        : null;
    const nestedThread =
      notificationParams !== null &&
      'thread' in notificationParams &&
      notificationParams.thread !== null &&
      typeof notificationParams.thread === 'object'
        ? notificationParams.thread
        : null;
    const nestedThreadId =
      nestedThread !== null &&
      'id' in nestedThread &&
      typeof nestedThread.id === 'string'
        ? nestedThread.id
        : null;
    const notificationThreadId = directThreadId ?? nestedThreadId;
    const nestedThreadSource =
      nestedThread !== null &&
      'threadSource' in nestedThread &&
      typeof nestedThread.threadSource === 'string'
        ? nestedThread.threadSource
        : null;
    if (
      notification.method === 'thread/started' &&
      notificationThreadId !== null &&
      nestedThreadSource?.startsWith(
        `${IMAGEGEN_PROMPT_COMPILER_THREAD_SOURCE_PREFIX}:`,
      ) === true
    ) {
      suppressedCodexThreadIds.add(notificationThreadId);
      return;
    }
    if (
      notificationThreadId !== null &&
      suppressedCodexThreadIds.has(notificationThreadId)
    ) {
      return;
    }
    if (notification.method === 'serverRequest/resolved') {
      const resolved = resolvedServerRequestNotificationSchema.safeParse(
        notification.params,
      );
      if (resolved.success) {
        const pending = [...pendingRuntimeRequests.entries()].find(
          ([, request]) =>
            request.id === resolved.data.requestId &&
            request.params !== null &&
            typeof request.params === 'object' &&
            'threadId' in request.params &&
            request.params.threadId === resolved.data.threadId,
        );
        if (pending !== undefined) pendingRuntimeRequests.delete(pending[0]);
        void runtimeRequestStore
          .resolveByRpcId(resolved.data.threadId, resolved.data.requestId)
          .then((request) => {
            if (request !== null) broadcast('runtime-request', request);
          })
          .catch(() => undefined);
      }
    }
    const directTurn = z
      .object({ turnId: z.string() })
      .safeParse(notification.params);
    const proposalMessage =
      notification.method === 'item/completed'
        ? completedAgentMessageSchema.safeParse(notification.params)
        : null;
    const proposalTurnId =
      proposalMessage?.success === true
        ? proposalMessage.data.turnId
        : directTurn.success
          ? directTurn.data.turnId
          : null;
    const pendingProposal =
      proposalTurnId === null
        ? undefined
        : pendingSpecPatchProposals.get(proposalTurnId);
    const isProposalAgentEvent =
      pendingProposal !== undefined &&
      (notification.method === 'item/agentMessage/delta' ||
        proposalMessage?.success === true);
    if (!isProposalAgentEvent) broadcast('codex', notification);

    if (proposalMessage?.success === true && pendingProposal !== undefined) {
      pendingSpecPatchProposals.delete(proposalMessage.data.turnId);
      try {
        const proposal = specPatchProposalSchema.parse(
          JSON.parse(proposalMessage.data.item.text) as unknown,
        );
        if (
          proposal.requestId !== pendingProposal.requestId ||
          proposal.baseSceneRevision !== pendingProposal.baseSceneRevision ||
          proposal.baseSpecRevision !== pendingProposal.baseSpecRevision
        ) {
          throw new Error('Codex proposal metadata does not match the request');
        }
        evaluateSpecPatchProposal(pendingProposal.sceneDocument, proposal);
        broadcast('spec-patch-proposal', proposal);
        void conversationStore
          .recordAssistantSummary(
            proposalMessage.data.threadId,
            proposalMessage.data.turnId,
            proposal.message,
          )
          .catch(() => undefined);
      } catch (error) {
        broadcast('spec-patch-proposal-error', {
          requestId: pendingProposal.requestId,
          error:
            error instanceof Error
              ? error.message
              : 'Codex 변경안을 검증하지 못했습니다.',
        });
      }
      return;
    }

    if (proposalMessage?.success === true && pendingProposal === undefined) {
      void conversationStore
        .recordAssistantSummary(
          proposalMessage.data.threadId,
          proposalMessage.data.turnId,
          proposalMessage.data.item.text,
        )
        .catch(() => undefined);
    }

    if (notification.method === 'turn/completed') {
      const completed = completedTurnNotificationSchema.safeParse(
        notification.params,
      );
      if (completed.success) {
        if (completed.data.turn.status !== 'inProgress') {
          void conversationStore
            .recordTurnCompleted(
              completed.data.threadId,
              completed.data.turn.id,
              completed.data.turn.status,
            )
            .catch(() => undefined);
        }
        const abandonedProposal = pendingSpecPatchProposals.get(
          completed.data.turn.id,
        );
        if (
          abandonedProposal !== undefined &&
          completed.data.turn.status !== 'inProgress'
        ) {
          pendingSpecPatchProposals.delete(completed.data.turn.id);
          broadcast('spec-patch-proposal-error', {
            requestId: abandonedProposal.requestId,
            error:
              completed.data.turn.error?.message ??
              'Codex turn이 검증 가능한 structured 변경안 없이 종료되었습니다.',
          });
        }
      }
    }

    const processGenerationNotification = async () => {
      if (notification.method === 'item/completed') {
        const parsed = completedImageGenerationSchema.safeParse(
          notification.params,
        );
        if (!parsed.success || parsed.data.item.savedPath === undefined) return;
        const generation = await generationStore.importGenerationResult(
          parsed.data.turnId,
          parsed.data.item.savedPath,
          parsed.data.item.revisedPrompt,
        );
        if (generation !== null) broadcast('generation', generation);
        return;
      }
      if (notification.method === 'turn/completed') {
        const parsed = completedTurnNotificationSchema.safeParse(
          notification.params,
        );
        if (!parsed.success || parsed.data.turn.status === 'inProgress') return;
        const generation = await generationStore.completeTurn(
          parsed.data.turn.id,
          parsed.data.turn.status,
          parsed.data.turn.error?.message ?? null,
        );
        if (generation !== null) broadcast('generation', generation);
      }
    };
    void processGenerationNotification()
      .catch(async (error) => {
        const directTurnId =
          notification.params !== null &&
          typeof notification.params === 'object' &&
          'turnId' in notification.params &&
          typeof notification.params.turnId === 'string'
            ? notification.params.turnId
            : null;
        const nestedTurnId = completedTurnNotificationSchema.safeParse(
          notification.params,
        );
        const turnId =
          directTurnId ??
          (nestedTurnId.success ? nestedTurnId.data.turn.id : null);
        const message =
          error instanceof Error
            ? error.message
            : '생성 결과를 프로젝트에 편입하지 못했습니다.';
        if (turnId !== null) {
          const generation = await generationStore.completeTurn(
            turnId,
            'failed',
            message,
          );
          if (generation !== null) broadcast('generation', generation);
        }
        broadcast('generation-error', { turnId, error: message });
      })
      .catch((error) => {
        broadcast('generation-error', {
          turnId: null,
          error:
            error instanceof Error
              ? error.message
              : '생성 실패 상태를 기록하지 못했습니다.',
        });
      });
  };
  const handleServerRequest = (request: JsonRpcServerRequest) => {
    const requestParams =
      request.params !== null && typeof request.params === 'object'
        ? request.params
        : null;
    const directThreadId =
      requestParams !== null &&
      'threadId' in requestParams &&
      typeof requestParams.threadId === 'string'
        ? requestParams.threadId
        : null;
    const nestedThreadId =
      requestParams !== null &&
      'thread' in requestParams &&
      requestParams.thread !== null &&
      typeof requestParams.thread === 'object' &&
      'id' in requestParams.thread &&
      typeof requestParams.thread.id === 'string'
        ? requestParams.thread.id
        : null;
    const requestThreadId = directThreadId ?? nestedThreadId;
    if (
      requestThreadId !== null &&
      suppressedCodexThreadIds.has(requestThreadId)
    ) {
      options.runtime.rejectServerRequest?.(
        request.id,
        -32600,
        'Imagegen prompt compiler planning-only thread는 server request를 허용하지 않습니다.',
      );
      return;
    }
    void runtimeRequestStore
      .register(request)
      .then((normalized) => {
        if (normalized === null) {
          options.runtime.rejectServerRequest?.(
            request.id,
            -32601,
            '이 Companion이 지원하지 않는 App Server 요청입니다.',
          );
          return;
        }
        pendingRuntimeRequests.set(normalized.id, request);
        broadcast('runtime-request', normalized);
      })
      .catch((error) => {
        options.runtime.rejectServerRequest?.(
          request.id,
          -32603,
          error instanceof Error
            ? error.message
            : 'App Server 요청을 안전하게 저장하지 못했습니다.',
        );
      });
  };
  options.runtime.on('status', handleStatus);
  options.runtime.on('notification', handleNotification);
  options.runtime.on('serverRequest', handleServerRequest);

  let serverOrigin: string | null = null;
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      !allowedOrigins.has(origin) &&
      origin !== serverOrigin
    ) {
      sendJson(response, 403, { error: '허용되지 않은 Origin입니다.' });
      return;
    }
    if (origin !== undefined) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Max-Age': '600',
      });
      response.end();
      return;
    }

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (
      staticEditor !== null &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !requestUrl.pathname.startsWith('/api/') &&
      requestUrl.pathname !== '/api' &&
      (await staticEditor.serve(
        requestUrl.pathname,
        response,
        request.method === 'HEAD',
      ))
    ) {
      return;
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      sendJson(response, 401, {
        error: '유효한 Companion 세션 토큰이 필요합니다.',
      });
      return;
    }

    try {
      if (request.method === 'GET' && requestUrl.pathname === '/api/runtime') {
        sendJson(response, 200, {
          ...options.runtime.status,
          imageProvider: options.imageProvider ?? 'codex',
          oauth: options.oauthStatus ?? {
            state: 'stopped',
            url: null,
            error: null,
            models: [],
          },
        });
        return;
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/api/runtime-requests'
      ) {
        sendJson(response, 200, await runtimeRequestStore.list());
        return;
      }

      const runtimeRequestResponseMatch = requestUrl.pathname.match(
        /^\/api\/runtime-requests\/([^/]+)\/respond$/,
      );
      if (request.method === 'POST' && runtimeRequestResponseMatch !== null) {
        const id = decodeURIComponent(runtimeRequestResponseMatch[1] ?? '');
        if (resolvingRuntimeRequests.has(id)) {
          throw new RuntimeRequestConflictError(
            '이미 처리 중인 App Server 요청입니다.',
          );
        }
        const pending = pendingRuntimeRequests.get(id);
        if (pending === undefined) {
          throw new RuntimeRequestConflictError(
            '이 요청은 현재 App Server 연결에서 더 이상 응답할 수 없습니다.',
          );
        }
        if (options.runtime.respondServerRequest === undefined) {
          throw new RuntimeRequestConflictError(
            '현재 Codex runtime이 App Server 요청 응답을 지원하지 않습니다.',
          );
        }
        const stored = (await runtimeRequestStore.list()).requests.find(
          (candidate) => candidate.id === id,
        );
        if (stored === undefined || stored.status !== 'pending') {
          throw new RuntimeRequestConflictError(
            '이미 종료된 App Server 요청입니다.',
          );
        }
        const body = runtimeRequestResponseSchema.parse(
          await readJson(request),
        );
        let result: unknown;
        let status: 'approved' | 'declined' | 'answered';
        if (stored.kind === 'userInput') {
          if (body.action !== 'answer') {
            throw new RuntimeRequestInputError(
              '사용자 입력 요청에는 질문 답변이 필요합니다.',
            );
          }
          const questionIds = new Set(stored.questions.map(({ id }) => id));
          const answerEntries = Object.entries(body.answers);
          if (
            answerEntries.length !== questionIds.size ||
            answerEntries.some(
              ([questionId, answers]) =>
                !questionIds.has(questionId) ||
                answers.length === 0 ||
                answers.every((answer) => answer.trim() === ''),
            )
          ) {
            throw new RuntimeRequestInputError(
              '모든 확인 질문에 하나 이상의 답변이 필요합니다.',
            );
          }
          result = {
            answers: Object.fromEntries(
              answerEntries.map(([questionId, answers]) => [
                questionId,
                { answers: answers.map((answer) => answer.trim()) },
              ]),
            ),
          };
          status = 'answered';
        } else {
          if (body.action === 'answer') {
            throw new RuntimeRequestInputError(
              '승인 요청에는 승인 또는 거부 결정이 필요합니다.',
            );
          }
          result = {
            decision: body.action === 'approve' ? 'accept' : 'decline',
          };
          status = body.action === 'approve' ? 'approved' : 'declined';
        }
        resolvingRuntimeRequests.add(id);
        try {
          options.runtime.respondServerRequest(pending.id, result);
          pendingRuntimeRequests.delete(id);
          const updated = await runtimeRequestStore.resolve(id, status);
          if (updated === null) {
            throw new Error('App Server 요청 metadata가 사라졌습니다.');
          }
          broadcast('runtime-request', updated);
          sendJson(response, 200, { request: updated });
        } finally {
          resolvingRuntimeRequests.delete(id);
        }
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        response.write(': connected\n\n');
        const client: SseClient = {
          response,
          heartbeat: setInterval(
            () => response.write(': heartbeat\n\n'),
            15_000,
          ),
        };
        sseClients.add(client);
        response.on('close', () => {
          clearInterval(client.heartbeat);
          sseClients.delete(client);
        });
        return;
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/api/references'
      ) {
        sendJson(response, 200, {
          version: 1,
          references: await referenceStore.list(),
        });
        return;
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/api/rigged-characters'
      ) {
        sendJson(response, 200, {
          version: 1,
          assets: await riggedCharacterStore.list(),
        });
        return;
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/scene-renders'
      ) {
        const query = sceneRenderQuerySchema.parse(
          Object.fromEntries(requestUrl.searchParams),
        );
        const render = await generationStore.importSceneRender(
          query.sceneId,
          await readBody(request, 25 * 1024 * 1024),
        );
        sendJson(response, 201, { render });
        return;
      }

      const sceneRenderContentMatch = requestUrl.pathname.match(
        /^\/api\/scene-renders\/([^/]+)\/content$/,
      );
      if (request.method === 'GET' && sceneRenderContentMatch !== null) {
        const renderId = decodeURIComponent(sceneRenderContentMatch[1] ?? '');
        const { data, mimeType } =
          await generationStore.readSceneRenderContent(renderId);
        response.writeHead(200, {
          'Content-Type': mimeType,
          'Content-Length': String(data.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(data);
        return;
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/api/generations'
      ) {
        sendJson(response, 200, {
          version: 1,
          generations: await generationStore.listGenerations(),
        });
        return;
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/api/conversation-session'
      ) {
        sendJson(response, 200, await conversationStore.getSession());
        return;
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/generations'
      ) {
        const body = generationBodySchema.parse(await readJson(request));
        const requestFingerprint = generationRequestFingerprint(body);
        const started = await serializeGenerationRequest(
          body.requestId,
          async () => {
            const existing = await generationStore.findGenerationRequest(
              body.requestId,
            );
            if (existing !== null) {
              if (existing.requestFingerprint !== requestFingerprint) {
                throw new GenerationRequestConflictError(
                  '같은 generation request ID를 다른 입력에 재사용할 수 없습니다.',
                );
              }
              return {
                turnId: existing.generation.turnId,
                generation: existing.generation,
                reused: true,
              };
            }
            const useOAuthImageProvider = options.imageProvider === 'oauth';
            if (
              !useOAuthImageProvider &&
              options.runtime.status.capabilities?.imageGeneration === false
            ) {
              throw new ReferenceInputError(
                '현재 Codex 모델 공급자에서는 imagegen을 사용할 수 없습니다.',
              );
            }
            const layout = await generationStore.resolveSceneRender(
              body.layoutRenderId,
            );
            const references = await referenceStore.resolveReferenceAttachments(
              body.referenceIds,
            );
            const sourceGeneration =
              body.generationMode === 'edit' && body.parentGenerationId !== null
                ? await generationStore.resolveGenerationResult(
                    body.parentGenerationId,
                  )
                : null;
            if (
              layout.render.sceneId !== body.sceneSnapshot.id ||
              body.layoutSpec.sceneId !== body.sceneSnapshot.id
            ) {
              throw new ReferenceInputError(
                '장면 스냅샷, 레이아웃 렌더와 LayoutSpec의 장면 ID가 일치하지 않습니다.',
              );
            }
            const preflight = evaluateGenerationPreflight({
              scene: body.sceneSnapshot,
              layoutSpec: body.layoutSpec,
              references,
              includeLayout: true,
              includeSourceKeyframe: body.generationMode === 'edit',
            });
            if (preflight.blockers.length > 0) {
              throw new ReferenceInputError(
                `생성 전 무결성 검사 실패: ${preflight.blockers.map(({ message }) => message).join(' ')}`,
              );
            }
            const acknowledgedWarnings = new Set(
              body.acknowledgedPreflightWarningIds,
            );
            const unacknowledgedWarnings = preflight.warnings.filter(
              ({ id }) => !acknowledgedWarnings.has(id),
            );
            if (unacknowledgedWarnings.length > 0) {
              throw new ReferenceInputError(
                `생성 전 경고 확인이 필요합니다: ${unacknowledgedWarnings.map(({ id, message }) => `[${id}] ${message}`).join(' ')}`,
              );
            }
            const layoutPath = await resolveProjectArtifact(
              options.projectRoot,
              layout.assetPath,
            );
            const sourceGenerationPath =
              sourceGeneration === null
                ? null
                : await resolveProjectArtifact(
                    options.projectRoot,
                    sourceGeneration.assetPath,
                  );
            const referencePaths = await Promise.all(
              references.map((reference) =>
                resolveProjectArtifact(
                  options.projectRoot,
                  reference.assetPath,
                ),
              ),
            );
            const generationImages = [
              {
                ...createGenerationImageDescriptor({
                  attachmentIndex: 1,
                  role: 'layout',
                  artifactId: layout.render.artifactId,
                }),
                path: layoutPath,
              },
              ...(sourceGeneration === null || sourceGenerationPath === null
                ? []
                : [
                    {
                      ...createGenerationImageDescriptor({
                        attachmentIndex: 2,
                        role: 'sourceGeneration',
                        artifactId:
                          sourceGeneration.generation.result!.artifactId,
                      }),
                      path: sourceGenerationPath,
                    },
                  ]),
              ...references.map((reference, index) => ({
                ...createGenerationImageDescriptor({
                  attachmentIndex: index + (sourceGeneration === null ? 2 : 3),
                  role: generationImageRoleForReferenceKind(reference.kind),
                  artifactId: reference.artifactId,
                  targetObjectId: reference.targetObjectId,
                }),
                path: referencePaths[index]!,
              })),
            ];
            const input: TurnInput[] = [
              { type: 'text', text: body.prompt },
              ...generationImages.map(({ path }) => ({
                type: 'localImage' as const,
                path,
                detail: 'original' as const,
              })),
            ];
            const responseModel = useOAuthImageProvider
              ? (body.imageModel ?? options.imageModel ?? 'gpt-5.4-mini')
              : null;
            const imageQuality = useOAuthImageProvider
              ? (body.imageQuality ?? options.imageQuality ?? 'medium')
              : null;
            const reasoningEffort = useOAuthImageProvider
              ? (options.reasoningEffort ?? 'high')
              : null;
            const generationIntent = useOAuthImageProvider
              ? await conversationStore.getGenerationIntent(body.threadId)
              : null;
            const turnId = useOAuthImageProvider
              ? `oauth_${body.requestId}`
              : await options.runtime.startTurn(body.threadId, input);
            await conversationStore.recordTurnStarted(body.threadId, turnId, {
              kind: 'generation',
              userMessage:
                body.feedback ??
                (body.generationMode === 'edit'
                  ? '키프레임 보정 생성'
                  : '현재 3D 장면 이미지 생성'),
              sceneRevision: body.sceneSnapshot.sceneRevision,
              specRevision: body.sceneSnapshot.specRevision,
            });
            const generation = await generationStore
              .createGeneration({
                requestId: body.requestId,
                requestFingerprint,
                threadId: body.threadId,
                turnId,
                prompt: body.prompt,
                provider: useOAuthImageProvider ? 'oauth' : 'codex',
                responseModel,
                imageQuality,
                reasoningEffort,
                generationIntentSnapshot: generationIntent,
                attachmentContractVersion: GENERATION_IMAGE_CONTRACT_VERSION,
                imageBindings:
                  expectedGenerationImageBindings(generationImages),
                layoutSpec: body.layoutSpec,
                sceneSnapshot: body.sceneSnapshot,
                referenceSnapshots: references.map(toPublicReference),
                parentGenerationId: body.parentGenerationId,
                sourceGenerationId: body.sourceGenerationId,
                feedback: body.feedback,
                refinementDirective: body.refinementDirective,
                generationMode: body.generationMode,
                layoutRenderId: body.layoutRenderId,
                referenceIds: references.map(({ id }) => id),
                attachments: [
                  { type: 'layout', id: body.layoutRenderId, kind: 'layout' },
                  ...(sourceGeneration === null
                    ? []
                    : [
                        {
                          type: 'sourceGeneration' as const,
                          id: sourceGeneration.generation.id,
                          kind: null,
                        },
                      ]),
                  ...references.map(({ id, kind }) => ({
                    type: 'reference' as const,
                    id,
                    kind,
                  })),
                ],
              })
              .catch(async (error) => {
                if (!useOAuthImageProvider) {
                  await options.runtime
                    .interruptTurn(body.threadId, turnId)
                    .catch(() => undefined);
                }
                await conversationStore
                  .recordTurnCompleted(
                    body.threadId,
                    turnId,
                    useOAuthImageProvider ? 'failed' : 'interrupted',
                  )
                  .catch(() => undefined);
                throw error;
              });
            if (useOAuthImageProvider) {
              void (async () => {
                try {
                  const filePaths = generationImages.map(({ path }) => path);
                  const compiledPrompt = await imagegenPromptCompiler({
                    runtime: options.runtime,
                    projectRoot: options.projectRoot,
                    sourcePrompt: body.prompt,
                    generationIntent,
                    images: generationImages,
                    onThreadStarted: (threadId) => {
                      suppressedCodexThreadIds.add(threadId);
                    },
                  });
                  const generated = await oauthImageGenerator({
                    baseUrl:
                      options.oauthUrl ??
                      options.oauthStatus?.url ??
                      'http://127.0.0.1:10532',
                    model: responseModel!,
                    quality: imageQuality!,
                    reasoningEffort: reasoningEffort!,
                    generationPrompt: compiledPrompt.finalPrompt,
                    filePaths,
                  });
                  try {
                    await generationStore.importGenerationResult(
                      turnId,
                      generated.filePath,
                      generated.revisedPrompt,
                      {
                        generationSpec: generated.generationSpec,
                        promptCompiler: compiledPrompt.compiler,
                      },
                    );
                  } finally {
                    await generated.cleanup();
                  }
                  const completed = await generationStore.completeTurn(
                    turnId,
                    'completed',
                    null,
                  );
                  await conversationStore.recordTurnCompleted(
                    body.threadId,
                    turnId,
                    'completed',
                  );
                  if (completed !== null) broadcast('generation', completed);
                } catch (error) {
                  const failed = await generationStore.completeTurn(
                    turnId,
                    'failed',
                    error instanceof Error
                      ? error.message
                      : 'OAuth 이미지 생성에 실패했습니다.',
                  );
                  await conversationStore
                    .recordTurnCompleted(body.threadId, turnId, 'failed')
                    .catch(() => undefined);
                  if (failed !== null) broadcast('generation', failed);
                }
              })();
            }
            return { turnId, generation, reused: false };
          },
        );
        sendJson(response, started.reused ? 200 : 202, started);
        return;
      }

      const generationThumbnailMatch = requestUrl.pathname.match(
        /^\/api\/generations\/([^/]+)\/thumbnail$/,
      );
      if (request.method === 'GET' && generationThumbnailMatch !== null) {
        const generationId = decodeURIComponent(
          generationThumbnailMatch[1] ?? '',
        );
        const { data, mimeType } =
          await generationStore.readGenerationThumbnailContent(generationId);
        response.writeHead(200, {
          'Content-Type': mimeType,
          'Content-Length': String(data.byteLength),
          'Cache-Control': 'private, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(data);
        return;
      }

      const generationContentMatch = requestUrl.pathname.match(
        /^\/api\/generations\/([^/]+)\/content$/,
      );
      if (request.method === 'GET' && generationContentMatch !== null) {
        const generationId = decodeURIComponent(
          generationContentMatch[1] ?? '',
        );
        const { data, mimeType } =
          await generationStore.readGenerationContent(generationId);
        response.writeHead(200, {
          'Content-Type': mimeType,
          'Content-Length': String(data.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(data);
        return;
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/references'
      ) {
        const query = referenceImportQuerySchema.parse(
          Object.fromEntries(requestUrl.searchParams),
        );
        const reference = await referenceStore.importReference({
          name: query.name,
          kind: query.kind,
          originalFileName: query.fileName,
          data: await readBody(request, 25 * 1024 * 1024),
        });
        sendJson(response, 201, { reference });
        return;
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/rigged-characters'
      ) {
        const query = riggedCharacterImportQuerySchema.parse(
          Object.fromEntries(requestUrl.searchParams),
        );
        const asset = await riggedCharacterStore.importAsset({
          name: query.name,
          originalFileName: query.fileName,
          analysis: query.analysis,
          data: await readBody(request, 100 * 1024 * 1024),
        });
        sendJson(response, 201, { asset });
        return;
      }

      const riggedCharacterContentMatch = requestUrl.pathname.match(
        /^\/api\/rigged-characters\/([^/]+)\/content$/,
      );
      if (request.method === 'GET' && riggedCharacterContentMatch !== null) {
        const assetId = decodeURIComponent(
          riggedCharacterContentMatch[1] ?? '',
        );
        const { asset, data } = await riggedCharacterStore.readContent(assetId);
        response.writeHead(200, {
          'Content-Type': asset.mimeType,
          'Content-Length': String(data.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(data);
        return;
      }

      const referenceMatch = requestUrl.pathname.match(
        /^\/api\/references\/([^/]+)$/,
      );
      if (request.method === 'PATCH' && referenceMatch !== null) {
        const referenceId = decodeURIComponent(referenceMatch[1] ?? '');
        const metadata = referenceMetadataInputSchema.parse(
          await readJson(request),
        );
        const reference = await referenceStore.updateReference(
          referenceId,
          metadata,
        );
        sendJson(response, 200, { reference });
        return;
      }
      if (request.method === 'DELETE' && referenceMatch !== null) {
        const referenceId = decodeURIComponent(referenceMatch[1] ?? '');
        const deleted = await referenceStore.deleteReference(referenceId);
        sendJson(response, 200, { deleted: deleted.id });
        return;
      }

      const referenceContentMatch = requestUrl.pathname.match(
        /^\/api\/references\/([^/]+)\/content$/,
      );
      if (request.method === 'GET' && referenceContentMatch !== null) {
        const referenceId = decodeURIComponent(referenceContentMatch[1] ?? '');
        const { reference, data } =
          await referenceStore.readReferenceContent(referenceId);
        response.writeHead(200, {
          'Content-Type': reference.mimeType,
          'Content-Length': String(data.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(data);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/threads') {
        const body = threadBodySchema.parse(await readJson(request));
        const mode =
          body.mode ?? (body.threadId === undefined ? 'new' : 'resume');
        const threadId =
          mode === 'new'
            ? await startFreshThread(options.runtime, options.projectRoot)
            : await options.runtime.resumeThread(
                body.threadId!,
                options.projectRoot,
              );
        const session = await conversationStore.activateThread(threadId, mode);
        sendJson(response, 200, { threadId, session });
        return;
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/spec-patch-proposals'
      ) {
        const body = specPatchProposalRequestSchema.parse(
          await readJson(request),
        );
        if (
          body.baseSceneRevision !== body.sceneDocument.sceneRevision ||
          body.baseSpecRevision !== body.sceneDocument.specRevision
        ) {
          throw new ReferenceInputError(
            '변경안 요청 revision이 SceneDocument와 일치하지 않습니다.',
          );
        }
        const turnId = await options.runtime.startTurn(
          body.threadId,
          [{ type: 'text', text: createSpecPatchProposalPrompt(body) }],
          { outputSchema: SPEC_PATCH_PROPOSAL_JSON_SCHEMA },
        );
        await conversationStore.recordTurnStarted(body.threadId, turnId, {
          kind: 'specPatch',
          userMessage: body.userMessage,
          sceneRevision: body.baseSceneRevision,
          specRevision: body.baseSpecRevision,
        });
        pendingSpecPatchProposals.set(turnId, body);
        sendJson(response, 202, { turnId, requestId: body.requestId });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/turns') {
        const body = turnBodySchema.parse(await readJson(request));
        const input: TurnInput[] = [{ type: 'text', text: body.prompt }];
        const layout =
          body.layoutRenderId === undefined
            ? null
            : await generationStore.resolveSceneRender(body.layoutRenderId);
        if (layout !== null && layout.render.sceneId !== body.sceneId) {
          throw new ReferenceInputError(
            '대화용 레이아웃 렌더와 SceneDocument의 장면 ID가 일치하지 않습니다.',
          );
        }
        const references = await referenceStore.resolveReferenceAttachments(
          body.referenceIds,
        );
        const artifactPaths = [
          ...(layout === null ? [] : [layout.assetPath]),
          ...body.attachments,
          ...references.map(({ assetPath }) => assetPath),
        ];
        if (artifactPaths.length > 16) {
          throw new ReferenceInputError(
            '한 번의 요청에는 이미지 첨부를 최대 16개까지 사용할 수 있습니다.',
          );
        }
        for (const artifactPath of artifactPaths) {
          input.push({
            type: 'localImage',
            path: await resolveProjectArtifact(
              options.projectRoot,
              artifactPath,
            ),
            detail: 'original',
          });
        }
        const turnId = await options.runtime.startTurn(body.threadId, input);
        if (body.metadata !== undefined) {
          await conversationStore.recordTurnStarted(
            body.threadId,
            turnId,
            body.metadata,
          );
        }
        sendJson(response, 202, { turnId });
        return;
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/api/turns/interrupt'
      ) {
        const body = interruptBodySchema.parse(await readJson(request));
        await options.runtime.interruptTurn(body.threadId, body.turnId);
        sendJson(response, 200, { interrupted: true });
        return;
      }

      sendJson(response, 404, { error: '요청한 Companion API가 없습니다.' });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Companion 요청이 실패했습니다.';
      const statusCode =
        error instanceof z.ZodError ||
        error instanceof ReferenceInputError ||
        error instanceof RiggedCharacterInputError ||
        error instanceof RequestBodyTooLargeError ||
        error instanceof RuntimeRequestInputError
          ? 400
          : error instanceof GenerationRequestConflictError
            ? 409
            : error instanceof RuntimeRequestConflictError
              ? 409
              : error instanceof ReferenceNotFoundError
                ? 404
                : error instanceof RiggedCharacterNotFoundError
                  ? 404
                  : 500;
      sendJson(response, statusCode, {
        error: message,
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  serverOrigin = `http://127.0.0.1:${address.port}`;
  return {
    token,
    url: serverOrigin,
    async close() {
      options.runtime.off('status', handleStatus);
      options.runtime.off('notification', handleNotification);
      options.runtime.off('serverRequest', handleServerRequest);
      for (const client of sseClients) {
        clearInterval(client.heartbeat);
        client.response.end();
      }
      sseClients.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      });
    },
  };
}
