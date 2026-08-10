import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../persistence/sceneSchema';
import {
  createCinematicSubjectProfile,
  type CinematicSubjectProfile,
  type Vec3,
} from './cinematicSubjectProfile';
import {
  solveDialogueOtsCoveragePair,
  validateDialogueOtsCoveragePair,
  type DialogueOtsCoveragePairResult,
} from './dialogueOtsCoveragePair';

function profile(
  id: string,
  position: { x: number; z: number },
  rotationY: number,
  bodyType: 'standard' | 'athletic' | 'heavy' = 'standard',
): CinematicSubjectProfile {
  const object = createSceneObject(id, { kind: 'mannequin', position });
  object.transform.rotationDeg.y = rotationY;
  object.mannequinBodyType = bodyType;
  if (bodyType === 'athletic') {
    object.dimensions.y = 1.8;
    object.transform.position.y = 0.9;
  }
  const result = createCinematicSubjectProfile(object);
  if (result === null) throw new Error('mannequin profile required');
  return result;
}

function identityPair(
  bodyA: 'standard' | 'athletic' | 'heavy' = 'standard',
  bodyB: 'standard' | 'athletic' | 'heavy' = 'standard',
) {
  return {
    identityA: {
      id: 'character-a',
      profile: profile('character-a', { x: 0.2, z: -1 }, 180, bodyA),
    },
    identityB: {
      id: 'character-b',
      profile: profile('character-b', { x: -0.2, z: 1 }, 0, bodyB),
    },
  };
}

function signedCanonicalHalfPlane(from: Vec3, to: Vec3, camera: Vec3): number {
  const axisX = to.x - from.x;
  const axisZ = to.z - from.z;
  const magnitude = Math.hypot(axisX, axisZ);
  const normalizedX = axisX / magnitude;
  const normalizedZ = axisZ / magnitude;
  const midpointX = (from.x + to.x) / 2;
  const midpointZ = (from.z + to.z) / 2;
  const offsetX = camera.x - midpointX;
  const offsetZ = camera.z - midpointZ;
  return normalizedZ * offsetX - normalizedX * offsetZ;
}

function solveStandardPair() {
  return solveDialogueOtsCoveragePair({
    ...identityPair(),
    canonicalAxisSide: 'negative',
    shotSize: 'medium-close',
    intensity: 0.55,
    lensMm: 50,
    outputAspect: 16 / 9,
  });
}

function requireAcceptedPair(
  result: DialogueOtsCoveragePairResult,
): asserts result is DialogueOtsCoveragePairResult & {
  canonicalAxis: NonNullable<DialogueOtsCoveragePairResult['canonicalAxis']>;
  shotA: NonNullable<DialogueOtsCoveragePairResult['shotA']>;
  reverseB: NonNullable<DialogueOtsCoveragePairResult['reverseB']>;
} {
  expect(result.accepted).toBe(true);
  if (
    result.canonicalAxis === null ||
    result.shotA === null ||
    result.reverseB === null
  ) {
    throw new Error('accepted coverage pair required');
  }
}

