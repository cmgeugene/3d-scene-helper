import { z } from 'zod';
import { layoutSpecSchema } from '../../shared/layoutSpecSchema';
import {
  sceneDocumentSchema,
  type SceneDocument,
} from '../editor/persistence/sceneSchema';
import { semanticSceneSpecSchema } from '../editor/persistence/semanticSceneSpec';
import { refinementDirectiveSchema } from '../../shared/refinementDirective';
import {
  generationExecutionIntegritySchema,
  generationExecutionSummarySchema,
} from '../../shared/generationExecutionSummary';
import {
  conversationSessionSchema,
  conversationTurnMetadataInputSchema,
  generationIntentSchema,
  type ConversationSession,
  type ConversationTurnMetadataInput,
} from '../../shared/conversationMetadata';
import {
  runtimeRequestListSchema,
  runtimeRequestResponseSchema,
  runtimeRequestSchema,
  type RuntimeRequest,
  type RuntimeRequestList,
  type RuntimeRequestResponse,
} from '../../shared/runtimeRequest';
import type { CompanionConnection } from './companionConnection';

const accountSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('apiKey') }),
    z.object({
      type: z.literal('chatgpt'),
      email: z.string().nullable(),
      planType: z.string(),
    }),
    z.object({ type: z.literal('amazonBedrock') }),
  ])
  .nullable();

export const companionRuntimeSchema = z.object({
  state: z.enum(['stopped', 'starting', 'ready', 'stopping', 'failed']),
  version: z.string().nullable(),
  account: accountSchema,
  requiresOpenaiAuth: z.boolean().nullable(),
  error: z.string().nullable(),
  capabilities: z
    .object({
      namespaceTools: z.boolean(),
      imageGeneration: z.boolean(),
      webSearch: z.boolean(),
    })
    .nullable()
    .optional(),
  imageProvider: z.enum(['codex', 'oauth']).optional(),
  oauth: z
    .object({
      state: z.enum(['stopped', 'starting', 'ready', 'failed']),
      url: z.string().nullable(),
      error: z.string().nullable(),
      models: z.array(z.string()),
    })
    .optional(),
});

export type CompanionRuntimeStatus = z.infer<typeof companionRuntimeSchema>;

export const referenceKindSchema = z.enum([
  'layout',
  'background',
  'character',
  'style',
]);

export const referenceArtifactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: referenceKindSchema,
  artifactId: z.string().min(1),
  contentHash: z.string(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  originalFileName: z.string().min(1),
  byteLength: z.number().int().positive(),
  createdAt: z.string(),
  targetObjectId: z.string().min(1).nullable(),
  use: z.array(z.string().min(1)),
  exclude: z.array(z.string().min(1)),
  enabled: z.boolean(),
});

export type ReferenceKind = z.infer<typeof referenceKindSchema>;
export type ReferenceArtifact = z.infer<typeof referenceArtifactSchema>;
export type ReferenceMetadataInput = Pick<
  ReferenceArtifact,
  'targetObjectId' | 'use' | 'exclude' | 'enabled'
>;

export const sceneRenderArtifactSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  artifactId: z.string().min(1),
  contentHash: z.string(),
  mimeType: z.literal('image/png'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteLength: z.number().int().positive(),
  createdAt: z.string(),
});

const generationThumbnailSchema = z.object({
  policyVersion: z.literal(1),
  artifactId: z.string().min(1),
  sourceContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mimeType: z.literal('image/webp'),
  width: z.number().int().positive().max(320),
  height: z.number().int().positive().max(320),
  byteLength: z.number().int().positive(),
});

