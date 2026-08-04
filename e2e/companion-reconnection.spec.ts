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

const token = 'companion-reconnection-e2e-token-123456';

class ReconnectionRuntime extends EventEmitter implements CodexRuntime {
  readonly status: AppServerStatus;
  readonly startedThreads: string[] = [];
  readonly resumedThreads: string[] = [];
  readonly startedTurns: Array<{
    threadId: string;
    turnId: string;
    input: TurnInput[];
  }> = [];

  constructor(private readonly label: string) {
    super();
    this.status = {
      state: 'ready',
      version: `codex-reconnect-${label}`,
      account: { type: 'chatgpt', email: null, planType: 'plus' },
      requiresOpenaiAuth: true,
      capabilities: {
        namespaceTools: true,
        imageGeneration: true,
        webSearch: true,
      },
      error: null,
    };
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
    return threadId;
  }
  async startTurn(threadId: string, input: TurnInput[]) {
    const turnId = `turn-${this.label}-${this.startedTurns.length + 1}`;
    this.startedTurns.push({ threadId, turnId, input });
    return turnId;
  }
  async interruptTurn() {}
}

test('Companion 재시작을 자동 재연결하되 완료 여부가 불명확한 turn을 재실행하지 않는다', async ({
  page,
}) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'i2v-reconnect-e2e-'));
  let server: CompanionServerHandle | null = null;
  const initialRuntime = new ReconnectionRuntime('initial');
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
          text.includes('net::ERR_SOCKET_NOT_CONNECTED') ||
          text.includes('net::ERR_CONNECTION_RESET')))
    ) {
      return;
    }
    if (message.type() === 'warning' || message.type() === 'error') {
      browserProblems.push(`${message.type()}: ${text}`);
    }
  });

  try {
    server = await startCompanionServer({
      runtime: initialRuntime,
      projectRoot,
      allowedOrigins: ['http://127.0.0.1:4173'],
      token,
    });
    const companionPort = Number(new URL(server.url).port);
    const encoded = Buffer.from(
      JSON.stringify({ version: 1, url: server.url, token }),
    ).toString('base64url');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/#companion=${encoded}`);
    const draft = page.getByLabel('장면에 대해 말하기');
    await expect(draft).toBeEnabled();
    await draft.fill('첫 turn을 완료해줘.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect.poll(() => initialRuntime.startedTurns).toHaveLength(1);
    const firstTurn = initialRuntime.startedTurns[0]!;
    initialRuntime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: firstTurn.threadId,
        turnId: firstTurn.turnId,
        item: {
          type: 'agentMessage',
          id: 'message-reconnect-e2e',
          text: '첫 turn을 완료했습니다.',
        },
      },
    });
    initialRuntime.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: firstTurn.threadId,
        turn: { id: firstTurn.turnId, status: 'completed', error: null },
      },
    });
    await expect(page.getByText('첫 turn을 완료했습니다.')).toBeVisible();

    await server.close();
    server = null;
    await expect(page.getByText('Companion 자동 재연결 1/3')).toBeVisible();

    const restartedRuntime = new ReconnectionRuntime('restarted');
    server = await startCompanionServer({
      runtime: restartedRuntime,
      projectRoot,
      allowedOrigins: ['http://127.0.0.1:4173'],
      token,
      port: companionPort,
    });

    await expect(
      page.getByRole('status', { name: 'Companion 연결 상태' }),
    ).toHaveText('연결됨', { timeout: 5_000 });
    expect(restartedRuntime.startedThreads).toEqual([]);
    expect(restartedRuntime.resumedThreads).toEqual([]);
    expect(restartedRuntime.startedTurns).toEqual([]);
    await expect(
      page.getByRole('article', { name: '저장된 Codex task 선택' }),
    ).toHaveCount(0);

    await expect(draft).toBeEnabled();
    await draft.fill('재연결 뒤 새 turn을 시작해줘.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect.poll(() => restartedRuntime.startedTurns).toHaveLength(1);
    expect(restartedRuntime.resumedThreads).toEqual([firstTurn.threadId]);
    expect(restartedRuntime.startedThreads).toEqual([]);
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
