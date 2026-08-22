import { z } from 'zod';

export const riggedCharacterVectorSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const riggedCharacterDimensionsSchema = z.strictObject({
  x: z.number().finite().positive(),
  y: z.number().finite().positive(),
  z: z.number().finite().positive(),
});

export const riggedCharacterClipSchema = z.strictObject({
  clipName: z.string().trim().min(1).max(300),
  durationSeconds: z.number().finite().positive(),
});

const riggedCharacterIkChainSchema = z.strictObject({
  root: z.string().trim().min(1).max(300),
  middle: z.string().trim().min(1).max(300),
  effector: z.string().trim().min(1).max(300),
});

export const riggedCharacterIkBoneMapSchema = z.strictObject({
  leftHand: riggedCharacterIkChainSchema,
  rightHand: riggedCharacterIkChainSchema,
  leftFoot: riggedCharacterIkChainSchema,
  rightFoot: riggedCharacterIkChainSchema,
});

export const riggedCharacterAnalysisSchema = z.strictObject({
  dimensions: riggedCharacterDimensionsSchema,
  center: riggedCharacterVectorSchema,
  forwardRotationYDeg: z.number().finite().min(-360).max(360),
  boneCount: z.number().int().positive().max(10_000),
  skinnedMeshCount: z.number().int().positive().max(10_000),
  animation: riggedCharacterClipSchema.nullable(),
  ikBoneMap: riggedCharacterIkBoneMapSchema.nullable().default(null),
});

export const riggedCharacterSceneAssetSchema = z.strictObject({
  source: z.enum(['bundled', 'project']),
  label: z.string().trim().min(1).max(120),
  originalFileName: z.string().trim().min(1).max(255),
  ...riggedCharacterAnalysisSchema.shape,
});

export const riggedCharacterAssetSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  artifactId: z.string().trim().min(1).max(200),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mimeType: z.literal('model/gltf-binary'),
  originalFileName: z.string().trim().min(1).max(255),
  byteLength: z.number().int().positive(),
  createdAt: z.string().datetime(),
  analysis: riggedCharacterAnalysisSchema,
});

export type RiggedCharacterAnalysis = z.infer<
  typeof riggedCharacterAnalysisSchema
>;
export type RiggedCharacterIkBoneMap = z.infer<
  typeof riggedCharacterIkBoneMapSchema
>;
export type RiggedCharacterSceneAsset = z.infer<
  typeof riggedCharacterSceneAssetSchema
>;
export type RiggedCharacterAsset = z.infer<typeof riggedCharacterAssetSchema>;
