export function isSceneShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return (
    target.closest('input, textarea, select') !== null ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}
