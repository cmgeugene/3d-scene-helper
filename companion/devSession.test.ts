import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCompanionDevSession,
  companionDevSessionPath,
  writeCompanionDevSession,
} from './devSession';

describe('companion dev session file', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('writes a loopback session and clears it on shutdown', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'i2v-dev-session-'));
    dirs.push(root);
    const sessionPath = companionDevSessionPath(root);

    await writeCompanionDevSession(root, {
      url: 'http://127.0.0.1:59990',
      token: 'd'.repeat(43),
    });

    expect(JSON.parse(await readFile(sessionPath, 'utf8'))).toEqual({
      version: 1,
      url: 'http://127.0.0.1:59990',
      token: 'd'.repeat(43),
    });

    await clearCompanionDevSession(root);
    await expect(readFile(sessionPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
