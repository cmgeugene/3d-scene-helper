import { describe, expect, it } from 'vitest';
import {
  clearSceneAssistantThread,
  readSceneAssistantThread,
  storeSceneAssistantThread,
} from './conversationSession';

describe('scene assistant thread session', () => {
  it('현재 탭 storage에 thread ID를 보관하고 지운다', () => {
    sessionStorage.clear();

    expect(readSceneAssistantThread()).toBeNull();
    storeSceneAssistantThread('thread-1');
    expect(readSceneAssistantThread()).toBe('thread-1');
    clearSceneAssistantThread();
    expect(readSceneAssistantThread()).toBeNull();
  });
});
