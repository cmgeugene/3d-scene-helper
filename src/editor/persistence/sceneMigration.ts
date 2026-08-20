import { SCENE_DOCUMENT_VERSION } from '../constants';
import { createMannequinPose } from '../mannequin/mannequinRig';
import { createLensDepthOfFieldSettings } from '../scene/lensDepthOfField';

export function migrateSceneDocument(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('version' in value)) {
    return value;
  }

  if (value.version === SCENE_DOCUMENT_VERSION) return value;
  if (value.version !== 1 && value.version !== 2 && value.version !== 3) {
    return value;
  }

  const legacy = value as Record<string, unknown>;
  const objects = Array.isArray(legacy.objects)
    ? legacy.objects.map((object) => {
        if (typeof object !== 'object' || object === null) return object;
        const migratedObject = { ...object } as Record<string, unknown>;
        if (
          value.version === 1 &&
          migratedObject.kind === 'mannequin' &&
          migratedObject.mannequinPose === undefined
        ) {
          migratedObject.mannequinPose = createMannequinPose('default');
        }
        migratedObject.viewportSelectionLocked ??= false;
        migratedObject.visualization ??= { proxyOpacity: 1 };
        migratedObject.appearanceIntent ??= {
          surfaceType: 'opaque',
          materialNotes: '',
        };
        return migratedObject;
      })
    : legacy.objects;

  const needsDepthOfField = value.version === 1 || value.version === 2;
  const outputCamera =
    needsDepthOfField &&
    typeof legacy.outputCamera === 'object' &&
    legacy.outputCamera !== null &&
    !Array.isArray(legacy.outputCamera)
      ? {
          ...legacy.outputCamera,
          depthOfField: createLensDepthOfFieldSettings(false),
        }
      : legacy.outputCamera;

  return {
    ...legacy,
    version: SCENE_DOCUMENT_VERSION,
    objects,
    groups: legacy.groups ?? [],
    spatialRelations: legacy.spatialRelations ?? [],
    outputCamera,
  };
}
