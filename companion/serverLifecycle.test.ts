// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { CodexRuntime } from './appServerClient';
import type { CompanionServerHandle } from './server';
import { startCompanionServerWithPortFallback } from './serverLifecycle';

const runtime = {} as CodexRuntime;
const handle = {
  token: 'token',
  url: 'http://127.0.0.1:62000',
  close: async () => undefined,
} satisfies CompanionServerHandle;

describe('Companion server lifecycle', () => {
  it('지정 포트 충돌 시 임시 loopback 포트로 한 번만 fallback한다', async () => {
    const conflict = Object.assign(new Error('address in use'), {
      code: 'EADDRINUSE',
    });
    const start = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(handle);

    await expect(
      startCompanionServerWithPortFallback(
        {
          runtime,
          projectRoot: '/project',
          allowedOrigins: ['http://127.0.0.1:5173'],
          port: 61234,
        },
        start,
      ),
    ).resolves.toEqual({
      server: handle,
      requestedPort: 61234,
      usedFallbackPort: true,
    });
    expect(start).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ port: 0 }),
    );
  });

  it('strict port 또는 포트 충돌이 아닌 오류는 그대로 전달한다', async () => {
    const conflict = Object.assign(new Error('address in use'), {
      code: 'EADDRINUSE',
    });
    await expect(
      startCompanionServerWithPortFallback(
        {
          runtime,
          projectRoot: '/project',
          allowedOrigins: [],
          port: 61234,
          fallbackOnPortConflict: false,
        },
        vi.fn().mockRejectedValue(conflict),
      ),
    ).rejects.toBe(conflict);

    const denied = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    await expect(
      startCompanionServerWithPortFallback(
        {
          runtime,
          projectRoot: '/project',
          allowedOrigins: [],
          port: 61234,
        },
        vi.fn().mockRejectedValue(denied),
      ),
    ).rejects.toBe(denied);
  });
});
