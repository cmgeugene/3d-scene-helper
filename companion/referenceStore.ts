import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveProjectArtifact } from './projectArtifacts';

export const referenceKindSchema = z.enum([
  'layout',
  'background',
  'character',
  'style',
]);

const referenceScopeItemSchema = z.string().trim().min(1).max(60);

export const referenceMetadataInputSchema = z.strictObject({
  targetObjectId: z.string().trim().min(1).max(200).nullable(),
  use: z.array(referenceScopeItemSchema).max(16),
  exclude: z.array(referenceScopeItemSchema).max(16),
  enabled: z.boolean(),
});

const storedReferenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: referenceKindSchema,
  artifactId: z.string().min(1),
  assetPath: z.string().min(1),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  originalFileName: z.string().min(1),
  byteLength: z.number().int().positive(),
  createdAt: z.string().datetime(),
  targetObjectId: z.string().trim().min(1).max(200).nullable().default(null),
  use: z.array(referenceScopeItemSchema).max(16).default([]),
  exclude: z.array(referenceScopeItemSchema).max(16).default([]),
  enabled: z.boolean().default(true),
});

export const publicReferenceSchema = storedReferenceSchema.omit({
  assetPath: true,
});

const storedManifestSchema = z.object({
  version: z.literal(1),
  references: z.array(storedReferenceSchema),
});

export type ReferenceKind = z.infer<typeof referenceKindSchema>;
export type StoredReference = z.infer<typeof storedReferenceSchema>;
export type PublicReference = z.infer<typeof publicReferenceSchema>;
export type ReferenceManifest = z.infer<typeof storedManifestSchema>;
export type ReferenceMetadataInput = z.infer<
  typeof referenceMetadataInputSchema
>;

export interface ImportReferenceInput {
  name: string;
  kind: ReferenceKind;
  originalFileName: string;
  data: Buffer;
}

export interface ImageMetadata {
  mimeType: StoredReference['mimeType'];
  extension: 'png' | 'jpg' | 'webp';
  width: number | null;
  height: number | null;
}

const EMPTY_MANIFEST: ReferenceManifest = { version: 1, references: [] };
const REFERENCE_KIND_ORDER: Record<ReferenceKind, number> = {
  layout: 0,
  background: 1,
  character: 2,
  style: 3,
};

const DEFAULT_SCOPES: Record<
  ReferenceKind,
  Pick<ReferenceMetadataInput, 'use' | 'exclude'>
> = {
  layout: {
    use: ['camera', 'composition', 'perspective', 'occlusion'],
    exclude: ['appearance', 'style', 'text'],
  },
  background: {
    use: ['location', 'spatial structure', 'lighting'],
    exclude: ['character appearance', 'text'],
  },
  character: {
    use: ['face', 'body', 'hair', 'clothing'],
    exclude: ['pose', 'background', 'text'],
  },
  style: {
    use: ['visual style', 'color palette', 'rendering'],
    exclude: ['composition', 'character identity', 'text'],
  },
};

export class ReferenceInputError extends Error {}
export class ReferenceNotFoundError extends Error {}

function readPngMetadata(data: Buffer): ImageMetadata | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 24 || !data.subarray(0, 8).equals(signature)) return null;
  return {
    mimeType: 'image/png',
    extension: 'png',
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

function readJpegMetadata(data: Buffer): ImageMetadata | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    const marker = data[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;
    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) break;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        mimeType: 'image/jpeg',
        extension: 'jpg',
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    width: null,
    height: null,
  };
}

