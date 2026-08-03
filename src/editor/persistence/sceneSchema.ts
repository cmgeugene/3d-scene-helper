import { z } from 'zod';
import {
  ASPECT_RATIO_VALUES,
  MANNEQUIN_REFERENCE_HEIGHT_M,
  MAX_GENERATION_NOTES_LENGTH,
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCENE_NOTES_LENGTH,
  MAX_SEMANTIC_MEANING_LENGTH,
  MAX_SHADOW_MAP_SIZE,
  OUTPUT_DIMENSION_RANGE,
  SCENE_DOCUMENT_VERSION,
} from '../constants';
import { createMannequinPose } from '../mannequin/mannequinRig';

const stableIdSchema = z.string().trim().min(1);

const vector3Schema = z.strictObject({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export function hasRenderableMotionDirection({
  x,
  y,
  z,
}: {
  x: number;
  y: number;
  z: number;
}) {
  return x * x + y * y + z * z > 1e-12;
}

const motionDirectionSchema = vector3Schema.refine(
  hasRenderableMotionDirection,
  { message: 'Motion direction must have non-zero length' },
);

const positiveVector3Schema = z.strictObject({
  x: z.number().positive(),
  y: z.number().positive(),
  z: z.number().positive(),
});

const transformSchema = z.strictObject({
  position: vector3Schema,
  rotationDeg: vector3Schema,
  scale: positiveVector3Schema,
});

const mannequinEulerSchema = z.strictObject({
  x: z.number().min(-180).max(180),
  y: z.number().min(-180).max(180),
  z: z.number().min(-180).max(180),
});

const mannequinArmPoseSchema = z.strictObject({
  shoulderRotationDeg: mannequinEulerSchema,
  elbowBendDeg: z.number().min(0).max(150),
  elbowDeviationDeg: z.number().min(-8).max(8).default(0),
  wristRotationDeg: mannequinEulerSchema,
});

const mannequinLegPoseSchema = z.strictObject({
  hipRotationDeg: mannequinEulerSchema,
  kneeBendDeg: z.number().min(0).max(150),
  kneeDeviationDeg: z.number().min(-5).max(5).default(0),
  ankleRotationDeg: mannequinEulerSchema,
});

export const mannequinPoseSchema = z.strictObject({
  id: z.enum(['default', 'a', 't', 'walk-ready', 'custom']),
  torsoRotationDeg: mannequinEulerSchema,
  headRotationDeg: mannequinEulerSchema,
  arms: z.strictObject({
    left: mannequinArmPoseSchema,
    right: mannequinArmPoseSchema,
  }),
  legs: z.strictObject({
    left: mannequinLegPoseSchema,
    right: mannequinLegPoseSchema,
  }),
});

const semanticObjectSchema = z.strictObject({
  meaning: z.string().trim().max(MAX_SEMANTIC_MEANING_LENGTH),
  generationNotes: z.string().trim().max(MAX_GENERATION_NOTES_LENGTH),
});

const sceneObjectSchema = z
  .strictObject({
    id: stableIdSchema,
    kind: z.enum([
      'floor',
      'cube',
      'sphere',
      'cylinder',
      'plane',
      'mannequin',
      'room',
    ]),
    name: z.string().trim().min(1).max(MAX_OBJECT_NAME_LENGTH),
    transform: transformSchema,
    dimensions: positiveVector3Schema,
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    visible: z.boolean(),
    exportable: z.boolean(),
    semantic: semanticObjectSchema.optional(),
    mannequinPose: mannequinPoseSchema.optional(),
  })
  .superRefine((object, context) => {
    if (object.kind === 'mannequin' && object.mannequinPose === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Mannequin objects require a validated pose',
        path: ['mannequinPose'],
      });
    }
    if (object.kind !== 'mannequin' && object.mannequinPose !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only mannequin objects may contain a mannequin pose',
        path: ['mannequinPose'],
      });
    }
  });

const outputCameraSchema = z.strictObject({
  position: vector3Schema,
  target: vector3Schema,
  focalLengthMm: z.number().positive(),
  rollDeg: z.number(),
});

const lightSchema = z.strictObject({
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  intensity: z.number().nonnegative(),
  direction: vector3Schema,
});

