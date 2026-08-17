import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const instanceLockSchema = z.object({
  version: z.literal(1),
  pid: z.number().int().positive(),
  nonce: z.string().uuid(),
  startedAt: z.string().datetime(),
  url: z.string().url().nullable(),
});

export type CompanionInstanceDescriptor = z.infer<typeof instanceLockSchema>;

export class CompanionAlreadyRunningError extends Error {
  constructor(readonly descriptor: CompanionInstanceDescriptor) {
    super(
      descriptor.url === null
        ? `이 프로젝트의 Companion이 이미 시작 중입니다 (pid ${descriptor.pid}).`
        : `이 프로젝트의 Companion이 이미 실행 중입니다: ${descriptor.url}`,
    );
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface CompanionInstanceLock {
  readonly path: string;
  readonly descriptor: CompanionInstanceDescriptor;
  updateUrl(url: string): Promise<void>;
  release(): Promise<void>;
}

export async function acquireCompanionInstanceLock(
  projectRoot: string,
): Promise<CompanionInstanceLock> {
  const lockPath = path.join(path.resolve(projectRoot), '.i2v-companion.lock');
  const descriptor = instanceLockSchema.parse({
    version: 1,
    pid: process.pid,
    nonce: randomUUID(),
    startedAt: new Date().toISOString(),
    url: null,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath, `${JSON.stringify(descriptor, null, 2)}\n`, {
        flag: 'wx',
      });
      let current = descriptor;
      return {
        path: lockPath,
        get descriptor() {
          return current;
        },
        async updateUrl(url: string) {
          const stored = instanceLockSchema.parse(
            JSON.parse(await readFile(lockPath, 'utf8')) as unknown,
          );
          if (stored.nonce !== current.nonce) {
            throw new Error('프로젝트 Companion lock 소유권이 변경되었습니다.');
          }
          const next = instanceLockSchema.parse({ ...current, url });
          await writeFile(lockPath, `${JSON.stringify(next, null, 2)}\n`, {
            flag: 'w',
          });
          current = next;
        },
        async release() {
          try {
            const stored = instanceLockSchema.parse(
              JSON.parse(await readFile(lockPath, 'utf8')) as unknown,
            );
            if (stored.nonce !== current.nonce) return;
            await unlink(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let existing: CompanionInstanceDescriptor | null = null;
      try {
        existing = instanceLockSchema.parse(
          JSON.parse(await readFile(lockPath, 'utf8')) as unknown,
        );
      } catch {
        // Malformed lock files are treated as stale and replaced below.
      }
      if (existing !== null && processIsAlive(existing.pid)) {
        throw new CompanionAlreadyRunningError(existing);
      }
      await unlink(lockPath).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw unlinkError;
        }
      });
    }
  }

  throw new Error('프로젝트 Companion lock을 획득하지 못했습니다.');
}
