// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationStore } from './conversationStore';

const tempRoots: string[] = [];

async function createStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'i2v-conversation-store-'));
  tempRoots.push(root);
  return { root, store: new ConversationStore(root) };
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('ConversationStore', () => {
  it('active task와 제한된 turn 요약 metadata를 재시작 뒤 복원한다', async () => {
    const { root, store } = await createStore();
    await expect(store.getSession()).resolves.toEqual({
      version: 1,
      activeTask: null,
      archivedTaskCount: 0,
    });

    await store.activateThread('thread-1', 'new');
    await store.recordTurnStarted('thread-1', 'turn-1', {
      kind: 'conversation',
      userMessage: '  노란 오브젝트는   전봇대야.  ',
      sceneRevision: 12,
      specRevision: 7,
    });
    await store.recordAssistantSummary(
      'thread-1',
      'turn-1',
      '전봇대 의미를 장면에 반영할 변경안을 제안할게요.',
    );
    await store.recordTurnCompleted('thread-1', 'turn-1', 'completed');

    await expect(
      new ConversationStore(root).getGenerationIntent('thread-1'),
    ).resolves.toEqual({
      revision: 1,
      sourceTurnId: 'turn-1',
      userMessage: '노란 오브젝트는 전봇대야.',
      assistantSummary: '전봇대 의미를 장면에 반영할 변경안을 제안할게요.',
      sceneRevision: 12,
      specRevision: 7,
    });

    await expect(
      new ConversationStore(root).getSession(),
    ).resolves.toMatchObject({
      version: 1,
      archivedTaskCount: 0,
      activeTask: {
        threadId: 'thread-1',
        state: 'active',
        turnCount: 1,
        lastTurnId: 'turn-1',
        lastTurnKind: 'conversation',
        lastTurnStatus: 'completed',
        lastUserMessage: '노란 오브젝트는 전봇대야.',
        lastAssistantSummary:
          '전봇대 의미를 장면에 반영할 변경안을 제안할게요.',
        sceneRevision: 12,
        specRevision: 7,
      },
    });

    const manifest = JSON.parse(
      await readFile(path.join(root, 'conversations.json'), 'utf8'),
    ) as { version: number; tasks: unknown[] };
    expect(manifest).toMatchObject({ version: 1 });
    expect(manifest.tasks).toHaveLength(1);
  });

  it('새 task는 이전 task를 archive하고 stale turn 완료는 현재 요약을 바꾸지 않는다', async () => {
    const { store } = await createStore();
    await store.activateThread('thread-1', 'new');
    await store.recordTurnStarted('thread-1', 'turn-old', {
      kind: 'specPatch',
      userMessage: '장소를 바꿔줘',
      sceneRevision: 2,
      specRevision: 1,
    });
    await store.activateThread('thread-2', 'new');
    await store.recordTurnStarted('thread-2', 'turn-current', {
      kind: 'generation',
      userMessage: '현재 장면 이미지 생성',
      sceneRevision: 3,
      specRevision: 2,
    });
    await store.recordAssistantSummary(
      'thread-2',
      'turn-stale',
      '무시해야 하는 응답',
    );
    await store.recordTurnCompleted('thread-2', 'turn-stale', 'failed');

    await expect(store.getSession()).resolves.toMatchObject({
      archivedTaskCount: 1,
      activeTask: {
        threadId: 'thread-2',
        turnCount: 1,
        lastTurnId: 'turn-current',
        lastTurnKind: 'generation',
        lastTurnStatus: 'inProgress',
        lastAssistantSummary: null,
      },
    });

    await store.activateThread('thread-1', 'resume');
    await expect(store.getSession()).resolves.toMatchObject({
      archivedTaskCount: 1,
      activeTask: {
        threadId: 'thread-1',
        turnCount: 1,
        lastUserMessage: '장소를 바꿔줘',
      },
    });
  });

  it('대화 첨부 번호를 안정적인 레퍼런스 ID와 역할로 정규화한다', async () => {
    const { store } = await createStore();
    await store.activateThread('thread-reference-intent', 'new');
    await store.recordTurnStarted(
      'thread-reference-intent',
      'turn-reference-intent',
      {
        kind: 'conversation',
        userMessage: '이미지 1의 배경을 더 강하게 적용해줘.',
        sceneRevision: 4,
        specRevision: 2,
        referenceBindings: [
          {
            conversationAttachmentIndex: 1,
            id: 'ref-background-corridor',
            name: '연습실 복도',
            role: 'background',
            targetObjectId: null,
            use: ['surface', 'lighting'],
            exclude: ['camera', 'text'],
          },
        ],
      },
    );
    await store.recordAssistantSummary(
      'thread-reference-intent',
      'turn-reference-intent',
      '이미지 1을 배경 전체에 강하게 적용하되 3D 구도는 유지합니다.',
    );
    await store.recordTurnCompleted(
      'thread-reference-intent',
      'turn-reference-intent',
      'completed',
    );

    await expect(
      store.getGenerationIntent('thread-reference-intent'),
    ).resolves.toMatchObject({
      userMessage:
        '레퍼런스 “연습실 복도” (background, id: ref-background-corridor)의 배경을 더 강하게 적용해줘.',
      assistantSummary:
        '레퍼런스 “연습실 복도” (background, id: ref-background-corridor)을 배경 전체에 강하게 적용하되 3D 구도는 유지합니다.',
      referenceBindings: [
        {
          conversationAttachmentIndex: 1,
          id: 'ref-background-corridor',
          role: 'background',
        },
      ],
    });
  });

  it('Companion 재시작에서 마지막 in-progress turn을 interrupted로 복구한다', async () => {
    const { root, store } = await createStore();
    await store.activateThread('thread-restart', 'new');
    await store.recordTurnStarted('thread-restart', 'turn-orphan', {
      kind: 'conversation',
      userMessage: '완료 전에 Companion 종료',
      sceneRevision: 1,
      specRevision: 1,
    });

    const restarted = new ConversationStore(root);
    await expect(restarted.recoverInProgressTask()).resolves.toMatchObject({
      activeTask: {
        threadId: 'thread-restart',
        lastTurnId: 'turn-orphan',
        lastTurnStatus: 'interrupted',
      },
    });
    await expect(restarted.recoverInProgressTask()).resolves.toMatchObject({
      activeTask: { lastTurnStatus: 'interrupted' },
    });
  });
});