function readWebpMetadata(data: Buffer): ImageMetadata | null {
  if (
    data.length < 16 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  let width: number | null = null;
  let height: number | null = null;
  if (data.toString('ascii', 12, 16) === 'VP8X' && data.length >= 30) {
    width = data.readUIntLE(24, 3) + 1;
    height = data.readUIntLE(27, 3) + 1;
  }
  return { mimeType: 'image/webp', extension: 'webp', width, height };
}

export function inspectImage(data: Buffer) {
  if (data.length === 0)
    throw new ReferenceInputError('빈 이미지는 가져올 수 없습니다.');
  const metadata =
    readPngMetadata(data) ?? readJpegMetadata(data) ?? readWebpMetadata(data);
  if (metadata === null) {
    throw new ReferenceInputError(
      'PNG, JPEG 또는 WebP 이미지만 가져올 수 있습니다.',
    );
  }
  if (
    (metadata.width !== null && metadata.width > 16_384) ||
    (metadata.height !== null && metadata.height > 16_384)
  ) {
    throw new ReferenceInputError(
      '이미지 크기는 한 변이 16384px 이하여야 합니다.',
    );
  }
  return metadata;
}

function sanitizeFileName(fileName: string) {
  const safe = path.basename(fileName.trim()).slice(0, 255);
  return safe === '' ? 'reference-image' : safe;
}

export function toPublicReference(reference: StoredReference): PublicReference {
  const { assetPath: _assetPath, ...publicReference } = reference;
  void _assetPath;
  return publicReference;
}

export class ReferenceStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly projectRoot: string) {}

  async list() {
    const manifest = await this.readManifest();
    return manifest.references.map(toPublicReference);
  }

  importReference(input: ImportReferenceInput) {
    const operation = this.mutationQueue.then(() =>
      this.importReferenceInternal(input),
    );
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  updateReference(referenceId: string, input: ReferenceMetadataInput) {
    const operation = this.mutationQueue.then(() =>
      this.updateReferenceInternal(referenceId, input),
    );
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async resolveReferenceAttachments(referenceIds: string[]) {
    const requestedIds = [...new Set(referenceIds)];
    const requested = new Set(requestedIds);
    const manifest = await this.readManifest();
    const references = manifest.references.filter(({ id }) =>
      requested.has(id),
    );
    if (references.length !== requestedIds.length) {
      throw new ReferenceNotFoundError(
        '선택한 레퍼런스 중 프로젝트에서 찾을 수 없는 항목이 있습니다.',
      );
    }
    return references.sort((left, right) => {
      const kindDifference =
        REFERENCE_KIND_ORDER[left.kind] - REFERENCE_KIND_ORDER[right.kind];
      if (kindDifference !== 0) return kindDifference;
      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  async readReferenceContent(referenceId: string) {
    const manifest = await this.readManifest();
    const reference = manifest.references.find(({ id }) => id === referenceId);
    if (reference === undefined)
      throw new ReferenceNotFoundError('레퍼런스를 찾을 수 없습니다.');
    const filePath = await resolveProjectArtifact(
      this.projectRoot,
      reference.assetPath,
    );
    return {
      reference: toPublicReference(reference),
      data: await readFile(filePath),
    };
  }

  private async importReferenceInternal(input: ImportReferenceInput) {
    const name = input.name.trim();
    if (name === '' || name.length > 120) {
      throw new ReferenceInputError(
        '레퍼런스 이름은 1자 이상 120자 이하여야 합니다.',
      );
    }
    if (input.data.byteLength > 25 * 1024 * 1024) {
      throw new ReferenceInputError('레퍼런스 이미지는 25MB 이하여야 합니다.');
    }
    const metadata = inspectImage(input.data);
    const id = `ref_${randomUUID()}`;
    const artifactId = `artifact_${randomUUID()}`;
    const assetPath = `references/${artifactId}.${metadata.extension}`;
    const referencesDirectory = path.join(
      this.projectRoot,
      'assets',
      'references',
    );
    const assetFile = path.join(
      referencesDirectory,
      `${artifactId}.${metadata.extension}`,
    );
    const manifest = await this.readManifest();
    const reference: StoredReference = {
      id,
      name,
      kind: input.kind,
      artifactId,
      assetPath,
      contentHash: `sha256:${createHash('sha256').update(input.data).digest('hex')}`,
      mimeType: metadata.mimeType,
      width: metadata.width,
      height: metadata.height,
      originalFileName: sanitizeFileName(input.originalFileName),
      byteLength: input.data.byteLength,
      createdAt: new Date().toISOString(),
      targetObjectId: null,
      use: DEFAULT_SCOPES[input.kind].use,
      exclude: DEFAULT_SCOPES[input.kind].exclude,
      enabled: true,
    };

    await mkdir(referencesDirectory, { recursive: true });
    await writeFile(assetFile, input.data, { flag: 'wx' });
    try {
      await this.writeManifest({
        version: 1,
        references: [...manifest.references, reference],
      });
    } catch (error) {
      await unlink(assetFile).catch(() => undefined);
      throw error;
    }
    return toPublicReference(reference);
  }

  private async updateReferenceInternal(
    referenceId: string,
    input: ReferenceMetadataInput,
  ) {
    const metadata = referenceMetadataInputSchema.parse(input);
    const manifest = await this.readManifest();
    const referenceIndex = manifest.references.findIndex(
      ({ id }) => id === referenceId,
    );
    if (referenceIndex < 0) {
      throw new ReferenceNotFoundError('레퍼런스를 찾을 수 없습니다.');
    }
    const current = manifest.references[referenceIndex]!;
    if (current.kind !== 'character' && metadata.targetObjectId !== null) {
      throw new ReferenceInputError(
        '현재 MVP에서는 캐릭터 레퍼런스만 장면 오브젝트에 연결할 수 있습니다.',
      );
    }
    const updated: StoredReference = { ...current, ...metadata };
    const references = [...manifest.references];
    references[referenceIndex] = updated;
    await this.writeManifest({ version: 1, references });
    return toPublicReference(updated);
  }

  private async readManifest(): Promise<ReferenceManifest> {
    const manifestPath = path.join(this.projectRoot, 'references.json');
    try {
      return storedManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return EMPTY_MANIFEST;
      }
      throw error;
    }
  }

  private async writeManifest(manifest: ReferenceManifest) {
    const parsed = storedManifestSchema.parse(manifest);
    const manifestPath = path.join(this.projectRoot, 'references.json');
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
