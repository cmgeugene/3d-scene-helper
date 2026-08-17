import { act, render } from '@testing-library/react';
import { PerspectiveCamera, Scene } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStarterSceneDocument } from '../persistence/sceneSchema';
import { createEditorStore } from '../state/editorStore';
import { CinematicDepthOfField } from './CinematicDepthOfField';

const createPipeline = vi.hoisted(() => vi.fn());
const threeState = vi.hoisted(() => ({
  current: null as unknown as {
    gl: {
      domElement: HTMLCanvasElement;
      getPixelRatio: () => number;
      getSize: (target: { set: (x: number, y: number) => unknown }) => unknown;
    };
    scene: Scene;
    camera: PerspectiveCamera;
    size: { width: number; height: number };
  },
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
  useThree: (selector: (state: typeof threeState.current) => unknown) =>
    selector(threeState.current),
}));

vi.mock('./depthOfFieldPipeline', () => ({
  createLensDepthOfFieldPipeline: createPipeline,
}));

describe('CinematicDepthOfField lifecycle', () => {
  beforeEach(() => {
    createPipeline.mockReset();
    const domElement = document.createElement('canvas');
    threeState.current = {
      gl: {
        domElement,
        getPixelRatio: () => 2,
        getSize: (target) => target.set(960, 540),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      size: { width: 960, height: 540 },
    };
  });

  it('updates optics uniforms without reallocating the composer on camera commits', () => {
    const update = vi.fn();
    const dispose = vi.fn();
    createPipeline.mockReturnValue({
      render: vi.fn(),
      setSize: vi.fn(),
      update,
      dispose,
    });
    const store = createEditorStore({
      initialDocument: createStarterSceneDocument({
        documentId: 'scene-dof-lifecycle',
        floorId: 'floor-dof-lifecycle',
        mannequinId: 'mannequin-dof-lifecycle',
      }),
      idFactory: () => 'generated-dof-lifecycle',
    });

    const view = render(<CinematicDepthOfField store={store} />);
    expect(createPipeline).toHaveBeenCalledTimes(1);

    act(() => store.getState().setCameraLens(85));

    expect(createPipeline).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ focalLengthMm: 85, fStop: 2 }),
    );
    expect(dispose).not.toHaveBeenCalled();

    view.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
