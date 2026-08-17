// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireCompanionInstanceLock } from './instanceLock';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'companion-lock-'));
  roots.push(root);
  return root;
}

describe('Companion instance lock', () => {
  it('같은 프로젝트의 살아 있는 Companion 중복 실행을 차단하고 소유자만 해제한다', async () => {
    const root = await createRoot();
    const lock = await acquireCompanionInstanceLock(root);
    await lock.updateUrl('http://127.0.0.1:61234');

    await expect(acquireCompanionInstanceLock(root)).rejects.toMatchObject({
      name: 'Error',
      message: expect.stringContaining('이미 실행 중'),
      descriptor: { pid: process.pid, url: 'http://127.0.0.1:61234' },
    });
    await lock.release();
    await expect(
      readFile(path.join(root, '.i2v-companion.lock'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('죽은 pid와 malformed stale lock을 교체한다', async () => {
    const root = await createRoot();
    const lockPath = path.join(root, '.i2v-companion.lock');
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        nonce: '5841f5ff-f079-4cb2-b870-2e19167f5e6a',
        startedAt: '2026-08-04T00:00:00.000Z',
        url: null,
      }),
    );
    const staleRecovered = await acquireCompanionInstanceLock(root);
    expect(staleRecovered.descriptor.pid).toBe(process.pid);
    await staleRecovered.release();

    await writeFile(lockPath, '{malformed');
    const malformedRecovered = await acquireCompanionInstanceLock(root);
    expect(malformedRecovered.descriptor.nonce).toEqual(expect.any(String));
    await malformedRecovered.release();
  });

  it('다른 process가 교체한 lock을 갱신하거나 해제하지 않는다', async () => {
    const root = await createRoot();
    const lockPath = path.join(root, '.i2v-companion.lock');
    const lock = await acquireCompanionInstanceLock(root);
    const replacement = {
      version: 1,
      pid: process.pid,
      nonce: randomUUID(),
      startedAt: new Date().toISOString(),
      url: 'http://127.0.0.1:62345',
    };
    await writeFile(lockPath, JSON.stringify(replacement));

    await expect(lock.updateUrl('http://127.0.0.1:61234')).rejects.toThrow(
      'lock 소유권이 변경되었습니다',
    );
    await lock.release();
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toEqual(replacement);
  });
});
