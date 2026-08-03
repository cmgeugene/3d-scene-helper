// @vitest-environment node

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveProjectArtifact } from './projectArtifacts';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createProject() {
  const root = await mkdtemp(path.join(tmpdir(), 'i2v-artifacts-'));
  tempRoots.push(root);
  await mkdir(path.join(root, 'assets', 'references'), { recursive: true });
  await writeFile(
    path.join(root, 'assets', 'references', 'character.png'),
    'png',
  );
  return root;
}

describe('resolveProjectArtifact', () => {
  it('assets 내부 파일만 절대 경로로 해석한다', async () => {
    const root = await createProject();

    const expected = await realpath(
      path.join(root, 'assets', 'references', 'character.png'),
    );

    await expect(
      resolveProjectArtifact(root, 'references/character.png'),
    ).resolves.toBe(expected);
  });

  it('경로 탈출과 절대 경로를 거부한다', async () => {
    const root = await createProject();

    await expect(resolveProjectArtifact(root, '../scene.json')).rejects.toThrow(
      'assets 외부',
    );
    await expect(
      resolveProjectArtifact(root, path.join(root, 'scene.json')),
    ).rejects.toThrow('상대 경로');
  });
});
