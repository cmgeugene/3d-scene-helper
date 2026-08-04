// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GenerationStore } from './generationStore';
import { TEST_LAYOUT_SPEC } from '../shared/layoutSpecTestFixture';
import { createStarterSceneDocument } from '../src/editor/persistence/sceneSchema';
import {
  createImageGenerationPrompt,
  createImageRefinementPrompt,
} from '../src/assistant/sceneAssistantPrompt';

const tempRoots: string[] = [];
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function createStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'i2v-generation-store-'));
  tempRoots.push(root);
  return { root, store: new GenerationStore(root) };
}

function createSceneSnapshot() {
  const scene = createStarterSceneDocument({
    documentId: 'scene-test',
    floorId: 'floor-test',
    mannequinId: 'mannequin-test',
  });
  scene.semanticSceneSpec.intent.location = '한국 노포 야외 치킨집';
  scene.semanticSceneSpec.extras = {
    enabled: true,
    minCount: 5,
    maxCount: 8,
    placement: '오른쪽 배경',
    importance: '주인공보다 낮음',
  };
  return scene;
}

const referenceSnapshot = {
  id: 'ref-1',
  name: '정민 캐릭터 시트',
  kind: 'character' as const,
  artifactId: 'artifact-ref-1',
  contentHash: `sha256:${'a'.repeat(64)}`,
  mimeType: 'image/png' as const,
  width: 1024,
  height: 1024,
  originalFileName: 'jeongmin.png',
  byteLength: 100,
  createdAt: '2026-08-03T00:00:00.000Z',
  targetObjectId: 'mannequin-test',
  use: ['face', 'hair', 'clothing'],
  exclude: ['pose'],
  enabled: true,
};

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('GenerationStore', () => {
  it('request ID와 fingerprint를 보존하고 재시작 고아 작업을 interrupted로 복구한다', async () => {
    const { root, store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    const requestFingerprint = `sha256:${'d'.repeat(64)}`;
    const generation = await store.createGeneration({
      requestId: 'generation-request-store-1',
      requestFingerprint,
      threadId: 'thread-idempotent',
      turnId: 'turn-idempotent',
      prompt: '$imagegen idempotent',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [],
      layoutRenderId: render.id,
      referenceIds: [],
      attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
    });

    await expect(
      store.findGenerationRequest('generation-request-store-1'),
    ).resolves.toMatchObject({
      requestFingerprint,
      generation: {
        id: generation.id,
        requestId: 'generation-request-store-1',
        status: 'inProgress',
      },
    });
    expect((await store.listGenerations())[0]).not.toHaveProperty(
      'requestFingerprint',
    );

    const restarted = new GenerationStore(root);
    await expect(
      restarted.recoverInProgressGenerations('Companion restart test'),
    ).resolves.toEqual([
      expect.objectContaining({
        id: generation.id,
        status: 'interrupted',
        error: 'Companion restart test',
      }),
    ]);
    await expect(
      restarted.recoverInProgressGenerations('second recovery'),
    ).resolves.toEqual([]);
    await expect(restarted.listGenerations()).resolves.toEqual([
      expect.objectContaining({
        requestId: 'generation-request-store-1',
        status: 'interrupted',
      }),
    ]);
  });

  it('구도와 Codex 결과를 프로젝트 artifact로 보관한다', async () => {
    const { root, store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    const generation = await store.createGeneration({
      threadId: 'thread-1',
      turnId: 'turn-1',
      prompt: '$imagegen 테스트',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [referenceSnapshot],
      layoutRenderId: render.id,
      referenceIds: ['ref-1'],
      attachments: [
        { type: 'layout', id: render.id, kind: 'layout' },
        { type: 'reference', id: 'ref-1', kind: 'character' },
      ],
    });
    const source = path.join(root, 'codex-result.png');
    await writeFile(source, onePixelPng);

    const imported = await store.importGenerationResult(
      'turn-1',
      source,
      'revised prompt',
    );
    const completed = await store.completeTurn('turn-1', 'completed', null);

    expect(imported).toMatchObject({
      id: generation.id,
      layoutSpec: { sceneId: 'scene-test' },
      sceneSnapshot: { id: 'scene-test' },
      semanticSceneSpecSnapshot: {
        version: 1,
        intent: { location: '한국 노포 야외 치킨집' },
        extras: { enabled: true, minCount: 5, maxCount: 8 },
      },
      referenceSnapshots: [expect.objectContaining({ id: 'ref-1' })],
      parentGenerationId: null,
      versionNumber: 1,
      feedback: null,
      generationMode: 'fresh',
      revisedPrompt: 'revised prompt',
      result: { mimeType: 'image/png', width: 1, height: 1 },
    });
    expect(completed).toMatchObject({ status: 'completed' });
    expect(completed).not.toHaveProperty('result.assetPath');
    const content = await store.readGenerationContent(generation.id);
    expect(content.data).toEqual(onePixelPng);
    expect(content.mimeType).toBe('image/png');
    const layoutContent = await store.readSceneRenderContent(render.id);
    expect(layoutContent.data).toEqual(onePixelPng);
    expect(layoutContent.mimeType).toBe('image/png');
    expect(layoutContent.render).toMatchObject({
      id: render.id,
      sceneId: 'scene-test',
    });
    const restartedStore = new GenerationStore(root);
    await expect(restartedStore.listGenerations()).resolves.toEqual([
      expect.objectContaining({ id: generation.id, status: 'completed' }),
    ]);
    await expect(
      restartedStore.readSceneRenderContent(render.id),
    ).resolves.toMatchObject({ data: onePixelPng, mimeType: 'image/png' });

    const manifest = JSON.parse(
      await readFile(path.join(root, 'generations.json'), 'utf8'),
    ) as { generations: Array<{ result: { assetPath: string } }> };
    expect(manifest.generations[0]?.result.assetPath).toMatch(
      /^generations\/artifact_.+\.png$/,
    );
  });

  it('입력 스냅샷 해시와 실제 첨부 순서를 저장하고 prompt 근거를 재검증한다', async () => {
    const { root, store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    const scene = createSceneSnapshot();
    const parent = await store.createGeneration({
      requestId: 'request-summary-parent',
      requestFingerprint: `sha256:${'d'.repeat(64)}`,
      threadId: 'thread-summary-parent',
      turnId: 'turn-summary-parent',
      prompt: createImageGenerationPrompt(scene, TEST_LAYOUT_SPEC, [
        referenceSnapshot,
      ]),
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: scene,
      referenceSnapshots: [referenceSnapshot],
      layoutRenderId: render.id,
      referenceIds: [referenceSnapshot.id],
      attachments: [
        { type: 'layout', id: render.id, kind: 'layout' },
        { type: 'reference', id: referenceSnapshot.id, kind: 'character' },
      ],
    });
    const sourcePath = path.join(root, 'summary-source.png');
    await writeFile(sourcePath, onePixelPng);
    const completedParent = await store.importGenerationResult(
      parent.turnId,
      sourcePath,
      null,
    );
    await store.completeTurn(parent.turnId, 'completed', null);

    const child = await store.createGeneration({
      requestId: 'request-summary-child',
      requestFingerprint: `sha256:${'e'.repeat(64)}`,
      threadId: 'thread-summary-child',
      turnId: 'turn-summary-child',
      prompt: createImageRefinementPrompt(
        {
          version: 1,
          preserve: ['전체 구도'],
          change: ['조명만 밝게'],
        },
        scene,
        TEST_LAYOUT_SPEC,
        parent,
        [referenceSnapshot],
      ),
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: scene,
      referenceSnapshots: [referenceSnapshot],
      parentGenerationId: parent.id,
      feedback: '조명만 밝게',
      refinementDirective: {
        version: 1,
        preserve: ['전체 구도'],
        change: ['조명만 밝게'],
      },
      generationMode: 'edit',
      layoutRenderId: render.id,
      referenceIds: [referenceSnapshot.id],
      attachments: [
        { type: 'sourceGeneration', id: parent.id, kind: null },
        { type: 'layout', id: render.id, kind: 'layout' },
        { type: 'reference', id: referenceSnapshot.id, kind: 'character' },
      ],
    });

    expect(child).toMatchObject({
      executionIntegrity: { status: 'valid', issues: [] },
      executionSummary: {
        version: 1,
        requestId: 'request-summary-child',
        sceneDocument: { id: 'scene-test' },
        layoutRender: { id: render.id, contentHash: render.contentHash },
        sourceGeneration: {
          id: parent.id,
          usage: 'editSource',
          contentHash: completedParent?.result?.contentHash,
        },
        references: [
          {
            id: referenceSnapshot.id,
            kind: 'character',
            contentHash: referenceSnapshot.contentHash,
          },
        ],
        attachments: [
          expect.objectContaining({
            attachmentIndex: 1,
            type: 'sourceGeneration',
            id: parent.id,
          }),
          expect.objectContaining({
            attachmentIndex: 2,
            type: 'layout',
            id: render.id,
          }),
          expect.objectContaining({
            attachmentIndex: 3,
            type: 'reference',
            id: referenceSnapshot.id,
          }),
        ],
      },
    });

    const manifestPath = path.join(root, 'generations.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      generations: Array<{ id: string; prompt: string }>;
    };
    manifest.generations.find(({ id }) => id === child.id)!.prompt =
      '$imagegen tampered prompt';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const tampered = (await new GenerationStore(root).listGenerations()).find(
      ({ id }) => id === child.id,
    );
    expect(tampered?.executionIntegrity).toMatchObject({
      status: 'mismatch',
      issues: expect.arrayContaining([
        expect.stringContaining('prompt 해시'),
        expect.stringContaining('prompt의 SceneDocument'),
        expect.stringContaining('prompt의 LayoutSpec'),
      ]),
    });
  });

  it('새 generation의 null scene snapshot을 Zod 경계에서 fail-closed한다', async () => {
    const { store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);

    await expect(
      store.createGeneration({
        threadId: 'thread-null-scene',
        turnId: 'turn-null-scene',
        prompt: '$imagegen invalid',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: null as never,
        referenceSnapshots: [],
        layoutRenderId: render.id,
        referenceIds: [],
        attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    await expect(store.listGenerations()).resolves.toEqual([]);
  });

  it('저장된 snapshot·LayoutSpec·layout render scene ID 무결성을 재시작 뒤에도 판정한다', async () => {
    const { root, store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    await store.createGeneration({
      threadId: 'thread-integrity',
      turnId: 'turn-integrity',
      prompt: '$imagegen integrity',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [],
      layoutRenderId: render.id,
      referenceIds: [],
      attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
    });

    await expect(new GenerationStore(root).listGenerations()).resolves.toEqual([
      expect.objectContaining({
        sceneIntegrity: {
          status: 'valid',
          snapshotSceneId: 'scene-test',
          layoutSpecSceneId: 'scene-test',
          layoutRenderSceneId: 'scene-test',
        },
      }),
    ]);

    const manifestPath = path.join(root, 'generations.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      sceneRenders: Array<{ sceneId: string }>;
    };
    manifest.sceneRenders[0]!.sceneId = 'scene-other';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(new GenerationStore(root).listGenerations()).resolves.toEqual([
      expect.objectContaining({
        sceneIntegrity: {
          status: 'mismatch',
          snapshotSceneId: 'scene-test',
          layoutSpecSceneId: 'scene-test',
          layoutRenderSceneId: 'scene-other',
        },
      }),
    ]);
  });

  it('존재하지 않는 저장 레이아웃 렌더 콘텐츠를 명확히 거부한다', async () => {
    const { store } = await createStore();

    await expect(
      store.readSceneRenderContent('missing-render'),
    ).rejects.toThrow('레이아웃 렌더를 찾을 수 없습니다');
  });

  it('이미지 결과 없이 끝난 turn은 실패로 기록한다', async () => {
    const { store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    await store.createGeneration({
      threadId: 'thread-1',
      turnId: 'turn-empty',
      prompt: '$imagegen 테스트',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [],
      layoutRenderId: render.id,
      referenceIds: [],
      attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
    });

    await expect(
      store.completeTurn('turn-empty', 'completed', null),
    ).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('이미지 결과가 없습니다'),
    });
  });

  it('이미지가 아닌 savedPath를 거부한다', async () => {
    const { root, store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    await store.createGeneration({
      threadId: 'thread-1',
      turnId: 'turn-invalid',
      prompt: '$imagegen 테스트',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [],
      layoutRenderId: render.id,
      referenceIds: [],
      attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
    });
    const source = path.join(root, 'not-an-image.txt');
    await writeFile(source, 'not an image');

    await expect(
      store.importGenerationResult('turn-invalid', source, null),
    ).rejects.toThrow('PNG, JPEG 또는 WebP');
  });

  it('부모 생성과 피드백을 버전 계보로 저장하고 입력 스냅샷을 복제한다', async () => {
    const { store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    const scene = createSceneSnapshot();
    const reference = structuredClone(referenceSnapshot);
    const parent = await store.createGeneration({
      threadId: 'thread-1',
      turnId: 'turn-parent',
      prompt: '$imagegen 원본',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: scene,
      referenceSnapshots: [reference],
      layoutRenderId: render.id,
      referenceIds: ['ref-1'],
      attachments: [
        { type: 'layout', id: render.id, kind: 'layout' },
        { type: 'reference', id: 'ref-1', kind: 'character' },
      ],
    });
    scene.name = '호출 뒤 변경된 이름';
    scene.semanticSceneSpec.intent.location = '호출 뒤 변경된 장소';
    reference.name = '호출 뒤 변경된 레퍼런스';

    const child = await store.createGeneration({
      threadId: 'thread-2',
      turnId: 'turn-child',
      prompt: '$imagegen 새 레이아웃으로 다시 생성',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [referenceSnapshot],
      parentGenerationId: parent.id,
      feedback: '전봇대 가림 비율만 줄여줘.',
      refinementDirective: {
        version: 1,
        preserve: ['전체 구도', '인물 의상'],
        change: ['전봇대 가림 비율만 줄여줘.'],
      },
      generationMode: 'edit',
      layoutRenderId: render.id,
      referenceIds: ['ref-1'],
      attachments: [
        { type: 'layout', id: render.id, kind: 'layout' },
        { type: 'reference', id: 'ref-1', kind: 'character' },
      ],
    });

    expect((await store.listGenerations())[0]).toMatchObject({
      sceneSnapshot: { name: 'Untitled scene' },
      semanticSceneSpecSnapshot: {
        intent: { location: '한국 노포 야외 치킨집' },
      },
      referenceSnapshots: [{ name: '정민 캐릭터 시트' }],
    });
    expect(child).toMatchObject({
      parentGenerationId: parent.id,
      versionNumber: 2,
      feedback: '전봇대 가림 비율만 줄여줘.',
      refinementDirective: {
        preserve: ['전체 구도', '인물 의상'],
        change: ['전봇대 가림 비율만 줄여줘.'],
      },
      generationMode: 'edit',
    });
  });

  it('적용한 3D snapshot 출처는 fresh root의 sourceGenerationId로 저장하고 edit parent와 구분한다', async () => {
    const { store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    const source = await store.createGeneration({
      threadId: 'thread-source',
      turnId: 'turn-source',
      prompt: '$imagegen source',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [],
      layoutRenderId: render.id,
      referenceIds: [],
      attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
    });

    const fresh = await store.createGeneration({
      threadId: 'thread-fresh',
      turnId: 'turn-fresh',
      prompt: '$imagegen applied layout',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [],
      parentGenerationId: null,
      sourceGenerationId: source.id,
      generationMode: 'fresh',
      layoutRenderId: render.id,
      referenceIds: [],
      attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
    });
    await expect(
      store.createGeneration({
        threadId: 'thread-edit-without-directive',
        turnId: 'turn-edit-without-directive',
        prompt: '$imagegen missing directive',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: createSceneSnapshot(),
        referenceSnapshots: [],
        parentGenerationId: source.id,
        feedback: '구도만 유지해줘',
        generationMode: 'edit',
        layoutRenderId: render.id,
        referenceIds: [],
        attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
      }),
    ).rejects.toThrow('구조화된 유지·변경 지시');
    await expect(
      store.createGeneration({
        threadId: 'thread-fresh-with-directive',
        turnId: 'turn-fresh-with-directive',
        prompt: '$imagegen invalid fresh directive',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: createSceneSnapshot(),
        referenceSnapshots: [],
        refinementDirective: {
          version: 1,
          preserve: [],
          change: ['조명 변경'],
        },
        generationMode: 'fresh',
        layoutRenderId: render.id,
        referenceIds: [],
        attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
      }),
    ).rejects.toThrow('새 생성에는 보정 지시');
    const edit = await store.createGeneration({
      threadId: 'thread-edit',
      turnId: 'turn-edit',
      prompt: '$imagegen edit source image',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [],
      parentGenerationId: source.id,
      sourceGenerationId: null,
      feedback: '기존 결과 이미지만 보정',
      refinementDirective: {
        version: 1,
        preserve: ['전체 구도'],
        change: ['기존 결과 이미지만 보정'],
      },
      generationMode: 'edit',
      layoutRenderId: render.id,
      referenceIds: [],
      attachments: [
        { type: 'sourceGeneration', id: source.id, kind: null },
        { type: 'layout', id: render.id, kind: 'layout' },
      ],
    });

    expect(fresh).toMatchObject({
      parentGenerationId: null,
      sourceGenerationId: source.id,
      versionNumber: 1,
      generationMode: 'fresh',
    });
    expect(edit).toMatchObject({
      parentGenerationId: source.id,
      sourceGenerationId: null,
      versionNumber: 2,
      generationMode: 'edit',
    });
    await expect(
      store.createGeneration({
        threadId: 'thread-invalid-fresh-parent',
        turnId: 'turn-invalid-fresh-parent',
        prompt: '$imagegen invalid fresh parent',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: createSceneSnapshot(),
        referenceSnapshots: [],
        parentGenerationId: source.id,
        sourceGenerationId: null,
        feedback: null,
        generationMode: 'fresh',
        layoutRenderId: render.id,
        referenceIds: [],
        attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
      }),
    ).rejects.toThrow('새 생성에는 부모');
    await expect(
      store.createGeneration({
        threadId: 'thread-invalid-edit-source',
        turnId: 'turn-invalid-edit-source',
        prompt: '$imagegen invalid edit source',
        layoutSpec: TEST_LAYOUT_SPEC,
        sceneSnapshot: createSceneSnapshot(),
        referenceSnapshots: [],
        parentGenerationId: source.id,
        sourceGenerationId: source.id,
        feedback: 'edit',
        generationMode: 'edit',
        layoutRenderId: render.id,
        referenceIds: [],
        attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
      }),
    ).rejects.toThrow('보정 생성에는 3D snapshot 출처');
  });

  it('이전 generation record에는 스냅샷과 계보 기본값을 적용한다', async () => {
    const { root, store } = await createStore();
    const render = await store.importSceneRender('scene-test', onePixelPng);
    await store.createGeneration({
      threadId: 'thread-legacy',
      turnId: 'turn-legacy',
      prompt: '$imagegen legacy',
      layoutSpec: TEST_LAYOUT_SPEC,
      sceneSnapshot: createSceneSnapshot(),
      referenceSnapshots: [],
      layoutRenderId: render.id,
      referenceIds: [],
      attachments: [{ type: 'layout', id: render.id, kind: 'layout' }],
    });
    const manifestPath = path.join(root, 'generations.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      generations: Array<Record<string, unknown>>;
    };
    for (const field of [
      'sceneSnapshot',
      'semanticSceneSpecSnapshot',
      'referenceSnapshots',
      'parentGenerationId',
      'sourceGenerationId',
      'versionNumber',
      'feedback',
      'refinementDirective',
      'generationMode',
      'requestId',
      'requestFingerprint',
      'executionSummary',
    ]) {
      delete manifest.generations[0]?.[field];
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(new GenerationStore(root).listGenerations()).resolves.toEqual([
      expect.objectContaining({
        sceneSnapshot: null,
        semanticSceneSpecSnapshot: null,
        referenceSnapshots: [],
        parentGenerationId: null,
        refinementDirective: null,
        sourceGenerationId: null,
        versionNumber: 1,
        feedback: null,
        generationMode: 'fresh',
        requestId: null,
        executionSummary: null,
        executionIntegrity: { status: 'legacy', issues: [] },
      }),
    ]);
  });
});
