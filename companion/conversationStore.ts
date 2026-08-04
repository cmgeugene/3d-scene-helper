import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  conversationSessionSchema,
  conversationTaskMetadataSchema,
  conversationTurnKindSchema,
  conversationTurnStatusSchema,
  type ConversationTurnMetadataInput,
} from '../shared/conversationMetadata';

const conversationTaskSchema = conversationTaskMetadataSchema;

const conversationManifestSchema = z.object({
  version: z.literal(1),
  activeThreadId: z.string().min(1).nullable(),
  tasks: z.array(conversationTaskSchema),
});

type ConversationManifest = z.infer<typeof conversationManifestSchema>;
type ConversationTask = z.infer<typeof conversationTaskSchema>;

const EMPTY_MANIFEST: ConversationManifest = {
  version: 1,
  activeThreadId: null,
  tasks: [],
};

function bounded(value: string, maximum: number) {
  const normalized = value.trim().replaceAll(/\s+/gu, ' ');
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1)}…`;
}

function publicSession(manifest: ConversationManifest) {
  return conversationSessionSchema.parse({
    version: 1,
    activeTask:
      manifest.activeThreadId === null
        ? null
        : (manifest.tasks.find(
            ({ threadId }) => threadId === manifest.activeThreadId,
          ) ?? null),
    archivedTaskCount: manifest.tasks.filter(
      ({ state }) => state === 'archived',
    ).length,
  });
}

export class ConversationStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly projectRoot: string) {}

  async getSession() {
    return publicSession(await this.readManifest());
  }

  recoverInProgressTask() {
    return this.mutate(async () => {
      const manifest = await this.readManifest();
      if (manifest.activeThreadId === null) return publicSession(manifest);
      const index = manifest.tasks.findIndex(
        ({ threadId }) => threadId === manifest.activeThreadId,
      );
      if (index < 0 || manifest.tasks[index]!.lastTurnStatus !== 'inProgress') {
        return publicSession(manifest);
      }
      const tasks = [...manifest.tasks];
      tasks[index] = conversationTaskSchema.parse({
        ...tasks[index]!,
        lastTurnStatus: 'interrupted',
        updatedAt: new Date().toISOString(),
      });
      const updated = conversationManifestSchema.parse({ ...manifest, tasks });
      await this.writeManifest(updated);
      return publicSession(updated);
    });
  }

  activateThread(threadId: string, mode: 'new' | 'resume') {
    return this.mutate(async () => {
      const manifest = await this.readManifest();
      const now = new Date().toISOString();
      const existing = manifest.tasks.find(
        (candidate) => candidate.threadId === threadId,
      );
      const tasks: ConversationTask[] = manifest.tasks.map((task) => ({
        ...task,
        state: 'archived' as const,
      }));
      const active: ConversationTask =
        existing === undefined || mode === 'new'
          ? {
              threadId,
              state: 'active',
              turnCount: 0,
              lastTurnId: null,
              lastTurnKind: null,
              lastTurnStatus: null,
              lastUserMessage: null,
              lastAssistantSummary: null,
              sceneRevision: null,
              specRevision: null,
              createdAt: now,
              updatedAt: now,
            }
          : { ...existing, state: 'active', updatedAt: now };
      const existingIndex = tasks.findIndex(
        (task) => task.threadId === threadId,
      );
      if (existingIndex < 0) tasks.push(active);
      else tasks[existingIndex] = active;
      const updated = conversationManifestSchema.parse({
        ...manifest,
        activeThreadId: threadId,
        tasks,
      });
      await this.writeManifest(updated);
      return publicSession(updated);
    });
  }

  recordTurnStarted(
    threadId: string,
    turnId: string,
    input: ConversationTurnMetadataInput,
  ) {
    return this.updateTask(threadId, (task) => ({
      ...task,
      turnCount: task.turnCount + 1,
      lastTurnId: turnId,
      lastTurnKind: conversationTurnKindSchema.parse(input.kind),
      lastTurnStatus: 'inProgress',
      lastUserMessage: bounded(input.userMessage, 500),
      lastAssistantSummary: null,
      sceneRevision: input.sceneRevision ?? task.sceneRevision,
      specRevision: input.specRevision ?? task.specRevision,
    }));
  }

  recordAssistantSummary(threadId: string, turnId: string, text: string) {
    return this.updateTask(threadId, (task) =>
      task.lastTurnId !== turnId
        ? task
        : { ...task, lastAssistantSummary: bounded(text, 1_000) },
    );
  }

  recordTurnCompleted(
    threadId: string,
    turnId: string,
    status: 'completed' | 'failed' | 'interrupted',
  ) {
    return this.updateTask(threadId, (task) =>
      task.lastTurnId !== turnId
        ? task
        : {
            ...task,
            lastTurnStatus: conversationTurnStatusSchema.parse(status),
          },
    );
  }

  private updateTask(
    threadId: string,
    update: (task: ConversationTask) => ConversationTask,
  ) {
    return this.mutate(async () => {
      const manifest = await this.readManifest();
      const index = manifest.tasks.findIndex(
        (task) => task.threadId === threadId,
      );
      if (index < 0) return publicSession(manifest);
      const tasks = [...manifest.tasks];
      tasks[index] = conversationTaskSchema.parse({
        ...update(tasks[index]!),
        updatedAt: new Date().toISOString(),
      });
      const updated = conversationManifestSchema.parse({ ...manifest, tasks });
      await this.writeManifest(updated);
      return publicSession(updated);
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
    const manifestPath = path.join(this.projectRoot, 'conversations.json');
    try {
      return conversationManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return EMPTY_MANIFEST;
      }
      throw error;
    }
  }

  private async writeManifest(manifest: ConversationManifest) {
    const parsed = conversationManifestSchema.parse(manifest);
    const manifestPath = path.join(this.projectRoot, 'conversations.json');
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
