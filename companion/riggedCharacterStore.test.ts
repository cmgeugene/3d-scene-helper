// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RiggedCharacterStore, inspectRiggedGlb } from './riggedCharacterStore';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore() {
  const root = await mkdtemp(path.join(tmpdir(), 'i2v-rigged-character-'));
  roots.push(root);
  return { root, store: new RiggedCharacterStore(root) };
}

const analysis = {
  dimensions: { x: 1.03, y: 1.7, z: 0.41 },
  center: { x: 0, y: 0.85, z: 0 },
  forwardRotationYDeg: 180,
  boneCount: 24,
  skinnedMeshCount: 1,
  animation: { clipName: 'Idle', durationSeconds: 10 },
  ikBoneMap: {
    leftHand: {
      root: 'LeftArm',
      middle: 'LeftForeArm',
      effector: 'LeftHand',
    },
    rightHand: {
      root: 'RightArm',
      middle: 'RightForeArm',
      effector: 'RightHand',
    },
    leftFoot: {
      root: 'LeftUpLeg',
      middle: 'LeftLeg',
      effector: 'LeftFoot',
    },
    rightFoot: {
      root: 'RightUpLeg',
      middle: 'RightLeg',
      effector: 'RightFoot',
    },
  },
};

describe('RiggedCharacterStore', () => {
  it('리깅 GLB를 프로젝트 자산으로 저장하고 다시 읽는다', async () => {
    const data = await readFile(
      path.resolve('assets/Meshy_AI_Animation_Idle_3_withSkin.glb'),
    );
    expect(inspectRiggedGlb(data).declaredBoneCount).toBeGreaterThan(0);
    const { root, store } = await createStore();

    const imported = await store.importAsset({
      name: 'Meshy 테스트',
      originalFileName: 'meshy.glb',
      data,
      analysis,
    });

    expect(imported).toMatchObject({
      name: 'Meshy 테스트',
      mimeType: 'model/gltf-binary',
      originalFileName: 'meshy.glb',
      byteLength: data.byteLength,
      analysis,
    });
    expect(imported).not.toHaveProperty('assetPath');
    await expect(store.list()).resolves.toEqual([imported]);
    const restored = await store.readContent(imported.id);
    expect(restored.asset).toEqual(imported);
    expect(restored.data.equals(data)).toBe(true);

    const manifest = JSON.parse(
      await readFile(path.join(root, 'rigged-character-assets.json'), 'utf8'),
    ) as { assets: Array<{ assetPath: string }> };
    expect(manifest.assets[0]?.assetPath).toMatch(/^models\/artifact_.+\.glb$/);
  });

  it('GLB가 아니거나 스킨이 없는 입력을 거부한다', async () => {
    const { store } = await createStore();
    await expect(
      store.importAsset({
        name: '가짜 캐릭터',
        originalFileName: 'fake.glb',
        data: Buffer.from('not-a-glb'),
        analysis,
      }),
    ).rejects.toThrow('유효한 GLB 2.0');
  });
});
