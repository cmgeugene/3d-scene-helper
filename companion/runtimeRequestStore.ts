import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  runtimeRequestListSchema,
  runtimeRequestSchema,
  runtimeRequestStatusSchema,
  type RuntimeRequest,
} from '../shared/runtimeRequest';
import type { JsonRpcId, JsonRpcServerRequest } from './jsonRpcPeer';

const rpcIdSchema = z.union([
  z.string().min(1).max(200),
  z.number().int().safe(),
]);

const storedRuntimeRequestSchema = runtimeRequestSchema.extend({
  rpcId: rpcIdSchema,
});

const runtimeRequestManifestSchema = z.object({
  version: z.literal(1),
  requests: z.array(storedRuntimeRequestSchema).max(50),
});

type RuntimeRequestManifest = z.infer<typeof runtimeRequestManifestSchema>;
type StoredRuntimeRequest = z.infer<typeof storedRuntimeRequestSchema>;

const EMPTY_MANIFEST: RuntimeRequestManifest = { version: 1, requests: [] };

const baseParamsSchema = z.object({
  threadId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
});

const commandApprovalParamsSchema = baseParamsSchema.extend({
  reason: z.string().max(1_000).nullable().optional(),
  command: z.string().max(4_000).nullable().optional(),
  cwd: z.string().max(2_000).nullable().optional(),
});

const fileChangeApprovalParamsSchema = baseParamsSchema.extend({
  reason: z.string().max(1_000).nullable().optional(),
  grantRoot: z.string().max(2_000).nullable().optional(),
});

const userInputParamsSchema = baseParamsSchema.extend({
  questions: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        header: z.string().trim().min(1).max(100),
        question: z.string().trim().min(1).max(1_000),
        isOther: z.boolean(),
        isSecret: z.boolean(),
        options: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(200),
              description: z.string().trim().max(500),
            }),
          )
          .max(12)
          .nullable(),
      }),
    )
    .min(1)
    .max(3),
  autoResolutionMs: z.number().int().min(60_000).max(240_000).nullable(),
});

function publicRequest(request: StoredRuntimeRequest): RuntimeRequest {
  return runtimeRequestSchema.parse(request);
}

function normalizedRequest(
  request: JsonRpcServerRequest,
): Omit<
  StoredRuntimeRequest,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'resolvedAt'
> | null {
  if (request.method === 'item/commandExecution/requestApproval') {
    const parsed = commandApprovalParamsSchema.safeParse(request.params);
    if (!parsed.success) return null;
    return {
      rpcId: rpcIdSchema.parse(request.id),
      kind: 'commandApproval',
      method: request.method,
      threadId: parsed.data.threadId,
      turnId: parsed.data.turnId,
      itemId: parsed.data.itemId,
      title: '명령 실행 승인',
      reason: parsed.data.reason ?? null,
      impact:
        parsed.data.command ?? 'Codex가 로컬 명령 실행 권한을 요청했습니다.',
      cwd: parsed.data.cwd ?? null,
      questions: [],
      autoResolutionMs: null,
    };
  }

  if (request.method === 'item/fileChange/requestApproval') {
    const parsed = fileChangeApprovalParamsSchema.safeParse(request.params);
    if (!parsed.success) return null;
    return {
      rpcId: rpcIdSchema.parse(request.id),
      kind: 'fileChangeApproval',
      method: request.method,
      threadId: parsed.data.threadId,
      turnId: parsed.data.turnId,
      itemId: parsed.data.itemId,
      title: '파일 변경 승인',
      reason: parsed.data.reason ?? null,
      impact:
        parsed.data.grantRoot === undefined || parsed.data.grantRoot === null
          ? 'Codex가 프로젝트 파일 변경 권한을 요청했습니다.'
          : `다음 경로 아래의 파일을 변경할 수 있습니다: ${parsed.data.grantRoot}`,
      cwd: parsed.data.grantRoot ?? null,
      questions: [],
      autoResolutionMs: null,
    };
  }

  if (request.method === 'item/tool/requestUserInput') {
    const parsed = userInputParamsSchema.safeParse(request.params);
    if (!parsed.success) return null;
    return {
      rpcId: rpcIdSchema.parse(request.id),
      kind: 'userInput',
      method: request.method,
      threadId: parsed.data.threadId,
      turnId: parsed.data.turnId,
      itemId: parsed.data.itemId,
      title: 'Codex 확인 질문',
      reason: null,
      impact: '답변을 보내면 현재 Codex turn이 해당 정보로 계속 진행됩니다.',
      cwd: null,
      questions: parsed.data.questions,
      autoResolutionMs: parsed.data.autoResolutionMs,
    };
  }

  return null;
}

