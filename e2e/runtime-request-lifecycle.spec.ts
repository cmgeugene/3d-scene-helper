import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type {
  AppServerStatus,
  CodexRuntime,
} from '../companion/appServerClient';
import {
  startCompanionServer,
  type CompanionServerHandle,
} from '../companion/server';
import type { JsonRpcId } from '../companion/jsonRpcPeer';

const token = 'runtime-request-e2e-token-1234567890';

class RuntimeRequestRuntime extends EventEmitter implements CodexRuntime {
  readonly status: AppServerStatus = {
    state: 'ready',
    version: 'codex-runtime-request-e2e',
    account: { type: 'chatgpt', email: null, planType: 'plus' },
    requiresOpenaiAuth: true,
    capabilities: {
      namespaceTools: true,
      imageGeneration: true,
      webSearch: true,
    },
    error: null,
  };
  readonly responses: Array<{ id: JsonRpcId; result: unknown }> = [];
  readonly rejections: Array<{
    id: JsonRpcId;
    code: number;
    message: string;
  }> = [];

  async start() {}
  async stop() {}
  async refreshAccount() {
    return this.status;
  }
  async startThread() {
    return 'thread-runtime-e2e';
  }
  async resumeThread(threadId: string) {
    return threadId;
  }
  async startTurn() {
    return 'turn-runtime-e2e';
  }
  async interruptTurn() {}
  respondServerRequest(id: JsonRpcId, result: unknown) {
    this.responses.push({ id, result });
  }
  rejectServerRequest(id: JsonRpcId, code: number, message: string) {
    this.rejections.push({ id, code, message });
  }
}

test('승인·사용자 입력 요청이 UI 응답과 재시작 만료까지 정확히 한 번 왕복한다', async ({
  page,
}) => {
  const projectRoot = await mkdtemp(
    path.join(tmpdir(), 'i2v-runtime-request-e2e-'),
  );
  let server: CompanionServerHandle | null = null;
  const runtime = new RuntimeRequestRuntime();
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
    const port = Number(new URL(server.url).port);
    const encoded = Buffer.from(
      JSON.stringify({ version: 1, url: server.url, token }),
    ).toString('base64url');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/#companion=${encoded}`);
    await expect(page.getByText('ChatGPT · plus')).toBeVisible();

    runtime.emit('serverRequest', {
      id: 1001,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-runtime-e2e',
        turnId: 'turn-command-e2e',
        itemId: 'item-command-e2e',
        startedAtMs: Date.now(),
        command: 'npm run build',
        cwd: projectRoot,
        reason: '프로덕션 빌드 결과를 확인합니다.',
      },
    });
    const commandCard = page.getByRole('article', {
      name: '명령 실행 승인: item-command-e2e',
    });
    await expect(commandCard).toBeVisible();
    await expect(commandCard).toContainText(
      'thread thread-runtime-e2e · turn turn-command-e2e',
    );
    await expect(commandCard).toContainText('npm run build');
    await commandCard.getByRole('button', { name: '이번 요청 승인' }).click();
    await expect
      .poll(() => runtime.responses)
      .toEqual([{ id: 1001, result: { decision: 'accept' } }]);
    await expect(commandCard).toBeHidden();

    runtime.emit('serverRequest', {
      id: 'question-1002',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-runtime-e2e',
        turnId: 'turn-question-e2e',
        itemId: 'item-question-e2e',
        autoResolutionMs: null,
        questions: [
          {
            id: 'direction',
            header: '연출 방향',
            question: '피사체를 어느 쪽에 둘까요?',
            isOther: true,
            isSecret: false,
            options: [
              { label: '왼쪽', description: '왼쪽에 배치합니다.' },
              { label: '오른쪽', description: '오른쪽에 배치합니다.' },
            ],
          },
          {
            id: 'secret',
            header: '비밀 값',
            question: '일회성 값을 입력해 주세요.',
            isOther: false,
            isSecret: true,
            options: null,
          },
        ],
      },
    });
    const questionCard = page.getByRole('article', {
      name: 'Codex 확인 질문: item-question-e2e',
    });
    await expect(questionCard).toBeVisible();
    await questionCard.getByRole('radio', { name: /오른쪽/ }).click();
    await questionCard
      .getByLabel('비밀 값 답변')
      .fill('browser-one-time-secret');
    await questionCard.getByRole('button', { name: '답변 보내기' }).click();
    await expect.poll(() => runtime.responses).toHaveLength(2);
    expect(runtime.responses[1]).toEqual({
      id: 'question-1002',
      result: {
        answers: {
          direction: { answers: ['오른쪽'] },
          secret: { answers: ['browser-one-time-secret'] },
        },
      },
    });
    expect(
      await readFile(path.join(projectRoot, 'runtime-requests.json'), 'utf8'),
    ).not.toContain('browser-one-time-secret');

    runtime.emit('serverRequest', {
      id: 1003,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-runtime-e2e',
        turnId: 'turn-file-e2e',
        itemId: 'item-file-e2e',
        startedAtMs: Date.now(),
        reason: '장면 metadata를 갱신합니다.',
        grantRoot: projectRoot,
      },
    });
    await expect(
      page.getByRole('article', {
        name: '파일 변경 승인: item-file-e2e',
      }),
    ).toBeVisible();

    await server.close();
    server = null;
    const restartedRuntime = new RuntimeRequestRuntime();
    server = await startCompanionServer({
      runtime: restartedRuntime,
      projectRoot,
      allowedOrigins: ['http://127.0.0.1:4173'],
      token,
      port,
    });
    await page.reload();
    const expired = page.getByRole('article', { name: '만료된 Codex 요청' });
    await expect(expired).toContainText('Companion 재시작');
    await expect(
      expired.getByRole('button', { name: '이번 요청 승인' }),
    ).toHaveCount(0);

    restartedRuntime.emit('serverRequest', {
      id: 1004,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-runtime-e2e',
        turnId: 'turn-file-new-e2e',
        itemId: 'item-file-new-e2e',
        startedAtMs: Date.now(),
        reason: '새 연결에서 다시 요청합니다.',
        grantRoot: projectRoot,
      },
    });
    const newFileCard = page.getByRole('article', {
      name: '파일 변경 승인: item-file-new-e2e',
    });
    await newFileCard.getByRole('button', { name: '거부' }).click();
    await expect
      .poll(() => restartedRuntime.responses)
      .toEqual([{ id: 1004, result: { decision: 'decline' } }]);
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
