import { z } from 'zod';
import type { CompanionEvent } from './companionClient';

const envelopeSchema = z.object({
  method: z.string(),
  params: z.unknown(),
});

const agentDeltaSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  delta: z.string(),
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

const turnCompletedSchema = z.object({
  threadId: z.string(),
  turn: z.object({
    id: z.string(),
    status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
    error: z
      .object({
        message: z.string(),
      })
      .nullable(),
  }),
});

const turnErrorSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  error: z.object({ message: z.string() }),
  willRetry: z.boolean(),
});

export type ConversationUpdate =
  | {
      type: 'agent-delta';
      threadId: string;
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: 'agent-completed';
      threadId: string;
      turnId: string;
      itemId: string;
      text: string;
    }
  | {
      type: 'turn-completed';
      threadId: string;
      turnId: string;
      status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
      error: string | null;
    }
  | {
      type: 'turn-error';
      threadId: string;
      turnId: string;
      error: string;
      willRetry: boolean;
    };

export function parseConversationUpdate(
  event: CompanionEvent,
): ConversationUpdate | null {
  if (event.event !== 'codex') return null;
  const envelope = envelopeSchema.safeParse(event.data);
  if (!envelope.success) return null;

  if (envelope.data.method === 'item/agentMessage/delta') {
    const parsed = agentDeltaSchema.safeParse(envelope.data.params);
    return parsed.success ? { type: 'agent-delta', ...parsed.data } : null;
  }

  if (envelope.data.method === 'item/completed') {
    const parsed = completedAgentMessageSchema.safeParse(envelope.data.params);
    if (!parsed.success) return null;
    return {
      type: 'agent-completed',
      threadId: parsed.data.threadId,
      turnId: parsed.data.turnId,
      itemId: parsed.data.item.id,
      text: parsed.data.item.text,
    };
  }

  if (envelope.data.method === 'turn/completed') {
    const parsed = turnCompletedSchema.safeParse(envelope.data.params);
    if (!parsed.success) return null;
    return {
      type: 'turn-completed',
      threadId: parsed.data.threadId,
      turnId: parsed.data.turn.id,
      status: parsed.data.turn.status,
      error: parsed.data.turn.error?.message ?? null,
    };
  }

  if (envelope.data.method === 'error') {
    const parsed = turnErrorSchema.safeParse(envelope.data.params);
    if (!parsed.success) return null;
    return {
      type: 'turn-error',
      threadId: parsed.data.threadId,
      turnId: parsed.data.turnId,
      error: parsed.data.error.message,
      willRetry: parsed.data.willRetry,
    };
  }

  return null;
}
