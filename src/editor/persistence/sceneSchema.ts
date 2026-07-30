import { z } from 'zod';
import {
  ASPECT_RATIO_VALUES,
  MANNEQUIN_REFERENCE_HEIGHT_M,
  MAX_SCENE_NOTES_LENGTH,
  MAX_SHADOW_MAP_SIZE,
  OUTPUT_DIMENSION_RANGE,
  SCENE_DOCUMENT_VERSION,
} from '../constants';

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

const sceneObjectSchema = z.strictObject({
  id: stableIdSchema,
  kind: z.enum(['floor', 'cube', 'sphere', 'cylinder', 'plane', 'mannequin']),
  name: z.string().trim().min(1),
  transform: transformSchema,
  dimensions: positiveVector3Schema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  visible: z.boolean(),
  exportable: z.boolean(),
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

const identityTransform = (positionY: number) => ({
  position: { x: 0, y: positionY, z: 0 },
  rotationDeg: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});

const OBJECT_DEFAULTS: Record<
  SceneObjectKind,
  Pick<SceneObject, 'name' | 'dimensions' | 'color'> & { positionY: number }
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
      ...identityTransform(defaults.positionY),
      ...(position === undefined ? {} : { position }),
    },
    dimensions: defaults.dimensions,
    color: defaults.color,
    visible: true,
    exportable: true,
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
      position: { x: 0, y: 1.6, z: 5 },
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
