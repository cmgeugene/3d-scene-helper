import { z } from 'zod';

export const SEMANTIC_SCENE_SPEC_VERSION = 1 as const;

const MAX_TEXT_LENGTH = 500;
const MAX_ITEMS = 20;
const MAX_CONSTRAINTS = 7;
const semanticTextSchema = z.string().trim().max(MAX_TEXT_LENGTH);
const requiredSemanticTextSchema = semanticTextSchema.min(1);

function compareStable(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeUniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    compareStable,
  );
}

const intentSchema = z
  .strictObject({
    location: semanticTextSchema.default(''),
    timeOfDay: semanticTextSchema.default(''),
    mood: semanticTextSchema.default(''),
    visualStyle: semanticTextSchema.default(''),
  })
  .default({
    location: '',
    timeOfDay: '',
    mood: '',
    visualStyle: '',
  });

const generatedPropSchema = z.strictObject({
  name: requiredSemanticTextSchema,
  placement: semanticTextSchema.default(''),
  importance: semanticTextSchema.default(''),
});

const extrasSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    minCount: z.number().int().min(0).max(500).default(0),
    maxCount: z.number().int().min(0).max(500).default(0),
    placement: semanticTextSchema.default(''),
    importance: semanticTextSchema.default(''),
  })
  .default({
    enabled: false,
    minCount: 0,
    maxCount: 0,
    placement: '',
    importance: '',
  });

const relationshipSchema = z.strictObject({
  subjectObjectId: requiredSemanticTextSchema,
  targetObjectId: requiredSemanticTextSchema,
  relationship: semanticTextSchema.default(''),
  gaze: semanticTextSchema.default(''),
  action: semanticTextSchema.default(''),
});

const constraintsSchema = z
  .strictObject({
    preserve: z
      .array(requiredSemanticTextSchema)
      .max(MAX_CONSTRAINTS)
      .transform(normalizeUniqueStrings)
      .default([]),
    allowChanges: z
      .array(requiredSemanticTextSchema)
      .max(MAX_CONSTRAINTS)
      .transform(normalizeUniqueStrings)
      .default([]),
  })
  .default({ preserve: [], allowChanges: [] });

const semanticSceneSpecInputSchema = z.strictObject({
  version: z.literal(SEMANTIC_SCENE_SPEC_VERSION),
  intent: intentSchema,
  generatedProps: z
    .array(generatedPropSchema)
    .max(MAX_ITEMS)
    .transform((items) =>
      [...items].sort((left, right) =>
        compareStable(
          `${left.name}\u0000${left.placement}\u0000${left.importance}`,
          `${right.name}\u0000${right.placement}\u0000${right.importance}`,
        ),
      ),
    )
    .default([]),
  extras: extrasSchema,
  relationships: z
    .array(relationshipSchema)
    .max(MAX_ITEMS)
    .transform((items) =>
      [...items].sort((left, right) =>
        compareStable(
          `${left.subjectObjectId}\u0000${left.targetObjectId}\u0000${left.relationship}\u0000${left.gaze}\u0000${left.action}`,
          `${right.subjectObjectId}\u0000${right.targetObjectId}\u0000${right.relationship}\u0000${right.gaze}\u0000${right.action}`,
        ),
      ),
    )
    .default([]),
  constraints: constraintsSchema,
});

export const semanticSceneSpecSchema = semanticSceneSpecInputSchema.superRefine(
  (spec, context) => {
    if (spec.extras.minCount > spec.extras.maxCount) {
      context.addIssue({
        code: 'custom',
        message: 'Extras minimum count must not exceed maximum count',
        path: ['extras', 'minCount'],
      });
    }
  },
);

export type SemanticSceneSpec = z.infer<typeof semanticSceneSpecSchema>;

export function createDefaultSemanticSceneSpec(): SemanticSceneSpec {
  return semanticSceneSpecSchema.parse({
    version: SEMANTIC_SCENE_SPEC_VERSION,
  });
}

export function normalizeSemanticSceneSpec(value: unknown): SemanticSceneSpec {
  const normalized = semanticSceneSpecInputSchema.parse(value);
  const minCount = Math.min(
    normalized.extras.minCount,
    normalized.extras.maxCount,
  );
  const maxCount = Math.max(
    normalized.extras.minCount,
    normalized.extras.maxCount,
  );
  return semanticSceneSpecSchema.parse({
    ...normalized,
    extras: { ...normalized.extras, minCount, maxCount },
  });
}
