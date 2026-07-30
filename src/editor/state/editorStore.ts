import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  createSceneObject,
  sceneDocumentSchema,
  type AddSceneObjectInput,
  type SceneDocument,
  type SceneObject,
} from '../persistence/sceneSchema';
import type {
  EditorNavigation,
  EditorPanel,
  ExportState,
  GuideVisibility,
  InProgressTransform,
  TransformMode,
} from '../types';

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
  selectedObjectId: string | null;
  hoveredObjectId: string | null;
  transformMode: TransformMode;
  guideVisibility: GuideVisibility;
  isDirty: boolean;
  activePanel: EditorPanel;
  navigation: EditorNavigation;
  inProgressTransform: InProgressTransform | null;
  exportState: ExportState;
  addObject: (input: AddSceneObjectInput) => string;
  selectObject: (id: string | null) => void;
  setHoveredObject: (id: string | null) => void;
  renameObject: (id: string, name: string) => void;
  setObjectColor: (id: string, color: string) => void;
  setObjectVisibility: (id: string, visible: boolean) => void;
  beginTransform: () => void;
  commitTransform: (transform: SceneObject['transform']) => void;
  duplicateObject: (id: string) => string | null;
  deleteObject: (id: string) => void;
  resetScene: () => void;
  commitCamera: (camera: SceneDocument['outputCamera']) => void;
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
}

export function createEditorStore(options: EditorStoreOptions) {
  const document = sceneDocumentSchema.parse(options.initialDocument);
  const initialDocument = structuredClone(document);

  const updateObject = (
    set: StoreApi<EditorStore>['setState'],
    id: string,
    update: Partial<SceneObject>,
  ) => {
    set((state) => {
      if (!state.document.objects.some((object) => object.id === id)) {
        return state;
      }

      return {
        document: sceneDocumentSchema.parse({
          ...state.document,
          objects: state.document.objects.map((object) =>
            object.id === id ? { ...object, ...update } : object,
          ),
        }),
        isDirty: true,
      };
    });
  };

  return createStore<EditorStore>((set, get) => ({
    document,
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
    addObject: (input) => {
      if ((input as { kind: string }).kind === 'floor') {
        throw new Error('Floor is starter scene content');
      }

      const id = options.idFactory();
      const object = createSceneObject(id, input);

      set((state) => ({
        document: sceneDocumentSchema.parse({
          ...state.document,
          objects: [...state.document.objects, object],
        }),
        selectedObjectId: id,
        isDirty: true,
      }));

      return id;
    },
    selectObject: (id) => {
      set((state) => ({
        selectedObjectId:
          id !== null &&
          state.document.objects.some((object) => object.id === id)
            ? id
            : null,
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
    commitTransform: (transform) => {
      set((state) => {
        if (state.inProgressTransform === null) {
          return state;
        }

        return {
          document: sceneDocumentSchema.parse({
            ...state.document,
            objects: state.document.objects.map((object) =>
              object.id === state.inProgressTransform?.objectId
                ? { ...object, transform }
                : object,
            ),
          }),
          inProgressTransform: null,
          isDirty: true,
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

        return {
          document: sceneDocumentSchema.parse({
            ...state.document,
            objects: [...state.document.objects, duplicate],
          }),
          selectedObjectId: duplicateId,
          isDirty: true,
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

        return {
          document: sceneDocumentSchema.parse(document),
          selectedObjectId:
            state.selectedObjectId === id ? null : state.selectedObjectId,
          hoveredObjectId:
            state.hoveredObjectId === id ? null : state.hoveredObjectId,
          inProgressTransform:
            state.inProgressTransform?.objectId === id
              ? null
              : state.inProgressTransform,
          isDirty: true,
        };
      });
    },
    resetScene: () => {
      set({
        document: structuredClone(initialDocument),
        selectedObjectId: null,
        hoveredObjectId: null,
        inProgressTransform: null,
        navigation: {
          position: structuredClone(initialDocument.outputCamera.position),
          target: structuredClone(initialDocument.outputCamera.target),
          isInteracting: false,
        },
        isDirty: true,
      });
    },
    commitCamera: (camera) => {
      set((state) => ({
        document: sceneDocumentSchema.parse({
          ...state.document,
          outputCamera: camera,
        }),
        navigation: {
          position: structuredClone(camera.position),
          target: structuredClone(camera.target),
          isInteracting: false,
        },
        isDirty: true,
      }));
    },
    setLighting: (lighting) => {
      set((state) => ({
        document: sceneDocumentSchema.parse({ ...state.document, lighting }),
        isDirty: true,
      }));
    },
    setBackgroundColor: (color) => {
      set((state) => ({
        document: sceneDocumentSchema.parse({
          ...state.document,
          background: { color },
        }),
        isDirty: true,
      }));
    },
    setOutput: (output) => {
      set((state) => ({
        document: sceneDocumentSchema.parse({ ...state.document, output }),
        isDirty: true,
      }));
    },
    setSubjectMotionGuide: (guide) => {
      set((state) => {
        const nextDocument = { ...state.document };
        if (guide === null) {
          delete nextDocument.subjectMotionGuide;
        } else {
          nextDocument.subjectMotionGuide = guide;
        }
        return {
          document: sceneDocumentSchema.parse(nextDocument),
          isDirty: true,
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
        return {
          document: sceneDocumentSchema.parse(nextDocument),
          isDirty: true,
        };
      });
    },
    setSceneNotes: (sceneNotes) => {
      set((state) => ({
        document: sceneDocumentSchema.parse({ ...state.document, sceneNotes }),
        isDirty: true,
      }));
    },
    setTransformMode: (transformMode) => {
      set({ transformMode });
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
  }));
}
