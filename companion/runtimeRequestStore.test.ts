// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeRequestStore } from './runtimeRequestStore';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-request-store-'));
  roots.push(root);
  return { root, store: new RuntimeRequestStore(root) };
}

describe('RuntimeRequestStore', () => {
  it('명령 승인 요청을 제한된 metadata로 저장하고 결정 상태를 남긴다', async () => {
    const { root, store } = await createStore();
    const request = await store.register({
      id: 19,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        command: 'npm run build',
        cwd: '/project',
        reason: 'production verification',
      },
    });

    expect(request).toMatchObject({
      kind: 'commandApproval',
      status: 'pending',
      impact: 'npm run build',
      cwd: '/project',
    });
    await expect(store.resolve(request!.id, 'approved')).resolves.toMatchObject(
      {
        status: 'approved',
        resolvedAt: expect.any(String),
      },
    );
    expect(
      await import('node:fs/promises').then(({ readFile }) =>
        readFile(path.join(root, 'runtime-requests.json'), 'utf8'),
      ),
    ).not.toContain('answers');
  });

  it('질문을 저장하지만 답변은 저장하지 않고 재시작 pending을 expired로 복구한다', async () => {
    const { root, store } = await createStore();
    const request = await store.register({
      id: 'rpc-question-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-2',
        itemId: 'item-2',
        autoResolutionMs: 60_000,
        questions: [
          {
            id: 'direction',
            header: '연출 방향',
            question: '어느 쪽을 선택할까요?',
            isOther: true,
            isSecret: false,
            options: [
              { label: '왼쪽', description: '왼쪽 구도를 사용합니다.' },
            ],
          },
        ],
      },
    });

    expect(request).toMatchObject({
      kind: 'userInput',
      autoResolutionMs: 60_000,
    });
    const restarted = new RuntimeRequestStore(root);
    await restarted.recoverPending();
    await expect(restarted.list()).resolves.toMatchObject({
      requests: [{ id: request!.id, status: 'expired' }],
    });
  });

  it('지원하지 않거나 잘못된 요청은 저장하지 않는다', async () => {
    const { store } = await createStore();
    await expect(
      store.register({ id: 1, method: 'currentTime/read', params: {} }),
    ).resolves.toBeNull();
    await expect(
      store.register({
        id: 2,
        method: 'item/fileChange/requestApproval',
        params: { threadId: 'thread-only' },
      }),
    ).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual({ version: 1, requests: [] });
  });
});
