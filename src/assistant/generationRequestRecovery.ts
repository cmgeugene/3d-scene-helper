import { z } from 'zod';
import {
  startGenerationInputSchema,
  type NormalizedStartGenerationInput,
} from './companionClient';

export const GENERATION_REQUEST_RECOVERY_STORAGE_KEY =
  'i2v.generation-request.recovery.v1';

const generationRequestRecoverySchema = z.strictObject({
  version: z.literal(1),
  savedAt: z.string().datetime(),
  input: startGenerationInputSchema,
});

export interface GenerationRequestRecovery {
  version: 1;
  savedAt: string;
  input: NormalizedStartGenerationInput;
}

export function readGenerationRequestRecovery(
  storage: Storage,
): GenerationRequestRecovery | null {
  try {
    const serialized = storage.getItem(GENERATION_REQUEST_RECOVERY_STORAGE_KEY);
    if (serialized === null) return null;
    const parsed = generationRequestRecoverySchema.safeParse(
      JSON.parse(serialized) as unknown,
    );
    if (!parsed.success) {
      storage.removeItem(GENERATION_REQUEST_RECOVERY_STORAGE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    try {
      storage.removeItem(GENERATION_REQUEST_RECOVERY_STORAGE_KEY);
    } catch {
      // Unavailable storage is equivalent to no recoverable request.
    }
    return null;
  }
}

export function storeGenerationRequestRecovery(
  storage: Storage,
  input: NormalizedStartGenerationInput,
) {
  const recovery = generationRequestRecoverySchema.parse({
    version: 1,
    savedAt: new Date().toISOString(),
    input,
  });
  try {
    storage.setItem(
      GENERATION_REQUEST_RECOVERY_STORAGE_KEY,
      JSON.stringify(recovery),
    );
  } catch {
    // Recovery persistence is best-effort. Server idempotency remains active.
  }
  return recovery;
}

export function clearGenerationRequestRecovery(storage: Storage) {
  try {
    storage.removeItem(GENERATION_REQUEST_RECOVERY_STORAGE_KEY);
  } catch {
    // Recovery cleanup must not break the generation flow.
  }
}
