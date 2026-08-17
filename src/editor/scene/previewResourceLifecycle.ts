export interface ReadOnlyPreviewRenderer {
  renderLists: { dispose: () => void };
  dispose: () => void;
  forceContextLoss: () => void;
  getContext?: () => { isContextLost: () => boolean } | null;
}

const releasedReadOnlyPreviewRenderers = new WeakSet<object>();

export function releaseReadOnlyPreviewRenderer(
  renderer: ReadOnlyPreviewRenderer,
) {
  if (releasedReadOnlyPreviewRenderers.has(renderer)) return;
  releasedReadOnlyPreviewRenderers.add(renderer);
  const contextAlreadyLost = renderer.getContext?.()?.isContextLost() ?? false;
  renderer.renderLists.dispose();
  renderer.dispose();
  if (!contextAlreadyLost) renderer.forceContextLoss();
}
