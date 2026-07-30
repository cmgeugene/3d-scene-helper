import { createStore, type StoreApi } from 'zustand/vanilla';
import { ASPECT_RATIO_VALUES } from '../constants';
import {
  createSceneObject,
  sceneDocumentSchema,
  type AddSceneObjectInput,
  type SceneDocument,
  type SceneObject,
} from '../persistence/sceneSchema';
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
  'commit-camera',
  'update-lighting-background',
  'update-output',
  'update-motion-metadata',
] as const;

export type DocumentMutationKind = (typeof DOCUMENT_MUTATION_KINDS)[number];

export interface EditorStoreOptions {
  initialDocument: SceneDocument;
  idFactory: () => string;
}

export interface EditorStore {
  document: SceneDocument;
  history: DocumentHistory<SceneDocument, DocumentMutationKind>;
  canUndo: boolean;
  canRedo: boolean;
  selectedObjectId: string | null;
  hoveredObjectId: string | null;
  transformMode: TransformMode;
  guideVisibility: GuideVisibility;
  isDirty: boolean;
  activePanel: EditorPanel;
  navigation: EditorNavigation;
  inProgressTransform: InProgressTransform | null;
  exportState: ExportState;
  statusMessage: string | null;
  addObject: (input: AddSceneObjectInput) => string;
  selectObject: (id: string | null) => void;
  setHoveredObject: (id: string | null) => void;
  renameObject: (id: string, name: string) => void;
  setObjectColor: (id: string, color: string) => void;
  setObjectVisibility: (id: string, visible: boolean) => void;
  beginTransform: () => void;
  cancelTransform: () => void;
  commitTransform: (transform: SceneObject['transform']) => void;
  duplicateObject: (id: string) => string | null;
  deleteObject: (id: string) => void;
  resetScene: () => void;
  commitCamera: (camera: SceneDocument['outputCamera']) => void;
  setCameraLens: (focalLengthMm: LensPreset['focalLengthMm']) => void;
  applyCameraShot: (presetId: CameraShotPreset['id']) => void;
  frameSelected: () => void;
  lookAtSelected: () => void;
  applyLightingPreset: (presetId: LightingPresetId) => void;
  resetLightingPreset: () => void;
  setLighting: (lighting: SceneDocument['lighting']) => void;
  setBackgroundColor: (color: string) => void;
  setOutput: (output: SceneDocument['output']) => void;
  setSubjectMotionGuide: (
    guide: SceneDocument['subjectMotionGuide'] | null,
  ) => void;
  setCameraMotionGuide: (
    guide: SceneDocument['cameraMotionGuide'] | null,
  ) => void;
  setSceneNotes: (notes: string) => void;
  setTransformMode: (mode: TransformMode) => void;
  setGuideVisibility: (visibility: Partial<GuideVisibility>) => void;
  setActivePanel: (panel: EditorPanel) => void;
  setNavigation: (navigation: EditorNavigation) => void;
  setExportState: (exportState: ExportState) => void;
  setStatusMessage: (statusMessage: string | null) => void;
  replaceDocument: (document: SceneDocument, persisted: boolean) => void;
  markDocumentPersisted: (document: SceneDocument) => void;
  undo: () => void;
  redo: () => void;
}

