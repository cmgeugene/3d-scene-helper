import { describe, expect, it } from 'vitest';
import { parseConversationUpdate } from './conversationEvents';

describe('parseConversationUpdate', () => {
  it('agent message delta를 대화 업데이트로 변환한다', () => {
    expect(
      parseConversationUpdate({
        event: 'codex',
        data: {
          method: 'item/agentMessage/delta',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'item-1',
            delta: '장면의 전경에는 ',
          },
        },
      }),
    ).toEqual({
      type: 'agent-delta',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      delta: '장면의 전경에는 ',
    });
  });

  it('turn 완료 상태와 오류 메시지를 정규화한다', () => {
    expect(
      parseConversationUpdate({
        event: 'codex',
        data: {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: {
              id: 'turn-1',
              status: 'failed',
              error: { message: '사용 한도를 확인해 주세요.' },
            },
          },
        },
      }),
    ).toEqual({
      type: 'turn-completed',
      threadId: 'thread-1',
      turnId: 'turn-1',
      status: 'failed',
      error: '사용 한도를 확인해 주세요.',
    });
  });
});
