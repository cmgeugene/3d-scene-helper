import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { GenerationIntent } from '../shared/conversationMetadata';
import {
  expectedGenerationImageBindings,
  generationImageBindingSchema,
  validateGenerationImageDescriptors,
  type GenerationImageDescriptor,
} from '../shared/generationImageContract';
import type { CodexRuntime, TurnInput } from './appServerClient';
import type { JsonRpcNotification, JsonRpcServerRequest } from './jsonRpcPeer';

const compilerResponseSchema = z.object({
  finalPrompt: z.string().min(1),
  bindings: z.array(generationImageBindingSchema),
});
type CompilerResponse = z.infer<typeof compilerResponseSchema>;

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['finalPrompt', 'bindings'],
  properties: {
    finalPrompt: { type: 'string' },
    bindings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['attachmentIndex', 'role', 'authority'],
        properties: {
          attachmentIndex: { type: 'integer', minimum: 1 },
          role: {
            type: 'string',
            enum: [
              'layout',
              'sourceGeneration',
              'layoutReference',
              'backgroundReference',
              'characterReference',
              'styleReference',
            ],
          },
          authority: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export const IMAGEGEN_PROMPT_COMPILER_THREAD_SOURCE_PREFIX =
  'i2v-3d-scene-helper:imagegen-prompt-compiler';

const requiredPromptSections = [
  { label: 'Use case:', pattern: /^Use case\s*:/imu },
  { label: 'Primary request:', pattern: /^Primary request\s*:/imu },
  {
    label: 'Style and integration:',
    pattern: /^Style(?:\/medium)?[^:\n]*integration\s*:/imu,
  },
  {
    label: 'Strict invariants:',
    pattern: /^Strict[^:\n]*invariants\s*:/imu,
  },
  { label: 'Avoid:', pattern: /^Avoid\s*:/imu },
] as const;

const passiveCompilerItemTypes = new Set([
  'userMessage',
  'hookPrompt',
  'agentMessage',
  'plan',
  'reasoning',
  'imageView',
  'contextCompaction',
]);

function createCompilerTimeoutError() {
  return new Error(
    'Codex imagegen prompt compiler 응답 시간이 초과되었습니다.',
  );
}

function withCompilerDeadline<T>(operation: Promise<T>, deadlineMs: number) {
  return new Promise<T>((resolve, reject) => {
    const remainingMs = Math.max(0, deadlineMs - Date.now());
    const timeout = setTimeout(
      () => reject(createCompilerTimeoutError()),
      remainingMs,
    );
    timeout.unref();
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export interface ImagegenSkillPromptCompilerOptions {
  runtime: CodexRuntime;
  projectRoot: string;
  sourcePrompt: string;
  generationIntent: GenerationIntent | null;
  images: Array<GenerationImageDescriptor & { path: string }>;
  onThreadStarted?: (threadId: string) => void;
  timeoutMs?: number;
}

export interface ImagegenSkillPromptCompilerResult {
  finalPrompt: string;
  bindings: z.infer<typeof generationImageBindingSchema>[];
  compiler: 'codex-imagegen-skill';
  compilerThreadId: string;
  compilerTurnId: string;
}

function removeCompilerOwnedImageAuthoritySection(prompt: string) {
  const normalized = prompt.replace(/\r\n?/gu, '\n').trim();
  const lines = normalized.split('\n');
  const headingIndex = lines.findIndex((line) =>
    /^(?:Input images|Image roles)[^:\n]*:/iu.test(line.trim()),
  );
  if (headingIndex < 0) return normalized;
  let endIndex = headingIndex + 1;
  while (endIndex < lines.length) {
    if (/^[A-Z][A-Za-z0-9 /&()_-]{2,100}:\s*/u.test(lines[endIndex]!.trim())) {
      break;
    }
    endIndex += 1;
  }
  return [...lines.slice(0, headingIndex), ...lines.slice(endIndex)]
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function createCanonicalImageAuthorityBlock(
  descriptors: GenerationImageDescriptor[],
) {
  const canonical = validateGenerationImageDescriptors(descriptors);
  const lines = canonical.flatMap(
    ({
      attachmentIndex,
      role,
      artifactId,
      targetObjectId,
      authority,
      prohibitedAuthority,
    }) => [
      `Image ${attachmentIndex} — role: ${role}; artifactId: ${artifactId}; targetObjectId: ${targetObjectId ?? 'scene-wide'}.`,
      `  Authority: ${authority.join('; ')}.`,
      `  Must not control: ${prohibitedAuthority.join('; ')}.`,
    ],
  );
  return `[SERVER-OWNED CANONICAL IMAGE ROLES AND AUTHORITY — IMMUTABLE]
This block is generated from the actual ordered attachments after prompt compilation. It overrides any conflicting image number, role, or authority statement elsewhere in the prompt. Every listed image is attached and must be used only within its assigned authority.
${lines.join('\n')}
Image 1 is always the current OutputCamera 3D layout and the non-negotiable highest spatial authority. Conversation-local image numbers are never production attachment identities.`;
}

function composeProductionPrompt(
  compilerPrompt: string,
  descriptors: GenerationImageDescriptor[],
) {
  return `${createCanonicalImageAuthorityBlock(descriptors)}

[IMAGEGEN SKILL CREATIVE AND INTEGRATION INSTRUCTIONS]
${removeCompilerOwnedImageAuthoritySection(compilerPrompt)}`;
}

function validateFinalPrompt(finalPrompt: string) {
  const inspected = finalPrompt.replace(/\r\n?/gu, '\n').trim();
  if (inspected.length < 300) {
    throw new Error(
      'Codex imagegen 스킬이 충분한 최종 운영 프롬프트를 반환하지 않았습니다.',
    );
  }
  for (const { label, pattern } of requiredPromptSections) {
    if (!pattern.test(inspected)) {
      throw new Error(
        `Codex imagegen 스킬 최종 프롬프트에 ${label} 섹션이 없습니다.`,
      );
    }
  }
  return inspected;
}

function validateCompilerBindings(
  descriptors: GenerationImageDescriptor[],
  bindings: z.infer<typeof generationImageBindingSchema>[],
) {
  const expected = expectedGenerationImageBindings(descriptors);
  if (JSON.stringify(bindings) !== JSON.stringify(expected)) {
    throw new Error(
      'Codex imagegen 스킬이 서버가 고정한 이미지 역할 또는 권위 바인딩을 변경했습니다.',
    );
  }
  return bindings;
}

function buildCompilerRequest(
  sourcePrompt: string,
  generationIntent: GenerationIntent | null,
  descriptors: GenerationImageDescriptor[],
) {
  const sourceWithoutTrigger = sourcePrompt.replace(
    /^\$imagegen(?:\s+|$)/u,
    '',
  );
  const confirmedIntent =
    generationIntent === null
      ? 'None. Use only the supplied scene evidence and role-bound images.'
      : JSON.stringify(generationIntent);

  const canonicalBindings = expectedGenerationImageBindings(descriptors);
  const descriptorManifest = descriptors.map(
    ({
      attachmentIndex,
      role,
      artifactId,
      targetObjectId,
      authority,
      prohibitedAuthority,
    }) => ({
      attachmentIndex,
      role,
      artifactId,
      targetObjectId,
      authority,
      prohibitedAuthority,
    }),
  );

  return `$imagegen

PLANNING-ONLY HANDOFF.
Load and follow the actual imagegen skill installed in Codex and its prompt-shaping references. This turn prepares the exact production prompt for a separate image_generation call; it must not generate an image itself.

DO NOT invoke image_gen, image_generation, scripts/image_gen.py, a CLI, or any other tool. Return only JSON matching the supplied output schema. Copy the canonical bindings below byte-for-byte as the bindings value; do not reinterpret, reorder, omit, or weaken any role or authority.

Write the creative, scene-specific and integration portion of the final prompt. Apply the imagegen skill's real prompt-shaping judgment rather than copying or summarizing the source request. Do not assign production image numbers or author an image-role section; the server will replace any such section with its immutable canonical block after this turn. Refer to inputs by semantic role or stable reference id. The finalPrompt must include these labeled operational sections:
- Use case:
- Primary request:
- Style/medium and integration: or Style and integration:
- Strict composition and camera invariants: or Strict invariants:
- Avoid:

Image 1 is always the current OutputCamera 3D layout and the highest authority for camera, crop, perspective, placement, pose, scale, depth order, and occlusion. A source generation is appearance evidence only and must never override those spatial attributes. Conversation intent cannot override the layout contract; if it conflicts, preserve the layout. Any image number found inside confirmed conversation intent is conversation-local and must be resolved through its stable referenceBindings, never copied as a production attachment number. Treat proxy geometry, guide colors, and editor appearance as non-authoritative. Integrate role-bound appearance references without copying their pose, framing, background, text, or sheet layout. Preserve strict invariants verbatim enough to prevent drift.

[CANONICAL IMAGE DESCRIPTORS]
${JSON.stringify(descriptorManifest)}

[CANONICAL OUTPUT BINDINGS — RETURN EXACTLY]
${JSON.stringify(canonicalBindings)}

[CONFIRMED CONVERSATION INTENT]
${confirmedIntent}

[FULL SOURCE REQUEST AND SCENE EVIDENCE]
${sourceWithoutTrigger}`;
}

export async function compileImagegenSkillPrompt(
  options: ImagegenSkillPromptCompilerOptions,
): Promise<ImagegenSkillPromptCompilerResult> {
  const descriptors = validateGenerationImageDescriptors(options.images);
  const deadlineMs = Date.now() + (options.timeoutMs ?? 180_000);
  const threadSource = `${IMAGEGEN_PROMPT_COMPILER_THREAD_SOURCE_PREFIX}:${randomUUID()}`;
  const compilerThreadId = await withCompilerDeadline(
    options.runtime.startThread(options.projectRoot, {
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      threadSource,
    }),
    deadlineMs,
  );
  options.onThreadStarted?.(compilerThreadId);
  const bufferedNotifications: JsonRpcNotification[] = [];
  const observedTurnIds = new Set<string>();
  const interruptPromises = new Map<string, Promise<void>>();
  let compilerTurnId: string | null = null;
  let agentText: string | null = null;
  let settled = false;
  let timeout: NodeJS.Timeout | null = null;
  let retainListenersForLateStart = false;
  let listenersRemoved = false;
  let interruptRequested = false;
  let startTurnSettled = false;
  let startTurnOperation: Promise<string> | null = null;
  let resolveCompletion!: (value: CompilerResponse) => void;
  let rejectCompletion!: (error: Error) => void;
  const completion = new Promise<CompilerResponse>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const cleanupListeners = () => {
    if (listenersRemoved) return;
    listenersRemoved = true;
    options.runtime.off('notification', handleNotification);
    options.runtime.off('serverRequest', handleServerRequest);
  };
  const interruptKnownTurns = async (error: Error) => {
    try {
      await Promise.all(
        [...observedTurnIds].map((turnId) => {
          const existing = interruptPromises.get(turnId);
          if (existing !== undefined) return existing;
          const interruption = options.runtime.interruptTurn(
            compilerThreadId,
            turnId,
          );
          interruptPromises.set(turnId, interruption);
          return interruption;
        }),
      );
      return error;
    } catch (interruptError) {
      return new Error(
        `${error.message} Turn 중단에도 실패했습니다: ${
          interruptError instanceof Error
            ? interruptError.message
            : String(interruptError)
        }`,
      );
    }
  };
  const fail = (error: Error, interrupt = false) => {
    if (settled) {
      if (interrupt) void interruptKnownTurns(error);
      return;
    }
    settled = true;
    interruptRequested ||= interrupt;
    void (async () => {
      const rejection = interruptRequested
        ? await interruptKnownTurns(error)
        : error;
      rejectCompletion(rejection);
    })();
  };

  const handleNotification = (notification: JsonRpcNotification) => {
    const params = notification.params as {
      threadId?: unknown;
      turnId?: unknown;
      item?: { type?: unknown; text?: unknown };
      turn?: { id?: unknown; status?: unknown; error?: unknown };
    };
    if (params.threadId !== compilerThreadId) return;
    const rawNotificationTurnId = params.turnId ?? params.turn?.id;
    const notificationTurnId =
      typeof rawNotificationTurnId === 'string' ? rawNotificationTurnId : null;
    if (notificationTurnId !== null) {
      observedTurnIds.add(notificationTurnId);
    }
    if (compilerTurnId === null && notificationTurnId === null) {
      bufferedNotifications.push(notification);
      return;
    }
    if (compilerTurnId !== null && notificationTurnId !== compilerTurnId) {
      return;
    }

    if (params.item?.type === 'imageGeneration') {
      fail(
        new Error(
          'Codex imagegen prompt compiler가 planning-only 경계에서 이미지 도구를 호출하려 했습니다.',
        ),
        true,
      );
      return;
    }
    if (
      typeof params.item?.type === 'string' &&
      !passiveCompilerItemTypes.has(params.item.type)
    ) {
      fail(
        new Error(
          `Codex imagegen prompt compiler가 planning-only 경계에서 ${params.item.type} 도구 실행을 시도했습니다.`,
        ),
        true,
      );
      return;
    }
    if (
      notification.method === 'item/completed' &&
      params.item?.type === 'agentMessage' &&
      typeof params.item.text === 'string'
    ) {
      agentText = params.item.text;
      return;
    }
    if (notification.method !== 'turn/completed') return;
    if (params.turn?.status !== 'completed') {
      fail(
        new Error(
          `Codex imagegen prompt compiler turn이 ${String(params.turn?.status)} 상태로 종료되었습니다.`,
        ),
      );
      return;
    }
    if (agentText === null) {
      fail(
        new Error(
          'Codex imagegen prompt compiler가 최종 agentMessage를 반환하지 않았습니다.',
        ),
      );
      return;
    }
    try {
      const { finalPrompt, bindings } = compilerResponseSchema.parse(
        JSON.parse(agentText),
      );
      const validatedPrompt = composeProductionPrompt(
        validateFinalPrompt(finalPrompt),
        descriptors,
      );
      const validatedBindings = validateCompilerBindings(descriptors, bindings);
      settled = true;
      resolveCompletion({
        finalPrompt: validatedPrompt,
        bindings: validatedBindings,
      });
    } catch (error) {
      fail(
        error instanceof Error
          ? error
          : new Error('Codex imagegen prompt compiler 응답을 읽지 못했습니다.'),
      );
    }
  };

  const handleServerRequest = (request: JsonRpcServerRequest) => {
    const params =
      request.params !== null && typeof request.params === 'object'
        ? request.params
        : null;
    const directThreadId =
      params !== null &&
      'threadId' in params &&
      typeof params.threadId === 'string'
        ? params.threadId
        : null;
    const nestedThreadId =
      params !== null &&
      'thread' in params &&
      params.thread !== null &&
      typeof params.thread === 'object' &&
      'id' in params.thread &&
      typeof params.thread.id === 'string'
        ? params.thread.id
        : null;
    if ((directThreadId ?? nestedThreadId) !== compilerThreadId) return;
    const requestTurnId =
      params !== null && 'turnId' in params && typeof params.turnId === 'string'
        ? params.turnId
        : null;
    if (requestTurnId !== null) {
      observedTurnIds.add(requestTurnId);
    }
    options.runtime.rejectServerRequest?.(
      request.id,
      -32600,
      'Imagegen prompt compiler planning-only turn은 server request를 허용하지 않습니다.',
    );
    fail(
      new Error(
        `Codex imagegen prompt compiler가 planning-only 경계에서 ${request.method} server request를 시도했습니다.`,
      ),
      true,
    );
  };

  options.runtime.on('notification', handleNotification);
  options.runtime.on('serverRequest', handleServerRequest);
  try {
    const input: TurnInput[] = [
      {
        type: 'text',
        text: buildCompilerRequest(
          options.sourcePrompt,
          options.generationIntent,
          descriptors,
        ),
      },
      ...options.images.map(({ path: filePath }) => ({
        type: 'localImage' as const,
        path: filePath,
        detail: 'original' as const,
      })),
    ];
    startTurnOperation = options.runtime.startTurn(compilerThreadId, input, {
      outputSchema,
    });
    const trackedStartTurn = startTurnOperation.then(
      (turnId) => {
        startTurnSettled = true;
        compilerTurnId = turnId;
        observedTurnIds.add(turnId);
        return turnId;
      },
      (error: unknown) => {
        startTurnSettled = true;
        throw error;
      },
    );
    const earlyFailure = completion.then(
      () => new Promise<never>(() => undefined),
      (error: unknown) => Promise.reject(error),
    );
    compilerTurnId = await Promise.race([
      withCompilerDeadline(trackedStartTurn, deadlineMs),
      earlyFailure,
    ]);
    observedTurnIds.add(compilerTurnId);
    if (interruptRequested) {
      await interruptKnownTurns(
        new Error('실패한 compiler turn을 완전히 중단하지 못했습니다.'),
      );
      await completion;
    }
    for (const notification of bufferedNotifications.splice(0)) {
      handleNotification(notification);
    }
    timeout = setTimeout(
      () => {
        fail(createCompilerTimeoutError(), true);
      },
      Math.max(0, deadlineMs - Date.now()),
    );
    const validated = await completion;
    return {
      finalPrompt: validated.finalPrompt,
      bindings: validated.bindings,
      compiler: 'codex-imagegen-skill',
      compilerThreadId,
      compilerTurnId,
    };
  } catch (error) {
    const failure =
      error instanceof Error
        ? error
        : new Error('Codex imagegen prompt compiler가 실패했습니다.');
    if (!settled) {
      fail(failure, true);
    }
    if (startTurnOperation !== null && !startTurnSettled) {
      retainListenersForLateStart = true;
      void startTurnOperation.then(
        async (turnId) => {
          startTurnSettled = true;
          compilerTurnId = turnId;
          observedTurnIds.add(turnId);
          const interruptionError = await interruptKnownTurns(failure);
          if (interruptionError === failure) cleanupListeners();
        },
        () => {
          startTurnSettled = true;
          cleanupListeners();
        },
      );
    } else if (interruptRequested) {
      const interruptionError = await interruptKnownTurns(failure);
      if (interruptionError !== failure) throw interruptionError;
    }
    throw failure;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
    if (!retainListenersForLateStart) cleanupListeners();
  }
}
