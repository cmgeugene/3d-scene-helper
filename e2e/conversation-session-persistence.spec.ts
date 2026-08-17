import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type {
  AppServerStatus,
  CodexRuntime,
  TurnInput,
} from '../companion/appServerClient';
import {
  startCompanionServer,
  type CompanionServerHandle,
} from '../companion/server';

const token = 'e2e-conversation-session-token-'.padEnd(43, 'x');

class ConversationRuntime extends EventEmitter implements CodexRuntime {
  readonly status: AppServerStatus = {
    state: 'ready',
    version: 'codex-conversation-session-e2e',
    account: { type: 'chatgpt', email: null, planType: 'plus' },
    requiresOpenaiAuth: true,
    capabilities: {
      namespaceTools: true,
      imageGeneration: true,
      webSearch: true,
    },
    error: null,
  };
  readonly startedThreads: string[] = [];
  readonly resumedThreads: string[] = [];
  readonly startedTurns: Array<{
    threadId: string;
    turnId: string;
    input: TurnInput[];
  }> = [];
  failResume = false;

  constructor(private readonly label: string) {
    super();
  }

  async start() {}
  async stop() {}
  async refreshAccount() {
    return this.status;
  }
  async startThread() {
    const threadId = `thread-${this.label}-${this.startedThreads.length + 1}`;
    this.startedThreads.push(threadId);
    return threadId;
  }
  async resumeThread(threadId: string) {
    this.resumedThreads.push(threadId);
    if (this.failResume) throw new Error('saved thread not found');
    return threadId;
  }
  async startTurn(threadId: string, input: TurnInput[]) {
    const turnId = `turn-${this.label}-${this.startedTurns.length + 1}`;
    this.startedTurns.push({ threadId, turnId, input });
    return turnId;
  }
  async interruptTurn() {}
}

test('프로젝트 task 요약을 명시적으로 재개하고 재시작·missing task에서 새 task로 복구한다', async ({
  page,
}) => {
  const projectRoot = await mkdtemp(
    path.join(tmpdir(), 'i2v-conversation-session-e2e-'),
  );
  let server: CompanionServerHandle | null = null;
  const runtime = new ConversationRuntime('initial');
  const browserProblems: string[] = [];
  page.on('pageerror', (error) =>
    browserProblems.push(`pageerror: ${error.message}`),
  );
  page.on('console', (message) => {
    const text = message.text();
    if (
      (message.type() === 'warning' &&
        (text.includes('THREE.Clock: This module has been deprecated') ||
          text.includes('GPU stall due to ReadPixels'))) ||
      (message.type() === 'error' &&
        (text.includes('net::ERR_FAILED') ||
          text.includes('net::ERR_INCOMPLETE_CHUNKED_ENCODING') ||
          text.includes('net::ERR_CONNECTION_REFUSED') ||
          text.includes('500 (Internal Server Error)')))
    ) {
      return;
    }
    if (message.type() === 'warning' || message.type() === 'error') {
      browserProblems.push(`${message.type()}: ${text}`);
    }
  });

  try {
    server = await startCompanionServer({
      runtime,
      projectRoot,
      allowedOrigins: ['http://127.0.0.1:4173'],
      token,
    });
    const companionUrl = server.url;
    const companionPort = Number(new URL(companionUrl).port);
    const encoded = Buffer.from(
      JSON.stringify({ version: 1, url: companionUrl, token }),
    ).toString('base64url');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/#companion=${encoded}`);

    const draft = page.getByLabel('장면에 대해 말하기');
    await expect(draft).toBeEnabled();
    await draft.fill('노란 오브젝트는 전봇대야.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect.poll(() => runtime.startedTurns).toHaveLength(1);
    expect(runtime.startedThreads).toEqual(['thread-initial-1']);
    const firstTurn = runtime.startedTurns[0]!;
    runtime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: firstTurn.threadId,
        turnId: firstTurn.turnId,
        item: {
          type: 'agentMessage',
          id: 'message-session-e2e',
          text: '전봇대 의미를 현재 장면 기준으로 기억하겠습니다.',
        },
      },
    });
    runtime.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: firstTurn.threadId,
        turn: { id: firstTurn.turnId, status: 'completed', error: null },
      },
    });
    await expect(
      page.getByText('전봇대 의미를 현재 장면 기준으로 기억하겠습니다.'),
    ).toBeVisible();

    await page.reload();
    const choice = page.getByRole('article', {
      name: '저장된 Codex task 선택',
    });
    await expect(choice).toBeVisible();
    await expect(choice).toContainText('thread-initial-1');
    await expect(choice).toContainText('노란 오브젝트는 전봇대야.');
    await expect(choice).toContainText(
      '전봇대 의미를 현재 장면 기준으로 기억하겠습니다.',
    );
    await expect(choice).toContainText('turn 1개 · completed');
    expect(runtime.resumedThreads).toEqual([]);
    await expect(draft).toBeDisabled();

    await choice.getByRole('button', { name: '저장된 task 재개' }).click();
    await expect(draft).toBeEnabled();
    expect(runtime.resumedThreads).toEqual(['thread-initial-1']);
    await draft.fill('이 turn은 Companion 재시작으로 중단돼야 해.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect.poll(() => runtime.startedTurns).toHaveLength(2);

    await server.close();
    server = null;
    const restartedRuntime = new ConversationRuntime('restarted');
    restartedRuntime.failResume = true;
    server = await startCompanionServer({
      runtime: restartedRuntime,
      projectRoot,
      allowedOrigins: ['http://127.0.0.1:4173'],
      token,
      port: companionPort,
    });
    await page.reload();
    await expect(choice).toContainText('turn 2개 · interrupted');
    await choice.getByRole('button', { name: '저장된 task 재개' }).click();
    await expect(page.getByRole('alert')).toContainText(
      '저장된 Codex task를 재개하지 못했습니다',
    );
    await expect(choice).toBeVisible();

    await choice.getByRole('button', { name: '새 task 시작' }).click();
    await expect(choice).toBeHidden();
    await expect(draft).toBeEnabled();
    expect(restartedRuntime.startedThreads).toEqual(['thread-restarted-1']);

    const stored = await fetch(`${server.url}/api/conversation-session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expect(stored.json()).resolves.toMatchObject({
      archivedTaskCount: 1,
      activeTask: {
        threadId: 'thread-restarted-1',
        turnCount: 0,
      },
    });
    expect(
      await page.evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth',
      ),
    ).toBe(true);
    expect(browserProblems).toEqual([]);
  } finally {
    await server?.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
