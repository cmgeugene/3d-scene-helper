import { z } from 'zod';

export const GENERATION_IMAGE_CONTRACT_VERSION = 2 as const;

export const generationImageRoleSchema = z.enum([
  'layout',
  'sourceGeneration',
  'layoutReference',
  'backgroundReference',
  'characterReference',
  'styleReference',
]);

export type GenerationImageRole = z.infer<typeof generationImageRoleSchema>;

const ROLE_AUTHORITY: Record<GenerationImageRole, readonly string[]> = {
  layout: [
    'camera viewpoint and perspective',
    'crop and framing',
    'subject and object screen placement and scale',
    'pose and facing direction',
    'foreground, midground and background depth order',
    'occlusion relationships',
  ],
  sourceGeneration: [
    'finished appearance and identity',
    'clothing and materials',
    'color treatment and rendering detail',
  ],
  layoutReference: [
    'secondary environment structure and design cues within the 3D layout',
  ],
  backgroundReference: [
    'location and environment appearance',
    'environment materials and lighting detail',
  ],
  characterReference: [
    'target character face and body appearance',
    'target character hair and clothing',
  ],
  styleReference: [
    'visual style and medium',
    'color palette and rendering treatment',
  ],
};

const ROLE_PROHIBITED_AUTHORITY: Record<
  GenerationImageRole,
  readonly string[]
> = {
  layout: [
    'final face or identity',
    'final clothing or materials',
    'proxy colors and primitive geometry appearance',
  ],
  sourceGeneration: [
    'camera viewpoint or perspective',
    'crop or framing',
    'screen placement or scale',
    'pose or facing direction',
    'depth order or occlusion',
  ],
  layoutReference: [
    'OutputCamera viewpoint, crop or perspective',
    'subject placement, scale, pose, depth or occlusion',
  ],
  backgroundReference: [
    'OutputCamera viewpoint, crop or perspective',
    'subject placement, scale, pose, depth or occlusion',
  ],
  characterReference: [
    'OutputCamera viewpoint, crop or perspective',
    'pose, placement, scale, background, text or sheet layout',
  ],
  styleReference: ['camera, composition, scene content or character identity'],
};

export const generationImageDescriptorSchema = z.strictObject({
  attachmentIndex: z.number().int().positive(),
  role: generationImageRoleSchema,
  artifactId: z.string().min(1),
  targetObjectId: z.string().min(1).nullable(),
  authority: z.array(z.string().min(1)).min(1),
  prohibitedAuthority: z.array(z.string().min(1)).min(1),
});

export type GenerationImageDescriptor = z.infer<
  typeof generationImageDescriptorSchema
>;

export const generationImageBindingSchema =
  generationImageDescriptorSchema.pick({
    attachmentIndex: true,
    role: true,
    authority: true,
  });

export type GenerationImageBinding = z.infer<
  typeof generationImageBindingSchema
>;

export function createGenerationImageDescriptor(input: {
  attachmentIndex: number;
  role: GenerationImageRole;
  artifactId: string;
  targetObjectId?: string | null;
}): GenerationImageDescriptor {
  return generationImageDescriptorSchema.parse({
    ...input,
    targetObjectId: input.targetObjectId ?? null,
    authority: [...ROLE_AUTHORITY[input.role]],
    prohibitedAuthority: [...ROLE_PROHIBITED_AUTHORITY[input.role]],
  });
}

export function generationImageRoleForReferenceKind(
  kind: 'layout' | 'background' | 'character' | 'style',
): GenerationImageRole {
  switch (kind) {
    case 'layout':
      return 'layoutReference';
    case 'background':
      return 'backgroundReference';
    case 'character':
      return 'characterReference';
    case 'style':
      return 'styleReference';
  }
}

export function validateGenerationImageDescriptors(
  values: GenerationImageDescriptor[],
) {
  const descriptors = values.map((value) =>
    generationImageDescriptorSchema.parse({
      attachmentIndex: value.attachmentIndex,
      role: value.role,
      artifactId: value.artifactId,
      targetObjectId: value.targetObjectId,
      authority: value.authority,
      prohibitedAuthority: value.prohibitedAuthority,
    }),
  );
  if (descriptors.length === 0) {
    throw new Error('생성 이미지 입력에는 3D 레이아웃이 필요합니다.');
  }
  for (const [index, descriptor] of descriptors.entries()) {
    if (descriptor.attachmentIndex !== index + 1) {
      throw new Error('생성 이미지 attachment index가 연속적이지 않습니다.');
    }
    const canonical = createGenerationImageDescriptor({
      attachmentIndex: descriptor.attachmentIndex,
      role: descriptor.role,
      artifactId: descriptor.artifactId,
      targetObjectId: descriptor.targetObjectId,
    });
    if (
      JSON.stringify(descriptor.authority) !==
        JSON.stringify(canonical.authority) ||
      JSON.stringify(descriptor.prohibitedAuthority) !==
        JSON.stringify(canonical.prohibitedAuthority)
    ) {
      throw new Error(
        '생성 이미지 역할의 권위 계약이 canonical 값과 다릅니다.',
      );
    }
  }
  if (
    descriptors[0]?.role !== 'layout' ||
    descriptors.filter(({ role }) => role === 'layout').length !== 1
  ) {
    throw new Error(
      '현재 OutputCamera의 3D 레이아웃은 정확히 하나이며 Image 1이어야 합니다.',
    );
  }
  const sourceGenerations = descriptors.filter(
    ({ role }) => role === 'sourceGeneration',
  );
  if (
    sourceGenerations.length > 1 ||
    (sourceGenerations.length === 1 &&
      sourceGenerations[0]?.attachmentIndex !== 2)
  ) {
    throw new Error('보정 원본 generation은 최대 하나이며 Image 2여야 합니다.');
  }
  return descriptors;
}

export function expectedGenerationImageBindings(
  descriptors: GenerationImageDescriptor[],
): GenerationImageBinding[] {
  return validateGenerationImageDescriptors(descriptors).map(
    ({ attachmentIndex, role, authority }) => ({
      attachmentIndex,
      role,
      authority,
    }),
  );
}
