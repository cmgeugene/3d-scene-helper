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
import { GENERATION_REQUEST_RECOVERY_STORAGE_KEY } from '../src/assistant/generationRequestRecovery';

const token = 'e2e-generation-idempotency-token-'.padEnd(43, 'x');

class RecoveryRuntime extends EventEmitter implements CodexRuntime {
  readonly status: AppServerStatus = {
    state: 'ready',
    version: 'codex-idempotency-e2e',
    account: { type: 'chatgpt', email: null, planType: 'plus' },
    requiresOpenaiAuth: true,
    capabilities: {
      namespaceTools: true,
      imageGeneration: true,
      webSearch: true,
    },
    error: null,
  };
  readonly startedTurns: Array<{
    threadId: string;
    turnId: string;
    input: TurnInput[];
  }> = [];
  readonly interruptedTurns: string[] = [];

  async start() {}
  async stop() {}
  async refreshAccount() {
    return this.status;
  }
  async startThread() {
    return 'thread-idempotency-e2e';
  }
  async resumeThread(threadId: string) {
    return threadId;
  }
  async startTurn(threadId: string, input: TurnInput[]) {
    const turnId = `turn-idempotency-${this.startedTurns.length + 1}`;
    this.startedTurns.push({ threadId, turnId, input });
    return turnId;
  }
  async interruptTurn(threadId: string, turnId: string) {
    this.interruptedTurns.push(turnId);
    this.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId,
        turn: { id: turnId, status: 'interrupted', error: null },
      },
    });
  }
}

test('generation POST 유실·reload·취소·Companion 재시작이 중복 turn 없이 복구된다', async ({
  page,
}) => {
  const projectRoot = await mkdtemp(
    path.join(tmpdir(), 'i2v-generation-idempotency-e2e-'),
  );
  let server: CompanionServerHandle | null = null;
  const runtime = new RecoveryRuntime();
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
          text.includes('net::ERR_CONNECTION_REFUSED')))
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
    const companionPort = new URL(companionUrl).port;
    let dropFirstGenerationResponse = true;
    let firstRequestId: string | null = null;
    let firstRequestBody: Record<string, unknown> | null = null;
    let firstResponse: { status: number; body: string } | null = null;
    await page.route(`${companionUrl}/api/generations`, async (route) => {
      if (route.request().method() === 'POST' && dropFirstGenerationResponse) {
        dropFirstGenerationResponse = false;
        const body = route.request().postDataJSON() as Record<
          string,
          unknown
        > & {
          requestId: string;
        };
        firstRequestId = body.requestId;
        firstRequestBody = body;
        const response = await route.fetch();
        firstResponse = {
          status: response.status(),
          body: await response.text(),
        };
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    const encoded = Buffer.from(
      JSON.stringify({ version: 1, url: companionUrl, token }),
    ).toString('base64url');
    await page.goto(`/#companion=${encoded}`);
    await expect(page.locator('[data-webgl-state]')).toHaveAttribute(
      'data-webgl-state',
      'available',
    );
    const draft = page.getByLabel('장면에 대해 말하기');
    await draft.fill('응답이 유실돼도 한 번만 생성해줘.');
    await page.getByRole('button', { name: '이미지 생성' }).dblclick();

    const recovery = page.getByRole('article', {
      name: '미확인 generation 요청 복구',
    });
    await expect(recovery).toBeVisible();
    await expect.poll(() => firstResponse).toMatchObject({ status: 202 });
    expect(firstRequestId).toMatch(/^generation-/);
    await expect.poll(() => runtime.startedTurns).toHaveLength(1);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        GENERATION_REQUEST_RECOVERY_STORAGE_KEY,
      ),
    ).not.toBeNull();

    await recovery
      .getByRole('button', { name: '같은 요청 안전하게 다시 확인' })
      .click();
    await expect(
      page.getByRole('status', { name: 'generation 요청 상태' }),
    ).toContainText(`${firstRequestId} · 진행 중`);
    expect(runtime.startedTurns).toHaveLength(1);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        GENERATION_REQUEST_RECOVERY_STORAGE_KEY,
      ),
    ).toBeNull();

    await page.reload();
    const savedTaskChoice = page.getByRole('article', {
      name: '저장된 Codex task 선택',
    });
    await expect(savedTaskChoice).toBeVisible();
    await savedTaskChoice
      .getByRole('button', { name: '저장된 task 재개' })
      .click();
    await expect(
      page.getByRole('status', { name: 'generation 요청 상태' }),
    ).toContainText(`${firstRequestId} · 진행 중`);
    const cancel = page.getByRole('button', { name: '응답 중단' });
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(
      page.getByRole('status', { name: 'generation 요청 상태' }),
    ).toContainText('중단됨 · 새 요청으로 다시 시도 가능');
    expect(runtime.interruptedTurns).toEqual(['turn-idempotency-1']);

    const capturedRequestBody = firstRequestBody as Record<
      string,
      unknown
    > | null;
    if (capturedRequestBody === null) {
      throw new Error('첫 generation 요청 body를 캡처하지 못했습니다.');
    }
    const secondGeneration = await fetch(`${companionUrl}/api/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...capturedRequestBody,
        requestId: 'generation-restart-recovery-e2e',
      }),
    });
    expect(secondGeneration.status).toBe(202);
    await expect.poll(() => runtime.startedTurns).toHaveLength(2);

    await server.close();
    server = null;
    const restartedRuntime = new RecoveryRuntime();
    server = await startCompanionServer({
      runtime: restartedRuntime,
      projectRoot,
      allowedOrigins: ['http://127.0.0.1:4173'],
      token,
      port: Number(companionPort),
    });
    await page.reload();
    await expect(
      page.getByRole('status', { name: 'generation 요청 상태' }),
    ).toContainText('중단됨 · 새 요청으로 다시 시도 가능');
    await expect(page.getByRole('alert')).toContainText(
      'Companion이 재시작되어',
    );
    expect(restartedRuntime.startedTurns).toHaveLength(0);
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
