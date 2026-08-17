let suppressNextSelection = false;

export function suppressNextObjectSelection() {
  suppressNextSelection = true;
}

export function consumeObjectSelectionSuppression() {
  if (!suppressNextSelection) return false;
  suppressNextSelection = false;
  return true;
}
