// @vitest-environment node

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type {
  AppServerStatus,
  CodexRuntime,
  TurnInput,
  TurnOptions,
} from './appServerClient';
import { compileImagegenSkillPrompt } from './imagegenSkillPromptCompiler';

const compiledPrompt = `Use case: photorealistic-natural
Asset type: single finished cinematic keyframe

Primary request:
Generate one integrated final keyframe from the authoritative 3D layout and role-bound references.

Input images and authority:
- Image 1 is the spatial layout authority.
- Image 2 is background appearance only.

Style/medium and integration:
Create one cohesive cinematic image with matched perspective, lighting, materials, and ground contact.

Strict composition and camera invariants:
Preserve OutputCamera viewpoint, crop, placement, pose, scale, depth order, and occlusion exactly.

Avoid:
No proxy geometry, pose drift, camera drift, extra characters, text, logos, borders, or watermark.`;

class FakeRuntime extends EventEmitter implements CodexRuntime {
  readonly status: AppServerStatus = {
    state: 'ready',
    version: 'codex-test',
    account: { type: 'chatgpt', email: null, planType: 'plus' },
    requiresOpenaiAuth: true,
    capabilities: {
      namespaceTools: true,
      imageGeneration: true,
      webSearch: true,
    },
    error: null,
  };
  readonly startThread = vi.fn(async () => 'thread-compiler');
  readonly startTurn = vi.fn<
    (
      threadId: string,
      input: TurnInput[],
      options?: TurnOptions,
    ) => Promise<string>
  >(async () => 'turn-compiler');
  readonly interruptTurn = vi.fn<
    (threadId: string, turnId: string) => Promise<void>
  >(async () => undefined);
  readonly rejectServerRequest = vi.fn();
  async start() {}
  async stop() {}
  async refreshAccount() {
    return this.status;
  }
  async resumeThread(threadId: string) {
    return threadId;
  }
}

function emitCompletedPrompt(
  runtime: FakeRuntime,
  finalPrompt = compiledPrompt,
) {
  setTimeout(() => {
    runtime.emit('notification', {
      method: 'item/completed',
      params: {
        threadId: 'thread-compiler',
        turnId: 'turn-compiler',
        item: {
          type: 'agentMessage',
          id: 'message-compiler',
          text: JSON.stringify({ finalPrompt }),
        },
      },
    });
    runtime.emit('notification', {
      method: 'turn/completed',
      params: {
        threadId: 'thread-compiler',
        turn: { id: 'turn-compiler', status: 'completed', error: null },
      },
    });
  }, 0);
}

