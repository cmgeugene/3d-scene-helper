// @vitest-environment node

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { browserOpenCommand, openBrowser } from './browserLauncher';

describe('browser launcher', () => {
  it('운영체제별 기본 브라우저 명령을 shell interpolation 없이 만든다', () => {
    const url = 'http://127.0.0.1:5173/#companion=safe-value';
    expect(browserOpenCommand(url, 'darwin')).toEqual({
      command: 'open',
      args: [url],
    });
    expect(browserOpenCommand(url, 'linux')).toEqual({
      command: 'xdg-open',
      args: [url],
    });
    expect(browserOpenCommand(url, 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', url],
    });
  });

  it('detached browser process를 시작하고 부모 lifecycle에서 분리한다', async () => {
    const child = new EventEmitter() as ChildProcess;
    child.unref = vi.fn();
    const spawnBrowser = vi.fn(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });

    await openBrowser(
      'http://127.0.0.1:5173/#companion=value',
      spawnBrowser,
      'darwin',
    );
    expect(spawnBrowser).toHaveBeenCalledWith(
      'open',
      ['http://127.0.0.1:5173/#companion=value'],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
