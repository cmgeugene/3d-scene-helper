import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export type JsonRpcId = number | string;

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcServerRequest extends JsonRpcNotification {
  id: JsonRpcId;
}

interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export interface JsonRpcPeerOptions {
  requestTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string';
}

export class JsonRpcPeer extends EventEmitter {
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly reader;
  private readonly requestTimeoutMs: number;
  private nextRequestId = 1;
  private closed = false;

  constructor(
    readable: Readable,
    private readonly writable: Writable,
    options: JsonRpcPeerOptions = {},
  ) {
    super();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.reader = createInterface({ input: readable, crlfDelay: Infinity });
    this.reader.on('line', (line) => this.handleLine(line));
    this.reader.on('close', () =>
      this.close(new Error('App Server 연결이 종료되었습니다.')),
    );
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new Error('종료된 App Server 연결에는 요청할 수 없습니다.'),
      );
    }

    const id = this.nextRequestId++;
    const message =
      params === undefined ? { method, id } : { method, id, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`App Server 요청 시간이 초과되었습니다: ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.write(message);
    });
  }

  notify(method: string, params?: unknown) {
    if (this.closed) {
      throw new Error('종료된 App Server 연결에는 알림을 보낼 수 없습니다.');
    }

    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: JsonRpcId, result: unknown) {
    if (this.closed) {
      throw new Error('종료된 App Server 연결에는 응답할 수 없습니다.');
    }

    this.write({ id, result });
  }

  respondError(id: JsonRpcId, code: number, message: string) {
    if (this.closed) {
      throw new Error('종료된 App Server 연결에는 응답할 수 없습니다.');
    }

    this.write({ id, error: { code, message } });
  }

  close(reason = new Error('App Server 연결이 종료되었습니다.')) {
    if (this.closed) return;
    this.closed = true;
    this.reader.close();

    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(reason);
    }
    this.pending.clear();
  }

  private write(message: unknown) {
    this.writable.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string) {
    if (line.trim() === '') return;

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit(
        'protocolError',
        new Error('App Server가 잘못된 JSON을 반환했습니다.'),
      );
      return;
    }

    if (!isRecord(message)) {
      this.emit(
        'protocolError',
        new Error('App Server 메시지는 객체여야 합니다.'),
      );
      return;
    }

    if (typeof message.method === 'string') {
      if (isJsonRpcId(message.id)) {
        this.emit('serverRequest', message as unknown as JsonRpcServerRequest);
      } else {
        this.emit('notification', message as unknown as JsonRpcNotification);
      }
      return;
    }

    if (!isJsonRpcId(message.id)) {
      this.emit(
        'protocolError',
        new Error('App Server 응답에 유효한 id가 없습니다.'),
      );
      return;
    }

    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);

    const response = message as unknown as JsonRpcResponse;
    if (response.error !== undefined) {
      pending.reject(
        new Error(response.error.message ?? 'App Server 요청이 실패했습니다.'),
      );
      return;
    }

    pending.resolve(response.result);
  }
}