export class RuntimeRequestStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly projectRoot: string) {}

  async list() {
    const manifest = await this.readManifest();
    return runtimeRequestListSchema.parse({
      version: 1,
      requests: manifest.requests.map(publicRequest),
    });
  }

  register(request: JsonRpcServerRequest) {
    const normalized = normalizedRequest(request);
    if (normalized === null) return Promise.resolve(null);
    return this.mutate(async () => {
      const manifest = await this.readManifest();
      const now = new Date().toISOString();
      const stored = storedRuntimeRequestSchema.parse({
        ...normalized,
        id: randomUUID(),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      });
      const updated = runtimeRequestManifestSchema.parse({
        version: 1,
        requests: [...manifest.requests, stored].slice(-50),
      });
      await this.writeManifest(updated);
      return publicRequest(stored);
    });
  }

  resolve(
    id: string,
    status: 'approved' | 'declined' | 'answered' | 'cancelled' | 'expired',
  ) {
    return this.mutate(async () => {
      const manifest = await this.readManifest();
      const index = manifest.requests.findIndex((request) => request.id === id);
      if (index < 0) return null;
      const current = manifest.requests[index]!;
      if (current.status !== 'pending') return publicRequest(current);
      const now = new Date().toISOString();
      const requests = [...manifest.requests];
      requests[index] = storedRuntimeRequestSchema.parse({
        ...current,
        status: runtimeRequestStatusSchema.parse(status),
        updatedAt: now,
        resolvedAt: now,
      });
      const updated = runtimeRequestManifestSchema.parse({
        ...manifest,
        requests,
      });
      await this.writeManifest(updated);
      return publicRequest(requests[index]!);
    });
  }

  recoverPending() {
    return this.mutate(async () => {
      const manifest = await this.readManifest();
      const now = new Date().toISOString();
      let changed = false;
      const requests = manifest.requests.map((request) => {
        if (request.status !== 'pending') return request;
        changed = true;
        return storedRuntimeRequestSchema.parse({
          ...request,
          status: 'expired',
          updatedAt: now,
          resolvedAt: now,
        });
      });
      if (!changed) return this.listFromManifest(manifest);
      const updated = runtimeRequestManifestSchema.parse({
        ...manifest,
        requests,
      });
      await this.writeManifest(updated);
      return this.listFromManifest(updated);
    });
  }

  resolveByRpcId(threadId: string, rpcId: JsonRpcId) {
    return this.mutate(async () => {
      const manifest = await this.readManifest();
      const current = [...manifest.requests]
        .reverse()
        .find(
          (request) =>
            request.threadId === threadId &&
            request.rpcId === rpcId &&
            request.status === 'pending',
        );
      if (current === undefined) return null;
      const now = new Date().toISOString();
      const requests = manifest.requests.map((request) =>
        request.id === current.id
          ? storedRuntimeRequestSchema.parse({
              ...request,
              status: 'cancelled',
              updatedAt: now,
              resolvedAt: now,
            })
          : request,
      );
      const updated = runtimeRequestManifestSchema.parse({
        ...manifest,
        requests,
      });
      await this.writeManifest(updated);
      return publicRequest(
        requests.find((request) => request.id === current.id)!,
      );
    });
  }

  private listFromManifest(manifest: RuntimeRequestManifest) {
    return runtimeRequestListSchema.parse({
      version: 1,
      requests: manifest.requests.map(publicRequest),
    });
  }

  private mutate<T>(operation: () => Promise<T>) {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readManifest() {
    const manifestPath = path.join(this.projectRoot, 'runtime-requests.json');
    try {
      return runtimeRequestManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return EMPTY_MANIFEST;
      }
      throw error;
    }
  }

  private async writeManifest(manifest: RuntimeRequestManifest) {
    const parsed = runtimeRequestManifestSchema.parse(manifest);
    const manifestPath = path.join(this.projectRoot, 'runtime-requests.json');
    const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
    await writeFile(temporaryPath, serialized, { flag: 'wx' });
    try {
      await rename(temporaryPath, manifestPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'EEXIST') {
        try {
          await writeFile(manifestPath, serialized);
          await unlink(temporaryPath).catch(() => undefined);
          return;
        } catch {
          // Preserve the original rename failure below.
        }
      }
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
