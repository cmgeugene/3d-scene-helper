import { describe, expect, it } from 'vitest';
import {
  SPEC_PATCH_PROPOSAL_VERSION,
  evaluateSpecPatchProposal,
  specPatchProposalSchema,
} from './specPatchProposal';
import { createStarterSceneDocument } from './sceneSchema';

describe('SpecPatchProposal', () => {
  it('versioned proposal과 승인된 add/remove/replace 경로만 허용한다', () => {
    const proposal = {
      version: SPEC_PATCH_PROPOSAL_VERSION,
      requestId: 'request-1',
      baseSceneRevision: 3,
      baseSpecRevision: 2,
      message: '장소와 분위기를 변경할게요.',
      specPatch: [
        { op: 'replace', path: '/intent/location', value: '골목 치킨집' },
        { op: 'remove', path: '/intent/mood' },
        {
          op: 'add',
          path: '/constraints/preserve',
          value: ['카메라 구도'],
        },
      ],
      sceneCommands: [
        {
          type: 'setObjectTransform',
          objectId: 'mannequin-1',
          transform: {
            position: { x: 1, y: 0.85, z: 0 },
            rotationDeg: { x: 0, y: 15, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
      warnings: ['마네킹의 위치와 회전을 함께 변경합니다.'],
    };

    expect(specPatchProposalSchema.parse(proposal)).toEqual(proposal);

    for (const specPatch of [
      [{ op: 'move', path: '/intent/location', value: 'x' }],
      [{ op: 'replace', path: '/arbitrary/path', value: 'x' }],
      [{ op: 'replace', path: '/__proto__/polluted', value: true }],
      [{ op: 'replace', path: '/generatedProps/0/name', value: '맥주' }],
      [
        {
          op: 'replace',
          path: '/objects/object-1/transform/position/x',
          value: 1,
        },
      ],
    ]) {
      expect(
        specPatchProposalSchema.safeParse({ ...proposal, specPatch }).success,
      ).toBe(false);
    }

    for (const sceneCommands of [
      [
        {
          type: 'deleteObject',
          objectId: 'mannequin-1',
        },
      ],
      [
        {
          type: 'setObjectTransform',
          objectId: 'mannequin-1',
          transform: {
            position: { x: 0, y: 0.85, z: 0 },
            rotationDeg: { x: 0, y: 0, z: 0 },
            scale: { x: 0, y: 1, z: 1 },
          },
        },
      ],
      [proposal.sceneCommands[0], proposal.sceneCommands[0]],
    ]) {
      expect(
        specPatchProposalSchema.safeParse({ ...proposal, sceneCommands })
          .success,
      ).toBe(false);
    }
  });

  it('live state가 아닌 clone에 patch를 적용해 field change를 계산하고 전체 무결성 실패 시 원본을 보존한다', () => {
    const scene = createStarterSceneDocument({
      documentId: 'scene-1',
      floorId: 'floor-1',
      mannequinId: 'mannequin-1',
    });
    const revisionedScene = {
      ...scene,
      sceneRevision: 4,
      specRevision: 2,
    };
    const original = structuredClone(revisionedScene);
    const proposal = specPatchProposalSchema.parse({
      version: SPEC_PATCH_PROPOSAL_VERSION,
      requestId: 'request-apply',
      baseSceneRevision: 4,
      baseSpecRevision: 2,
      message: '장소와 엑스트라를 변경합니다.',
      specPatch: [
        { op: 'replace', path: '/intent/location', value: '골목 치킨집' },
        { op: 'replace', path: '/extras/enabled', value: true },
        { op: 'replace', path: '/extras/minCount', value: 5 },
        { op: 'replace', path: '/extras/maxCount', value: 8 },
      ],
      sceneCommands: [
        {
          type: 'setObjectTransform',
          objectId: 'mannequin-1',
          transform: {
            position: { x: 1.25, y: 0.85, z: 0 },
            rotationDeg: { x: 0, y: 20, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
      warnings: [],
    });

    const evaluation = evaluateSpecPatchProposal(revisionedScene, proposal);

    expect(evaluation.before).toEqual(scene.semanticSceneSpec);
    expect(evaluation.after).toMatchObject({
      intent: { location: '골목 치킨집' },
      extras: { enabled: true, minCount: 5, maxCount: 8 },
    });
    expect(evaluation.changes).toEqual([
      { path: '/intent/location', before: '', after: '골목 치킨집' },
      { path: '/extras/enabled', before: false, after: true },
      { path: '/extras/minCount', before: 0, after: 5 },
      { path: '/extras/maxCount', before: 0, after: 8 },
    ]);
    expect(evaluation.sceneCommandChanges).toEqual([
      {
        type: 'setObjectTransform',
        objectId: 'mannequin-1',
        objectName: 'Mannequin',
        before: scene.objects[1].transform,
        after: proposal.sceneCommands[0].transform,
      },
    ]);
    expect(evaluation.afterDocument).toMatchObject({
      semanticSceneSpec: {
        intent: { location: '골목 치킨집' },
      },
      objects: [
        { id: 'floor-1' },
        {
          id: 'mannequin-1',
          transform: proposal.sceneCommands[0].transform,
        },
      ],
    });
    expect(revisionedScene).toEqual(original);

    expect(() =>
      evaluateSpecPatchProposal(revisionedScene, {
        ...proposal,
        specPatch: [
          { op: 'replace', path: '/extras/minCount', value: 9 },
          { op: 'replace', path: '/extras/maxCount', value: 3 },
        ],
      }),
    ).toThrow();
    expect(revisionedScene).toEqual(original);

    expect(() =>
      evaluateSpecPatchProposal(revisionedScene, {
        ...proposal,
        baseSceneRevision: 3,
      }),
    ).toThrow(/stale/i);

    expect(() =>
      evaluateSpecPatchProposal(revisionedScene, {
        ...proposal,
        sceneCommands: [
          {
            ...proposal.sceneCommands[0],
            objectId: 'deleted-object',
          },
        ],
      }),
    ).toThrow(/target does not exist/);
    expect(revisionedScene).toEqual(original);
  });
});
