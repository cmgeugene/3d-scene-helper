import type { SceneDocument, SceneObject } from './persistence/sceneSchema';

export type Vector3 = SceneDocument['outputCamera']['position'];
export type Transform = SceneObject['transform'];

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface GuideVisibility {
  thirds: boolean;
  center: boolean;
  actionSafe: boolean;
  titleSafe: boolean;
  motion: boolean;
}

export type EditorPanel = 'scene' | 'camera' | 'lighting' | 'output';

export interface EditorNavigation {
  position: Vector3;
  target: Vector3;
  isInteracting: boolean;
}

export interface InProgressTransform {
  objectId: string;
  initialTransform: Transform;
}

export type ExportStatus =
  'idle' | 'preparing' | 'exporting' | 'complete' | 'error';

export interface ExportState {
  status: ExportStatus;
  progress: number;
  error: string | null;
}
