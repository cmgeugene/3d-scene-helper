import { describe, expect, it } from 'vitest';
import { parseSpecPatchProposalUpdate } from './specPatchProposalEvents';

const validProposal = {
  version: 2,
  requestId: 'request-1',
  baseSceneRevision: 2,
  baseSpecRevision: 1,
  message: '분위기를 긴장감 있게 변경합니다.',
  specPatch: [{ op: 'replace', path: '/intent/mood', value: '긴장감' }],
  sceneCommands: [],
  warnings: ['조명은 이 변경안에서 다루지 않습니다.'],
};

describe('parseSpecPatchProposalUpdate', () => {
  it('SSE proposal을 browser 경계에서 동일 schema로 검증한다', () => {
    expect(
      parseSpecPatchProposalUpdate({
        event: 'spec-patch-proposal',
        data: validProposal,
      }),
    ).toEqual({ type: 'proposal', proposal: validProposal });
  });

  it('prototype/array-index/object-transform path를 포함한 SSE를 fail-closed 오류로 바꾼다', () => {
    for (const path of [
      '/__proto__/polluted',
      '/constraints/preserve/0',
      '/objects/object-1/transform',
    ]) {
      const update = parseSpecPatchProposalUpdate({
        event: 'spec-patch-proposal',
        data: {
          ...validProposal,
          specPatch: [{ op: 'replace', path, value: 'x' }],
        },
      });
      expect(update).toMatchObject({
        type: 'error',
        error: expect.stringMatching(/검증/),
      });
    }
  });

  it('schema 밖 scene command와 transform을 browser 경계에서 거부한다', () => {
    for (const sceneCommands of [
      [{ type: 'deleteObject', objectId: 'object-1' }],
      [
        {
          type: 'setObjectTransform',
          objectId: 'object-1',
          transform: {
            position: { x: 0, y: 0, z: 0 },
            rotationDeg: { x: 0, y: 0, z: 0 },
            scale: { x: -1, y: 1, z: 1 },
          },
        },
      ],
    ]) {
      expect(
        parseSpecPatchProposalUpdate({
          event: 'spec-patch-proposal',
          data: { ...validProposal, sceneCommands },
        }),
      ).toMatchObject({
        type: 'error',
        error: expect.stringContaining('browser schema'),
      });
    }
  });

  it('Companion proposal error를 검증해 전달한다', () => {
    expect(
      parseSpecPatchProposalUpdate({
        event: 'spec-patch-proposal-error',
        data: { requestId: 'request-1', error: 'invalid structured output' },
      }),
    ).toEqual({
      type: 'error',
      requestId: 'request-1',
      error: 'invalid structured output',
    });
  });
});
