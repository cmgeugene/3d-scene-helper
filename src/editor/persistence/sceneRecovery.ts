import { z } from 'zod';
import { STORAGE_NAMESPACE } from '../constants';
import {
  SceneStorageError,
  parseSceneDocument,
  saveSceneDocument,
} from './sceneCodec';
import { type SceneDocument } from './sceneSchema';

export const PRE_APPLY_RECOVERY_STORAGE_KEY = `${STORAGE_NAMESPACE}:pre-apply-recovery:v1`;

const preApplyRecoveryEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  document: z.unknown(),
  selectedObjectId: z.string().min(1).nullable(),
  targetGenerationId: z.string().min(1),
  targetVersionNumber: z.number().int().positive(),
  savedAt: z.string().datetime(),
});

export interface PreApplySceneRecovery {
  document: SceneDocument;
  selectedObjectId: string | null;
  targetGenerationId: string;
  targetVersionNumber: number;
  savedAt: string;
}

export interface SaveSceneBeforeGenerationApplyInput {
  document: SceneDocument;
  selectedObjectId: string | null;
  targetGenerationId: string;
  targetVersionNumber: number;
}

function restorePreviousRecovery(storage: Storage, previous: string | null) {
  if (previous === null) {
    storage.removeItem(PRE_APPLY_RECOVERY_STORAGE_KEY);
  } else {
    storage.setItem(PRE_APPLY_RECOVERY_STORAGE_KEY, previous);
  }
}

export function saveSceneBeforeGenerationApply(
  storage: Storage,
  input: SaveSceneBeforeGenerationApplyInput,
): PreApplySceneRecovery {
  const recovery: PreApplySceneRecovery = {
    document: input.document,
    selectedObjectId: input.selectedObjectId,
    targetGenerationId: input.targetGenerationId,
    targetVersionNumber: input.targetVersionNumber,
    savedAt: new Date().toISOString(),
  };
  const serializedRecovery = JSON.stringify({ version: 1, ...recovery });
  let previousRecovery: string | null;
  try {
    previousRecovery = storage.getItem(PRE_APPLY_RECOVERY_STORAGE_KEY);
    storage.setItem(PRE_APPLY_RECOVERY_STORAGE_KEY, serializedRecovery);
  } catch (error) {
    throw new SceneStorageError(
      '적용 전 복구 지점을 브라우저에 저장하지 못했습니다. 현재 씬은 변경하지 않았습니다.',
      { cause: error },
    );
  }

  try {
    saveSceneDocument(storage, input.document);
  } catch (error) {
    try {
      restorePreviousRecovery(storage, previousRecovery);
    } catch (rollbackError) {
      throw new SceneStorageError(
        '현재 씬 저장에 실패했고 복구 지점 롤백도 완료하지 못했습니다. 현재 씬은 변경하지 않았습니다.',
        { cause: new AggregateError([error, rollbackError]) },
      );
    }
    throw error;
  }

  return recovery;
}

export function loadPreApplySceneRecovery(
  storage: Storage,
): PreApplySceneRecovery | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(PRE_APPLY_RECOVERY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (serialized === null) return null;

  try {
    const envelope = preApplyRecoveryEnvelopeSchema.parse(
      JSON.parse(serialized),
    );
    const document = parseSceneDocument(JSON.stringify(envelope.document));
    const selectedObjectId = document.objects.some(
      ({ id }) => id === envelope.selectedObjectId,
    )
      ? envelope.selectedObjectId
      : null;
    return {
      document,
      selectedObjectId,
      targetGenerationId: envelope.targetGenerationId,
      targetVersionNumber: envelope.targetVersionNumber,
      savedAt: envelope.savedAt,
    };
  } catch {
    return null;
  }
}
