import { z } from 'zod';
import {
  specPatchProposalSchema,
  type SpecPatchProposal,
} from '../editor/persistence/specPatchProposal';
import type { CompanionEvent } from './companionClient';

const proposalErrorSchema = z.strictObject({
  requestId: z.string().min(1).max(200),
  error: z.string().min(1).max(2_000),
});

export type SpecPatchProposalUpdate =
  | { type: 'proposal'; proposal: SpecPatchProposal }
  | { type: 'error'; requestId: string | null; error: string };

export function parseSpecPatchProposalUpdate(
  event: CompanionEvent,
): SpecPatchProposalUpdate | null {
  if (event.event === 'spec-patch-proposal') {
    const proposal = specPatchProposalSchema.safeParse(event.data);
    if (!proposal.success) {
      return {
        type: 'error',
        requestId: null,
        error: 'Companion 변경안이 browser schema 검증에 실패했습니다.',
      };
    }
    return { type: 'proposal', proposal: proposal.data };
  }
  if (event.event === 'spec-patch-proposal-error') {
    const error = proposalErrorSchema.safeParse(event.data);
    if (!error.success) {
      return {
        type: 'error',
        requestId: null,
        error: 'Companion 변경안 오류 payload가 schema 검증에 실패했습니다.',
      };
    }
    return { type: 'error', ...error.data };
  }
  return null;
}
