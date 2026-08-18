// @vitest-environment node

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createThreadStartGate,
  withMissingRolloutRetry,
} from './threadStartGate';
import type { JsonRpcNotification } from './jsonRpcPeer';

class FakeRuntime extends EventEmitter {
  emitNotification(notification: JsonRpcNotification) {
    this.emit('notification', notification);
  }
}

describe('createThreadStartGate', () => {
  it('matching thread/started가 올 때까지 wait를 끝내지 않는다', async () => {
    const runtime = new FakeRuntime();
    const gate = createThreadStartGate(runtime);
    const pending = gate.wait('thread-new', 200);

    const premature = await Promise.race([
      pending.then(() => 'resolved'),
      new Promise<'pending'>((resolve) => {
        setTimeout(() => resolve('pending'), 40);
      }),
    ]);
    expect(premature).toBe('pending');

    runtime.emitNotification({
      method: 'thread/started',
      params: { thread: { id: 'thread-new' } },
    });
    await expect(pending).resolves.toBeUndefined();
    gate.dispose();
  });
});

describe('withMissingRolloutRetry', () => {
  it('no rollout 오류가 나면 turn/start를 다시 시도한다', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withMissingRolloutRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('no rollout for thread id thread-new');
        }
        return 'turn-1';
      },
      {
        attempts: 4,
        delayMs: 25,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe('turn-1');
    expect(attempts).toBe(3);
    expect(delays).toEqual([25, 50]);
  });

  it('rollout과 무관한 오류는 다시 시도하지 않는다', async () => {
    let attempts = 0;
    await expect(
      withMissingRolloutRetry(async () => {
        attempts += 1;
        throw new Error('permission denied');
      }),
    ).rejects.toThrow('permission denied');
    expect(attempts).toBe(1);
  });
});
