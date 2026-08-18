import type { JsonRpcNotification } from './jsonRpcPeer';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function threadIdFromStartedNotification(
  notification: JsonRpcNotification,
): string | null {
  if (notification.method !== 'thread/started') return null;
  if (!isRecord(notification.params)) return null;
  if (typeof notification.params.threadId === 'string') {
    return notification.params.threadId;
  }
  const thread = notification.params.thread;
  if (isRecord(thread) && typeof thread.id === 'string') return thread.id;
  return null;
}

export function createThreadStartGate(runtime: {
  on(
    event: 'notification',
    listener: (value: JsonRpcNotification) => void,
  ): unknown;
  off(
    event: 'notification',
    listener: (value: JsonRpcNotification) => void,
  ): unknown;
}) {
  const seen = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  const handle = (notification: JsonRpcNotification) => {
    const threadId = threadIdFromStartedNotification(notification);
    if (threadId === null) return;
    seen.add(threadId);
    const pending = waiters.get(threadId) ?? [];
    waiters.delete(threadId);
    for (const resolve of pending) resolve();
  };
  runtime.on('notification', handle);
  return {
    wait(threadId: string, timeoutMs = 10_000) {
      if (seen.has(threadId)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const remaining = (waiters.get(threadId) ?? []).filter(
            (fn) => fn !== onReady,
          );
          if (remaining.length === 0) waiters.delete(threadId);
          else waiters.set(threadId, remaining);
          reject(new Error('Codex thread가 아직 준비되지 않았습니다.'));
        }, timeoutMs);
        const onReady = () => {
          clearTimeout(timer);
          resolve();
        };
        const queued = waiters.get(threadId) ?? [];
        queued.push(onReady);
        waiters.set(threadId, queued);
      });
    },
    dispose() {
      runtime.off('notification', handle);
    },
  };
}

export function isMissingRolloutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no rollout/i.test(message);
}

export async function withMissingRolloutRetry<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 200;
  const sleep =
    options.sleep ??
    (async (ms: number) => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    });
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isMissingRolloutError(error) || attempt === attempts) {
        throw error;
      }
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}
