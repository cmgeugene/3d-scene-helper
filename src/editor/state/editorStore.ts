import { createStore, type StoreApi } from 'zustand/vanilla';
import { ASPECT_RATIO_VALUES, MAX_SCENE_NOTES_LENGTH } from '../constants';
import {
  createSceneObject,
  mannequinPoseSchema,
  sceneDocumentSchema,
  type AddSceneObjectInput,
  type MannequinPose,
  type SceneDocument,
  type SceneObject,
  type SpatialRelation,
} from '../persistence/sceneSchema';
import type { SemanticSceneSpec } from '../persistence/semanticSceneSpec';
import {
  evaluateSpecPatchProposal,
  type SpecPatchEvaluation,
  type SpecPatchProposal,
} from '../persistence/specPatchProposal';
import {
  createMannequinPose,
  type MannequinPosePresetId,
} from '../mannequin/mannequinRig';
import {
  MANNEQUIN_BODY_TYPE_PRESETS,
  type MannequinBodyTypeId,
} from '../mannequin/mannequinBodyType';
import {
  CAMERA_SHOT_PRESETS,
  LENS_PRESETS,
  type CameraShotPreset,
  type LensPreset,
} from '../presets/cameras';
import {
  applyLightingPreset as applyLightingPresetToDocument,
  LIGHTING_PRESETS,
  type LightingPresetId,
} from '../presets/lighting';
import {
  computeCameraShot,
  computeFrameSelectedCamera,
  computeLookAtSelectedCamera,
} from '../scene/cameraMath';
import {
  getAutoApertureForLens,
  MAX_F_STOP,
  MIN_F_STOP,
} from '../scene/lensDepthOfField';
import { getSceneObjectBounds } from '../scene/sceneObjectModel';
import type {
  EditorNavigation,
  EditorPanel,
  ExportState,
  GuideVisibility,
  InProgressTransform,
  TransformMode,
} from '../types';
import {
  createDocumentHistory,
  recordDocumentHistory,
  redoDocumentHistory,
  undoDocumentHistory,
  type DocumentHistory,
} from './history';

export const DOCUMENT_MUTATION_KINDS = [
  'add-object',
  'delete-object',
  'duplicate-object',
  'commit-transform',
  'update-object-property',
  'update-object-selection-lock',
  'create-object-group',
  'delete-object-group',
  'translate-object-group',
  'update-object-visualization',
  'update-object-appearance',
  'create-spatial-relation',
  'delete-spatial-relation',
  'commit-camera',
  'update-lighting-background',
  'update-output',
  'update-motion-metadata',
  'update-semantic-scene-spec',
  'apply-scene-change-proposal',
  'commit-mannequin-pose',
  'update-mannequin-appearance',
  'apply-generation-snapshot',
] as const;

export type DocumentMutationKind = (typeof DOCUMENT_MUTATION_KINDS)[number];
export type MannequinTool = 'object' | 'ik';

export interface EditorStoreOptions {
  initialDocument: SceneDocument;
  createNewDocument?: () => SceneDocument;
  createStarterDocument?: () => SceneDocument;
  idFactory: () => string;
}

export interface LayoutGuide {
  objectUrl: string | null;
  fileName: string | null;
  opacity: number;
}

