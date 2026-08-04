import { z } from 'zod';

export const contentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const hashedSnapshotSchema = z.object({
  contentHash: contentHashSchema,
});

export const generationExecutionSummarySchema = z.object({
  version: z.literal(1),
  requestId: z.string().min(1).nullable(),
  prompt: hashedSnapshotSchema,
  sceneDocument: hashedSnapshotSchema.extend({
    id: z.string().min(1),
    sceneRevision: z.number().int().nonnegative(),
    specRevision: z.number().int().nonnegative(),
  }),
  semanticSceneSpec: hashedSnapshotSchema.extend({
    version: z.literal(1),
  }),
  layoutSpec: hashedSnapshotSchema.extend({
    version: z.literal(1),
    sceneId: z.string().min(1),
  }),
  layoutRender: hashedSnapshotSchema.extend({
    id: z.string().min(1),
    sceneId: z.string().min(1),
  }),
  sourceGeneration: z
    .object({
      id: z.string().min(1),
      usage: z.enum(['editSource', 'sceneSnapshotSource']),
      contentHash: contentHashSchema.nullable(),
    })
    .nullable(),
  references: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(['layout', 'background', 'character', 'style']),
      contentHash: contentHashSchema,
    }),
  ),
  attachments: z.array(
    z.object({
      attachmentIndex: z.number().int().positive(),
      type: z.enum(['layout', 'reference', 'sourceGeneration']),
      id: z.string().min(1),
      kind: z.enum(['layout', 'background', 'character', 'style']).nullable(),
      contentHash: contentHashSchema.nullable(),
    }),
  ),
});

export const generationExecutionIntegritySchema = z.object({
  status: z.enum(['valid', 'legacy', 'mismatch']),
  issues: z.array(z.string()),
});

export type GenerationExecutionSummary = z.infer<
  typeof generationExecutionSummarySchema
>;
export type GenerationExecutionIntegrity = z.infer<
  typeof generationExecutionIntegritySchema
>;
