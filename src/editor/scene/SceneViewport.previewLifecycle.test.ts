import { describe, expect, it, vi } from 'vitest';
import {
  releaseReadOnlyPreviewRenderer,
  type ReadOnlyPreviewRenderer,
} from './previewResourceLifecycle';

describe('read-only preview resource lifecycle', () => {
  it('renderer/WebGL resources를 close/unmount에서 정확히 한 번 해제한다', () => {
    const renderer = {
      renderLists: { dispose: vi.fn() },
      dispose: vi.fn(),
      forceContextLoss: vi.fn(),
    };

    releaseReadOnlyPreviewRenderer(renderer);
    releaseReadOnlyPreviewRenderer(renderer);

    expect(renderer.renderLists.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('R3F가 이미 잃은 WebGL context를 다시 lose하지 않는다', () => {
    const renderer = {
      renderLists: { dispose: vi.fn() },
      dispose: vi.fn(),
      forceContextLoss: vi.fn(),
      getContext: () => ({ isContextLost: () => true }),
    };

    releaseReadOnlyPreviewRenderer(renderer);

    expect(renderer.renderLists.dispose).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).not.toHaveBeenCalled();
  });

  it('초기화되지 않은 null context에서도 renderer cleanup을 완료한다', () => {
    const renderer = {
      renderLists: { dispose: vi.fn() },
      dispose: vi.fn(),
      forceContextLoss: vi.fn(),
      getContext: () => null,
    };

    releaseReadOnlyPreviewRenderer(
      renderer as unknown as ReadOnlyPreviewRenderer,
    );

    expect(renderer.renderLists.dispose).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
  });
});
