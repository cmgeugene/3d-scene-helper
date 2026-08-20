import { describe, expect, it } from 'vitest';
import {
  createGenerationImageDescriptor,
  expectedGenerationImageBindings,
  generationImageRoleForReferenceKind,
  validateGenerationImageDescriptors,
} from '../shared/generationImageContract';

describe('generation image contract', () => {
  it('keeps the 3D layout first and gives a source generation appearance-only authority', () => {
    const descriptors = [
      createGenerationImageDescriptor({
        attachmentIndex: 1,
        role: 'layout',
        artifactId: 'layout-artifact',
      }),
      createGenerationImageDescriptor({
        attachmentIndex: 2,
        role: 'sourceGeneration',
        artifactId: 'source-artifact',
      }),
    ];

    expect(validateGenerationImageDescriptors(descriptors)).toEqual(
      descriptors,
    );
    expect(expectedGenerationImageBindings(descriptors)).toMatchObject([
      {
        attachmentIndex: 1,
        role: 'layout',
        authority: expect.arrayContaining([
          'camera viewpoint and perspective',
          'occlusion relationships',
        ]),
      },
      {
        attachmentIndex: 2,
        role: 'sourceGeneration',
        authority: expect.arrayContaining(['finished appearance and identity']),
      },
    ]);
    expect(descriptors[1]?.prohibitedAuthority).toContain(
      'camera viewpoint or perspective',
    );
  });

  it('maps imported reference kinds without confusing them with the primary layout', () => {
    expect(generationImageRoleForReferenceKind('layout')).toBe(
      'layoutReference',
    );
    expect(generationImageRoleForReferenceKind('background')).toBe(
      'backgroundReference',
    );
    expect(generationImageRoleForReferenceKind('character')).toBe(
      'characterReference',
    );
    expect(generationImageRoleForReferenceKind('style')).toBe('styleReference');
  });

  it('rejects weakened authority even when attachment order looks valid', () => {
    const layout = createGenerationImageDescriptor({
      attachmentIndex: 1,
      role: 'layout',
      artifactId: 'layout-artifact',
    });

    expect(() =>
      validateGenerationImageDescriptors([
        { ...layout, authority: ['appearance suggestion only'] },
      ]),
    ).toThrow('canonical 값과 다릅니다');
  });
});
