// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReferenceStore } from './referenceStore';

const roots: string[] = [];
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'i2v-references-'));
  roots.push(root);
  return { root, store: new ReferenceStore(root) };
}

describe('ReferenceStore', () => {
  it('이미지를 프로젝트에 복사하고 hash와 크기를 manifest에 기록한다', async () => {
    const { root, store } = await createStore();

    const imported = await store.importReference({
      name: '정민 캐릭터 시트',
      kind: 'character',
      originalFileName: '정민 B 시트.png',
      data: onePixelPng,
    });

    expect(imported).toMatchObject({
      name: '정민 캐릭터 시트',
      kind: 'character',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteLength: onePixelPng.byteLength,
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      targetObjectId: null,
      use: ['face', 'body', 'hair', 'clothing'],
      exclude: ['pose', 'background', 'text'],
      enabled: true,
    });
    expect(imported).not.toHaveProperty('assetPath');
    await expect(store.list()).resolves.toEqual([imported]);

    const manifest = JSON.parse(
      await readFile(path.join(root, 'references.json'), 'utf8'),
    ) as { references: Array<{ assetPath: string }> };
    expect(manifest.references[0]?.assetPath).toMatch(
      /^references\/artifact_.+\.png$/,
    );
    await expect(
      store.readReferenceContent(imported.id),
    ).resolves.toMatchObject({
      reference: imported,
      data: onePixelPng,
    });
  });

  it('실제 이미지 형식이 아닌 파일을 거부한다', async () => {
    const { store } = await createStore();

    await expect(
      store.importReference({
        name: '가짜 이미지',
        kind: 'style',
        originalFileName: 'fake.png',
        data: Buffer.from('not-an-image'),
      }),
    ).rejects.toThrow('PNG, JPEG 또는 WebP');
  });

  it('연결과 사용 범위를 갱신하고 첨부 순서를 역할별로 정규화한다', async () => {
    const { store } = await createStore();
    const character = await store.importReference({
      name: '정민 캐릭터 시트',
      kind: 'character',
      originalFileName: 'character.png',
      data: onePixelPng,
    });
    const layout = await store.importReference({
      name: '카메라 레이아웃',
      kind: 'layout',
      originalFileName: 'layout.png',
      data: onePixelPng,
    });

    await expect(
      store.updateReference(character.id, {
        targetObjectId: 'blue-mannequin',
        use: ['face', 'clothing'],
        exclude: ['pose', 'text'],
        enabled: true,
      }),
    ).resolves.toMatchObject({
      targetObjectId: 'blue-mannequin',
      use: ['face', 'clothing'],
      exclude: ['pose', 'text'],
    });

    await expect(
      store.resolveReferenceAttachments([
        character.id,
        layout.id,
        character.id,
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ id: layout.id, kind: 'layout' }),
      expect.objectContaining({ id: character.id, kind: 'character' }),
    ]);
  });

  it('이전 manifest의 레퍼런스에 새 메타데이터 기본값을 적용한다', async () => {
    const { root, store } = await createStore();
    const imported = await store.importReference({
      name: '기존 배경',
      kind: 'background',
      originalFileName: 'background.png',
      data: onePixelPng,
    });
    const manifestPath = path.join(root, 'references.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      references: Array<Record<string, unknown>>;
    };
    delete manifest.references[0]?.targetObjectId;
    delete manifest.references[0]?.use;
    delete manifest.references[0]?.exclude;
    delete manifest.references[0]?.enabled;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(new ReferenceStore(root).list()).resolves.toEqual([
      expect.objectContaining({
        id: imported.id,
        targetObjectId: null,
        use: [],
        exclude: [],
        enabled: true,
      }),
    ]);
  });

  it('레퍼런스를 삭제하면 manifest와 파일을 제거하고 다시 찾을 수 없게 한다', async () => {
    const { root, store } = await createStore();
    const imported = await store.importReference({
      name: '정민 캐릭터 시트',
      kind: 'character',
      originalFileName: 'character.png',
      data: onePixelPng,
    });
    const kept = await store.importReference({
      name: '골목 배경',
      kind: 'background',
      originalFileName: 'alley.png',
      data: onePixelPng,
    });
    const manifest = JSON.parse(
      await readFile(path.join(root, 'references.json'), 'utf8'),
    ) as { references: Array<{ id: string; assetPath: string }> };
    const deletedAsset = path.join(
      root,
      'assets',
      manifest.references.find(({ id }) => id === imported.id)!.assetPath,
    );

    await expect(store.deleteReference(imported.id)).resolves.toEqual({
      id: imported.id,
    });
    await expect(store.list()).resolves.toEqual([kept]);
    await expect(readFile(deletedAsset)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(store.deleteReference(imported.id)).rejects.toThrow(
      '레퍼런스를 찾을 수 없습니다',
    );
    await expect(store.list()).resolves.toEqual([kept]);
  });
});
