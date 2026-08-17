// @vitest-environment node

import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppServerStatus, CodexRuntime } from './appServerClient';
import { startCompanionServer, type CompanionServerHandle } from './server';

const tempRoots: string[] = [];
const servers: CompanionServerHandle[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

class StaticEditorRuntime extends EventEmitter implements CodexRuntime {
  readonly status: AppServerStatus = {
    state: 'ready',
    version: 'codex-static-editor-test',
    account: null,
    requiresOpenaiAuth: true,
    capabilities: null,
    error: null,
  };

  async start() {}
  async stop() {}
  async refreshAccount() {
    return this.status;
  }
  async startThread() {
    return 'thread-static';
  }
  async resumeThread(threadId: string) {
    return threadId;
  }
  async startTurn() {
    return 'turn-static';
  }
  async interruptTurn() {}
}

async function createStaticServer() {
  const root = await mkdtemp(path.join(tmpdir(), 'i2v-static-editor-'));
  tempRoots.push(root);
  const projectRoot = path.join(root, 'project');
  const editorRoot = path.join(root, 'editor');
  await mkdir(path.join(editorRoot, 'assets'), { recursive: true });
  await mkdir(projectRoot);
  await writeFile(
    path.join(editorRoot, 'index.html'),
    '<!doctype html><script type="module" src="/assets/app.js"></script>',
  );
  await writeFile(path.join(editorRoot, 'assets', 'app.js'), 'export {};');
  await writeFile(path.join(root, 'outside.txt'), 'private');
  await symlink(
    path.join(root, 'outside.txt'),
    path.join(editorRoot, 'escape.txt'),
  );
  const server = await startCompanionServer({
    runtime: new StaticEditorRuntime(),
    projectRoot,
    editorRoot,
    allowedOrigins: [],
    token: 'static-editor-token',
  });
  servers.push(server);
  return server;
}

describe('bundled static editor', () => {
  it('편집기와 asset을 인증 전 같은 loopback origin에서 제공한다', async () => {
    const server = await createStaticServer();
    const index = await fetch(server.url);
    const asset = await fetch(`${server.url}/assets/app.js`);
    const head = await fetch(`${server.url}/assets/app.js`, { method: 'HEAD' });

    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(index.headers.get('cache-control')).toBe('no-store');
    expect(index.headers.get('content-security-policy')).toContain(
      "connect-src 'self'",
    );
    expect(await index.text()).toContain('/assets/app.js');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(await asset.text()).toBe('export {};');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('self origin API는 허용하고 외부 origin과 root 밖 symlink는 거부한다', async () => {
    const server = await createStaticServer();
    const runtime = await fetch(`${server.url}/api/runtime`, {
      headers: {
        Authorization: 'Bearer static-editor-token',
        Origin: server.url,
      },
    });
    const foreign = await fetch(server.url, {
      headers: { Origin: 'https://example.com' },
    });
    const escaped = await fetch(`${server.url}/escape.txt`);

    expect(runtime.status).toBe(200);
    expect(foreign.status).toBe(403);
    expect(escaped.status).toBe(401);
    await expect(escaped.json()).resolves.toEqual({
      error: '유효한 Companion 세션 토큰이 필요합니다.',
    });
  });

  it('index.html이 없는 배포 루트는 시작 전에 거부한다', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'i2v-empty-editor-'));
    tempRoots.push(root);
    await expect(
      startCompanionServer({
        runtime: new StaticEditorRuntime(),
        projectRoot: root,
        editorRoot: root,
        allowedOrigins: [],
      }),
    ).rejects.toThrow('index.html이 없습니다');
  });
});