const generationResultSchema = z.object({
  artifactId: z.string().min(1),
  contentHash: z.string(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  byteLength: z.number().int().positive(),
  thumbnail: generationThumbnailSchema.nullable().optional(),
});

const generationSceneIntegritySchema = z.object({
  status: z.enum(['valid', 'legacy', 'mismatch']),
  snapshotSceneId: z.string().min(1).nullable(),
  layoutSpecSceneId: z.string().min(1).nullable(),
  layoutRenderSceneId: z.string().min(1).nullable(),
});

export const generationRecordSchema = z.object({
  id: z.string().min(1),
  requestId: z.string().trim().min(1).max(200).nullable().optional(),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  status: z.enum(['inProgress', 'completed', 'failed', 'interrupted']),
  prompt: z.string().min(1),
  provider: z.enum(['codex', 'oauth']).nullable().optional(),
  responseModel: z.string().min(1).nullable().optional(),
  imageQuality: z.enum(['low', 'medium', 'high', 'auto']).nullable().optional(),
  reasoningEffort: z
    .enum(['none', 'low', 'medium', 'high', 'xhigh'])
    .nullable()
    .optional(),
  generationIntentSnapshot: generationIntentSchema.nullable().optional(),
  generationSpec: z.string().min(1).nullable().optional(),
  promptCompiler: z.literal('codex-imagegen-skill').nullable().optional(),
  layoutSpec: layoutSpecSchema.nullable(),
  sceneSnapshot: sceneDocumentSchema.nullable().default(null),
  semanticSceneSpecSnapshot: semanticSceneSpecSchema.nullable().default(null),
  referenceSnapshots: z.array(referenceArtifactSchema).default([]),
  parentGenerationId: z.string().min(1).nullable().default(null),
  sourceGenerationId: z.string().min(1).nullable().optional(),
  versionNumber: z.number().int().positive().default(1),
  feedback: z.string().min(1).nullable().default(null),
  refinementDirective: refinementDirectiveSchema.nullable().default(null),
  generationMode: z.enum(['fresh', 'edit']).default('fresh'),
  layoutRenderId: z.string().min(1),
  sceneIntegrity: generationSceneIntegritySchema.optional(),
  referenceIds: z.array(z.string().min(1)),
  attachments: z.array(
    z.object({
      type: z.enum(['layout', 'reference', 'sourceGeneration']),
      id: z.string().min(1),
      kind: referenceKindSchema.nullable(),
    }),
  ),
  executionSummary: generationExecutionSummarySchema.nullable().optional(),
  executionIntegrity: generationExecutionIntegritySchema.optional(),
  revisedPrompt: z.string().nullable(),
  result: generationResultSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SceneRenderArtifact = z.infer<typeof sceneRenderArtifactSchema>;
export type GenerationRecord = z.infer<typeof generationRecordSchema>;

const startSpecPatchProposalInputSchema = z
  .strictObject({
    threadId: z.string().min(1),
    requestId: z.string().trim().min(1).max(200),
    baseSceneRevision: z.number().int().nonnegative().safe(),
    baseSpecRevision: z.number().int().nonnegative().safe(),
    userMessage: z.string().trim().min(1).max(4_000),
    sceneDocument: sceneDocumentSchema,
  })
  .superRefine((input, context) => {
    if (input.baseSceneRevision !== input.sceneDocument.sceneRevision) {
      context.addIssue({
        code: 'custom',
        path: ['baseSceneRevision'],
        message: 'scene revision does not match SceneDocument',
      });
    }
    if (input.baseSpecRevision !== input.sceneDocument.specRevision) {
      context.addIssue({
        code: 'custom',
        path: ['baseSpecRevision'],
        message: 'spec revision does not match SceneDocument',
      });
    }
  });

export interface StartSpecPatchProposalInput {
  threadId: string;
  requestId: string;
  baseSceneRevision: number;
  baseSpecRevision: number;
  userMessage: string;
  sceneDocument: SceneDocument;
}

export const startGenerationInputSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  threadId: z.string().min(1),
  prompt: z.string().min(1).max(100_000),
  layoutRenderId: z.string().min(1),
  layoutSpec: layoutSpecSchema,
  sceneSnapshot: sceneDocumentSchema,
  referenceIds: z.array(z.string().min(1)).default([]),
  parentGenerationId: z.string().min(1).nullable().default(null),
  sourceGenerationId: z.string().min(1).nullable().default(null),
  feedback: z.string().trim().min(1).max(4_000).nullable().default(null),
  refinementDirective: refinementDirectiveSchema.nullable().default(null),
  generationMode: z.enum(['fresh', 'edit']).default('fresh'),
  acknowledgedPreflightWarningIds: z
    .array(z.string().trim().min(1).max(300))
    .max(32)
    .default([]),
  imageModel: z.string().trim().min(1).max(80).default('gpt-5.4-mini'),
  imageQuality: z.enum(['low', 'medium', 'high', 'auto']).default('medium'),
});

export type StartGenerationInput = z.input<typeof startGenerationInputSchema>;
export type NormalizedStartGenerationInput = z.output<
  typeof startGenerationInputSchema
>;

export interface CompanionEvent {
  event: string;
  data: unknown;
}

export interface CompanionBrowserClient {
  getRuntime(signal?: AbortSignal): Promise<CompanionRuntimeStatus>;
  getConversationSession?(signal?: AbortSignal): Promise<ConversationSession>;
  listRuntimeRequests?(signal?: AbortSignal): Promise<RuntimeRequestList>;
  respondRuntimeRequest?(
    requestId: string,
    response: RuntimeRequestResponse,
    signal?: AbortSignal,
  ): Promise<RuntimeRequest>;
  startThread(threadId?: string, signal?: AbortSignal): Promise<string>;
  startTurn(
    threadId: string,
    prompt: string,
    referenceIds?: string[],
    signal?: AbortSignal,
  ): Promise<string>;
  startConversationTurn?(
    threadId: string,
    prompt: string,
    referenceIds: string[],
    metadata: ConversationTurnMetadataInput,
    signal?: AbortSignal,
  ): Promise<string>;
  startSpecPatchProposal?(
    input: StartSpecPatchProposalInput,
    signal?: AbortSignal,
  ): Promise<{ turnId: string; requestId: string }>;
  interruptTurn(
    threadId: string,
    turnId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  listReferences(signal?: AbortSignal): Promise<ReferenceArtifact[]>;
  importReference(
    file: File,
    name: string,
    kind: ReferenceKind,
    signal?: AbortSignal,
  ): Promise<ReferenceArtifact>;
  updateReference(
    referenceId: string,
    metadata: ReferenceMetadataInput,
    signal?: AbortSignal,
  ): Promise<ReferenceArtifact>;
  loadReferenceBlob(referenceId: string, signal?: AbortSignal): Promise<Blob>;
  createSceneRender(
    blob: Blob,
    sceneId: string,
    signal?: AbortSignal,
  ): Promise<SceneRenderArtifact>;
  loadSceneRenderBlob(renderId: string, signal?: AbortSignal): Promise<Blob>;
  listGenerations(signal?: AbortSignal): Promise<GenerationRecord[]>;
  startGeneration(
    input: StartGenerationInput,
    signal?: AbortSignal,
  ): Promise<{
    turnId: string;
    generation: GenerationRecord;
    reused?: boolean;
  }>;
  loadGenerationBlob(generationId: string, signal?: AbortSignal): Promise<Blob>;
  loadGenerationThumbnailBlob?(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<Blob>;
  subscribe(
    listener: (event: CompanionEvent) => void,
    onError: (error: Error) => void,
  ): () => void;
}

interface FetchLike {
  (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response>;
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export class SseDecoder {
  private buffer = '';

  push(chunk: string) {
    this.buffer += chunk.replaceAll('\r\n', '\n');
    const events: CompanionEvent[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = this.parseBlock(block);
      if (event !== null) events.push(event);
      boundary = this.buffer.indexOf('\n\n');
    }
    return events;
  }

  private parseBlock(block: string): CompanionEvent | null {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return null;

    const serialized = data.join('\n');
    try {
      return { event, data: JSON.parse(serialized) as unknown };
    } catch {
      return { event, data: serialized };
    }
  }
}

export class CompanionClient implements CompanionBrowserClient {
  constructor(
    private readonly connection: CompanionConnection,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async getRuntime(signal?: AbortSignal) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/runtime`,
      {
        headers: this.headers(),
        signal,
      },
    );
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    return companionRuntimeSchema.parse(await response.json());
  }

  async startThread(threadId?: string, signal?: AbortSignal) {
    const value = await this.postJson(
      '/api/threads',
      threadId === undefined ? {} : { threadId },
      signal,
    );
    return z.object({ threadId: z.string().min(1) }).parse(value).threadId;
  }

  async getConversationSession(signal?: AbortSignal) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/conversation-session`,
      { headers: this.headers(), signal },
    );
    if (response.status === 404) {
      return { version: 1 as const, activeTask: null, archivedTaskCount: 0 };
    }
    if (!response.ok) throw await this.createHttpError(response);
    return conversationSessionSchema.parse(await response.json());
  }

  async listRuntimeRequests(signal?: AbortSignal) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/runtime-requests`,
      { headers: this.headers(), signal },
    );
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    return runtimeRequestListSchema.parse(await response.json());
  }

  async respondRuntimeRequest(
    requestId: string,
    input: RuntimeRequestResponse,
    signal?: AbortSignal,
  ) {
    const body = runtimeRequestResponseSchema.parse(input);
    const value = await this.postJson(
      `/api/runtime-requests/${encodeURIComponent(requestId)}/respond`,
      body,
      signal,
    );
    return z.object({ request: runtimeRequestSchema }).parse(value).request;
  }

  async startTurn(
    threadId: string,
    prompt: string,
    referenceIds: string[] = [],
    signal?: AbortSignal,
  ) {
    const value = await this.postJson(
      '/api/turns',
      { threadId, prompt, attachments: [], referenceIds },
      signal,
    );
    return z.object({ turnId: z.string().min(1) }).parse(value).turnId;
  }

  async startConversationTurn(
    threadId: string,
    prompt: string,
    referenceIds: string[],
    metadata: ConversationTurnMetadataInput,
    signal?: AbortSignal,
  ) {
    const value = await this.postJson(
      '/api/turns',
      {
        threadId,
        prompt,
        attachments: [],
        referenceIds,
        metadata: conversationTurnMetadataInputSchema.parse(metadata),
      },
      signal,
    );
    return z.object({ turnId: z.string().min(1) }).parse(value).turnId;
  }

  async startSpecPatchProposal(
    input: StartSpecPatchProposalInput,
    signal?: AbortSignal,
  ) {
    const parsedInput = startSpecPatchProposalInputSchema.parse(input);
    const value = await this.postJson(
      '/api/spec-patch-proposals',
      parsedInput,
      signal,
    );
    return z
      .strictObject({
        turnId: z.string().min(1),
        requestId: z.literal(parsedInput.requestId),
      })
      .parse(value);
  }

  async interruptTurn(threadId: string, turnId: string, signal?: AbortSignal) {
    const value = await this.postJson(
      '/api/turns/interrupt',
      { threadId, turnId },
      signal,
    );
    z.object({ interrupted: z.literal(true) }).parse(value);
  }

  async listReferences(signal?: AbortSignal) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/references`,
      { headers: this.headers(), signal },
    );
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    return z
      .object({
        version: z.literal(1),
        references: z.array(referenceArtifactSchema),
      })
      .parse(await response.json()).references;
  }

  async importReference(
    file: File,
    name: string,
    kind: ReferenceKind,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({ name, kind, fileName: file.name });
    const response = await this.fetchImpl(
      `${this.connection.url}/api/references?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
        signal,
      },
    );
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    return z
      .object({ reference: referenceArtifactSchema })
      .parse(await response.json()).reference;
  }

  async loadReferenceBlob(referenceId: string, signal?: AbortSignal) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/references/${encodeURIComponent(referenceId)}/content`,
      { headers: this.headers(), signal },
    );
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    return response.blob();
  }

  async updateReference(
    referenceId: string,
    metadata: ReferenceMetadataInput,
    signal?: AbortSignal,
  ) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/references/${encodeURIComponent(referenceId)}`,
      {
        method: 'PATCH',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
        signal,
      },
    );
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    return z
      .object({ reference: referenceArtifactSchema })
      .parse(await response.json()).reference;
  }

  async createSceneRender(blob: Blob, sceneId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ sceneId });
    const response = await this.fetchImpl(
      `${this.connection.url}/api/scene-renders?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'image/png',
        },
        body: blob,
        signal,
      },
    );
    if (!response.ok) throw await this.createHttpError(response);
    return z
      .object({ render: sceneRenderArtifactSchema })
      .parse(await response.json()).render;
  }

  async loadSceneRenderBlob(renderId: string, signal?: AbortSignal) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/scene-renders/${encodeURIComponent(renderId)}/content`,
      { headers: this.headers(), signal },
    );
    if (!response.ok) throw await this.createHttpError(response);
    return response.blob();
  }

  async listGenerations(signal?: AbortSignal) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/generations`,
      { headers: this.headers(), signal },
    );
    if (!response.ok) throw await this.createHttpError(response);
    return z
      .object({
        version: z.literal(1),
        generations: z.array(generationRecordSchema),
      })
      .parse(await response.json()).generations;
  }

  async startGeneration(input: StartGenerationInput, signal?: AbortSignal) {
    const parsedInput = startGenerationInputSchema.parse(input);
    const response = await this.fetchImpl(
      `${this.connection.url}/api/generations`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...parsedInput,
        }),
        signal,
      },
    );
    if (!response.ok) throw await this.createHttpError(response);
    return z
      .object({
        turnId: z.string().min(1),
        generation: generationRecordSchema,
        reused: z.boolean().optional(),
      })
      .parse(await response.json());
  }

  async loadGenerationBlob(generationId: string, signal?: AbortSignal) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/generations/${encodeURIComponent(generationId)}/content`,
      { headers: this.headers(), signal },
    );
    if (!response.ok) throw await this.createHttpError(response);
    return response.blob();
  }

  async loadGenerationThumbnailBlob(
    generationId: string,
    signal?: AbortSignal,
  ) {
    const response = await this.fetchImpl(
      `${this.connection.url}/api/generations/${encodeURIComponent(generationId)}/thumbnail`,
      { headers: this.headers(), signal },
    );
    if (!response.ok) throw await this.createHttpError(response);
    return response.blob();
  }

  subscribe(
    listener: (event: CompanionEvent) => void,
    onError: (error: Error) => void,
  ) {
    const controller = new AbortController();
    void this.readEvents(controller.signal, listener).catch((error) => {
      if (controller.signal.aborted) return;
      onError(
        error instanceof Error
          ? error
          : new Error('Companion 이벤트 연결이 종료되었습니다.'),
      );
    });
    return () => controller.abort();
  }

  private async readEvents(
    signal: AbortSignal,
    listener: (event: CompanionEvent) => void,
  ) {
    const response = await this.fetchImpl(`${this.connection.url}/api/events`, {
      headers: this.headers(),
      signal,
    });
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    if (response.body === null) {
      throw new Error('Companion 이벤트 응답에 스트림이 없습니다.');
    }

    const decoder = new TextDecoder();
    const sse = new SseDecoder();
    const reader = response.body.getReader();
    try {
      while (!signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        for (const event of sse.push(
          decoder.decode(next.value, { stream: true }),
        )) {
          listener(event);
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!signal.aborted) {
      throw new Error('Companion 이벤트 연결이 종료되었습니다.');
    }
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.connection.token}`,
    };
  }

  private async postJson(path: string, body: unknown, signal?: AbortSignal) {
    const response = await this.fetchImpl(`${this.connection.url}${path}`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw await this.createHttpError(response);
    }
    return response.json() as Promise<unknown>;
  }

  private async createHttpError(response: Response) {
    if (response.status === 401)
      return new Error('Companion 세션이 만료되었거나 올바르지 않습니다.');
    if (response.status === 403)
      return new Error('현재 편집기 Origin은 Companion에서 허용되지 않습니다.');
    try {
      const body = z
        .object({ error: z.string().min(1) })
        .parse(await response.clone().json());
      return new Error(body.error);
    } catch {
      return new Error(`Companion 요청이 실패했습니다 (${response.status}).`);
    }
  }
}