describe('solveDialogueOtsCoveragePair', () => {
  it('role-swaps the two explicit identities instead of preserving a same-role pseudo-pair', () => {
    const result = solveStandardPair();

    expect(result.accepted).toBe(true);
    expect(result.identities).toEqual({
      aId: 'character-a',
      bId: 'character-b',
    });
    expect(result.shotA).toMatchObject({
      subjectIdentityId: 'character-a',
      foregroundIdentityId: 'character-b',
      compositionKind: 'canonical-shoulder-over',
    });
    expect(result.reverseB).toMatchObject({
      subjectIdentityId: 'character-b',
      foregroundIdentityId: 'character-a',
      compositionKind: 'canonical-shoulder-over',
    });
    expect(result.shotA?.subjectIdentityId).not.toBe(
      result.reverseB?.subjectIdentityId,
    );
    expect(result.shotA?.foregroundIdentityId).not.toBe(
      result.reverseB?.foregroundIdentityId,
    );
  });

  it('keeps both selected cameras on the same nonzero half-plane of one A-to-B canonical axis', () => {
    const identities = identityPair();
    const result = solveDialogueOtsCoveragePair({
      ...identities,
      canonicalAxisSide: 'negative',
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    });

    expect(result.accepted).toBe(true);
    if (result.shotA === null || result.reverseB === null) {
      throw new Error('accepted pair legs required');
    }
    const from = identities.identityA.profile.landmarks.eyeCenter;
    const to = identities.identityB.profile.landmarks.eyeCenter;
    const shotASigned = signedCanonicalHalfPlane(
      from,
      to,
      result.shotA.candidate.camera.position,
    );
    const reverseSigned = signedCanonicalHalfPlane(
      from,
      to,
      result.reverseB.candidate.camera.position,
    );

    expect(shotASigned).toBeLessThan(-1e-6);
    expect(reverseSigned).toBeLessThan(-1e-6);
    expect(result.canonicalAxis).toMatchObject({
      fromIdentityId: 'character-a',
      toIdentityId: 'character-b',
      selectedHalfPlaneSign: -1,
    });
    expect(result.shotA.canonicalAxisHalfPlaneSign).toBe(-1);
    expect(result.reverseB.canonicalAxisHalfPlaneSign).toBe(-1);
    expect(result.shotA.canonicalAxisSignedValue).toBeLessThan(-1e-6);
    expect(result.reverseB.canonicalAxisSignedValue).toBeLessThan(-1e-6);
  });

  it('returns byte-equivalent JSON without mutating profiles or intent', () => {
    const identities = identityPair();
    const intent = {
      ...identities,
      canonicalAxisSide: 'negative',
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    } as const;
    const before = structuredClone(intent);

    const first = solveDialogueOtsCoveragePair(intent);
    const second = solveDialogueOtsCoveragePair(intent);

    requireAcceptedPair(first);
    expect(first.pairId).toBe(
      `${first.shotA.candidate.id}__${first.reverseB.candidate.id}`,
    );
    expect(first.pairScore).toBeTypeOf('number');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(intent).toEqual(before);
  });

  it.each([['standard', 'standard', 50]] as const)(
    'matches canonical continuity for %s/%s profiles at %dmm',
    (bodyA, bodyB, lensMm) => {
      const result = solveDialogueOtsCoveragePair({
        ...identityPair(bodyA, bodyB),
        canonicalAxisSide: 'negative',
        shotSize: 'medium-close',
        intensity: 0.55,
        lensMm,
        outputAspect: 16 / 9,
      });

      requireAcceptedPair(result);
      expect(result.shotA.candidate.kind).toBe('canonical-shoulder-over');
      expect(result.reverseB.candidate.kind).toBe('canonical-shoulder-over');
      expect(result.shotA.candidate.camera.focalLengthMm).toBe(lensMm);
      expect(result.reverseB.candidate.camera.focalLengthMm).toBe(lensMm);
      expect(result.shotA.shoulderSide).not.toBe(result.reverseB.shoulderSide);
      for (const leg of [result.shotA, result.reverseB]) {
        expect(
          leg.candidate.diagnostics.foregroundShoulderWidthOccupancy,
        ).toBeGreaterThanOrEqual(
          result.diagnostics.tolerances.foregroundShoulderScaleMin,
        );
        expect(
          leg.candidate.diagnostics.foregroundWidthOccupancy,
        ).toBeLessThanOrEqual(result.diagnostics.tolerances.foregroundScaleMax);
        expect(
          leg.candidate.diagnostics.foregroundHeadWidthOccupancy,
        ).toBeLessThanOrEqual(
          result.diagnostics.tolerances.foregroundHeadScaleMax,
        );
        expect(
          leg.candidate.diagnostics.foregroundShoulderWidthOccupancy /
            leg.candidate.diagnostics.foregroundHeadWidthOccupancy,
        ).toBeGreaterThanOrEqual(
          result.diagnostics.tolerances.shoulderToHeadRatioMin,
        );
        expect(
          leg.foregroundTopology.neckEdgeCoordinate,
        ).toBeGreaterThanOrEqual(
          result.diagnostics.tolerances.neckEdgeCoordinateMin,
        );
        expect(leg.foregroundTopology.neckEdgeCoordinate).toBeLessThanOrEqual(
          result.diagnostics.tolerances.neckEdgeCoordinateMax,
        );
        expect(
          leg.foregroundTopology.shoulderInwardReach,
        ).toBeGreaterThanOrEqual(
          result.diagnostics.tolerances.shoulderInwardReachMin,
        );
        expect(leg.foregroundTopology.shoulderRidgeNdcY).toBeGreaterThanOrEqual(
          result.diagnostics.tolerances.shoulderRidgeNdcYMin,
        );
        expect(leg.foregroundTopology.quality).toBeGreaterThan(0);
      }
      expect(result.shotA.candidate.diagnostics.foregroundEdge).not.toBe(
        result.reverseB.candidate.diagnostics.foregroundEdge,
      );
      expect(
        Math.sign(result.shotA.candidate.diagnostics.subjectFaceNdc.x),
      ).toBe(
        -Math.sign(result.reverseB.candidate.diagnostics.subjectFaceNdc.x),
      );
      expect(result.diagnostics.continuity).toMatchObject({
        lensMatched: true,
        shotSizeMatched: true,
        screenDirectionsOpposed: true,
        targetFacesCounterPositioned: true,
        nearShoulderEdgeReversed: true,
      });
      const continuity = result.diagnostics.continuity;
      if (continuity === null)
        throw new Error('continuity diagnostics required');
      expect(continuity.headroomDelta).toBeLessThanOrEqual(
        result.diagnostics.tolerances.headroom,
      );
      expect(continuity.faceOccupancyDelta).toBeLessThanOrEqual(
        result.diagnostics.tolerances.faceOccupancy,
      );
      expect(continuity.eyelineDelta).toBeLessThanOrEqual(
        result.diagnostics.tolerances.eyeline,
      );
      expect(continuity.foregroundScaleDelta).toBeLessThanOrEqual(
        result.diagnostics.tolerances.foregroundScale,
      );
      expect(continuity.lookRoomDelta).toBeLessThanOrEqual(
        result.diagnostics.tolerances.lookRoom,
      );
    },
  );

  it.each([
    ['athletic', 'heavy'],
    ['heavy', 'athletic'],
  ] as const)(
    'rejects a weak %s/%s profile pair instead of relabeling it canonical',
    (bodyA, bodyB) => {
      const intent = {
        ...identityPair(bodyA, bodyB),
        canonicalAxisSide: 'negative' as const,
        shotSize: 'medium-close' as const,
        intensity: 0.55,
        lensMm: 50 as const,
        outputAspect: 16 / 9,
      };
      const first = solveDialogueOtsCoveragePair(intent);
      const second = solveDialogueOtsCoveragePair(intent);

      expect(first.accepted).toBe(false);
      expect(first.shotA).toBeNull();
      expect(first.reverseB).toBeNull();
      expect(first.diagnostics.failureReasons).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^missing-(shot-a|reverse-b)-canonical-leg$/),
        ]),
      );
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    },
  );

  it.each([65, 85] as const)(
    'returns an explicit canonical-leg failure rather than a weak %dmm pair',
    (lensMm) => {
      const intent = {
        ...identityPair(),
        canonicalAxisSide: 'negative' as const,
        shotSize: 'medium-close' as const,
        intensity: 0.55,
        lensMm,
        outputAspect: 16 / 9,
      };
      const first = solveDialogueOtsCoveragePair(intent);
      const second = solveDialogueOtsCoveragePair(intent);

      expect(first.accepted).toBe(false);
      expect(first.diagnostics.failureReasons).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^missing-(shot-a|reverse-b)-canonical-leg$/),
        ]),
      );
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    },
  );

  it('returns explicit JSON-safe failure diagnostics for the same identity', () => {
    const identities = identityPair();
    const result = solveDialogueOtsCoveragePair({
      identityA: identities.identityA,
      identityB: {
        id: identities.identityA.id,
        profile: identities.identityA.profile,
      },
      canonicalAxisSide: 'negative',
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    });

    expect(result).toMatchObject({
      accepted: false,
      shotA: null,
      reverseB: null,
      diagnostics: {
        accepted: false,
        failureReasons: ['same-identity'],
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('rejects a fabricated same-role pseudo-pair', () => {
    const result = structuredClone(solveStandardPair());
    requireAcceptedPair(result);
    result.reverseB.subjectIdentityId = result.shotA.subjectIdentityId;
    result.reverseB.foregroundIdentityId = result.shotA.foregroundIdentityId;

    const diagnostics = validateDialogueOtsCoveragePair(result);

    expect(diagnostics.accepted).toBe(false);
    expect(diagnostics.failureReasons).toContain('same-role-pseudo-pair');
  });

  it('rejects a fabricated reverse camera that crosses the stable canonical axis', () => {
    const result = structuredClone(solveStandardPair());
    requireAcceptedPair(result);
    const axis = result.canonicalAxis;
    const camera = result.reverseB.candidate.camera.position;
    const signed =
      axis.direction.z * (camera.x - axis.midpoint.x) -
      axis.direction.x * (camera.z - axis.midpoint.z);
    result.reverseB.candidate.camera.position.x -=
      2 * signed * axis.direction.z;
    result.reverseB.candidate.camera.position.z +=
      2 * signed * axis.direction.x;

    const diagnostics = validateDialogueOtsCoveragePair(result);

    expect(diagnostics.accepted).toBe(false);
    expect(diagnostics.failureReasons).toContain('axis-crossing');
  });

  it.each([
    [
      'mismatched-lens',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null)
          pair.reverseB.candidate.camera.focalLengthMm = 65;
      },
    ],
    [
      'mismatched-shot-size',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null) pair.reverseB.shotSize = 'tight';
      },
    ],
    [
      'mismatched-headroom',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null)
          pair.reverseB.candidate.diagnostics.subjectHeadroom += 0.2;
      },
    ],
    [
      'mismatched-face-occupancy',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null)
          pair.reverseB.candidate.diagnostics.subjectFaceHeightOccupancy += 0.2;
      },
    ],
    [
      'mismatched-eyeline',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null)
          pair.reverseB.candidate.diagnostics.subjectEyeNdc.y += 0.2;
      },
    ],
    [
      'mismatched-foreground-scale',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null)
          pair.reverseB.candidate.diagnostics.foregroundWidthOccupancy += 0.2;
      },
    ],
    [
      'mismatched-look-room',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null)
          pair.reverseB.candidate.diagnostics.subjectLookRoom += 0.2;
      },
    ],
    [
      'same-screen-direction',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null && pair.shotA !== null) {
          pair.reverseB.subjectScreenDirectionSign =
            pair.shotA.subjectScreenDirectionSign;
          pair.reverseB.candidate.diagnostics.subjectFaceNdc.x =
            pair.shotA.candidate.diagnostics.subjectFaceNdc.x;
        }
      },
    ],
    [
      'face-blocked',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null)
          pair.reverseB.candidate.diagnostics.faceOcclusion = 0.5;
      },
    ],
    [
      'foreground-torso-wall',
      (pair: DialogueOtsCoveragePairResult) => {
        if (pair.reverseB !== null)
          pair.reverseB.candidate.diagnostics.foregroundTorsoWall = true;
      },
    ],
  ] as const)(
    'returns %s when pair-local validation is violated',
    (reason, mutate) => {
      const result = structuredClone(solveStandardPair());
      requireAcceptedPair(result);
      mutate(result);

      const diagnostics = validateDialogueOtsCoveragePair(result);

      expect(diagnostics.accepted).toBe(false);
      expect(diagnostics.failureReasons).toContain(reason);
    },
  );
});
