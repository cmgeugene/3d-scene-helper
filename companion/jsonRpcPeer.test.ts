// @vitest-environment node

import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { JsonRpcPeer } from './jsonRpcPeer';

async function waitForData(stream: PassThrough) {
  return new Promise<string>((resolve) => {
    stream.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8')));
  });
}

describe('JsonRpcPeer', () => {
  it('요청 ID와 응답을 연결한다', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const peer = new JsonRpcPeer(readable, writable, { requestTimeoutMs: 100 });

    const output = waitForData(writable);
    const result = peer.request('account/read', { refreshToken: false });
    const request = JSON.parse(await output) as {
      id: number;
      method: string;
    };

    expect(request).toMatchObject({ id: 1, method: 'account/read' });
    readable.write(
      `${JSON.stringify({ id: request.id, result: { ok: true } })}\n`,
    );

    await expect(result).resolves.toEqual({ ok: true });
    peer.close();
  });

  it('서버 알림과 서버 요청을 구분한다', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const peer = new JsonRpcPeer(readable, writable);
    const notification = vi.fn();
    const serverRequest = vi.fn();
    peer.on('notification', notification);
    peer.on('serverRequest', serverRequest);

    readable.write(
      `${JSON.stringify({ method: 'turn/started', params: { id: 'turn_1' } })}\n`,
    );
    readable.write(
      `${JSON.stringify({ id: 9, method: 'tool/requestUserInput', params: {} })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(notification).toHaveBeenCalledWith({
      method: 'turn/started',
      params: { id: 'turn_1' },
    });
    expect(serverRequest).toHaveBeenCalledWith({
      id: 9,
      method: 'tool/requestUserInput',
      params: {},
    });
    peer.close();
  });

  it('잘못된 JSON을 프로토콜 오류로 보고한다', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const peer = new JsonRpcPeer(readable, writable);
    const protocolError = vi.fn();
    peer.on('protocolError', protocolError);

    readable.write('{not-json}\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(protocolError).toHaveBeenCalledWith(expect.any(Error));
    peer.close();
  });
});
