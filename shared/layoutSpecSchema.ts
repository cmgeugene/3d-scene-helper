import { z } from 'zod';

const vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const screenPointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const screenBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const layoutSpecSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  sceneId: z.string().min(1),
  output: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatioId: z.string().min(1),
  }),
  camera: z.object({
    position: vector3Schema,
    target: vector3Schema,
    focalLengthMm: z.number().positive(),
    rollDeg: z.number(),
    targetDistanceMeters: z.number().nonnegative(),
  }),
  authority: z.object({
    preserveFromLayout: z.array(z.string().min(1)),
    reinterpretForFinalFrame: z.array(z.string().min(1)),
    referencePriority: z.array(z.string().min(1)),
  }),
  objects: z.array(
    z.object({
      objectId: z.string().min(1),
      name: z.string().min(1),
      kind: z.enum([
        'floor',
        'cube',
        'sphere',
        'cylinder',
        'plane',
        'rounded-cube',
        'bent-plane',
        'triangle',
        'mannequin',
        'room',
      ]),
      role: z.enum(['subject', 'proxy', 'environment']),
      guideColor: z.string(),
      guideColorOnly: z.literal(true),
      proxyVisualization: z
        .object({ opacity: z.number().min(0.05).max(1) })
        .default({ opacity: 1 }),
      appearanceIntent: z
        .object({
          surfaceType: z.enum([
            'opaque',
            'transparent',
            'translucent',
            'mirror',
          ]),
          materialNotes: z.string(),
        })
        .default({ surfaceType: 'opaque', materialNotes: '' }),
      groupId: z.string().min(1).nullable().default(null),
      semanticMeaning: z.string().nullable().default(null),
      generationNotes: z.string().nullable().default(null),
      worldBounds: z.object({
        center: vector3Schema,
        size: vector3Schema,
      }),
      yawDeg: z.number(),
      facing: z
        .object({
          worldDirection: vector3Schema,
          relativeToCamera: z.enum([
            'toward-camera',
            'away-from-camera',
            'screen-left',
            'screen-right',
          ]),
        })
        .nullable(),
      poseId: z.string().nullable(),
      screen: z.object({
        status: z.enum(['visible', 'partial', 'outside', 'behind-camera']),
        center: screenPointSchema.nullable(),
        bounds: screenBoundsSchema.nullable(),
        clippedBounds: screenBoundsSchema.nullable(),
        occupancy: z.number().min(0).max(1),
        depthMeters: z.number(),
        depthBand: z.enum([
          'foreground',
          'midground',
          'background',
          'behind-camera',
        ]),
        positionLabel: z.string().nullable(),
      }),
      appearanceReferenceIds: z.array(z.string().min(1)),
      preserve: z.array(z.string().min(1)),
      reinterpret: z.array(z.string().min(1)),
    }),
  ),
  potentialOcclusions: z.array(
    z.object({
      nearObjectId: z.string().min(1),
      farObjectId: z.string().min(1),
      farObjectOverlap: z.number().min(0).max(1),
    }),
  ),
  containment: z
    .array(
      z.object({
        relationId: z.string().min(1),
        containerObjectId: z.string().min(1),
        containedObjectId: z.string().min(1),
        visibility: z.enum([
          'occluded',
          'through-opening',
          'through-transparent-surface',
          'cutaway',
        ]),
      }),
    )
    .default([]),
  mirrors: z
    .array(
      z.object({
        relationId: z.string().min(1),
        mirrorObjectId: z.string().min(1),
        reflectedObjectIds: z.array(z.string().min(1)).min(1),
        screenBounds: screenBoundsSchema.nullable(),
        pointWorld: vector3Schema,
        normalWorld: vector3Schema,
      }),
    )
    .default([]),
  omittedObjectIds: z.array(z.string().min(1)),
});

export type LayoutSpec = z.infer<typeof layoutSpecSchema>;
