import { describe, expect, it } from 'vitest';
import {
  FRESH_GENERATION_MAX_REFERENCES,
  getMaximumReferenceImages,
} from '../../shared/imageInputBudget';

describe('image input budget', () => {
  it('reserves one slot for the 3D layout in fresh generation', () => {
    expect(FRESH_GENERATION_MAX_REFERENCES).toBe(4);
  });

  it('reserves layout and source keyframe slots for future edit generation', () => {
    expect(
      getMaximumReferenceImages({
        includeLayout: true,
        includeSourceKeyframe: true,
      }),
    ).toBe(3);
  });
});
