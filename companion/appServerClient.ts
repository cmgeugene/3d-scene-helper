import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { z } from 'zod';
import {
  JsonRpcPeer,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcServerRequest,
} from './jsonRpcPeer';

const require = createRequire(import.meta.url);

const initializeResponseSchema = z.object({
  codexHome: z.string(),
  platformFamily: z.string(),
  platformOs: z.string(),
  userAgent: z.string(),
});

const accountResponseSchema = z.object({
  account: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('apiKey') }),
      z.object({
        type: z.literal('chatgpt'),
        email: z.string().nullable(),
        planType: z.string(),
      }),
      z.object({
        type: z.literal('amazonBedrock'),
        usesCodexManagedCredentials: z.boolean().optional(),
      }),
    ])
    .nullable()
    .optional(),
  requiresOpenaiAuth: z.boolean(),
});

const threadResponseSchema = z.object({
  thread: z.object({ id: z.string() }).passthrough(),
});

const turnResponseSchema = z.object({
  turn: z.object({ id: z.string() }).passthrough(),
});

const modelProviderCapabilitiesSchema = z.object({
  namespaceTools: z.boolean(),
  imageGeneration: z.boolean(),
  webSearch: z.boolean(),
});

export type CodexAccount = z.infer<typeof accountResponseSchema>['account'];

export type AppServerState =
  'stopped' | 'starting' | 'ready' | 'stopping' | 'failed';

export interface LocalImageInput {
  type: 'localImage';
  path: string;
  detail?: 'low' | 'high' | 'auto' | 'original';
}

export interface TextInput {
  type: 'text';
  text: string;
}

export type TurnInput = TextInput | LocalImageInput;

export interface AppServerStatus {
  state: AppServerState;
  version: string | null;
  account: CodexAccount;
  requiresOpenaiAuth: boolean | null;
  error: string | null;
  capabilities?: z.infer<typeof modelProviderCapabilitiesSchema> | null;
}

export interface TurnOptions {
  outputSchema?: unknown;
}

export interface CodexRuntime {
  readonly status: AppServerStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  refreshAccount(): Promise<AppServerStatus>;
  startThread(projectRoot: string): Promise<string>;
  resumeThread(threadId: string, projectRoot: string): Promise<string>;
  startTurn(
    threadId: string,
    input: TurnInput[],
    options?: TurnOptions,
  ): Promise<string>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  respondServerRequest?(id: JsonRpcId, result: unknown): void;
  rejectServerRequest?(id: JsonRpcId, code: number, message: string): void;
  on(
    event: 'notification',
    listener: (value: JsonRpcNotification) => void,
  ): this;
  on(event: 'status', listener: (value: AppServerStatus) => void): this;
  on(
    event: 'serverRequest',
    listener: (value: JsonRpcServerRequest) => void,
  ): this;
  off(
    event: 'notification',
    listener: (value: JsonRpcNotification) => void,
  ): this;
  off(event: 'status', listener: (value: AppServerStatus) => void): this;
  off(
    event: 'serverRequest',
    listener: (value: JsonRpcServerRequest) => void,
  ): this;
}

export interface CodexAppServerClientOptions {
  cwd: string;
  codexEntrypoint?: string;
  requestTimeoutMs?: number;
}

function resolveCodexEntrypoint() {
  return require.resolve('@openai/codex/bin/codex.js');
}

