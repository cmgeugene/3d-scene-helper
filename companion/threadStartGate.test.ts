// @vitest-environment node

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createThreadStartGate } from './threadStartGate';
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
