import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_OAUTH_IMAGE_MODEL,
  DEFAULT_OAUTH_PROXY_PORT,
  OAUTH_IMAGE_MODELS,
  filterOAuthImageModels,
  parseOAuthReadyUrl,
} from './oauthImageProvider';

export interface OAuthProxyStatus {
  state: 'stopped' | 'starting' | 'ready' | 'failed';
  url: string | null;
  error: string | null;
  models: string[];
}

export interface ManagedOAuthProxy {
  status: OAuthProxyStatus;
  stop(): Promise<void>;
}

function codexAuthPath() {
  return path.join(
    process.env.CODEX_HOME || path.join(homedir(), '.codex'),
    'auth.json',
  );
}

export function hasCodexAuthFile() {
  return existsSync(codexAuthPath());
}

export function resolveOAuthCliPath(repoRoot: string) {
  return path.join(repoRoot, 'node_modules', 'openai-oauth', 'dist', 'cli.js');
}

function findAvailablePort(startPort: number) {
  return new Promise<number>((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > startPort + 20) {
        reject(
          new Error(`openai-oauth 포트를 ${startPort}부터 찾지 못했습니다.`),
        );
        return;
      }
      const probe = createServer();
      probe.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      probe.once('listening', () => {
        probe.close(() => resolve(port));
      });
      probe.listen(port, '127.0.0.1');
    };
    tryPort(startPort);
  });
}

async function listOAuthModels(baseUrl: string) {
  const response = await fetch(`${baseUrl}/v1/models`);
  if (!response.ok) return [...OAUTH_IMAGE_MODELS];
  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  const ids = (body.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string');
  const filtered = filterOAuthImageModels(ids);
  return filtered.length > 0 ? filtered : [DEFAULT_OAUTH_IMAGE_MODEL];
}

export async function startManagedOAuthProxy(options: {
  repoRoot: string;
  port?: number;
  requestedUrl?: string | null;
}): Promise<ManagedOAuthProxy> {
  if (options.requestedUrl) {
    const url = options.requestedUrl.replace(/\/$/, '');
    try {
      const models = await listOAuthModels(url);
      return {
        status: { state: 'ready', url, error: null, models },
        stop: async () => undefined,
      };
    } catch (error) {
      return {
        status: {
          state: 'failed',
          url,
          error:
            error instanceof Error
              ? error.message
              : '지정한 OAuth 프록시에 연결하지 못했습니다.',
          models: [],
        },
        stop: async () => undefined,
      };
    }
  }

  if (!hasCodexAuthFile()) {
    return {
      status: {
        state: 'failed',
        url: null,
        error:
          'Codex 로그인 파일이 없습니다. `codex login` 후 다시 시작해 주세요.',
        models: [],
      },
      stop: async () => undefined,
    };
  }

  const cliPath = resolveOAuthCliPath(options.repoRoot);
  if (!existsSync(cliPath)) {
    return {
      status: {
        state: 'failed',
        url: null,
        error:
          'openai-oauth 패키지를 찾지 못했습니다. npm ci 후 다시 시작해 주세요.',
        models: [],
      },
      stop: async () => undefined,
    };
  }

  const port = await findAvailablePort(
    options.port ?? DEFAULT_OAUTH_PROXY_PORT,
  );
  let child: ChildProcess | null = spawn(
    process.execPath,
    [cliPath, '--host', '127.0.0.1', '--port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const stop = async () => {
    if (child === null) return;
    const current = child;
    child = null;
    current.kill('SIGTERM');
  };

  const ready = await new Promise<OAuthProxyStatus>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        state: 'failed',
        url: null,
        error: 'openai-oauth 프록시 시작 시간이 초과되었습니다.',
        models: [],
      });
    }, 15_000);
    const onOutput = (chunk: Buffer) => {
      const url = parseOAuthReadyUrl(chunk.toString());
      if (url === null) return;
      clearTimeout(timeout);
      child?.stdout?.off('data', onOutput);
      child?.stderr?.off('data', onOutput);
      void listOAuthModels(url).then((models) => {
        resolve({ state: 'ready', url, error: null, models });
      });
    };
    child?.stdout?.on('data', onOutput);
    child?.stderr?.on('data', onOutput);
    child?.once('exit', (code: number | null) => {
      clearTimeout(timeout);
      resolve({
        state: 'failed',
        url: null,
        error: `openai-oauth가 종료되었습니다 (${code ?? 'unknown'}).`,
        models: [],
      });
    });
  });

  if (ready.state !== 'ready') {
    await stop();
  }

  return { status: ready, stop };
}
