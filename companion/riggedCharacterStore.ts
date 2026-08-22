import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  riggedCharacterAnalysisSchema,
  riggedCharacterAssetSchema,
  type RiggedCharacterAnalysis,
  type RiggedCharacterAsset,
} from '../shared/riggedCharacterAsset';
import { resolveProjectArtifact } from './projectArtifacts';

const storedRiggedCharacterAssetSchema = riggedCharacterAssetSchema.extend({
  assetPath: z.string().min(1),
});

const manifestSchema = z.strictObject({
  version: z.literal(1),
  assets: z.array(storedRiggedCharacterAssetSchema),
});

type StoredRiggedCharacterAsset = z.infer<
  typeof storedRiggedCharacterAssetSchema
>;

export class RiggedCharacterInputError extends Error {}
export class RiggedCharacterNotFoundError extends Error {}

const EMPTY_MANIFEST = { version: 1 as const, assets: [] };
const MAX_GLB_BYTES = 100 * 1024 * 1024;

function toPublicAsset(
  asset: StoredRiggedCharacterAsset,
): RiggedCharacterAsset {
  const { assetPath: _assetPath, ...publicAsset } = asset;
  void _assetPath;
  return riggedCharacterAssetSchema.parse(publicAsset);
}

function sanitizeFileName(fileName: string) {
  const safe = path.basename(fileName.trim()).slice(0, 255);
  return safe === '' ? 'character.glb' : safe;
}

export function inspectRiggedGlb(data: Buffer) {
  if (data.byteLength < 20 || data.toString('ascii', 0, 4) !== 'glTF') {
    throw new RiggedCharacterInputError('유효한 GLB 2.0 파일이 아닙니다.');
  }
  if (data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.byteLength) {
    throw new RiggedCharacterInputError('GLB 2.0 헤더가 올바르지 않습니다.');
  }
  const jsonLength = data.readUInt32LE(12);
  const jsonType = data.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a || 20 + jsonLength > data.byteLength) {
    throw new RiggedCharacterInputError('GLB JSON 청크가 올바르지 않습니다.');
  }
  let document: unknown;
  try {
    document = JSON.parse(data.toString('utf8', 20, 20 + jsonLength).trim());
  } catch {
    throw new RiggedCharacterInputError('GLB JSON을 읽을 수 없습니다.');
  }
  const gltf = z
    .object({
      asset: z.object({ version: z.string() }),
      meshes: z.array(z.unknown()).min(1),
      nodes: z.array(z.object({ name: z.string().optional() })),
      skins: z
        .array(z.object({ joints: z.array(z.number().int()).min(1) }))
        .min(1),
    })
    .safeParse(document);
  if (!gltf.success || !gltf.data.asset.version.startsWith('2')) {
    throw new RiggedCharacterInputError(
      '메시와 스킨(본)이 포함된 GLB 2.0만 가져올 수 있습니다.',
    );
  }
  const jointIndices = new Set(gltf.data.skins.flatMap((skin) => skin.joints));
  return {
    declaredBoneCount: jointIndices.size,
    jointNames: Array.from(jointIndices)
      .map((index) => gltf.data.nodes[index]?.name)
      .filter((name): name is string => name !== undefined),
  };
}

export class RiggedCharacterStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly projectRoot: string) {}

  async list() {
    return (await this.readManifest()).assets.map(toPublicAsset);
  }

  importAsset(input: {
    name: string;
    originalFileName: string;
    data: Buffer;
    analysis: RiggedCharacterAnalysis;
  }) {
    const operation = this.mutationQueue.then(() =>
      this.importAssetInternal(input),
    );
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async readContent(assetId: string) {
    const asset = (await this.readManifest()).assets.find(
      ({ id }) => id === assetId,
    );
    if (asset === undefined) {
      throw new RiggedCharacterNotFoundError('캐릭터 자산을 찾을 수 없습니다.');
    }
    return {
      asset: toPublicAsset(asset),
      data: await readFile(
        await resolveProjectArtifact(this.projectRoot, asset.assetPath),
      ),
    };
  }

  private async importAssetInternal(input: {
    name: string;
    originalFileName: string;
    data: Buffer;
    analysis: RiggedCharacterAnalysis;
  }) {
    const name = input.name.trim();
    if (name === '' || name.length > 120) {
      throw new RiggedCharacterInputError(
        '캐릭터 이름은 1자 이상 120자 이하여야 합니다.',
      );
    }
    if (input.data.byteLength === 0 || input.data.byteLength > MAX_GLB_BYTES) {
      throw new RiggedCharacterInputError('GLB 파일은 100MB 이하여야 합니다.');
    }
    const inspected = inspectRiggedGlb(input.data);
    const analysis = riggedCharacterAnalysisSchema.parse(input.analysis);
    if (analysis.boneCount < inspected.declaredBoneCount) {
      throw new RiggedCharacterInputError(
        '분석된 본 개수가 GLB 스킨 정보와 일치하지 않습니다.',
      );
    }
    if (analysis.ikBoneMap !== null) {
      const knownJoints = new Set(inspected.jointNames);
      const mappedBones = Object.values(analysis.ikBoneMap).flatMap((chain) => [
        chain.root,
        chain.middle,
        chain.effector,
      ]);
      if (mappedBones.some((boneName) => !knownJoints.has(boneName))) {
        throw new RiggedCharacterInputError(
          'IK 본 매핑이 GLB 스킨의 관절 이름과 일치하지 않습니다.',
        );
      }
    }

    const id = `character_${randomUUID()}`;
    const artifactId = `artifact_${randomUUID()}`;
    const assetPath = `models/${artifactId}.glb`;
    const directory = path.join(this.projectRoot, 'assets', 'models');
    const filePath = path.join(directory, `${artifactId}.glb`);
    const manifest = await this.readManifest();
    const asset: StoredRiggedCharacterAsset = {
      id,
      name,
      artifactId,
      assetPath,
      contentHash: `sha256:${createHash('sha256').update(input.data).digest('hex')}`,
      mimeType: 'model/gltf-binary',
      originalFileName: sanitizeFileName(input.originalFileName),
      byteLength: input.data.byteLength,
      createdAt: new Date().toISOString(),
      analysis,
    };

    await mkdir(directory, { recursive: true });
    await writeFile(filePath, input.data, { flag: 'wx' });
    try {
      await this.writeManifest({
        version: 1,
        assets: [...manifest.assets, asset],
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    return toPublicAsset(asset);
  }

  private async readManifest() {
    const manifestPath = path.join(
      this.projectRoot,
      'rigged-character-assets.json',
    );
    try {
      return manifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return EMPTY_MANIFEST;
      }
      throw error;
    }
  }

  private async writeManifest(manifest: z.input<typeof manifestSchema>) {
    const parsed = manifestSchema.parse(manifest);
    const manifestPath = path.join(
      this.projectRoot,
      'rigged-character-assets.json',
    );
    const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      flag: 'wx',
    });
    try {
      await rename(temporaryPath, manifestPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
