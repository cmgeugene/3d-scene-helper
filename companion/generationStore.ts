import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { layoutSpecSchema, type LayoutSpec } from '../shared/layoutSpecSchema';
import {
  migratedSceneDocumentSchema,
  sceneDocumentSchema,
  type SceneDocument,
} from '../src/editor/persistence/sceneSchema';
import { semanticSceneSpecSchema } from '../src/editor/persistence/semanticSceneSpec';
import {
  refinementDirectiveSchema,
  type RefinementDirective,
} from '../shared/refinementDirective';
import {
  generationExecutionSummarySchema,
  type GenerationExecutionIntegrity,
  type GenerationExecutionSummary,
} from '../shared/generationExecutionSummary';
import {
  generationImageBindingSchema,
  GENERATION_IMAGE_CONTRACT_VERSION,
  type GenerationImageBinding,
} from '../shared/generationImageContract';
import { generationPromptEvidence } from '../shared/generationPromptEvidence';
import {
  generationIntentSchema,
  type GenerationIntent,
} from '../shared/conversationMetadata';
import { resolveProjectArtifact } from './projectArtifacts';
import {
  publicReferenceSchema,
  ReferenceInputError,
  ReferenceNotFoundError,
  inspectImage,
  type PublicReference,
  type ReferenceKind,
} from './referenceStore';

const sceneRenderSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  artifactId: z.string().min(1),
  assetPath: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mimeType: z.literal('image/png'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteLength: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

const generationResultSchema = z.object({
  artifactId: z.string().min(1),
  assetPath: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  byteLength: z.number().int().positive(),
  thumbnail: z
    .object({
      policyVersion: z.literal(1),
      artifactId: z.string().min(1),
      assetPath: z.string().min(1),
      sourceContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      mimeType: z.literal('image/webp'),
      width: z.number().int().positive().max(320),
      height: z.number().int().positive().max(320),
      byteLength: z.number().int().positive(),
    })
    .nullable()
    .default(null),
});

const attachmentSchema = z.object({
  type: z.enum(['layout', 'reference', 'sourceGeneration']),
  id: z.string().min(1),
  kind: z.enum(['layout', 'background', 'character', 'style']).nullable(),
});

const generationSchema = z
  .object({
    id: z.string().min(1),
    requestId: z.string().trim().min(1).max(200).nullable().default(null),
    requestFingerprint: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    status: z.enum(['inProgress', 'completed', 'failed', 'interrupted']),
    prompt: z.string().min(1),
    provider: z.enum(['codex', 'oauth']).nullable().default(null),
    responseModel: z.string().min(1).nullable().default(null),
    imageQuality: z
      .enum(['low', 'medium', 'high', 'auto'])
      .nullable()
      .default(null),
    reasoningEffort: z
      .enum(['none', 'low', 'medium', 'high', 'xhigh'])
      .nullable()
      .default(null),
    generationIntentSnapshot: generationIntentSchema.nullable().default(null),
    generationSpec: z.string().min(1).nullable().default(null),
    promptCompiler: z.literal('codex-imagegen-skill').nullable().default(null),
    attachmentContractVersion: z
      .union([z.literal(1), z.literal(GENERATION_IMAGE_CONTRACT_VERSION)])
      .default(1),
    imageBindings: z
      .array(generationImageBindingSchema)
      .nullable()
      .default(null),
    layoutSpec: layoutSpecSchema.nullable().default(null),
    sceneSnapshot: migratedSceneDocumentSchema.nullable().default(null),
    semanticSceneSpecSnapshot: semanticSceneSpecSchema.nullable().default(null),
    referenceSnapshots: z.array(publicReferenceSchema).default([]),
    parentGenerationId: z.string().min(1).nullable().default(null),
    sourceGenerationId: z.string().min(1).nullable().default(null),
    versionNumber: z.number().int().positive().default(1),
    feedback: z.string().trim().min(1).max(4_000).nullable().default(null),
    refinementDirective: refinementDirectiveSchema.nullable().default(null),
    generationMode: z.enum(['fresh', 'edit']).default('fresh'),
    layoutRenderId: z.string().min(1),
    referenceIds: z.array(z.string().min(1)),
    attachments: z.array(attachmentSchema),
    executionSummary: generationExecutionSummarySchema.nullable().default(null),
    revisedPrompt: z.string().nullable(),
    result: generationResultSchema.nullable(),
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((generation, context) => {
    if (
      (generation.requestId === null) !==
      (generation.requestFingerprint === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requestFingerprint'],
        message: 'request ID와 fingerprint는 함께 저장해야 합니다.',
      });
    }
  });

const generationManifestSchema = z.object({
  version: z.literal(1),
  sceneRenders: z.array(sceneRenderSchema),
  generations: z.array(generationSchema),
});

export type SceneRender = z.infer<typeof sceneRenderSchema>;
export type GenerationRecord = z.infer<typeof generationSchema>;
export type GenerationMode = GenerationRecord['generationMode'];

export interface GenerationSceneIntegrity {
  status: 'valid' | 'legacy' | 'mismatch';
  snapshotSceneId: string | null;
  layoutSpecSceneId: string | null;
  layoutRenderSceneId: string | null;
}

export interface CreateGenerationInput {
  requestId?: string | null;
  requestFingerprint?: string | null;
  threadId: string;
  turnId: string;
  prompt: string;
  provider?: 'codex' | 'oauth' | null;
  responseModel?: string | null;
  imageQuality?: 'low' | 'medium' | 'high' | 'auto' | null;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | null;
  generationIntentSnapshot?: GenerationIntent | null;
  attachmentContractVersion?: 1 | typeof GENERATION_IMAGE_CONTRACT_VERSION;
  imageBindings?: GenerationImageBinding[] | null;
  layoutSpec: LayoutSpec;
  sceneSnapshot: SceneDocument;
  referenceSnapshots: PublicReference[];
  parentGenerationId?: string | null;
  sourceGenerationId?: string | null;
  feedback?: string | null;
  refinementDirective?: RefinementDirective | null;
  generationMode?: GenerationMode;
  layoutRenderId: string;
  referenceIds: string[];
  attachments: Array<{
    type: 'layout' | 'reference' | 'sourceGeneration';
    id: string;
    kind: ReferenceKind | null;
  }>;
}

const EMPTY_MANIFEST: z.infer<typeof generationManifestSchema> = {
  version: 1,
  sceneRenders: [],
  generations: [],
};

function sha256(data: Buffer) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function hashText(value: string) {
  return sha256(Buffer.from(value, 'utf8'));
}

function hashJson(value: unknown) {
  return hashText(JSON.stringify(value));
}

function findSourceGeneration(
  generation: GenerationRecord,
  generations: GenerationRecord[],
) {
  const id =
    generation.generationMode === 'edit'
      ? generation.parentGenerationId
      : generation.sourceGenerationId;
  if (id === null) return null;
  return generations.find((candidate) => candidate.id === id) ?? null;
}

function attachmentContentHash(
  attachment: GenerationRecord['attachments'][number],
  generation: GenerationRecord,
  layoutRender: SceneRender,
  generations: GenerationRecord[],
) {
  if (attachment.type === 'layout') {
    return attachment.id === layoutRender.id ? layoutRender.contentHash : null;
  }
  if (attachment.type === 'reference') {
    return (
      generation.referenceSnapshots.find(({ id }) => id === attachment.id)
        ?.contentHash ?? null
    );
  }
  return (
    generations.find(({ id }) => id === attachment.id)?.result?.contentHash ??
    null
  );
}

function createExecutionSummary(
  generation: GenerationRecord,
  layoutRender: SceneRender,
  generations: GenerationRecord[],
): GenerationExecutionSummary | null {
  if (
    generation.sceneSnapshot === null ||
    generation.semanticSceneSpecSnapshot === null ||
    generation.layoutSpec === null
  ) {
    return null;
  }
  const source = findSourceGeneration(generation, generations);
  return generationExecutionSummarySchema.parse({
    version: 1,
    requestId: generation.requestId,
    prompt: { contentHash: hashText(generation.prompt) },
    sceneDocument: {
      id: generation.sceneSnapshot.id,
      sceneRevision: generation.sceneSnapshot.sceneRevision,
      specRevision: generation.sceneSnapshot.specRevision,
      contentHash: hashJson(generation.sceneSnapshot),
    },
    semanticSceneSpec: {
      version: generation.semanticSceneSpecSnapshot.version,
      contentHash: hashJson(generation.semanticSceneSpecSnapshot),
    },
    layoutSpec: {
      version: generation.layoutSpec.version,
      sceneId: generation.layoutSpec.sceneId,
      contentHash: hashJson(generation.layoutSpec),
    },
    layoutRender: {
      id: layoutRender.id,
      sceneId: layoutRender.sceneId,
      contentHash: layoutRender.contentHash,
    },
    sourceGeneration:
      source === null
        ? null
        : {
            id: source.id,
            usage:
              generation.generationMode === 'edit'
                ? 'editSource'
                : 'sceneSnapshotSource',
            contentHash: source.result?.contentHash ?? null,
          },
    references: generation.referenceSnapshots.map(
      ({ id, kind, contentHash }) => ({ id, kind, contentHash }),
    ),
    attachments: generation.attachments.map((attachment, index) => ({
      attachmentIndex: index + 1,
      ...attachment,
      contentHash: attachmentContentHash(
        attachment,
        generation,
        layoutRender,
        generations,
      ),
    })),
  });
}

function assessExecutionIntegrity(
  generation: GenerationRecord,
  layoutRender: SceneRender | undefined,
  generations: GenerationRecord[],
): GenerationExecutionIntegrity {
  if (generation.executionSummary === null) {
    return { status: 'legacy', issues: [] };
  }
  if (layoutRender === undefined) {
    return {
      status: 'mismatch',
      issues: ['실행 요약의 레이아웃 렌더를 저장소에서 찾을 수 없습니다.'],
    };
  }
  const expected = createExecutionSummary(
    { ...generation, executionSummary: null },
    layoutRender,
    generations,
  );
  if (expected === null) {
    return {
      status: 'mismatch',
      issues: ['실행 요약을 재검증할 입력 스냅샷이 없습니다.'],
    };
  }
  const issues: string[] = [];
  const stored = generation.executionSummary;
  const compare = (label: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      issues.push(`${label}이(가) 저장된 실행 요약과 일치하지 않습니다.`);
    }
  };
  compare('request ID', stored.requestId, expected.requestId);
  compare('prompt 해시', stored.prompt, expected.prompt);
  compare('SceneDocument 스냅샷', stored.sceneDocument, expected.sceneDocument);
  compare(
    'Semantic Scene Spec 스냅샷',
    stored.semanticSceneSpec,
    expected.semanticSceneSpec,
  );
  compare('LayoutSpec 스냅샷', stored.layoutSpec, expected.layoutSpec);
  compare('레이아웃 렌더', stored.layoutRender, expected.layoutRender);
  compare('원본 키프레임', stored.sourceGeneration, expected.sourceGeneration);
  compare('레퍼런스 목록', stored.references, expected.references);
  compare('실제 첨부 순서', stored.attachments, expected.attachments);

  if (
    JSON.stringify(generation.sceneSnapshot?.semanticSceneSpec) !==
    JSON.stringify(generation.semanticSceneSpecSnapshot)
  ) {
    issues.push(
      'SceneDocument와 별도 Semantic Scene Spec 스냅샷이 일치하지 않습니다.',
    );
  }
  if (generation.sceneSnapshot !== null && generation.layoutSpec !== null) {
    const evidence = generationPromptEvidence(
      generation.sceneSnapshot,
      generation.layoutSpec,
      generation.generationMode,
      generation.referenceSnapshots,
    );
    if (!generation.prompt.includes(evidence.sceneDocument)) {
      issues.push(
        'prompt의 SceneDocument 입력이 저장 스냅샷과 일치하지 않습니다.',
      );
    }
    if (!generation.prompt.includes(evidence.layoutSpec)) {
      issues.push(
        'prompt의 LayoutSpec 입력이 저장 스냅샷과 일치하지 않습니다.',
      );
    }
    if (
      evidence.semanticSceneSpec !== null &&
      !generation.prompt.includes(evidence.semanticSceneSpec)
    ) {
      issues.push(
        'prompt의 Semantic Scene Spec 입력이 저장 스냅샷과 일치하지 않습니다.',
      );
    }
    if (!generation.prompt.includes(evidence.references)) {
      issues.push(
        'prompt의 레퍼런스 첨부 순서가 저장 스냅샷과 일치하지 않습니다.',
      );
    }
  }
  const expectedAttachments: GenerationRecord['attachments'] = [
    ...(generation.generationMode === 'edit' &&
    generation.parentGenerationId !== null
      ? [
          {
            type: 'sourceGeneration' as const,
            id: generation.parentGenerationId,
            kind: null,
          },
        ]
      : []),
    {
      type: 'layout' as const,
      id: generation.layoutRenderId,
      kind: 'layout' as const,
    },
    ...generation.referenceSnapshots.map(({ id, kind }) => ({
      type: 'reference' as const,
      id,
      kind,
    })),
  ];
  if (
    JSON.stringify(generation.attachments) !==
    JSON.stringify(expectedAttachments)
  ) {
    issues.push('실제 첨부 순서가 생성 mode와 저장 입력 순서에 맞지 않습니다.');
  }
  if (
    stored.sourceGeneration !== null &&
    stored.sourceGeneration.contentHash === null
  ) {
    issues.push('원본 키프레임 결과의 콘텐츠 해시가 없습니다.');
  }
  if (stored.attachments.some(({ contentHash }) => contentHash === null)) {
    issues.push('해시를 확인할 수 없는 실제 첨부가 있습니다.');
  }
  return {
    status: issues.length === 0 ? 'valid' : 'mismatch',
    issues,
  };
}

export function toPublicSceneRender(render: SceneRender) {
  const { assetPath, ...publicRender } = render;
  void assetPath;
  return publicRender;
}

function assessSceneIntegrity(
  generation: GenerationRecord,
  layoutRender: SceneRender | undefined,
): GenerationSceneIntegrity {
  const snapshotSceneId = generation.sceneSnapshot?.id ?? null;
  const layoutSpecSceneId = generation.layoutSpec?.sceneId ?? null;
  const layoutRenderSceneId = layoutRender?.sceneId ?? null;
  const status =
    snapshotSceneId === null
      ? 'legacy'
      : layoutSpecSceneId === snapshotSceneId &&
          layoutRenderSceneId === snapshotSceneId
        ? 'valid'
        : 'mismatch';

  return {
    status,
    snapshotSceneId,
    layoutSpecSceneId,
    layoutRenderSceneId,
  };
}

export function toPublicGeneration(
  generation: GenerationRecord,
  layoutRender: SceneRender | undefined,
  generations: GenerationRecord[] = [],
) {
  const { requestFingerprint, ...publicGeneration } = generation;
  void requestFingerprint;
  return {
    ...publicGeneration,
    sceneIntegrity: assessSceneIntegrity(generation, layoutRender),
    executionIntegrity: assessExecutionIntegrity(
      generation,
      layoutRender,
      generations,
    ),
    result:
      generation.result === null
        ? null
        : (() => {
            const { assetPath, thumbnail, ...publicResult } = generation.result;
            void assetPath;
            return {
              ...publicResult,
              thumbnail:
                thumbnail === null
                  ? null
                  : (() => {
                      const { assetPath: thumbnailPath, ...publicThumbnail } =
                        thumbnail;
                      void thumbnailPath;
                      return publicThumbnail;
                    })(),
            };
          })(),
  };
}

export interface GenerationStoreOptions {
  writeThumbnailFile?: (filePath: string, data: Buffer) => Promise<unknown>;
}

export class GenerationStore {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly writeThumbnailFile: (
    filePath: string,
    data: Buffer,
  ) => Promise<unknown>;

  constructor(
    private readonly projectRoot: string,
    options: GenerationStoreOptions = {},
  ) {
    this.writeThumbnailFile =
      options.writeThumbnailFile ??
      ((filePath, data) => writeFile(filePath, data, { flag: 'wx' }));
  }

  listGenerations() {
    return this.mutate(() => this.listGenerationsInternal());
  }

  private async listGenerationsInternal() {
    const manifest = await this.restoreLegacyThumbnails(
      await this.readManifest(),
    );
    return manifest.generations.map((generation) =>
      toPublicGeneration(
        generation,
        manifest.sceneRenders.find(
          ({ id }) => id === generation.layoutRenderId,
        ),
        manifest.generations,
      ),
    );
  }

  async findGenerationRequest(requestId: string) {
    const manifest = await this.readManifest();
    const generation = manifest.generations.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (generation === undefined) return null;
    return {
      requestFingerprint: generation.requestFingerprint,
      generation: toPublicGeneration(
        generation,
        manifest.sceneRenders.find(
          ({ id }) => id === generation.layoutRenderId,
        ),
        manifest.generations,
      ),
    };
  }

  recoverInProgressGenerations(error: string) {
    return this.mutate(() => this.recoverInProgressGenerationsInternal(error));
  }

  importSceneRender(sceneId: string, data: Buffer) {
    return this.mutate(() => this.importSceneRenderInternal(sceneId, data));
  }

  async resolveSceneRender(renderId: string) {
    const manifest = await this.readManifest();
    const render = manifest.sceneRenders.find(({ id }) => id === renderId);
    if (render === undefined) {
      throw new ReferenceNotFoundError('레이아웃 렌더를 찾을 수 없습니다.');
    }
    return {
      render: toPublicSceneRender(render),
      assetPath: render.assetPath,
    };
  }

  async readSceneRenderContent(renderId: string) {
    const { render, assetPath } = await this.resolveSceneRender(renderId);
    const filePath = await resolveProjectArtifact(this.projectRoot, assetPath);
    return {
      render,
      data: await readFile(filePath),
      mimeType: render.mimeType,
    };
  }

  createGeneration(input: CreateGenerationInput) {
    return this.mutate(() => this.createGenerationInternal(input));
  }

  importGenerationResult(
    turnId: string,
    savedPath: string,
    revisedPrompt: string | null,
    metadata: {
      generationSpec?: string | null;
      promptCompiler?: 'codex-imagegen-skill' | null;
    } = {},
  ) {
    return this.mutate(() =>
      this.importGenerationResultInternal(
        turnId,
        savedPath,
        revisedPrompt,
        metadata,
      ),
    );
  }

  completeTurn(
    turnId: string,
    status: 'completed' | 'failed' | 'interrupted',
    error: string | null,
  ) {
    return this.mutate(() => this.completeTurnInternal(turnId, status, error));
  }

  readGenerationThumbnailContent(generationId: string) {
    return this.mutate(async () => {
      const manifest = await this.restoreLegacyThumbnails(
        await this.readManifest(),
      );
      const generation = manifest.generations.find(
        ({ id }) => id === generationId,
      );
      if (
        generation === undefined ||
        generation.status !== 'completed' ||
        generation.result?.thumbnail === null ||
        generation.result?.thumbnail === undefined
      ) {
        throw new ReferenceNotFoundError(
          'generation thumbnail을 찾을 수 없습니다.',
        );
      }
      const filePath = await resolveProjectArtifact(
        this.projectRoot,
        generation.result.thumbnail.assetPath,
      );
      return {
        generation: toPublicGeneration(
          generation,
          manifest.sceneRenders.find(
            ({ id }) => id === generation.layoutRenderId,
          ),
          manifest.generations,
        ),
        data: await readFile(filePath),
        mimeType: generation.result.thumbnail.mimeType,
      };
    });
  }

  async readGenerationContent(generationId: string) {
    const manifest = await this.readManifest();
    const generation = manifest.generations.find(
      ({ id }) => id === generationId,
    );
    if (
      generation === undefined ||
      generation.status !== 'completed' ||
      generation.result === null
    ) {
      throw new ReferenceNotFoundError('생성 결과 이미지를 찾을 수 없습니다.');
    }
    const filePath = await resolveProjectArtifact(
      this.projectRoot,
      generation.result.assetPath,
    );
    const data = await readFile(filePath);
    const metadata = inspectImage(data);
    if (
      sha256(data) !== generation.result.contentHash ||
      metadata.mimeType !== generation.result.mimeType ||
      metadata.width !== generation.result.width ||
      metadata.height !== generation.result.height ||
      data.byteLength !== generation.result.byteLength
    ) {
      throw new ReferenceInputError(
        'generation 원본 해시 또는 이미지 metadata가 일치하지 않습니다.',
      );
    }
    return {
      generation: toPublicGeneration(
        generation,
        manifest.sceneRenders.find(
          ({ id }) => id === generation.layoutRenderId,
        ),
        manifest.generations,
      ),
      data,
      mimeType: generation.result.mimeType,
    };
  }

  async resolveGenerationResult(generationId: string) {
    const manifest = await this.readManifest();
    const generation = manifest.generations.find(
      ({ id }) => id === generationId,
    );
    if (generation === undefined || generation.result === null) {
      throw new ReferenceNotFoundError(
        '보정 원본으로 사용할 생성 결과 이미지를 찾을 수 없습니다.',
      );
    }
    return {
      generation: toPublicGeneration(
        generation,
        manifest.sceneRenders.find(
          ({ id }) => id === generation.layoutRenderId,
        ),
        manifest.generations,
      ),
      assetPath: generation.result.assetPath,
    };
  }

  private mutate<T>(operation: () => Promise<T>) {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async importSceneRenderInternal(sceneId: string, data: Buffer) {
    if (sceneId.trim() === '') {
      throw new ReferenceInputError('장면 ID가 필요합니다.');
    }
    if (data.byteLength > 25 * 1024 * 1024) {
      throw new ReferenceInputError('레이아웃 렌더는 25MB 이하여야 합니다.');
    }
    const metadata = inspectImage(data);
    if (
      metadata.mimeType !== 'image/png' ||
      metadata.width === null ||
      metadata.height === null
    ) {
      throw new ReferenceInputError('레이아웃 렌더는 PNG 형식이어야 합니다.');
    }
    const id = `render_${randomUUID()}`;
    const artifactId = `artifact_${randomUUID()}`;
    const assetPath = `scene-renders/${artifactId}.png`;
    const directory = path.join(this.projectRoot, 'assets', 'scene-renders');
    const filePath = path.join(directory, `${artifactId}.png`);
    const render: SceneRender = {
      id,
      sceneId: sceneId.trim(),
      artifactId,
      assetPath,
      contentHash: sha256(data),
      mimeType: 'image/png',
      width: metadata.width,
      height: metadata.height,
      byteLength: data.byteLength,
      createdAt: new Date().toISOString(),
    };
    const manifest = await this.readManifest();
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, data, { flag: 'wx' });
    try {
      await this.writeManifest({
        ...manifest,
        sceneRenders: [...manifest.sceneRenders, render],
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    return toPublicSceneRender(render);
  }

  private async createGenerationInternal(input: CreateGenerationInput) {
    const manifest = await this.readManifest();
    const sceneSnapshot = sceneDocumentSchema.parse(input.sceneSnapshot);
    const parentGenerationId = input.parentGenerationId ?? null;
    const parent =
      parentGenerationId === null
        ? null
        : manifest.generations.find(({ id }) => id === parentGenerationId);
    if (parentGenerationId !== null && parent === undefined) {
      throw new ReferenceInputError(
        '부모 키프레임 생성 기록을 찾을 수 없습니다.',
      );
    }
    const sourceGenerationId = input.sourceGenerationId ?? null;
    const generationMode = input.generationMode ?? 'fresh';
    const refinementDirective = refinementDirectiveSchema
      .nullable()
      .parse(input.refinementDirective ?? null);
    if (generationMode === 'fresh' && parentGenerationId !== null) {
      throw new ReferenceInputError(
        '새 생성에는 부모 키프레임을 지정할 수 없습니다.',
      );
    }
    if (generationMode === 'edit' && parentGenerationId === null) {
      throw new ReferenceInputError(
        '보정 생성에는 부모 키프레임이 필요합니다.',
      );
    }
    if (generationMode === 'edit' && sourceGenerationId !== null) {
      throw new ReferenceInputError(
        '보정 생성에는 3D snapshot 출처를 별도로 지정할 수 없습니다.',
      );
    }
    if (generationMode === 'edit' && refinementDirective === null) {
      throw new ReferenceInputError(
        '보정 생성에는 구조화된 유지·변경 지시가 필요합니다.',
      );
    }
    if (generationMode === 'fresh' && refinementDirective !== null) {
      throw new ReferenceInputError(
        '새 생성에는 보정 지시를 지정할 수 없습니다.',
      );
    }
    if (
      sourceGenerationId !== null &&
      !manifest.generations.some(({ id }) => id === sourceGenerationId)
    ) {
      throw new ReferenceInputError(
        '3D 레이아웃 출처 generation 기록을 찾을 수 없습니다.',
      );
    }
    const layoutRender = manifest.sceneRenders.find(
      ({ id }) => id === input.layoutRenderId,
    );
    if (layoutRender === undefined) {
      throw new ReferenceNotFoundError('레이아웃 렌더를 찾을 수 없습니다.');
    }
    if (
      sceneSnapshot.id !== input.layoutSpec.sceneId ||
      sceneSnapshot.id !== layoutRender.sceneId
    ) {
      throw new ReferenceInputError(
        '장면 스냅샷, 레이아웃 렌더와 LayoutSpec의 장면 ID가 일치하지 않습니다.',
      );
    }
    const snapshotReferenceIds = new Set(
      input.referenceSnapshots.map(({ id }) => id),
    );
    if (
      snapshotReferenceIds.size !== input.referenceIds.length ||
      input.referenceIds.some((id) => !snapshotReferenceIds.has(id))
    ) {
      throw new ReferenceInputError(
        '레퍼런스 스냅샷과 생성 첨부 목록이 일치하지 않습니다.',
      );
    }
    const now = new Date().toISOString();
    const generationWithoutSummary: GenerationRecord = generationSchema.parse({
      id: `generation_${randomUUID()}`,
      ...input,
      requestId: input.requestId ?? null,
      requestFingerprint: input.requestFingerprint ?? null,
      sceneSnapshot,
      semanticSceneSpecSnapshot: structuredClone(
        sceneSnapshot.semanticSceneSpec,
      ),
      parentGenerationId,
      sourceGenerationId,
      versionNumber:
        parent === null || parent === undefined ? 1 : parent.versionNumber + 1,
      feedback: input.feedback ?? null,
      refinementDirective,
      generationMode,
      status: 'inProgress',
      generationSpec: null,
      revisedPrompt: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    const generation: GenerationRecord = generationSchema.parse({
      ...generationWithoutSummary,
      executionSummary: createExecutionSummary(
        generationWithoutSummary,
        layoutRender,
        manifest.generations,
      ),
    });
    await this.writeManifest({
      ...manifest,
      generations: [...manifest.generations, generation],
    });
    return toPublicGeneration(generation, layoutRender, [
      ...manifest.generations,
      generation,
    ]);
  }

  private async recoverInProgressGenerationsInternal(error: string) {
    const manifest = await this.readManifest();
    if (!manifest.generations.some(({ status }) => status === 'inProgress')) {
      return [];
    }
    const updatedAt = new Date().toISOString();
    const recovered: GenerationRecord[] = [];
    const generations = manifest.generations.map((generation) => {
      if (generation.status !== 'inProgress') return generation;
      const updated: GenerationRecord = {
        ...generation,
        status: 'interrupted',
        error,
        updatedAt,
      };
      recovered.push(updated);
      return updated;
    });
    await this.writeManifest({ ...manifest, generations });
    return recovered.map((generation) =>
      toPublicGeneration(
        generation,
        manifest.sceneRenders.find(
          ({ id }) => id === generation.layoutRenderId,
        ),
        generations,
      ),
    );
  }

  private async importGenerationResultInternal(
    turnId: string,
    savedPath: string,
    revisedPrompt: string | null,
    metadata: {
      generationSpec?: string | null;
      promptCompiler?: 'codex-imagegen-skill' | null;
    },
  ) {
    const manifest = await this.readManifest();
    const index = manifest.generations.findIndex(
      (generation) => generation.turnId === turnId,
    );
    if (index < 0) return null;
    if (!path.isAbsolute(savedPath)) {
      throw new ReferenceInputError(
        'Codex 생성 결과 경로가 절대 경로가 아닙니다.',
      );
    }
    const sourcePath = await realpath(savedPath);
    const sourceMetadata = await stat(sourcePath);
    if (!sourceMetadata.isFile() || sourceMetadata.size > 50 * 1024 * 1024) {
      throw new ReferenceInputError(
        'Codex 생성 결과는 50MB 이하의 이미지 파일이어야 합니다.',
      );
    }
    const data = await readFile(sourcePath);
    const image = inspectImage(data);
    const artifactId = `artifact_${randomUUID()}`;
    const assetPath = `generations/${artifactId}.${image.extension}`;
    const originalContentHash = sha256(data);
    const thumbnailArtifactId = `artifact_${randomUUID()}`;
    const thumbnailAssetPath = `generation-thumbnails/${thumbnailArtifactId}.webp`;
    const thumbnailOutput = await sharp(data)
      .rotate()
      .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });
    const directory = path.join(this.projectRoot, 'assets', 'generations');
    const thumbnailDirectory = path.join(
      this.projectRoot,
      'assets',
      'generation-thumbnails',
    );
    const destination = path.join(
      directory,
      `${artifactId}.${image.extension}`,
    );
    const thumbnailDestination = path.join(
      thumbnailDirectory,
      `${thumbnailArtifactId}.webp`,
    );
    const result: GenerationRecord['result'] = {
      artifactId,
      assetPath,
      contentHash: originalContentHash,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      byteLength: data.byteLength,
      thumbnail: {
        policyVersion: 1,
        artifactId: thumbnailArtifactId,
        assetPath: thumbnailAssetPath,
        sourceContentHash: originalContentHash,
        contentHash: sha256(thumbnailOutput.data),
        mimeType: 'image/webp',
        width: thumbnailOutput.info.width,
        height: thumbnailOutput.info.height,
        byteLength: thumbnailOutput.data.byteLength,
      },
    };
    const current = manifest.generations[index]!;
    const updated: GenerationRecord = {
      ...current,
      result,
      generationSpec: metadata.generationSpec ?? current.generationSpec,
      promptCompiler: metadata.promptCompiler ?? current.promptCompiler,
      revisedPrompt,
      updatedAt: new Date().toISOString(),
    };
    await Promise.all([
      mkdir(directory, { recursive: true }),
      mkdir(thumbnailDirectory, { recursive: true }),
    ]);
    const originalTemporary = `${destination}.${randomUUID()}.tmp`;
    const thumbnailTemporary = `${thumbnailDestination}.${randomUUID()}.tmp`;
    let originalPublished = false;
    let thumbnailPublished = false;
    const generations = [...manifest.generations];
    generations[index] = updated;
    try {
      await writeFile(originalTemporary, data, { flag: 'wx' });
      await this.writeThumbnailFile(thumbnailTemporary, thumbnailOutput.data);
      await rename(originalTemporary, destination);
      originalPublished = true;
      await rename(thumbnailTemporary, thumbnailDestination);
      thumbnailPublished = true;
      await this.writeManifest({ ...manifest, generations });
    } catch (error) {
      await Promise.all([
        unlink(originalTemporary).catch(() => undefined),
        unlink(thumbnailTemporary).catch(() => undefined),
        ...(originalPublished
          ? [unlink(destination).catch(() => undefined)]
          : []),
        ...(thumbnailPublished
          ? [unlink(thumbnailDestination).catch(() => undefined)]
          : []),
      ]);
      throw error;
    }
    return toPublicGeneration(
      updated,
      manifest.sceneRenders.find(({ id }) => id === updated.layoutRenderId),
      generations,
    );
  }

  private async completeTurnInternal(
    turnId: string,
    status: 'completed' | 'failed' | 'interrupted',
    error: string | null,
  ) {
    const manifest = await this.readManifest();
    const index = manifest.generations.findIndex(
      (generation) => generation.turnId === turnId,
    );
    if (index < 0) return null;
    const current = manifest.generations[index]!;
    const layoutRender = manifest.sceneRenders.find(
      ({ id }) => id === current.layoutRenderId,
    );
    if (current.status !== 'inProgress')
      return toPublicGeneration(current, layoutRender, manifest.generations);
    const completedWithoutResult =
      status === 'completed' && current.result === null;
    const updated: GenerationRecord = {
      ...current,
      status: completedWithoutResult ? 'failed' : status,
      error: completedWithoutResult
        ? 'Codex turn은 완료됐지만 저장된 이미지 결과가 없습니다.'
        : error,
      updatedAt: new Date().toISOString(),
    };
    const generations = [...manifest.generations];
    generations[index] = updated;
    await this.writeManifest({ ...manifest, generations });
    return toPublicGeneration(updated, layoutRender, generations);
  }

  private async restoreLegacyThumbnails(
    manifest: z.infer<typeof generationManifestSchema>,
  ) {
    const thumbnailDirectory = path.join(
      this.projectRoot,
      'assets',
      'generation-thumbnails',
    );
    await mkdir(thumbnailDirectory, { recursive: true });
    const assetsRoot = await realpath(path.join(this.projectRoot, 'assets'));
    const resolvedThumbnailDirectory = await realpath(thumbnailDirectory);
    const thumbnailDirectoryRelative = path.relative(
      assetsRoot,
      resolvedThumbnailDirectory,
    );
    if (
      thumbnailDirectoryRelative !== 'generation-thumbnails' ||
      path.isAbsolute(thumbnailDirectoryRelative)
    ) {
      throw new ReferenceInputError(
        'generation thumbnail 경로가 프로젝트 assets 내부가 아닙니다.',
      );
    }

    const generations = [...manifest.generations];
    const cleanupPaths: string[] = [];
    let changed = false;
    try {
      for (const [index, generation] of generations.entries()) {
        const result = generation.result;
        if (result === null) continue;
        const storedThumbnail = result.thumbnail;
        if (storedThumbnail !== null) {
          if (storedThumbnail.sourceContentHash !== result.contentHash) {
            throw new ReferenceInputError(
              'generation thumbnail source 해시가 원본과 일치하지 않습니다.',
            );
          }
          if (
            storedThumbnail.assetPath !==
            `generation-thumbnails/${storedThumbnail.artifactId}.webp`
          ) {
            throw new ReferenceInputError(
              'generation thumbnail 경로 또는 artifact ID가 올바르지 않습니다.',
            );
          }
          try {
            const existingPath = await resolveProjectArtifact(
              this.projectRoot,
              storedThumbnail.assetPath,
            );
            const existing = await readFile(existingPath);
            if (sha256(existing) !== storedThumbnail.contentHash) {
              throw new ReferenceInputError(
                'generation thumbnail 해시가 저장 metadata와 일치하지 않습니다.',
              );
            }
            const existingMetadata = await sharp(existing).metadata();
            if (
              existingMetadata.format !== 'webp' ||
              existingMetadata.width !== storedThumbnail.width ||
              existingMetadata.height !== storedThumbnail.height ||
              existing.byteLength !== storedThumbnail.byteLength
            ) {
              throw new ReferenceInputError(
                'generation thumbnail 이미지 metadata가 일치하지 않습니다.',
              );
            }
            continue;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }

        const originalPath = await resolveProjectArtifact(
          this.projectRoot,
          result.assetPath,
        );
        const original = await readFile(originalPath);
        const metadata = inspectImage(original);
        if (
          sha256(original) !== result.contentHash ||
          metadata.mimeType !== result.mimeType ||
          metadata.width !== result.width ||
          metadata.height !== result.height ||
          original.byteLength !== result.byteLength
        ) {
          throw new ReferenceInputError(
            'legacy generation 원본의 해시 또는 이미지 metadata가 일치하지 않습니다.',
          );
        }
        const thumbnailOutput = await sharp(original)
          .rotate()
          .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer({ resolveWithObject: true });
        const artifactId =
          storedThumbnail?.artifactId ?? `artifact_${randomUUID()}`;
        const assetPath = `generation-thumbnails/${artifactId}.webp`;
        const destination = path.join(thumbnailDirectory, `${artifactId}.webp`);
        const temporary = `${destination}.${randomUUID()}.tmp`;
        cleanupPaths.push(temporary, destination);
        await this.writeThumbnailFile(temporary, thumbnailOutput.data);
        await rename(temporary, destination);
        generations[index] = generationSchema.parse({
          ...generation,
          result: {
            ...result,
            thumbnail: {
              policyVersion: 1,
              artifactId,
              assetPath,
              sourceContentHash: result.contentHash,
              contentHash: sha256(thumbnailOutput.data),
              mimeType: 'image/webp',
              width: thumbnailOutput.info.width,
              height: thumbnailOutput.info.height,
              byteLength: thumbnailOutput.data.byteLength,
            },
          },
        });
        changed = true;
      }
      if (!changed) return manifest;
      const repaired = { ...manifest, generations };
      await this.writeManifest(repaired);
      return repaired;
    } catch (error) {
      await Promise.all(
        cleanupPaths.map((filePath) => unlink(filePath).catch(() => undefined)),
      );
      throw error;
    }
  }

  private async readManifest() {
    const manifestPath = path.join(this.projectRoot, 'generations.json');
    try {
      return generationManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return EMPTY_MANIFEST;
      throw error;
    }
  }

  private async writeManifest(
    manifest: z.infer<typeof generationManifestSchema>,
  ) {
    const parsed = generationManifestSchema.parse(manifest);
    const manifestPath = path.join(this.projectRoot, 'generations.json');
    const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
    await writeFile(temporaryPath, serialized, {
      flag: 'wx',
    });
    try {
      await rename(temporaryPath, manifestPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'EEXIST') {
        try {
          await writeFile(manifestPath, serialized);
          await unlink(temporaryPath).catch(() => undefined);
          return;
        } catch {
          // Preserve the original rename failure below.
        }
      }
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
