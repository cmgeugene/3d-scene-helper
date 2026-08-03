// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GenerationStore } from './generationStore';
import { TEST_LAYOUT_SPEC } from '../shared/layoutSpecTestFixture';
import { createStarterSceneDocument } from '../src/editor/persistence/sceneSchema';

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
  return createStarterSceneDocument({
    documentId: 'scene-test',
    floorId: 'floor-test',
    mannequinId: 'mannequin-test',
  });
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
      generationMode: 'fresh',
      layoutRenderId: render.id,
      referenceIds: ['ref-1'],
      attachments: [
        { type: 'layout', id: render.id, kind: 'layout' },
        { type: 'reference', id: 'ref-1', kind: 'character' },
      ],
    });

    expect((await store.listGenerations())[0]).toMatchObject({
      sceneSnapshot: { name: 'Untitled scene' },
      referenceSnapshots: [{ name: '정민 캐릭터 시트' }],
    });
    expect(child).toMatchObject({
      parentGenerationId: parent.id,
      versionNumber: 2,
      feedback: '전봇대 가림 비율만 줄여줘.',
      generationMode: 'fresh',
    });
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
      'referenceSnapshots',
      'parentGenerationId',
      'versionNumber',
      'feedback',
      'generationMode',
    ]) {
      delete manifest.generations[0]?.[field];
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(new GenerationStore(root).listGenerations()).resolves.toEqual([
      expect.objectContaining({
        sceneSnapshot: null,
        referenceSnapshots: [],
        parentGenerationId: null,
        versionNumber: 1,
        feedback: null,
        generationMode: 'fresh',
      }),
    ]);
  });
});