const lightingSchema = z.strictObject({
  presetId: stableIdSchema,
  environmentIntensity: z.number().nonnegative(),
  key: lightSchema,
  fill: lightSchema,
  rim: lightSchema,
  exposure: z.number().positive(),
  shadows: z.strictObject({
    enabled: z.boolean(),
    softness: z.number().min(0).max(1),
    mapSize: z.number().int().positive().max(MAX_SHADOW_MAP_SIZE),
  }),
});

const backgroundSchema = z.strictObject({
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

export function isAspectLockedOutputSize(
  aspectRatioId: keyof typeof ASPECT_RATIO_VALUES,
  dimensions: { width: number; height: number },
) {
  const aspect = ASPECT_RATIO_VALUES[aspectRatioId];
  const matchesWidthDrivenLock =
    dimensions.height === Math.round(dimensions.width / aspect);
  const matchesHeightDrivenLock =
    dimensions.width === Math.round(dimensions.height * aspect);
  const isCanonicalCinematicPreset =
    aspectRatioId === '2.39:1' &&
    dimensions.width === 1920 &&
    dimensions.height === 804;

  return (
    matchesWidthDrivenLock ||
    matchesHeightDrivenLock ||
    isCanonicalCinematicPreset
  );
}

const outputSchema = z
  .strictObject({
    aspectRatioId: z.enum(['16:9', '9:16', '1:1', '2.39:1']),
    width: z
      .number()
      .int()
      .min(OUTPUT_DIMENSION_RANGE.min)
      .max(OUTPUT_DIMENSION_RANGE.max),
    height: z
      .number()
      .int()
      .min(OUTPUT_DIMENSION_RANGE.min)
      .max(OUTPUT_DIMENSION_RANGE.max),
    mode: z.enum(['clean', 'reference']),
  })
  .superRefine((output, context) => {
    if (!isAspectLockedOutputSize(output.aspectRatioId, output)) {
      context.addIssue({
        code: 'custom',
        message: 'Output dimensions must match the active aspect ratio',
        path: ['height'],
      });
    }
  });

const subjectMotionGuideSchema = z.strictObject({
  subjectId: stableIdSchema,
  direction: motionDirectionSchema,
  strength: z.number().min(0).max(1),
  label: z.string().trim().min(1),
});

const cameraMotionGuideSchema = z.strictObject({
  motionType: z.enum(['pan', 'tilt', 'dolly', 'orbit']),
  direction: motionDirectionSchema,
  strength: z.number().min(0).max(1),
  label: z.string().trim().min(1),
});

const generationSourceSchema = z.strictObject({
  generationId: stableIdSchema,
  versionNumber: z.number().int().positive(),
});

export const sceneDocumentSchema = z
  .strictObject({
    version: z.literal(SCENE_DOCUMENT_VERSION),
    id: stableIdSchema,
    name: z.string(),
    objects: z.array(sceneObjectSchema),
    outputCamera: outputCameraSchema,
    lighting: lightingSchema,
    background: backgroundSchema,
    output: outputSchema,
    sceneNotes: z.string().max(MAX_SCENE_NOTES_LENGTH),
    generationSource: generationSourceSchema.optional(),
    subjectMotionGuide: subjectMotionGuideSchema.optional(),
    cameraMotionGuide: cameraMotionGuideSchema.optional(),
  })
  .superRefine((document, context) => {
    const objectIds = new Set<string>();

    document.objects.forEach((object, index) => {
      if (objectIds.has(object.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Object IDs must be unique',
          path: ['objects', index, 'id'],
        });
      }
      objectIds.add(object.id);
    });

    if (
      document.subjectMotionGuide !== undefined &&
      !objectIds.has(document.subjectMotionGuide.subjectId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Subject motion guide must reference an existing object',
        path: ['subjectMotionGuide', 'subjectId'],
      });
    }
  });

export type SceneDocument = z.infer<typeof sceneDocumentSchema>;
export type SceneObject = SceneDocument['objects'][number];
export type MannequinPose = z.infer<typeof mannequinPoseSchema>;

export interface StarterSceneIds {
  documentId: string;
  floorId: string;
  mannequinId: string;
}

export type SceneObjectKind = SceneObject['kind'];
export type AddableSceneObjectKind = Exclude<SceneObjectKind, 'floor'>;