export interface EditorStore {
  document: SceneDocument;
  history: DocumentHistory<SceneDocument, DocumentMutationKind>;
  canUndo: boolean;
  canRedo: boolean;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedGroupId: string | null;
  hoveredObjectId: string | null;
  transformMode: TransformMode;
  mannequinTool: MannequinTool;
  guideVisibility: GuideVisibility;
  layoutGuide: LayoutGuide;
  isDirty: boolean;
  activePanel: EditorPanel;
  navigation: EditorNavigation;
  inProgressTransform: InProgressTransform | null;
  inProgressMannequinPose: {
    objectId: string;
    initialPose: MannequinPose;
  } | null;
  exportState: ExportState;
  statusMessage: string | null;
  addObject: (input: AddSceneObjectInput) => string;
  selectObject: (id: string | null) => void;
  toggleObjectSelection: (id: string) => void;
  selectGroup: (id: string | null) => void;
  setHoveredObject: (id: string | null) => void;
  renameObject: (id: string, name: string) => void;
  setObjectSemantic: (id: string, semantic: SceneObject['semantic']) => void;
  setObjectColor: (id: string, color: string) => void;
  setObjectVisibility: (id: string, visible: boolean) => void;
  setObjectViewportSelectionLocked: (id: string, locked: boolean) => void;
  setObjectProxyOpacity: (id: string, opacity: number) => void;
  setObjectAppearanceIntent: (
    id: string,
    appearanceIntent: SceneObject['appearanceIntent'],
  ) => void;
  addContainmentRelation: (
    containerObjectId: string,
    containedObjectId: string,
    visibility: Extract<SpatialRelation, { type: 'contains' }>['visibility'],
  ) => string | null;
  removeSpatialRelation: (relationId: string) => void;
  createObjectGroup: (objectIds: string[], name?: string) => string | null;
  ungroupObjects: (groupId: string) => void;
  translateObjectGroup: (
    groupId: string,
    delta: SceneObject['transform']['position'],
  ) => void;
  applyMannequinBodyTypePreset: (bodyType: MannequinBodyTypeId) => void;
  applyMannequinPosePreset: (presetId: MannequinPosePresetId) => void;
  beginMannequinPose: () => void;
  cancelMannequinPose: () => void;
  commitMannequinPose: (pose: MannequinPose) => void;
  beginTransform: () => void;
  cancelTransform: () => void;
  commitTransform: (transform: SceneObject['transform']) => void;
  duplicateObject: (id: string) => string | null;
  deleteObject: (id: string) => void;
  newScene: () => void;
  resetScene: () => void;
  commitCamera: (camera: SceneDocument['outputCamera']) => void;
  setCameraLens: (focalLengthMm: LensPreset['focalLengthMm']) => void;
  setCameraDepthOfFieldEnabled: (enabled: boolean) => void;
  setCameraApertureMode: (
    apertureMode: SceneDocument['outputCamera']['depthOfField']['apertureMode'],
  ) => void;
  setCameraFStop: (fStop: number) => void;
  setMannequinFocusContoursEnabled: (enabled: boolean) => void;
  applyCameraShot: (presetId: CameraShotPreset['id']) => void;
  frameSelected: () => void;
  targetSelected: () => void;
  applyLightingPreset: (presetId: LightingPresetId) => void;
  resetLightingPreset: () => void;
  setLighting: (lighting: SceneDocument['lighting']) => void;
  setBackgroundColor: (color: string) => void;
  setOutput: (output: SceneDocument['output']) => void;
  setSubjectMotionGuide: (
    guide: NonNullable<SceneDocument['subjectMotionGuide']> | null,
  ) => void;
  setCameraMotionGuide: (
    guide: NonNullable<SceneDocument['cameraMotionGuide']> | null,
  ) => void;
  setSceneNotes: (notes: string) => void;
  setSemanticSceneSpec: (spec: SemanticSceneSpec) => void;
  applySpecPatchProposal: (proposal: SpecPatchProposal) => SpecPatchEvaluation;
  setTransformMode: (mode: TransformMode) => void;
  setMannequinTool: (tool: MannequinTool) => void;
  setGuideVisibility: (visibility: Partial<GuideVisibility>) => void;
  setLayoutGuideFile: (file: File | null) => void;
  setLayoutGuideOpacity: (opacity: number) => void;
  setActivePanel: (panel: EditorPanel) => void;
  setNavigation: (navigation: EditorNavigation) => void;
  setExportState: (exportState: ExportState) => void;
  setStatusMessage: (statusMessage: string | null) => void;
  replaceDocument: (document: SceneDocument, persisted: boolean) => void;
  markDocumentPersisted: (document: SceneDocument) => void;
  applyGenerationSnapshot: (
    document: SceneDocument,
    source: NonNullable<SceneDocument['generationSource']>,
  ) => void;
  undo: () => void;
  redo: () => void;
}