describe('compileImagegenSkillPrompt', () => {
  it('runs the actual $imagegen skill in an isolated planning-only turn', async () => {
    const runtime = new FakeRuntime();
    const onThreadStarted = vi.fn();
    emitCompletedPrompt(runtime);

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen\n[SceneDocument]\nscene evidence',
        generationIntent: {
          revision: 4,
          sourceTurnId: 'turn-intent-4',
          userMessage: '맑은 낮의 애니메이션 장면으로 만들어줘.',
          assistantSummary: '밝은 낮과 애니메이션 마감을 반영합니다.',
          sceneRevision: 12,
          specRevision: 5,
        },
        filePaths: ['/project-data/layout.png', '/project-data/style.png'],
        onThreadStarted,
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({
      finalPrompt: compiledPrompt,
      compiler: 'codex-imagegen-skill',
    });

    expect(runtime.startThread).toHaveBeenCalledWith(
      '/project-data',
      expect.objectContaining({
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        threadSource: expect.stringMatching(
          /^i2v-3d-scene-helper:imagegen-prompt-compiler:/u,
        ),
      }),
    );
    expect(onThreadStarted).toHaveBeenCalledWith('thread-compiler');
    expect(runtime.startTurn).toHaveBeenCalledOnce();
    const [threadId, input, options] = runtime.startTurn.mock.calls[0]!;
    expect(threadId).toBe('thread-compiler');
    expect(input[0]).toMatchObject({ type: 'text' });
    const compilerRequest = (input[0] as { type: 'text'; text: string }).text;
    expect(compilerRequest).toMatch(/^\$imagegen\n/u);
    expect(compilerRequest).toContain('PLANNING-ONLY HANDOFF');
    expect(compilerRequest).toContain('actual imagegen skill');
    expect(compilerRequest).toContain('맑은 낮의 애니메이션 장면');
    expect(compilerRequest.match(/\$imagegen/gu)).toHaveLength(1);
    expect(input.slice(1)).toEqual([
      {
        type: 'localImage',
        path: '/project-data/layout.png',
        detail: 'original',
      },
      {
        type: 'localImage',
        path: '/project-data/style.png',
        detail: 'original',
      },
    ]);
    expect(options).toMatchObject({
      outputSchema: {
        required: ['finalPrompt'],
      },
    });
    expect(runtime.interruptTurn).not.toHaveBeenCalled();
  });

  it('interrupts and rejects if the planning turn attempts image generation', async () => {
    const runtime = new FakeRuntime();
    setTimeout(() => {
      runtime.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread-compiler',
          turnId: 'turn-compiler',
          item: { type: 'imageGeneration', id: 'image-tool-call' },
        },
      });
    }, 0);

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png'],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('이미지 도구를 호출하려 했습니다');
    expect(runtime.interruptTurn).toHaveBeenCalledWith(
      'thread-compiler',
      'turn-compiler',
    );
  });

  it('rejects command execution and waits for interruption to finish', async () => {
    const runtime = new FakeRuntime();
    let finishInterrupt!: () => void;
    runtime.interruptTurn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishInterrupt = resolve;
        }),
    );
    setTimeout(() => {
      runtime.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread-compiler',
          turnId: 'turn-compiler',
          item: { type: 'commandExecution', id: 'command-tool-call' },
        },
      });
    }, 0);

    const compilation = compileImagegenSkillPrompt({
      runtime,
      projectRoot: '/project-data',
      sourcePrompt: '$imagegen scene evidence',
      generationIntent: null,
      filePaths: ['/project-data/layout.png'],
      timeoutMs: 1_000,
    });
    const observed = compilation.then(
      () => 'resolved',
      (error: unknown) =>
        `rejected:${error instanceof Error ? error.message : String(error)}`,
    );

    await vi.waitFor(() => {
      expect(runtime.interruptTurn).toHaveBeenCalledWith(
        'thread-compiler',
        'turn-compiler',
      );
    });
    await expect(
      Promise.race([
        observed,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('interrupt-pending'), 10),
        ),
      ]),
    ).resolves.toBe('interrupt-pending');

    finishInterrupt();
    await expect(observed).resolves.toContain('도구 실행을 시도했습니다');
  });

  it('surfaces an interrupt failure instead of swallowing it', async () => {
    const runtime = new FakeRuntime();
    runtime.interruptTurn.mockRejectedValue(new Error('interrupt RPC failed'));
    setTimeout(() => {
      runtime.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread-compiler',
          turnId: 'turn-compiler',
          item: { type: 'imageGeneration', id: 'image-tool-call' },
        },
      });
    }, 0);

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png'],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('interrupt RPC failed');
  });

  it('fails closed on an unknown future item type', async () => {
    const runtime = new FakeRuntime();
    setTimeout(() => {
      runtime.emit('notification', {
        method: 'item/started',
        params: {
          threadId: 'thread-compiler',
          turnId: 'turn-compiler',
          item: { type: 'futureToolCall', id: 'future-tool-call' },
        },
      });
    }, 0);

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png'],
        timeoutMs: 50,
      }),
    ).rejects.toThrow('도구 실행을 시도했습니다');
    expect(runtime.interruptTurn).toHaveBeenCalledWith(
      'thread-compiler',
      'turn-compiler',
    );
  });

  it('rejects compiler server requests instead of exposing approvals', async () => {
    const runtime = new FakeRuntime();
    setTimeout(() => {
      runtime.emit('serverRequest', {
        id: 77,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: 'thread-compiler',
          turnId: 'turn-compiler',
        },
      });
    }, 0);

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png'],
        timeoutMs: 50,
      }),
    ).rejects.toThrow('server request');
    expect(runtime.rejectServerRequest).toHaveBeenCalledWith(
      77,
      -32600,
      expect.stringContaining('planning-only'),
    );
  });

  it('guards and interrupts an early server request while startTurn is pending', async () => {
    const runtime = new FakeRuntime();
    let resolveStartTurn!: (turnId: string) => void;
    runtime.startTurn.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveStartTurn = resolve;
        }),
    );
    const compilation = compileImagegenSkillPrompt({
      runtime,
      projectRoot: '/project-data',
      sourcePrompt: '$imagegen scene evidence',
      generationIntent: null,
      filePaths: ['/project-data/layout.png'],
      timeoutMs: 1_000,
    });
    const observed = compilation.then(
      () => 'resolved',
      (error: unknown) =>
        `rejected:${error instanceof Error ? error.message : String(error)}`,
    );

    await vi.waitFor(() => {
      expect(runtime.startTurn).toHaveBeenCalledOnce();
    });
    runtime.emit('serverRequest', {
      id: 88,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-compiler',
        turnId: 'turn-early',
      },
    });

    await expect(
      Promise.race([
        observed,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('still-pending'), 50),
        ),
      ]),
    ).resolves.toContain('server request');
    expect(runtime.interruptTurn).toHaveBeenCalledWith(
      'thread-compiler',
      'turn-early',
    );
    expect(runtime.listenerCount('serverRequest')).toBeGreaterThan(0);

    resolveStartTurn('turn-early');
    await vi.waitFor(() => {
      expect(runtime.listenerCount('serverRequest')).toBe(0);
      expect(runtime.listenerCount('notification')).toBe(0);
    });
  });

  it('bounds thread creation with the overall compiler deadline', async () => {
    const runtime = new FakeRuntime();
    runtime.startThread.mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const observed = compileImagegenSkillPrompt({
      runtime,
      projectRoot: '/project-data',
      sourcePrompt: '$imagegen scene evidence',
      generationIntent: null,
      filePaths: ['/project-data/layout.png'],
      timeoutMs: 20,
    }).then(
      () => 'resolved',
      (error: unknown) =>
        `rejected:${error instanceof Error ? error.message : String(error)}`,
    );

    await expect(
      Promise.race([
        observed,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('still-pending'), 80),
        ),
      ]),
    ).resolves.toContain('응답 시간이 초과되었습니다');
  });

  it('bounds turn start with the same overall compiler deadline', async () => {
    const runtime = new FakeRuntime();
    runtime.startTurn.mockImplementation(
      () => new Promise<string>(() => undefined),
    );
    const observed = compileImagegenSkillPrompt({
      runtime,
      projectRoot: '/project-data',
      sourcePrompt: '$imagegen scene evidence',
      generationIntent: null,
      filePaths: ['/project-data/layout.png'],
      timeoutMs: 20,
    }).then(
      () => 'resolved',
      (error: unknown) =>
        `rejected:${error instanceof Error ? error.message : String(error)}`,
    );

    await expect(
      Promise.race([
        observed,
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('still-pending'), 80),
        ),
      ]),
    ).resolves.toContain('응답 시간이 초과되었습니다');
  });

  it('interrupts a turn that resolves after the startTurn deadline', async () => {
    const runtime = new FakeRuntime();
    let resolveStartTurn!: (turnId: string) => void;
    runtime.startTurn.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveStartTurn = resolve;
        }),
    );

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png'],
        timeoutMs: 20,
      }),
    ).rejects.toThrow('응답 시간이 초과되었습니다');
    expect(runtime.listenerCount('notification')).toBeGreaterThan(0);
    expect(runtime.listenerCount('serverRequest')).toBeGreaterThan(0);

    resolveStartTurn('turn-late');
    await vi.waitFor(() => {
      expect(runtime.interruptTurn).toHaveBeenCalledWith(
        'thread-compiler',
        'turn-late',
      );
      expect(runtime.listenerCount('notification')).toBe(0);
      expect(runtime.listenerCount('serverRequest')).toBe(0);
    });
  });

  it('interrupts a prohibited item observed after the startTurn deadline', async () => {
    const runtime = new FakeRuntime();
    let resolveStartTurn!: (turnId: string) => void;
    runtime.startTurn.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveStartTurn = resolve;
        }),
    );

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png'],
        timeoutMs: 20,
      }),
    ).rejects.toThrow('응답 시간이 초과되었습니다');
    runtime.emit('notification', {
      method: 'item/started',
      params: {
        threadId: 'thread-compiler',
        turnId: 'turn-observed-after-deadline',
        item: { type: 'commandExecution' },
      },
    });
    await Promise.resolve();

    try {
      expect(runtime.interruptTurn).toHaveBeenCalledWith(
        'thread-compiler',
        'turn-observed-after-deadline',
      );
      expect(runtime.listenerCount('notification')).toBeGreaterThan(0);
    } finally {
      resolveStartTurn('turn-observed-after-deadline');
      await vi.waitFor(() => {
        expect(runtime.listenerCount('notification')).toBe(0);
        expect(runtime.listenerCount('serverRequest')).toBe(0);
      });
    }
  });

  it('rejects a final prompt that omits an attached image role', async () => {
    const runtime = new FakeRuntime();
    emitCompletedPrompt(
      runtime,
      compiledPrompt.replace('- Image 2 is background appearance only.\n', ''),
    );

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png', '/project-data/background.png'],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('모든 입력 이미지');
  });

  it('rejects an explicitly unassigned image role', async () => {
    const runtime = new FakeRuntime();
    emitCompletedPrompt(
      runtime,
      compiledPrompt.replace(
        'Image 2 is background appearance only.',
        'Image 2 is intentionally unassigned.',
      ),
    );

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png', '/project-data/background.png'],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('역할 바인딩');
  });

  it('returns the validated skill prompt byte-for-byte unchanged', async () => {
    const runtime = new FakeRuntime();
    const promptWithBoundaryWhitespace = `\n${compiledPrompt}\n`;
    emitCompletedPrompt(runtime, promptWithBoundaryWhitespace);

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png', '/project-data/background.png'],
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({ finalPrompt: promptWithBoundaryWhitespace });
  });

  it('rejects an answer that is not the structured imagegen production prompt', async () => {
    const runtime = new FakeRuntime();
    emitCompletedPrompt(
      runtime,
      `Use case: photorealistic-natural
Primary request: Generate a complete cinematic keyframe from the supplied scene evidence.
Input images and authority: Image 1 controls layout; Image 2 controls background appearance only.
Style/medium and integration: Integrate all role-bound references into one coherent photographed moment with natural materials and matched lighting.
Avoid: No proxy geometry, camera drift, pose drift, extra subjects, typography, logos, borders, panels, or watermark. Preserve every supplied role boundary and do not cross-copy information between reference images.`,
    );

    await expect(
      compileImagegenSkillPrompt({
        runtime,
        projectRoot: '/project-data',
        sourcePrompt: '$imagegen scene evidence',
        generationIntent: null,
        filePaths: ['/project-data/layout.png'],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('Strict');
  });
});
