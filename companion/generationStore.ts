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
import { z } from 'zod';
import { layoutSpecSchema, type LayoutSpec } from '../shared/layoutSpecSchema';
import {
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
import { generationPromptEvidence } from '../shared/generationPromptEvidence';
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
    layoutSpec: layoutSpecSchema.nullable().default(null),
    sceneSnapshot: sceneDocumentSchema.nullable().default(null),
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
            const { assetPath, ...publicResult } = generation.result;
            void assetPath;
            return publicResult;
          })(),
  };
}

export class GenerationStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly projectRoot: string) {}

  async listGenerations() {
    const manifest = await this.readManifest();
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
  ) {
    return this.mutate(() =>
      this.importGenerationResultInternal(turnId, savedPath, revisedPrompt),
    );
  }

  completeTurn(
    turnId: string,
    status: 'completed' | 'failed' | 'interrupted',
    error: string | null,
  ) {
    return this.mutate(() => this.completeTurnInternal(turnId, status, error));
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
    return {
      generation: toPublicGeneration(
        generation,
        manifest.sceneRenders.find(
          ({ id }) => id === generation.layoutRenderId,
        ),
        manifest.generations,
      ),
      data: await readFile(filePath),
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
    const directory = path.join(this.projectRoot, 'assets', 'generations');
    const destination = path.join(
      directory,
      `${artifactId}.${image.extension}`,
    );
    const result: GenerationRecord['result'] = {
      artifactId,
      assetPath,
      contentHash: sha256(data),
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      byteLength: data.byteLength,
    };
    const current = manifest.generations[index]!;
    const updated: GenerationRecord = {
      ...current,
      result,
      revisedPrompt,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(directory, { recursive: true });
    await writeFile(destination, data, { flag: 'wx' });
    const generations = [...manifest.generations];
    generations[index] = updated;
    try {
      await this.writeManifest({ ...manifest, generations });
    } catch (error) {
      await unlink(destination).catch(() => undefined);
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