export interface CreateSceneObjectInput {
  kind: SceneObjectKind;
  name?: string;
  position?: { x: number; z: number };
}

export interface AddSceneObjectInput extends CreateSceneObjectInput {
  kind: AddableSceneObjectKind;
}

const identityTransform = (positionY: number, rotationY = 0) => ({
  position: { x: 0, y: positionY, z: 0 },
  rotationDeg: { x: 0, y: rotationY, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});

const OBJECT_DEFAULTS: Record<
  SceneObjectKind,
  Pick<SceneObject, 'name' | 'dimensions' | 'color'> & {
    positionY: number;
    rotationY?: number;
  }
> = {
  floor: {
    name: 'Floor',
    dimensions: { x: 10, y: 0.02, z: 10 },
    color: '#b8b8b8',
    positionY: -0.01,
  },
  mannequin: {
    name: 'Mannequin',
    dimensions: { x: 0.5, y: MANNEQUIN_REFERENCE_HEIGHT_M, z: 0.3 },
    color: '#a8a8a8',
    positionY: 0.85,
  },
  cube: {
    name: 'Cube',
    dimensions: { x: 1, y: 1, z: 1 },
    color: '#8c8c8c',
    positionY: 0.5,
  },
  sphere: {
    name: 'Sphere',
    dimensions: { x: 1, y: 1, z: 1 },
    color: '#8c8c8c',
    positionY: 0.5,
  },
  cylinder: {
    name: 'Cylinder',
    dimensions: { x: 1, y: 1, z: 1 },
    color: '#8c8c8c',
    positionY: 0.5,
  },
  plane: {
    name: 'Plane',
    dimensions: { x: 2, y: 0.02, z: 2 },
    color: '#b8b8b8',
    positionY: 0.01,
  },
  room: {
    name: 'Room Set',
    dimensions: { x: 4, y: 2.7, z: 4 },
    color: '#d0cbc2',
    positionY: 1.35,
    rotationY: 180,
  },
};

export function createSceneObject(
  id: string,
  input: CreateSceneObjectInput,
): SceneObject {
  const defaults = OBJECT_DEFAULTS[input.kind];
  const position =
    input.position === undefined
      ? undefined
      : {
          x: input.position.x,
          y: defaults.positionY,
          z: input.position.z,
        };

  return sceneObjectSchema.parse({
    id,
    kind: input.kind,
    name: input.name ?? defaults.name,
    transform: {
      ...identityTransform(defaults.positionY, defaults.rotationY),
      ...(position === undefined ? {} : { position }),
    },
    dimensions: defaults.dimensions,
    color: defaults.color,
    visible: true,
    exportable: true,
    ...(input.kind === 'mannequin'
      ? { mannequinPose: createMannequinPose('default') }
      : {}),
  });
}

export function createStarterSceneDocument(
  ids: StarterSceneIds,
): SceneDocument {
  return sceneDocumentSchema.parse({
    version: SCENE_DOCUMENT_VERSION,
    id: ids.documentId,
    name: 'Untitled scene',
    objects: [
      createSceneObject(ids.floorId, { kind: 'floor' }),
      createSceneObject(ids.mannequinId, { kind: 'mannequin' }),
    ],
    outputCamera: {
      position: { x: 0, y: 1.6, z: -5 },
      target: { x: 0, y: 1.6, z: 0 },
      focalLengthMm: 50,
      rollDeg: 0,
    },
    lighting: {
      presetId: 'neutral-studio',
      environmentIntensity: 0.35,
      key: {
        color: '#ffffff',
        intensity: 1,
        direction: { x: 1, y: 2, z: 1 },
      },
      fill: {
        color: '#dce7ff',
        intensity: 0.5,
        direction: { x: -1, y: 1, z: 1 },
      },
      rim: {
        color: '#ffffff',
        intensity: 0.35,
        direction: { x: 0, y: 1, z: -1 },
      },
      exposure: 1,
      shadows: {
        enabled: true,
        softness: 0.5,
        mapSize: MAX_SHADOW_MAP_SIZE,
      },
    },
    background: { color: '#d8d8d8' },
    output: {
      aspectRatioId: '16:9',
      width: 1920,
      height: 1080,
      mode: 'clean',
    },
    sceneNotes: '',
  });
}
