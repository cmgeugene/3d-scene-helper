import { z } from 'zod';
import {
  semanticSceneSpecSchema,
  type SemanticSceneSpec,
} from './semanticSceneSpec';
import {
  sceneDocumentSchema,
  transformSchema,
  type SceneDocument,
  type SceneObject,
} from './sceneSchema';

export const SPEC_PATCH_PROPOSAL_VERSION = 2 as const;

export const SPEC_PATCH_PATHS = [
  '/intent/location',
  '/intent/timeOfDay',
  '/intent/mood',
  '/intent/visualStyle',
  '/generatedProps',
  '/extras/enabled',
  '/extras/minCount',
  '/extras/maxCount',
  '/extras/placement',
  '/extras/importance',
  '/relationships',
  '/constraints/preserve',
  '/constraints/allowChanges',
] as const;

const semanticTextSchema = z.string().trim().max(500);
const requiredSemanticTextSchema = semanticTextSchema.min(1);
const semanticTextListSchema = z.array(requiredSemanticTextSchema).max(7);
const patchValueSchemas = {
  '/intent/location': semanticTextSchema,
  '/intent/timeOfDay': semanticTextSchema,
  '/intent/mood': semanticTextSchema,
  '/intent/visualStyle': semanticTextSchema,
  '/generatedProps': z
    .array(
      z.strictObject({
        name: requiredSemanticTextSchema,
        placement: semanticTextSchema,
        importance: semanticTextSchema,
      }),
    )
    .max(20),
  '/extras/enabled': z.boolean(),
  '/extras/minCount': z.number().int().min(0).max(500),
  '/extras/maxCount': z.number().int().min(0).max(500),
  '/extras/placement': semanticTextSchema,
  '/extras/importance': semanticTextSchema,
  '/relationships': z
    .array(
      z.strictObject({
        subjectObjectId: requiredSemanticTextSchema,
        targetObjectId: requiredSemanticTextSchema,
        relationship: semanticTextSchema,
        gaze: semanticTextSchema,
        action: semanticTextSchema,
      }),
    )
    .max(20),
  '/constraints/preserve': semanticTextListSchema,
  '/constraints/allowChanges': semanticTextListSchema,
} satisfies Record<(typeof SPEC_PATCH_PATHS)[number], z.ZodType>;

const patchOperationSchema = z
  .strictObject({
    op: z.enum(['add', 'remove', 'replace']),
    path: z.enum(SPEC_PATCH_PATHS),
    value: z.unknown().optional(),
  })
  .superRefine((operation, context) => {
    if (operation.op === 'remove') {
      if (operation.value !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'remove operation must not include a value',
        });
      }
      return;
    }
    const parsedValue = patchValueSchemas[operation.path].safeParse(
      operation.value,
    );
    if (!parsedValue.success) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: `${operation.op} operation has an invalid value for ${operation.path}`,
      });
    }
  });

const sceneCommandSchema = z.strictObject({
  type: z.literal('setObjectTransform'),
  objectId: z.string().trim().min(1).max(200),
  transform: transformSchema,
});

const sceneCommandsSchema = z
  .array(sceneCommandSchema)
  .max(16)
  .superRefine((commands, context) => {
    const objectIds = new Set<string>();
    commands.forEach((command, index) => {
      if (objectIds.has(command.objectId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'objectId'],
          message: 'sceneCommands must not target the same object twice',
        });
      }
      objectIds.add(command.objectId);
    });
  });

export const specPatchProposalSchema = z.strictObject({
  version: z.literal(SPEC_PATCH_PROPOSAL_VERSION),
  requestId: z.string().trim().min(1).max(200),
  baseSceneRevision: z.number().int().nonnegative().safe(),
  baseSpecRevision: z.number().int().nonnegative().safe(),
  message: z.string().trim().min(1).max(2_000),
  specPatch: z.array(patchOperationSchema).max(32),
  sceneCommands: sceneCommandsSchema,
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
});

export type SpecPatchProposal = z.infer<typeof specPatchProposalSchema>;
export type SpecPatchOperation = SpecPatchProposal['specPatch'][number];
export type SpecPatchPath = SpecPatchOperation['path'];
export type SceneCommand = SpecPatchProposal['sceneCommands'][number];

