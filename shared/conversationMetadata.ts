import { z } from 'zod';

export const conversationTurnKindSchema = z.enum([
  'conversation',
  'specPatch',
  'generation',
]);

export const conversationTurnStatusSchema = z.enum([
  'inProgress',
  'completed',
  'failed',
  'interrupted',
]);

export const generationIntentSchema = z.object({
  revision: z.number().int().positive(),
  sourceTurnId: z.string().min(1),
  userMessage: z.string().max(500),
  assistantSummary: z.string().max(1_000),
  sceneRevision: z.number().int().nonnegative().nullable(),
  specRevision: z.number().int().nonnegative().nullable(),
});

export const conversationTaskMetadataSchema = z.object({
  threadId: z.string().min(1),
  state: z.enum(['active', 'archived']),
  turnCount: z.number().int().nonnegative(),
  lastTurnId: z.string().min(1).nullable(),
  lastTurnKind: conversationTurnKindSchema.nullable(),
  lastTurnStatus: conversationTurnStatusSchema.nullable(),
  lastUserMessage: z.string().max(500).nullable(),
  lastAssistantSummary: z.string().max(1_000).nullable(),
  sceneRevision: z.number().int().nonnegative().nullable(),
  specRevision: z.number().int().nonnegative().nullable(),
  generationIntent: generationIntentSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const conversationSessionSchema = z.object({
  version: z.literal(1),
  activeTask: conversationTaskMetadataSchema.nullable(),
  archivedTaskCount: z.number().int().nonnegative(),
});

export const conversationTurnMetadataInputSchema = z.object({
  kind: conversationTurnKindSchema,
  userMessage: z.string().trim().min(1).max(4_000),
  sceneRevision: z.number().int().nonnegative().nullable().default(null),
  specRevision: z.number().int().nonnegative().nullable().default(null),
});

export type ConversationTaskMetadata = z.infer<
  typeof conversationTaskMetadataSchema
>;
export type GenerationIntent = z.infer<typeof generationIntentSchema>;
export type ConversationSession = z.infer<typeof conversationSessionSchema>;
export type ConversationTurnMetadataInput = z.input<
  typeof conversationTurnMetadataInputSchema
>;
