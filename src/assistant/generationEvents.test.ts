import { describe, expect, it } from 'vitest';
import { parseGenerationUpdate } from './generationEvents';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';

const generation = {
  id: 'generation-1',
  threadId: 'thread-1',
  turnId: 'turn-1',
  status: 'inProgress' as const,
  prompt: '$imagegen test',
  layoutSpec: TEST_LAYOUT_SPEC,
  sceneSnapshot: null,
  semanticSceneSpecSnapshot: null,
  referenceSnapshots: [],
  parentGenerationId: null,
  versionNumber: 1,
  feedback: null,
  refinementDirective: null,
  generationMode: 'fresh' as const,
  layoutRenderId: 'render-1',
  referenceIds: [],
  attachments: [
    { type: 'layout' as const, id: 'render-1', kind: 'layout' as const },
  ],
  revisedPrompt: null,
  result: null,
  error: null,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

describe('parseGenerationUpdate', () => {
  it('생성 기록 SSE를 검증한다', () => {
    expect(
      parseGenerationUpdate({ event: 'generation', data: generation }),
    ).toEqual({
      type: 'record',
      generation,
    });
  });

  it('생성 오류와 무관한 이벤트를 구분한다', () => {
    expect(
      parseGenerationUpdate({
        event: 'generation-error',
        data: { turnId: 'turn-1', error: 'import failed' },
      }),
    ).toEqual({ type: 'error', turnId: 'turn-1', error: 'import failed' });
    expect(parseGenerationUpdate({ event: 'codex', data: {} })).toBeNull();
  });
});