export function createEditorStore(options: EditorStoreOptions) {
  const document = sceneDocumentSchema.parse(options.initialDocument);
  const initialDocument = structuredClone(document);
  let persistedDocument = structuredClone(document);
  const documentsEqual = (left: SceneDocument, right: SceneDocument) =>
    JSON.stringify(left) === JSON.stringify(right);
  const documentContentsEqual = (left: SceneDocument, right: SceneDocument) =>
    JSON.stringify({ ...left, sceneRevision: 0, specRevision: 0 }) ===
    JSON.stringify({ ...right, sceneRevision: 0, specRevision: 0 });
  const semanticSpecsEqual = (left: SceneDocument, right: SceneDocument) =>
    JSON.stringify(left.semanticSceneSpec) ===
    JSON.stringify(right.semanticSceneSpec);
  const withNextRevision = (
    currentDocument: SceneDocument,
    nextDocument: SceneDocument,
  ) =>
    sceneDocumentSchema.parse({
      ...nextDocument,
      sceneRevision:
        Math.max(currentDocument.sceneRevision, nextDocument.sceneRevision) + 1,
      specRevision:
        Math.max(currentDocument.specRevision, nextDocument.specRevision) +
        (semanticSpecsEqual(currentDocument, nextDocument) ? 0 : 1),
    });
  const createResetState = (
    currentDocument: SceneDocument,
    replacement: SceneDocument,
  ) => {
    const nextDocument = withNextRevision(currentDocument, replacement);
    return {
      document: nextDocument,
      history: createDocumentHistory<SceneDocument, DocumentMutationKind>(),
      canUndo: false,
      canRedo: false,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedGroupId: null,
      hoveredObjectId: null,
      inProgressTransform: null,
      inProgressMannequinPose: null,
      navigation: {
        position: structuredClone(nextDocument.outputCamera.position),
        target: structuredClone(nextDocument.outputCamera.target),
        isInteracting: false,
      },
      isDirty: !documentContentsEqual(nextDocument, persistedDocument),
      statusMessage: null,
    };
  };

  const recordMutation = (
    state: EditorStore,
    nextDocument: SceneDocument,
    mutationKind: DocumentMutationKind,
  ) => {
    if (documentsEqual(state.document, nextDocument)) {
      return {
        document:
          mutationKind === 'commit-camera' ? nextDocument : state.document,
        history: state.history,
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        isDirty: state.isDirty,
      };
    }
    const revisionedDocument = withNextRevision(state.document, nextDocument);
    const history = recordDocumentHistory(
      state.history,
      state.document,
      mutationKind,
      DOCUMENT_MUTATION_KINDS,
    );

    return {
      document: revisionedDocument,
      history,
      canUndo: history.past.length > 0,
      canRedo: false,
      isDirty: !documentContentsEqual(revisionedDocument, persistedDocument),
    };
  };

  const updateObject = (
    set: StoreApi<EditorStore>['setState'],
    id: string,
    update: Partial<SceneObject>,
    mutationKind: DocumentMutationKind = 'update-object-property',
  ) => {
    set((state) => {
      if (!state.document.objects.some((object) => object.id === id)) {
        return state;
      }

      const nextDocument = sceneDocumentSchema.parse({
        ...state.document,
        objects: state.document.objects.map((object) =>
          object.id === id ? { ...object, ...update } : object,
        ),
      });
      return {
        ...recordMutation(state, nextDocument, mutationKind),
      };
    });
  };

  return createStore<EditorStore>((set, get) => ({
    document,
    history: createDocumentHistory(),
    canUndo: false,
    canRedo: false,
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedGroupId: null,
    hoveredObjectId: null,
    transformMode: 'translate',
    mannequinTool: 'object',
    guideVisibility: {
      thirds: false,
      center: false,
      actionSafe: false,
      titleSafe: false,
      motion: false,
    },
    layoutGuide: {
      objectUrl: null,
      fileName: null,
      opacity: 0.35,
    },
    isDirty: false,
    activePanel: 'scene',
    navigation: {
      position: structuredClone(document.outputCamera.position),
      target: structuredClone(document.outputCamera.target),
      isInteracting: false,
    },
    inProgressTransform: null,
    inProgressMannequinPose: null,
    exportState: {
      status: 'idle',
      progress: 0,
      error: null,
    },
    statusMessage: null,
    addObject: (input) => {
      if ((input as { kind: string }).kind === 'floor') {
        throw new Error('Floor is starter scene content');
      }

      const id = options.idFactory();
      const object = createSceneObject(id, input);

      set((state) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          objects: [...state.document.objects, object],
        });
        return {
          ...recordMutation(state, nextDocument, 'add-object'),
          selectedObjectId: id,
          selectedObjectIds: [id],
          selectedGroupId: null,
          statusMessage: null,
        };
      });

      return id;
    },
    selectObject: (id) => {
      set((state) => {
        const selectedObjectId =
          id !== null &&
          state.document.objects.some((object) => object.id === id)
            ? id
            : null;
        return {
          selectedObjectId,
          selectedObjectIds:
            selectedObjectId === null ? [] : [selectedObjectId],
          selectedGroupId: null,
          statusMessage: null,
        };
      });
    },
    toggleObjectSelection: (id) => {
      set((state) => {
        if (!state.document.objects.some((object) => object.id === id)) {
          return state;
        }
        const selectedObjectIds = state.selectedObjectIds.includes(id)
          ? state.selectedObjectIds.filter((objectId) => objectId !== id)
          : [...state.selectedObjectIds, id];
        return {
          selectedObjectIds,
          selectedObjectId:
            selectedObjectIds.length === 1 ? selectedObjectIds[0]! : null,
          selectedGroupId: null,
          statusMessage: null,
        };
      });
    },
    selectGroup: (id) => {
      set((state) => {
        const group = state.document.groups.find((group) => group.id === id);
        return {
          selectedGroupId: group?.id ?? null,
          selectedObjectIds: group?.memberObjectIds ?? [],
          selectedObjectId: null,
          statusMessage: null,
        };
      });
    },
    setHoveredObject: (id) => {
      set((state) => ({
        hoveredObjectId:
          id !== null &&
          state.document.objects.some((object) => object.id === id)
            ? id
            : null,
      }));
    },
    renameObject: (id, name) => {
      updateObject(set, id, { name });
    },
    setObjectSemantic: (id, semantic) => {
      updateObject(set, id, { semantic });
    },
    setObjectColor: (id, color) => {
      updateObject(set, id, { color });
    },
    setObjectVisibility: (id, visible) => {
      updateObject(set, id, { visible });
    },
    setObjectViewportSelectionLocked: (id, locked) => {
      updateObject(
        set,
        id,
        { viewportSelectionLocked: locked },
        'update-object-selection-lock',
      );
    },
    setObjectProxyOpacity: (id, opacity) => {
      if (!Number.isFinite(opacity)) {
        throw new RangeError('Proxy opacity must be finite');
      }
      updateObject(
        set,
        id,
        { visualization: { proxyOpacity: opacity } },
        'update-object-visualization',
      );
    },
    setObjectAppearanceIntent: (id, appearanceIntent) => {
      updateObject(set, id, { appearanceIntent }, 'update-object-appearance');
    },
    addContainmentRelation: (
      containerObjectId,
      containedObjectId,
      visibility,
    ) => {
      const relationId = options.idFactory();
      let created = false;
      set((state) => {
        const parsed = sceneDocumentSchema.safeParse({
          ...state.document,
          spatialRelations: [
            ...state.document.spatialRelations,
            {
              id: relationId,
              type: 'contains',
              containerObjectId,
              containedObjectId,
              visibility,
            },
          ],
        });
        if (!parsed.success) return state;
        created = true;
        return {
          ...recordMutation(state, parsed.data, 'create-spatial-relation'),
          statusMessage: null,
        };
      });
      return created ? relationId : null;
    },
    removeSpatialRelation: (relationId) => {
      set((state) => {
        if (
          !state.document.spatialRelations.some(({ id }) => id === relationId)
        ) {
          return state;
        }
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          spatialRelations: state.document.spatialRelations.filter(
            ({ id }) => id !== relationId,
          ),
        });
        return {
          ...recordMutation(state, nextDocument, 'delete-spatial-relation'),
          statusMessage: null,
        };
      });
    },
    createObjectGroup: (objectIds, name) => {
      const uniqueObjectIds = [...new Set(objectIds)];
      const state = get();
      const groupedObjectIds = new Set(
        state.document.groups.flatMap((group) => group.memberObjectIds),
      );
      const eligible = uniqueObjectIds.filter((id) => {
        const object = state.document.objects.find(
          (object) => object.id === id,
        );
        return (
          object !== undefined &&
          object.kind !== 'floor' &&
          !groupedObjectIds.has(id)
        );
      });
      if (eligible.length < 2 || eligible.length !== uniqueObjectIds.length) {
        return null;
      }

      const groupId = options.idFactory();
      set((current) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...current.document,
          groups: [
            ...current.document.groups,
            {
              id: groupId,
              name:
                name?.trim() || `Group ${current.document.groups.length + 1}`,
              memberObjectIds: eligible,
            },
          ],
        });
        return {
          ...recordMutation(current, nextDocument, 'create-object-group'),
          selectedObjectId: null,
          selectedObjectIds: eligible,
          selectedGroupId: groupId,
          statusMessage: null,
        };
      });
      return groupId;
    },
    ungroupObjects: (groupId) => {
      set((state) => {
        const group = state.document.groups.find(({ id }) => id === groupId);
        if (group === undefined) return state;
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          groups: state.document.groups.filter(({ id }) => id !== groupId),
        });
        return {
          ...recordMutation(state, nextDocument, 'delete-object-group'),
          selectedObjectId: null,
          selectedObjectIds: group.memberObjectIds,
          selectedGroupId: null,
          statusMessage: null,
        };
      });
    },
    translateObjectGroup: (groupId, delta) => {
      if (
        !Number.isFinite(delta.x) ||
        !Number.isFinite(delta.y) ||
        !Number.isFinite(delta.z)
      ) {
        throw new RangeError('Group translation delta must be finite');
      }
      set((state) => {
        const group = state.document.groups.find(({ id }) => id === groupId);
        if (
          group === undefined ||
          (delta.x === 0 && delta.y === 0 && delta.z === 0)
        ) {
          return state;
        }
        const memberIds = new Set(group.memberObjectIds);
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          objects: state.document.objects.map((object) =>
            memberIds.has(object.id)
              ? {
                  ...object,
                  transform: {
                    ...object.transform,
                    position: {
                      x: object.transform.position.x + delta.x,
                      y: object.transform.position.y + delta.y,
                      z: object.transform.position.z + delta.z,
                    },
                  },
                }
              : object,
          ),
        });
        return {
          ...recordMutation(state, nextDocument, 'translate-object-group'),
          selectedObjectId: null,
          selectedObjectIds: group.memberObjectIds,
          selectedGroupId: group.id,
          statusMessage: null,
        };
      });
    },
    applyMannequinBodyTypePreset: (bodyType) => {
      set((state) => {
        const selected = state.document.objects.find(
          ({ id }) => id === state.selectedObjectId,
        );
        if (selected?.kind !== 'mannequin') return state;
        const preset = MANNEQUIN_BODY_TYPE_PRESETS.find(
          ({ id }) => id === bodyType,
        );
        if (
          preset === undefined ||
          (selected.mannequinBodyType === bodyType &&
            selected.dimensions.y === preset.heightMeters)
        ) {
          return state;
        }
        const resizedSelected: SceneObject = {
          ...selected,
          mannequinBodyType: bodyType,
          dimensions: {
            ...selected.dimensions,
            y: preset.heightMeters,
          },
        };
        const floorOffset =
          getSceneObjectBounds(selected).min.y -
          getSceneObjectBounds(resizedSelected).min.y;
        const groundedSelected: SceneObject = {
          ...resizedSelected,
          transform: {
            ...resizedSelected.transform,
            position: {
              ...resizedSelected.transform.position,
              y: resizedSelected.transform.position.y + floorOffset,
            },
          },
        };
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          objects: state.document.objects.map((object) =>
            object.id === selected.id ? groundedSelected : object,
          ),
        });
        return {
          ...recordMutation(state, nextDocument, 'update-object-property'),
          statusMessage: `${selected.name}에 ${preset.label}을 적용했습니다.`,
        };
      });
    },
    applyMannequinPosePreset: (presetId) => {
      set((state) => {
        const selected = state.document.objects.find(
          ({ id }) => id === state.selectedObjectId,
        );
        if (selected?.kind !== 'mannequin') return state;
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          objects: state.document.objects.map((object) =>
            object.id === selected.id
              ? { ...object, mannequinPose: createMannequinPose(presetId) }
              : object,
          ),
        });
        return {
          ...recordMutation(state, nextDocument, 'commit-mannequin-pose'),
          inProgressMannequinPose: null,
          statusMessage: `${selected.name}에 ${presetId} 포즈를 적용했습니다.`,
        };
      });
    },
    beginMannequinPose: () => {
      set((state) => {
        const selected = state.document.objects.find(
          ({ id }) => id === state.selectedObjectId,
        );
        if (
          selected?.kind !== 'mannequin' ||
          selected.mannequinPose === undefined
        ) {
          return state;
        }
        return {
          inProgressMannequinPose: {
            objectId: selected.id,
            initialPose: structuredClone(selected.mannequinPose),
          },
        };
      });
    },
    cancelMannequinPose: () => {
      set((state) =>
        state.inProgressMannequinPose === null
          ? state
          : { inProgressMannequinPose: null },
      );
    },
    commitMannequinPose: (pose) => {
      set((state) => {
        const inProgress = state.inProgressMannequinPose;
        if (inProgress === null) return state;
        const validatedPose = mannequinPoseSchema.parse(pose);
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          objects: state.document.objects.map((object) =>
            object.id === inProgress.objectId
              ? { ...object, mannequinPose: validatedPose }
              : object,
          ),
        });
        return {
          ...recordMutation(state, nextDocument, 'commit-mannequin-pose'),
          inProgressMannequinPose: null,
        };
      });
    },
    beginTransform: () => {
      set((state) => {
        if (state.selectedObjectId === null) {
          return state;
        }

        const object = state.document.objects.find(
          ({ id }) => id === state.selectedObjectId,
        );
        if (object === undefined) {
          return state;
        }

        return {
          inProgressTransform: {
            objectId: object.id,
            initialTransform: structuredClone(object.transform),
          },
        };
      });
    },
    cancelTransform: () => {
      set((state) =>
        state.inProgressTransform === null
          ? state
          : { inProgressTransform: null },
      );
    },
    commitTransform: (transform) => {
      set((state) => {
        if (state.inProgressTransform === null) {
          return state;
        }

        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          objects: state.document.objects.map((object) =>
            object.id === state.inProgressTransform?.objectId
              ? { ...object, transform }
              : object,
          ),
        });
        return {
          ...recordMutation(state, nextDocument, 'commit-transform'),
          inProgressTransform: null,
        };
      });
    },
    duplicateObject: (id) => {
      const source = get().document.objects.find((object) => object.id === id);
      if (source === undefined) {
        return null;
      }

      const duplicateId = options.idFactory();

      set((state) => {
        const duplicate = structuredClone(source);
        duplicate.id = duplicateId;
        duplicate.name = `${source.name} copy`;
        duplicate.transform.position.x += 0.5;

        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          objects: [...state.document.objects, duplicate],
        });
        return {
          ...recordMutation(state, nextDocument, 'duplicate-object'),
          selectedObjectId: duplicateId,
          selectedObjectIds: [duplicateId],
          selectedGroupId: null,
          statusMessage: null,
        };
      });

      return duplicateId;
    },
    deleteObject: (id) => {
      set((state) => {
        if (!state.document.objects.some((object) => object.id === id)) {
          return state;
        }

        const spatialRelations: SceneDocument['spatialRelations'] = [];
        state.document.spatialRelations.forEach((relation) => {
          if (relation.type === 'contains') {
            if (
              relation.containerObjectId !== id &&
              relation.containedObjectId !== id
            ) {
              spatialRelations.push(relation);
            }
            return;
          }
          if (relation.mirrorObjectId === id) return;
          const reflectedObjectIds = relation.reflectedObjectIds.filter(
            (objectId) => objectId !== id,
          );
          if (reflectedObjectIds.length > 0) {
            spatialRelations.push({ ...relation, reflectedObjectIds });
          }
        });

        const documentWithoutObject = {
          ...state.document,
          objects: state.document.objects.filter((object) => object.id !== id),
          groups: state.document.groups.flatMap((group) => {
            const memberObjectIds = group.memberObjectIds.filter(
              (objectId) => objectId !== id,
            );
            return memberObjectIds.length >= 2
              ? [{ ...group, memberObjectIds }]
              : [];
          }),
          spatialRelations,
          semanticSceneSpec: {
            ...state.document.semanticSceneSpec,
            relationships:
              state.document.semanticSceneSpec.relationships.filter(
                ({ subjectObjectId, targetObjectId }) =>
                  subjectObjectId !== id && targetObjectId !== id,
              ),
          },
        };
        const document = { ...documentWithoutObject };
        if (state.document.subjectMotionGuide?.subjectId === id) {
          delete document.subjectMotionGuide;
        }

        const nextDocument = sceneDocumentSchema.parse(document);
        const selectedGroup = nextDocument.groups.find(
          ({ id: groupId }) => groupId === state.selectedGroupId,
        );
        const survivingSelectedObjectIds = state.selectedObjectIds.filter(
          (objectId) =>
            objectId !== id &&
            nextDocument.objects.some((object) => object.id === objectId),
        );
        const selectedObjectIds =
          selectedGroup?.memberObjectIds ?? survivingSelectedObjectIds;
        return {
          ...recordMutation(state, nextDocument, 'delete-object'),
          selectedObjectId:
            selectedGroup === undefined && selectedObjectIds.length === 1
              ? selectedObjectIds[0]!
              : null,
          selectedObjectIds,
          selectedGroupId: selectedGroup?.id ?? null,
          hoveredObjectId:
            state.hoveredObjectId === id ? null : state.hoveredObjectId,
          inProgressTransform:
            state.inProgressTransform?.objectId === id
              ? null
              : state.inProgressTransform,
          inProgressMannequinPose:
            state.inProgressMannequinPose?.objectId === id
              ? null
              : state.inProgressMannequinPose,
          statusMessage: null,
        };
      });
    },
    newScene: () => {
      const nextDocument = sceneDocumentSchema.parse(
        options.createNewDocument?.() ?? structuredClone(initialDocument),
      );
      set((state) => createResetState(state.document, nextDocument));
    },
    resetScene: () => {
      const nextDocument = sceneDocumentSchema.parse(
        options.createStarterDocument?.() ?? structuredClone(initialDocument),
      );
      set((state) => createResetState(state.document, nextDocument));
    },
    commitCamera: (camera) => {
      set((state) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          outputCamera: camera,
        });
        return {
          ...recordMutation(state, nextDocument, 'commit-camera'),
          navigation: {
            position: structuredClone(camera.position),
            target: structuredClone(camera.target),
            isInteracting: false,
          },
        };
      });
    },
    setCameraLens: (focalLengthMm) => {
      if (
        !LENS_PRESETS.some((preset) => preset.focalLengthMm === focalLengthMm)
      ) {
        throw new RangeError('지원하지 않는 렌즈 프리셋입니다.');
      }
      const camera = get().document.outputCamera;
      get().commitCamera({
        ...camera,
        focalLengthMm,
        depthOfField:
          camera.depthOfField.apertureMode === 'auto'
            ? {
                ...camera.depthOfField,
                fStop: getAutoApertureForLens(focalLengthMm),
              }
            : camera.depthOfField,
      });
      set({ statusMessage: `${focalLengthMm}mm 렌즈를 적용했습니다.` });
    },
    setCameraDepthOfFieldEnabled: (enabled) => {
      const camera = get().document.outputCamera;
      get().commitCamera({
        ...camera,
        depthOfField: { ...camera.depthOfField, enabled },
      });
      set({
        statusMessage: enabled
          ? '시네마틱 심도를 사용합니다.'
          : '시네마틱 심도를 끕니다.',
      });
    },
    setCameraApertureMode: (apertureMode) => {
      const camera = get().document.outputCamera;
      get().commitCamera({
        ...camera,
        depthOfField: {
          ...camera.depthOfField,
          apertureMode,
          fStop:
            apertureMode === 'auto'
              ? getAutoApertureForLens(camera.focalLengthMm)
              : camera.depthOfField.fStop,
        },
      });
      set({
        statusMessage:
          apertureMode === 'auto'
            ? '렌즈 자동 조리개를 사용합니다.'
            : '수동 조리개를 사용합니다.',
      });
    },
    setCameraFStop: (fStop) => {
      if (!Number.isFinite(fStop) || fStop < MIN_F_STOP || fStop > MAX_F_STOP) {
        throw new RangeError(
          `f-stop은 ${MIN_F_STOP}..${MAX_F_STOP} 범위여야 합니다.`,
        );
      }
      const camera = get().document.outputCamera;
      if (camera.depthOfField.apertureMode !== 'manual') return;
      get().commitCamera({
        ...camera,
        depthOfField: { ...camera.depthOfField, fStop },
      });
      set({ statusMessage: `수동 조리개 f/${fStop}을 적용했습니다.` });
    },
    setMannequinFocusContoursEnabled: (enabled) => {
      set((state) => {
        if (
          state.document.mannequinAppearance.focusContoursEnabled === enabled
        ) {
          return state;
        }
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          mannequinAppearance: { focusContoursEnabled: enabled },
        });
        return {
          ...recordMutation(state, nextDocument, 'update-mannequin-appearance'),
          statusMessage: enabled
            ? '모든 마네킹의 초점 확인 등고선을 표시합니다.'
            : '모든 마네킹의 초점 확인 등고선을 숨깁니다.',
        };
      });
    },
    applyCameraShot: (presetId) => {
      const preset = CAMERA_SHOT_PRESETS.find(({ id }) => id === presetId);
      if (preset === undefined) return;
      const state = get();
      const selected = state.document.objects.find(
        ({ id }) => id === state.selectedObjectId,
      );
      const fallback = state.document.objects.find(
        ({ kind, visible }) => kind === 'mannequin' && visible,
      );
      const subject = selected ?? fallback;
      const camera = computeCameraShot(
        subject === undefined ? null : getSceneObjectBounds(subject),
        state.document.outputCamera,
        ASPECT_RATIO_VALUES[state.document.output.aspectRatioId],
        preset,
      );
      get().commitCamera(camera);
      set({ statusMessage: `${preset.label} 샷을 적용했습니다.` });
    },
    frameSelected: () => {
      const state = get();
      const selected = state.document.objects.find(
        ({ id }) => id === state.selectedObjectId,
      );
      if (selected === undefined) {
        set({ statusMessage: '프레임에 맞출 오브젝트를 먼저 선택하세요.' });
        return;
      }
      get().commitCamera(
        computeFrameSelectedCamera(
          getSceneObjectBounds(selected),
          state.document.outputCamera,
          ASPECT_RATIO_VALUES[state.document.output.aspectRatioId],
        ),
      );
      set({ statusMessage: `${selected.name}을 프레임에 맞췄습니다.` });
    },
    targetSelected: () => {
      const state = get();
      const selected = state.document.objects.find(
        ({ id }) => id === state.selectedObjectId,
      );
      if (selected === undefined) {
        set({
          statusMessage:
            '카메라 타겟·초점으로 설정할 오브젝트를 먼저 선택하세요.',
        });
        return;
      }
      get().commitCamera(
        computeLookAtSelectedCamera(
          getSceneObjectBounds(selected),
          state.document.outputCamera,
        ),
      );
      set({
        statusMessage: `${selected.name}을 카메라 타겟·초점으로 설정했습니다.`,
      });
    },
    applyLightingPreset: (presetId) => {
      set((state) => {
        const nextDocument = sceneDocumentSchema.parse(
          applyLightingPresetToDocument(state.document, presetId),
        );
        return recordMutation(
          state,
          nextDocument,
          'update-lighting-background',
        );
      });
    },
    resetLightingPreset: () => {
      const presetId = get().document.lighting.presetId;
      const preset = LIGHTING_PRESETS.find(
        (candidate) => candidate.id === presetId,
      );
      if (preset === undefined) {
        set({ statusMessage: '재설정할 조명 프리셋을 먼저 선택하세요.' });
        return;
      }
      get().applyLightingPreset(preset.id);
    },
    setLighting: (lighting) => {
      set((state) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          lighting,
        });
        return recordMutation(
          state,
          nextDocument,
          'update-lighting-background',
        );
      });
    },
    setBackgroundColor: (color) => {
      set((state) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          background: { color },
        });
        return recordMutation(
          state,
          nextDocument,
          'update-lighting-background',
        );
      });
    },
    setOutput: (output) => {
      set((state) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          output,
        });
        return {
          ...recordMutation(state, nextDocument, 'update-output'),
          statusMessage: null,
        };
      });
    },
    setSubjectMotionGuide: (guide) => {
      set((state) => {
        const nextDocument = { ...state.document };
        if (guide === null) {
          delete nextDocument.subjectMotionGuide;
        } else {
          if (state.selectedObjectId === null) return state;
          nextDocument.subjectMotionGuide = {
            ...guide,
            subjectId: state.selectedObjectId,
          };
        }
        const mutation = recordMutation(
          state,
          sceneDocumentSchema.parse(nextDocument),
          'update-motion-metadata',
        );
        return guide === null
          ? mutation
          : {
              ...mutation,
              guideVisibility: { ...state.guideVisibility, motion: true },
            };
      });
    },
    setCameraMotionGuide: (guide) => {
      set((state) => {
        const nextDocument = { ...state.document };
        if (guide === null) {
          delete nextDocument.cameraMotionGuide;
        } else {
          nextDocument.cameraMotionGuide = guide;
        }
        const mutation = recordMutation(
          state,
          sceneDocumentSchema.parse(nextDocument),
          'update-motion-metadata',
        );
        return guide === null
          ? mutation
          : {
              ...mutation,
              guideVisibility: { ...state.guideVisibility, motion: true },
            };
      });
    },
    setSceneNotes: (sceneNotes) => {
      set((state) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          sceneNotes: sceneNotes.slice(0, MAX_SCENE_NOTES_LENGTH),
        });
        return recordMutation(state, nextDocument, 'update-motion-metadata');
      });
    },
    setSemanticSceneSpec: (semanticSceneSpec) => {
      set((state) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          semanticSceneSpec,
        });
        return recordMutation(
          state,
          nextDocument,
          'update-semantic-scene-spec',
        );
      });
    },
    applySpecPatchProposal: (proposal) => {
      let applied: SpecPatchEvaluation | null = null;
      set((state) => {
        const evaluation = evaluateSpecPatchProposal(state.document, proposal);
        if (
          evaluation.changes.length === 0 &&
          evaluation.sceneCommandChanges.length === 0
        ) {
          throw new Error('scene change proposal has no effective changes');
        }
        applied = evaluation;
        return {
          ...recordMutation(
            state,
            evaluation.afterDocument,
            'apply-scene-change-proposal',
          ),
          statusMessage: 'Scene Assistant 변경안을 적용했습니다.',
        };
      });
      if (applied === null) {
        throw new Error('scene change proposal was not applied');
      }
      return applied;
    },
    setTransformMode: (transformMode) => {
      set({ transformMode, statusMessage: null });
    },
    setMannequinTool: (mannequinTool) => {
      set({ mannequinTool, statusMessage: null });
    },
    setGuideVisibility: (visibility) => {
      set((state) => ({
        guideVisibility: { ...state.guideVisibility, ...visibility },
      }));
    },
    setLayoutGuideFile: (file) => {
      const previousUrl = get().layoutGuide.objectUrl;
      if (previousUrl !== null) URL.revokeObjectURL(previousUrl);
      if (file === null) {
        set((state) => ({
          layoutGuide: {
            ...state.layoutGuide,
            objectUrl: null,
            fileName: null,
          },
          statusMessage: '레이아웃 가이드 이미지를 제거했습니다.',
        }));
        return;
      }
      set((state) => ({
        layoutGuide: {
          ...state.layoutGuide,
          objectUrl: URL.createObjectURL(file),
          fileName: file.name,
        },
        statusMessage: '레이아웃 가이드 이미지를 표시합니다.',
      }));
    },
    setLayoutGuideOpacity: (opacity) => {
      const nextOpacity = Math.min(1, Math.max(0, opacity));
      set((state) => ({
        layoutGuide: {
          ...state.layoutGuide,
          opacity: nextOpacity,
        },
      }));
    },
    setActivePanel: (activePanel) => {
      set({ activePanel });
    },
    setNavigation: (navigation) => {
      set({ navigation: structuredClone(navigation) });
    },
    setExportState: (exportState) => {
      set({ exportState: structuredClone(exportState) });
    },
    setStatusMessage: (statusMessage) => {
      set({ statusMessage });
    },
    replaceDocument: (replacement, persisted) => {
      const parsedReplacement = sceneDocumentSchema.parse(replacement);
      set((state) => {
        const nextState = createResetState(state.document, parsedReplacement);
        if (persisted) persistedDocument = structuredClone(nextState.document);
        return nextState;
      });
    },
    markDocumentPersisted: (savedDocument) => {
      const state = get();
      if (state.document !== savedDocument) return;
      persistedDocument = structuredClone(state.document);
      set({ isDirty: false });
    },
    applyGenerationSnapshot: (snapshot, source) => {
      const snapshotDocument = sceneDocumentSchema.parse({
        ...structuredClone(snapshot),
        generationSource: source,
      });
      set((state) => {
        const nextDocument = withNextRevision(state.document, snapshotDocument);
        const history = recordDocumentHistory(
          state.history,
          state.document,
          'apply-generation-snapshot',
          DOCUMENT_MUTATION_KINDS,
          state.selectedObjectId,
        );
        return {
          document: nextDocument,
          history,
          canUndo: true,
          canRedo: false,
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedGroupId: null,
          hoveredObjectId: null,
          inProgressTransform: null,
          inProgressMannequinPose: null,
          navigation: {
            position: structuredClone(nextDocument.outputCamera.position),
            target: structuredClone(nextDocument.outputCamera.target),
            isInteracting: false,
          },
          isDirty: !documentContentsEqual(nextDocument, persistedDocument),
          statusMessage: `generation v${source.versionNumber}의 3D 씬을 적용했습니다.`,
        };
      });
    },
    undo: () => {
      set((state) => {
        const result = undoDocumentHistory(
          state.history,
          state.document,
          state.selectedObjectId,
        );
        if (result === null) return state;
        const restoredDocument = sceneDocumentSchema.parse(result.document);
        const nextDocument = withNextRevision(state.document, restoredDocument);
        const navigation =
          result.mutationKind === 'commit-camera' ||
          result.mutationKind === 'apply-generation-snapshot'
            ? {
                position: structuredClone(nextDocument.outputCamera.position),
                target: structuredClone(nextDocument.outputCamera.target),
                isInteracting: false,
              }
            : state.navigation;
        const selectedObjectId =
          result.mutationKind === 'apply-generation-snapshot'
            ? (result.selectedObjectId ?? null)
            : state.selectedObjectId;
        const selectedGroup = nextDocument.groups.find(
          ({ id }) => id === state.selectedGroupId,
        );
        const selectedObjectIds =
          selectedGroup?.memberObjectIds ??
          state.selectedObjectIds.filter((id) =>
            nextDocument.objects.some((object) => object.id === id),
          );
        const validSelectedObjectId = nextDocument.objects.some(
          ({ id }) => id === selectedObjectId,
        )
          ? selectedObjectId
          : selectedObjectIds.length === 1
            ? selectedObjectIds[0]!
            : null;

        return {
          document: nextDocument,
          navigation,
          history: result.history,
          canUndo: result.history.past.length > 0,
          canRedo: result.history.future.length > 0,
          selectedObjectId:
            selectedGroup === undefined ? validSelectedObjectId : null,
          selectedObjectIds,
          selectedGroupId: selectedGroup?.id ?? null,
          hoveredObjectId: nextDocument.objects.some(
            ({ id }) => id === state.hoveredObjectId,
          )
            ? state.hoveredObjectId
            : null,
          inProgressTransform: null,
          inProgressMannequinPose: null,
          isDirty: !documentContentsEqual(nextDocument, persistedDocument),
          statusMessage: '실행을 취소했습니다.',
        };
      });
    },
    redo: () => {
      set((state) => {
        const result = redoDocumentHistory(
          state.history,
          state.document,
          state.selectedObjectId,
        );
        if (result === null) return state;
        const restoredDocument = sceneDocumentSchema.parse(result.document);
        const nextDocument = withNextRevision(state.document, restoredDocument);
        const navigation =
          result.mutationKind === 'commit-camera' ||
          result.mutationKind === 'apply-generation-snapshot'
            ? {
                position: structuredClone(nextDocument.outputCamera.position),
                target: structuredClone(nextDocument.outputCamera.target),
                isInteracting: false,
              }
            : state.navigation;
        const selectedGroup = nextDocument.groups.find(
          ({ id }) => id === state.selectedGroupId,
        );
        const selectedObjectIds =
          selectedGroup?.memberObjectIds ??
          state.selectedObjectIds.filter((id) =>
            nextDocument.objects.some((object) => object.id === id),
          );
        const selectedObjectId = nextDocument.objects.some(
          ({ id }) => id === state.selectedObjectId,
        )
          ? state.selectedObjectId
          : selectedObjectIds.length === 1
            ? selectedObjectIds[0]!
            : null;

        return {
          document: nextDocument,
          navigation,
          history: result.history,
          canUndo: result.history.past.length > 0,
          canRedo: result.history.future.length > 0,
          selectedObjectId:
            selectedGroup === undefined ? selectedObjectId : null,
          selectedObjectIds,
          selectedGroupId: selectedGroup?.id ?? null,
          hoveredObjectId: nextDocument.objects.some(
            ({ id }) => id === state.hoveredObjectId,
          )
            ? state.hoveredObjectId
            : null,
          inProgressTransform: null,
          inProgressMannequinPose: null,
          isDirty: !documentContentsEqual(nextDocument, persistedDocument),
          statusMessage: '다시 실행했습니다.',
        };
      });
    },
  }));
}