export function createEditorStore(options: EditorStoreOptions) {
  const document = sceneDocumentSchema.parse(options.initialDocument);
  const initialDocument = structuredClone(document);
  let persistedDocument = structuredClone(document);
  const documentsEqual = (left: SceneDocument, right: SceneDocument) =>
    JSON.stringify(left) === JSON.stringify(right);

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
    const history = recordDocumentHistory(
      state.history,
      state.document,
      mutationKind,
      DOCUMENT_MUTATION_KINDS,
    );

    return {
      document: nextDocument,
      history,
      canUndo: history.past.length > 0,
      canRedo: false,
      isDirty: !documentsEqual(nextDocument, persistedDocument),
    };
  };

  const updateObject = (
    set: StoreApi<EditorStore>['setState'],
    id: string,
    update: Partial<SceneObject>,
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
        ...recordMutation(state, nextDocument, 'update-object-property'),
      };
    });
  };

  return createStore<EditorStore>((set, get) => ({
    document,
    history: createDocumentHistory(),
    canUndo: false,
    canRedo: false,
    selectedObjectId: null,
    hoveredObjectId: null,
    transformMode: 'translate',
    guideVisibility: {
      thirds: false,
      center: false,
      actionSafe: false,
      titleSafe: false,
      motion: false,
    },
    isDirty: false,
    activePanel: 'scene',
    navigation: {
      position: structuredClone(document.outputCamera.position),
      target: structuredClone(document.outputCamera.target),
      isInteracting: false,
    },
    inProgressTransform: null,
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
          statusMessage: null,
        };
      });

      return id;
    },
    selectObject: (id) => {
      set((state) => ({
        selectedObjectId:
          id !== null &&
          state.document.objects.some((object) => object.id === id)
            ? id
            : null,
        statusMessage: null,
      }));
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
    setObjectColor: (id, color) => {
      updateObject(set, id, { color });
    },
    setObjectVisibility: (id, visible) => {
      updateObject(set, id, { visible });
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

        const documentWithoutObject = {
          ...state.document,
          objects: state.document.objects.filter((object) => object.id !== id),
        };
        const document = { ...documentWithoutObject };
        if (state.document.subjectMotionGuide?.subjectId === id) {
          delete document.subjectMotionGuide;
        }

        const nextDocument = sceneDocumentSchema.parse(document);
        return {
          ...recordMutation(state, nextDocument, 'delete-object'),
          selectedObjectId:
            state.selectedObjectId === id ? null : state.selectedObjectId,
          hoveredObjectId:
            state.hoveredObjectId === id ? null : state.hoveredObjectId,
          inProgressTransform:
            state.inProgressTransform?.objectId === id
              ? null
              : state.inProgressTransform,
          statusMessage: null,
        };
      });
    },
    resetScene: () => {
      set(() => {
        const nextDocument = structuredClone(initialDocument);
        return {
          document: nextDocument,
          history: createDocumentHistory(),
          canUndo: false,
          canRedo: false,
          selectedObjectId: null,
          hoveredObjectId: null,
          inProgressTransform: null,
          navigation: {
            position: structuredClone(initialDocument.outputCamera.position),
            target: structuredClone(initialDocument.outputCamera.target),
            isInteracting: false,
          },
          isDirty: !documentsEqual(nextDocument, persistedDocument),
          statusMessage: null,
        };
      });
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
      get().commitCamera({ ...camera, focalLengthMm });
      set({ statusMessage: `${focalLengthMm}mm 렌즈를 적용했습니다.` });
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
    lookAtSelected: () => {
      const state = get();
      const selected = state.document.objects.find(
        ({ id }) => id === state.selectedObjectId,
      );
      if (selected === undefined) {
        set({ statusMessage: '바라볼 오브젝트를 먼저 선택하세요.' });
        return;
      }
      get().commitCamera(
        computeLookAtSelectedCamera(
          getSceneObjectBounds(selected),
          state.document.outputCamera,
        ),
      );
      set({ statusMessage: `${selected.name}을 바라봅니다.` });
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
          nextDocument.subjectMotionGuide = guide;
        }
        return recordMutation(
          state,
          sceneDocumentSchema.parse(nextDocument),
          'update-motion-metadata',
        );
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
        return recordMutation(
          state,
          sceneDocumentSchema.parse(nextDocument),
          'update-motion-metadata',
        );
      });
    },
    setSceneNotes: (sceneNotes) => {
      set((state) => {
        const nextDocument = sceneDocumentSchema.parse({
          ...state.document,
          sceneNotes,
        });
        return recordMutation(state, nextDocument, 'update-motion-metadata');
      });
    },
    setTransformMode: (transformMode) => {
      set({ transformMode, statusMessage: null });
    },
    setGuideVisibility: (visibility) => {
      set((state) => ({
        guideVisibility: { ...state.guideVisibility, ...visibility },
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
      const nextDocument = sceneDocumentSchema.parse(replacement);
      if (persisted) persistedDocument = structuredClone(nextDocument);
      set({
        document: nextDocument,
        history: createDocumentHistory(),
        canUndo: false,
        canRedo: false,
        selectedObjectId: null,
        hoveredObjectId: null,
        inProgressTransform: null,
        navigation: {
          position: structuredClone(nextDocument.outputCamera.position),
          target: structuredClone(nextDocument.outputCamera.target),
          isInteracting: false,
        },
        isDirty: !documentsEqual(nextDocument, persistedDocument),
        statusMessage: null,
      });
    },
    markDocumentPersisted: (savedDocument) => {
      const state = get();
      if (state.document !== savedDocument) return;
      persistedDocument = structuredClone(state.document);
      set({ isDirty: false });
    },
    undo: () => {
      set((state) => {
        const result = undoDocumentHistory(state.history, state.document);
        if (result === null) return state;
        const nextDocument = sceneDocumentSchema.parse(result.document);
        const navigation =
          result.mutationKind === 'commit-camera'
            ? {
                position: structuredClone(nextDocument.outputCamera.position),
                target: structuredClone(nextDocument.outputCamera.target),
                isInteracting: false,
              }
            : state.navigation;

        return {
          document: nextDocument,
          navigation,
          history: result.history,
          canUndo: result.history.past.length > 0,
          canRedo: result.history.future.length > 0,
          selectedObjectId: nextDocument.objects.some(
            ({ id }) => id === state.selectedObjectId,
          )
            ? state.selectedObjectId
            : null,
          hoveredObjectId: nextDocument.objects.some(
            ({ id }) => id === state.hoveredObjectId,
          )
            ? state.hoveredObjectId
            : null,
          inProgressTransform: null,
          isDirty: !documentsEqual(nextDocument, persistedDocument),
          statusMessage: '실행을 취소했습니다.',
        };
      });
    },
    redo: () => {
      set((state) => {
        const result = redoDocumentHistory(state.history, state.document);
        if (result === null) return state;
        const nextDocument = sceneDocumentSchema.parse(result.document);
        const navigation =
          result.mutationKind === 'commit-camera'
            ? {
                position: structuredClone(nextDocument.outputCamera.position),
                target: structuredClone(nextDocument.outputCamera.target),
                isInteracting: false,
              }
            : state.navigation;

        return {
          document: nextDocument,
          navigation,
          history: result.history,
          canUndo: result.history.past.length > 0,
          canRedo: result.history.future.length > 0,
          selectedObjectId: nextDocument.objects.some(
            ({ id }) => id === state.selectedObjectId,
          )
            ? state.selectedObjectId
            : null,
          hoveredObjectId: nextDocument.objects.some(
            ({ id }) => id === state.hoveredObjectId,
          )
            ? state.hoveredObjectId
            : null,
          inProgressTransform: null,
          isDirty: !documentsEqual(nextDocument, persistedDocument),
          statusMessage: '다시 실행했습니다.',
        };
      });
    },
  }));
}
