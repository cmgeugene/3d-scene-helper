export const IMAGEGEN_MAX_INPUT_IMAGES = 5;

export interface ImageInputBudget {
  includeLayout: boolean;
  includeSourceKeyframe: boolean;
}

export function getMaximumReferenceImages({
  includeLayout,
  includeSourceKeyframe,
}: ImageInputBudget) {
  const reservedImages = Number(includeLayout) + Number(includeSourceKeyframe);
  return Math.max(0, IMAGEGEN_MAX_INPUT_IMAGES - reservedImages);
}

export const FRESH_GENERATION_MAX_REFERENCES = getMaximumReferenceImages({
  includeLayout: true,
  includeSourceKeyframe: false,
});