export class CodexAppServerClient extends EventEmitter implements CodexRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private peer: JsonRpcPeer | null = null;
  private startPromise: Promise<void> | null = null;
  private currentStatus: AppServerStatus = {
    state: 'stopped',
    version: null,
    account: null,
    requiresOpenaiAuth: null,
    error: null,
  };

  constructor(private readonly options: CodexAppServerClientOptions) {
    super();
  }

  get status() {
    return this.currentStatus;
  }

  start() {
    if (this.currentStatus.state === 'ready') return Promise.resolve();
    if (this.startPromise !== null) return this.startPromise;

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop() {
    if (this.child === null) return;
    this.updateStatus({ state: 'stopping' });

    const child = this.child;
    this.child = null;
    this.peer?.close();
    this.peer = null;

    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
    });

    child.stdin.end();
    const timeout = setTimeout(() => child.kill(), 2_000);
    await exited;
    clearTimeout(timeout);
    this.updateStatus({
      state: 'stopped',
      account: null,
      requiresOpenaiAuth: null,
      capabilities: null,
      error: null,
    });
  }

  async refreshAccount() {
    const result = accountResponseSchema.parse(
      await this.getPeer().request('account/read', { refreshToken: false }),
    );
    this.updateStatus({
      account: result.account ?? null,
      requiresOpenaiAuth: result.requiresOpenaiAuth,
    });
    return this.status;
  }

  async startThread(projectRoot: string) {
    const response = threadResponseSchema.parse(
      await this.getPeer().request('thread/start', {
        cwd: path.resolve(projectRoot),
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
        personality: 'pragmatic',
      }),
    );
    return response.thread.id;
  }

  async resumeThread(threadId: string, projectRoot: string) {
    const response = threadResponseSchema.parse(
      await this.getPeer().request('thread/resume', {
        threadId,
        cwd: path.resolve(projectRoot),
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
      }),
    );
    return response.thread.id;
  }

  async startTurn(
    threadId: string,
    input: TurnInput[],
    options: TurnOptions = {},
  ) {
    const response = turnResponseSchema.parse(
      await this.getPeer().request('turn/start', {
        threadId,
        input,
        ...(options.outputSchema === undefined
          ? {}
          : { outputSchema: options.outputSchema }),
      }),
    );
    return response.turn.id;
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.getPeer().request('turn/interrupt', { threadId, turnId });
  }

  respondServerRequest(id: JsonRpcId, result: unknown) {
    this.getPeer().respond(id, result);
  }

  rejectServerRequest(id: JsonRpcId, code: number, message: string) {
    this.getPeer().respondError(id, code, message);
  }

  private async startInternal() {
    this.updateStatus({ state: 'starting', error: null });
    const codexEntrypoint =
      this.options.codexEntrypoint ?? resolveCodexEntrypoint();

    try {
      const child = spawn(
        process.execPath,
        [codexEntrypoint, 'app-server', '--listen', 'stdio://'],
        {
          cwd: this.options.cwd,
          env: process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      this.child = child;
      const peer = new JsonRpcPeer(child.stdout, child.stdin, {
        requestTimeoutMs: this.options.requestTimeoutMs,
      });
      this.peer = peer;

      peer.on('notification', (value: JsonRpcNotification) => {
        this.emit('notification', value);
      });
      peer.on('serverRequest', (value: JsonRpcServerRequest) => {
        this.emit('serverRequest', value);
      });
      peer.on('protocolError', (error: Error) => {
        this.updateStatus({ error: error.message });
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString('utf8').trim();
        if (message !== '') this.emit('diagnostic', message);
      });
      child.on('error', (error) => this.handleProcessFailure(error));
      child.on('exit', (code, signal) => {
        if (this.currentStatus.state === 'stopping') return;
        this.handleProcessFailure(
          new Error(
            `Codex App Server가 종료되었습니다 (code=${String(code)}, signal=${String(signal)}).`,
          ),
        );
      });

      const initialized = initializeResponseSchema.parse(
        await peer.request('initialize', {
          clientInfo: {
            name: 'i2v-3d-scene-helper',
            title: 'I2V 3D Scene Helper',
            version: '0.1.0',
          },
          capabilities: { experimentalApi: false },
        }),
      );
      peer.notify('initialized');
      this.updateStatus({
        state: 'ready',
        version: initialized.userAgent,
        error: null,
      });
      await this.refreshAccount();
      try {
        const capabilities = modelProviderCapabilitiesSchema.parse(
          await peer.request('modelProvider/capabilities/read', {}),
        );
        this.updateStatus({ capabilities });
      } catch {
        this.updateStatus({ capabilities: null });
      }
    } catch (error) {
      await this.stopAfterFailure();
      const message =
        error instanceof Error
          ? error.message
          : 'Codex App Server를 시작하지 못했습니다.';
      this.updateStatus({ state: 'failed', error: message });
      throw error;
    }
  }

  private getPeer() {
    if (this.peer === null || this.currentStatus.state !== 'ready') {
      throw new Error('Codex App Server가 준비되지 않았습니다.');
    }
    return this.peer;
  }

  private updateStatus(patch: Partial<AppServerStatus>) {
    this.currentStatus = { ...this.currentStatus, ...patch };
    this.emit('status', this.currentStatus);
  }

  private handleProcessFailure(error: Error) {
    this.peer?.close(error);
    this.peer = null;
    this.child = null;
    this.updateStatus({ state: 'failed', error: error.message });
  }

  private async stopAfterFailure() {
    const child = this.child;
    this.child = null;
    this.peer?.close();
    this.peer = null;
    if (child === null || child.exitCode !== null) return;
    child.stdin.end();
    child.kill();
  }
}
