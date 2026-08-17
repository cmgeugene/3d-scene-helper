import { z } from 'zod';

export const runtimeRequestStatusSchema = z.enum([
  'pending',
  'approved',
  'declined',
  'answered',
  'cancelled',
  'expired',
]);

export const runtimeRequestOptionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500),
});

export const runtimeRequestQuestionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  header: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(1_000),
  isOther: z.boolean(),
  isSecret: z.boolean(),
  options: z.array(runtimeRequestOptionSchema).max(12).nullable(),
});

export const runtimeRequestSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['commandApproval', 'fileChangeApproval', 'userInput']),
  method: z.enum([
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/tool/requestUserInput',
  ]),
  threadId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
  status: runtimeRequestStatusSchema,
  title: z.string().min(1).max(200),
  reason: z.string().max(1_000).nullable(),
  impact: z.string().min(1).max(4_000),
  cwd: z.string().max(2_000).nullable(),
  questions: z.array(runtimeRequestQuestionSchema).max(3),
  autoResolutionMs: z.number().int().min(60_000).max(240_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export const runtimeRequestListSchema = z.object({
  version: z.literal(1),
  requests: z.array(runtimeRequestSchema).max(50),
});

export const runtimeRequestResponseSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['approve', 'decline']),
  }),
  z.object({
    action: z.literal('answer'),
    answers: z
      .record(z.string().min(1).max(100), z.array(z.string().max(4_000)).max(8))
      .refine((answers) => Object.keys(answers).length > 0, {
        message: 'at least one answer is required',
      }),
  }),
]);

export type RuntimeRequest = z.infer<typeof runtimeRequestSchema>;
export type RuntimeRequestList = z.infer<typeof runtimeRequestListSchema>;
export type RuntimeRequestResponse = z.infer<
  typeof runtimeRequestResponseSchema
>;
