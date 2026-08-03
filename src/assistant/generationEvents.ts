import { z } from 'zod';
import {
  generationRecordSchema,
  type CompanionEvent,
  type GenerationRecord,
} from './companionClient';

const generationErrorSchema = z.object({
  turnId: z.string().nullable(),
  error: z.string(),
});

export type GenerationUpdate =
  | { type: 'record'; generation: GenerationRecord }
  | { type: 'error'; turnId: string | null; error: string };

export function parseGenerationUpdate(
  event: CompanionEvent,
): GenerationUpdate | null {
  if (event.event === 'generation') {
    const parsed = generationRecordSchema.safeParse(event.data);
    return parsed.success ? { type: 'record', generation: parsed.data } : null;
  }
  if (event.event === 'generation-error') {
    const parsed = generationErrorSchema.safeParse(event.data);
    return parsed.success ? { type: 'error', ...parsed.data } : null;
  }
  return null;
}