const textValueJsonSchema = { type: 'string', maxLength: 500 } as const;
const requiredTextValueJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 500,
} as const;
const patchValueJsonSchemas: Record<SpecPatchPath, unknown> = {
  '/intent/location': textValueJsonSchema,
  '/intent/timeOfDay': textValueJsonSchema,
  '/intent/mood': textValueJsonSchema,
  '/intent/visualStyle': textValueJsonSchema,
  '/generatedProps': {
    type: 'array',
    maxItems: 20,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'placement', 'importance'],
      properties: {
        name: requiredTextValueJsonSchema,
        placement: textValueJsonSchema,
        importance: textValueJsonSchema,
      },
    },
  },
  '/extras/enabled': { type: 'boolean' },
  '/extras/minCount': { type: 'integer', minimum: 0, maximum: 500 },
  '/extras/maxCount': { type: 'integer', minimum: 0, maximum: 500 },
  '/extras/placement': textValueJsonSchema,
  '/extras/importance': textValueJsonSchema,
  '/relationships': {
    type: 'array',
    maxItems: 20,
    items: {
      type: 'object',
      additionalProperties: false,
      required: [
        'subjectObjectId',
        'targetObjectId',
        'relationship',
        'gaze',
        'action',
      ],
      properties: {
        subjectObjectId: requiredTextValueJsonSchema,
        targetObjectId: requiredTextValueJsonSchema,
        relationship: textValueJsonSchema,
        gaze: textValueJsonSchema,
        action: textValueJsonSchema,
      },
    },
  },
  '/constraints/preserve': {
    type: 'array',
    maxItems: 7,
    items: requiredTextValueJsonSchema,
  },
  '/constraints/allowChanges': {
    type: 'array',
    maxItems: 7,
    items: requiredTextValueJsonSchema,
  },
};

const patchOperationJsonSchemas = SPEC_PATCH_PATHS.flatMap((path) => [
  {
    type: 'object',
    additionalProperties: false,
    required: ['op', 'path', 'value'],
    properties: {
      op: { enum: ['add', 'replace'] },
      path: { const: path },
      value: patchValueJsonSchemas[path],
    },
  },
  {
    type: 'object',
    additionalProperties: false,
    required: ['op', 'path'],
    properties: {
      op: { const: 'remove' },
      path: { const: path },
    },
  },
]);

const vector3JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'z'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
  },
} as const;

const positiveVector3JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'z'],
  properties: {
    x: { type: 'number', exclusiveMinimum: 0 },
    y: { type: 'number', exclusiveMinimum: 0 },
    z: { type: 'number', exclusiveMinimum: 0 },
  },
} as const;

const transformJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['position', 'rotationDeg', 'scale'],
  properties: {
    position: vector3JsonSchema,
    rotationDeg: vector3JsonSchema,
    scale: positiveVector3JsonSchema,
  },
} as const;

export const SPEC_PATCH_PROPOSAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'requestId',
    'baseSceneRevision',
    'baseSpecRevision',
    'message',
    'specPatch',
    'sceneCommands',
    'warnings',
  ],
  properties: {
    version: { const: SPEC_PATCH_PROPOSAL_VERSION },
    requestId: { type: 'string', minLength: 1, maxLength: 200 },
    baseSceneRevision: { type: 'integer', minimum: 0 },
    baseSpecRevision: { type: 'integer', minimum: 0 },
    message: { type: 'string', minLength: 1, maxLength: 2_000 },
    specPatch: {
      type: 'array',
      maxItems: 32,
      items: { oneOf: patchOperationJsonSchemas },
    },
    sceneCommands: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'objectId', 'transform'],
        properties: {
          type: { const: 'setObjectTransform' },
          objectId: { type: 'string', minLength: 1, maxLength: 200 },
          transform: transformJsonSchema,
        },
      },
    },
    warnings: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
} as const;

export interface SpecPatchFieldChange {
  path: SpecPatchPath;
  before: unknown;
  after: unknown;
}

export interface SpecPatchEvaluation {
  proposal: SpecPatchProposal;
  before: SemanticSceneSpec;
  after: SemanticSceneSpec;
  changes: SpecPatchFieldChange[];
  sceneCommandChanges: SceneCommandChange[];
  afterDocument: SceneDocument;
}

export interface SceneCommandChange {
  type: SceneCommand['type'];
  objectId: string;
  objectName: string;
  before: SceneObject['transform'];
  after: SceneObject['transform'];
}

export class StaleSpecPatchProposalError extends Error {
  constructor() {
    super('stale scene change proposal: scene or spec revision changed');
    this.name = 'StaleSpecPatchProposalError';
  }
}

function defaultValue(path: SpecPatchPath) {
  switch (path) {
    case '/extras/enabled':
      return false;
    case '/extras/minCount':
    case '/extras/maxCount':
      return 0;
    case '/generatedProps':
    case '/relationships':
    case '/constraints/preserve':
    case '/constraints/allowChanges':
      return [];
    default:
      return '';
  }
}

function getPatchValue(spec: SemanticSceneSpec, path: SpecPatchPath): unknown {
  switch (path) {
    case '/intent/location':
      return spec.intent.location;
    case '/intent/timeOfDay':
      return spec.intent.timeOfDay;
    case '/intent/mood':
      return spec.intent.mood;
    case '/intent/visualStyle':
      return spec.intent.visualStyle;
    case '/generatedProps':
      return spec.generatedProps;
    case '/extras/enabled':
      return spec.extras.enabled;
    case '/extras/minCount':
      return spec.extras.minCount;
    case '/extras/maxCount':
      return spec.extras.maxCount;
    case '/extras/placement':
      return spec.extras.placement;
    case '/extras/importance':
      return spec.extras.importance;
    case '/relationships':
      return spec.relationships;
    case '/constraints/preserve':
      return spec.constraints.preserve;
    case '/constraints/allowChanges':
      return spec.constraints.allowChanges;
  }
}

function setPatchValue(
  spec: SemanticSceneSpec,
  path: SpecPatchPath,
  input: unknown,
) {
  const value = patchValueSchemas[path].parse(input);
  switch (path) {
    case '/intent/location':
      spec.intent.location = value as string;
      break;
    case '/intent/timeOfDay':
      spec.intent.timeOfDay = value as string;
      break;
    case '/intent/mood':
      spec.intent.mood = value as string;
      break;
    case '/intent/visualStyle':
      spec.intent.visualStyle = value as string;
      break;
    case '/generatedProps':
      spec.generatedProps = value as SemanticSceneSpec['generatedProps'];
      break;
    case '/extras/enabled':
      spec.extras.enabled = value as boolean;
      break;
    case '/extras/minCount':
      spec.extras.minCount = value as number;
      break;
    case '/extras/maxCount':
      spec.extras.maxCount = value as number;
      break;
    case '/extras/placement':
      spec.extras.placement = value as string;
      break;
    case '/extras/importance':
      spec.extras.importance = value as string;
      break;
    case '/relationships':
      spec.relationships = value as SemanticSceneSpec['relationships'];
      break;
    case '/constraints/preserve':
      spec.constraints.preserve = value as string[];
      break;
    case '/constraints/allowChanges':
      spec.constraints.allowChanges = value as string[];
      break;
  }
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function evaluateSpecPatchProposal(
  sceneInput: SceneDocument,
  proposalInput: SpecPatchProposal,
): SpecPatchEvaluation {
  const scene = sceneDocumentSchema.parse(sceneInput);
  const proposal = specPatchProposalSchema.parse(proposalInput);
  if (
    proposal.baseSceneRevision !== scene.sceneRevision ||
    proposal.baseSpecRevision !== scene.specRevision
  ) {
    throw new StaleSpecPatchProposalError();
  }

  const before = structuredClone(scene.semanticSceneSpec);
  const candidate = structuredClone(before);
  for (const operation of proposal.specPatch) {
    setPatchValue(
      candidate,
      operation.path,
      operation.op === 'remove'
        ? defaultValue(operation.path)
        : operation.value,
    );
  }

  const after = semanticSceneSpecSchema.parse(candidate);
  let afterDocument = sceneDocumentSchema.parse({
    ...scene,
    semanticSceneSpec: after,
  });
  const sceneCommandChanges: SceneCommandChange[] = [];
  for (const command of proposal.sceneCommands) {
    const target = afterDocument.objects.find(
      ({ id }) => id === command.objectId,
    );
    if (target === undefined) {
      throw new Error(
        `scene command target does not exist: ${command.objectId}`,
      );
    }
    if (valuesEqual(target.transform, command.transform)) continue;
    sceneCommandChanges.push({
      type: command.type,
      objectId: target.id,
      objectName: target.name,
      before: structuredClone(target.transform),
      after: structuredClone(command.transform),
    });
    afterDocument = sceneDocumentSchema.parse({
      ...afterDocument,
      objects: afterDocument.objects.map((object) =>
        object.id === command.objectId
          ? { ...object, transform: command.transform }
          : object,
      ),
    });
  }
  const paths = [...new Set(proposal.specPatch.map(({ path }) => path))];
  const changes = paths.flatMap((path) => {
    const previous = getPatchValue(before, path);
    const next = getPatchValue(after, path);
    return valuesEqual(previous, next)
      ? []
      : [
          {
            path,
            before: structuredClone(previous),
            after: structuredClone(next),
          },
        ];
  });

  return {
    proposal,
    before,
    after,
    changes,
    sceneCommandChanges,
    afterDocument,
  };
}
