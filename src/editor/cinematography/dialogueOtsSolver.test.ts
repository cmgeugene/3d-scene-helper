import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../persistence/sceneSchema';
import {
  createCinematicSubjectProfile,
  type CinematicSubjectProfile,
} from './cinematicSubjectProfile';
import { solveDialogueOts } from './dialogueOtsSolver';

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

function dialoguePair(
  subjectBody: 'standard' | 'athletic' | 'heavy' = 'standard',
  foregroundBody: 'standard' | 'athletic' | 'heavy' = 'standard',
) {
  return {
    subject: profile('speaker', { x: 0.2, z: -1 }, 180, subjectBody),
    foreground: profile('listener', { x: -0.2, z: 1 }, 0, foregroundBody),
  };
}

describe('solveDialogueOts', () => {
  it('returns JSON-safe transient left-shoulder candidates without mutating its inputs', () => {
    const pair = dialoguePair();
    const intent = {
      subject: pair.subject,
      foreground: pair.foreground,
      shoulderSide: 'left',
      axisSidePolicy: { mode: 'preserve', continuitySign: 1 },
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    } as const;
    const before = structuredClone({ pair, intent });

    const result = solveDialogueOts(intent);

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]).toMatchObject({
      shoulderSide: 'left',
      camera: { focalLengthMm: 50, rollDeg: 0 },
      diagnostics: { accepted: true },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect({ pair, intent }).toEqual(before);
  });

  it('resolves JSON-safe object IDs from an explicit profile registry', () => {
    const pair = dialoguePair();

    const result = solveDialogueOts(
      {
        subject: { objectId: 'speaker' },
        foreground: { objectId: 'listener' },
        shoulderSide: 'right',
        axisSidePolicy: { mode: 'negative' },
        shotSize: 'medium-close',
        intensity: 0.4,
        lensMm: 65,
        outputAspect: 1,
      },
      { speaker: pair.subject, listener: pair.foreground },
    );

    expect(result.candidates[0]).toMatchObject({
      shoulderSide: 'right',
      camera: { focalLengthMm: 65 },
    });
  });

  it('ranks a standard medium-close OTS by explicit eye, clearance, edge, clipping, near-plane, and axis diagnostics', () => {
    const pair = dialoguePair();

    const result = solveDialogueOts({
      ...pair,
      shoulderSide: 'left',
      axisSidePolicy: { mode: 'preserve', continuitySign: 1 },
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    });
    const best = result.candidates[0];

    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    expect(best.diagnostics.subjectEyeNdc.y).toBeGreaterThan(0.12);
    expect(best.diagnostics.subjectEyeNdc.y).toBeLessThan(0.5);
    expect(best.diagnostics.subjectHeadroom).toBeGreaterThan(0);
    expect(best.diagnostics.subjectLookRoom).toBeGreaterThan(0);
    expect(best.diagnostics.faceClearance).toBeGreaterThan(0.06);
    expect(best.diagnostics.foregroundEdgeContact).toBe(true);
    expect(best.diagnostics.foregroundWidthOccupancy).toBeGreaterThanOrEqual(
      0.15,
    );
    expect(best.diagnostics.foregroundWidthOccupancy).toBeLessThanOrEqual(0.3);
    expect(best.diagnostics.foregroundOutlineWidthOccupancy).toBeGreaterThan(0);
    expect(best.diagnostics.foregroundOutlineClippedCount).toBeGreaterThan(0);
    expect(best.diagnostics.subjectCriticalClipped).toEqual([]);
    expect(best.diagnostics.nearPlaneSafe).toBe(true);
    expect(best.diagnostics.axisContinuity).toBe(true);
    expect(result.candidates.map(({ score }) => score)).toEqual(
      [...result.candidates.map(({ score }) => score)].sort((a, b) => b - a),
    );
  });

  it('solves an athletic speaker over a heavy listener right shoulder', () => {
    const pair = dialoguePair('athletic', 'heavy');

    const result = solveDialogueOts({
      ...pair,
      shoulderSide: 'right',
      axisSidePolicy: { mode: 'preserve', continuitySign: -1 },
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].diagnostics).toMatchObject({
      foregroundEdge: 'left',
      foregroundEdgeContact: true,
      foregroundTorsoWall: false,
      axisSideSign: -1,
      axisContinuity: true,
    });
  });

  it('rejects every candidate that crosses a preserved 180-degree axis side', () => {
    const pair = dialoguePair();

    const result = solveDialogueOts({
      ...pair,
      shoulderSide: 'left',
      axisSidePolicy: { mode: 'preserve', continuitySign: -1 },
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.rejected.length).toBeGreaterThan(0);
    expect(
      result.diagnostics.rejected.every(({ diagnostics }) =>
        diagnostics.rejectionReasons.includes('axis-discontinuity'),
      ),
    ).toBe(true);
  });

  it('rejects a false wide two-shot whose foreground shoulder is absent from the frame', () => {
    const pair = dialoguePair();
    const foreground = structuredClone(pair.foreground);
    const center = foreground.landmarks.neck;
    for (const name of ['headTop', 'headLeft', 'headRight', 'chest'] as const) {
      foreground.landmarks[name] = { ...center };
    }
    foreground.landmarks.leftShoulder = { ...center, x: center.x - 0.002 };
    foreground.landmarks.rightShoulder = { ...center, x: center.x + 0.002 };

    const result = solveDialogueOts({
      ...pair,
      foreground,
      shoulderSide: 'left',
      axisSidePolicy: { mode: 'positive' },
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    });

    expect(result.candidates).toEqual([]);
    expect(
      result.diagnostics.rejected.every(({ diagnostics }) =>
        diagnostics.rejectionReasons.includes('false-wide-two-shot'),
      ),
    ).toBe(true);
  });

  it('rejects foreground head and torso silhouettes that materially cover the speaker face', () => {
    const pair = dialoguePair();
    const foreground = structuredClone(pair.foreground);
    for (const name of ['headTop', 'headLeft', 'headRight', 'chest'] as const) {
      foreground.landmarks[name] = { ...pair.subject.landmarks[name] };
    }
    foreground.landmarks.rightShoulder = {
      ...pair.subject.landmarks.faceCenter,
    };

    const result = solveDialogueOts({
      ...pair,
      foreground,
      shoulderSide: 'left',
      axisSidePolicy: { mode: 'positive' },
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.rejected.length).toBeGreaterThan(0);
    expect(
      result.diagnostics.rejected.every(({ diagnostics }) =>
        diagnostics.rejectionReasons.includes('face-blocked'),
      ),
    ).toBe(true);
    expect(
      result.diagnostics.rejected.every(
        ({ diagnostics }) => diagnostics.faceOcclusion > 0.18,
      ),
    ).toBe(true);
  });

  it.each([
    ['standard', 'left', 1, 'right'],
    ['standard', 'right', -1, 'left'],
    ['athletic', 'left', 1, 'right'],
    ['athletic', 'right', -1, 'left'],
    ['heavy', 'left', 1, 'right'],
    ['heavy', 'right', -1, 'left'],
  ] as const)(
    'supports a %s/%s shoulder pair without a face block or torso wall',
    (bodyType, shoulderSide, continuitySign, expectedEdge) => {
      const pair = dialoguePair(bodyType, bodyType);

      const result = solveDialogueOts({
        ...pair,
        shoulderSide,
        axisSidePolicy: { mode: 'preserve', continuitySign },
        shotSize: 'medium-close',
        intensity: 0.55,
        lensMm: 50,
        outputAspect: 16 / 9,
      });
      const best = result.candidates[0];

      expect(best.diagnostics.foregroundEdge).toBe(expectedEdge);
      expect(best.diagnostics.foregroundWidthOccupancy).toBeGreaterThanOrEqual(
        0.12,
      );
      expect(best.diagnostics.foregroundWidthOccupancy).toBeLessThanOrEqual(
        0.36,
      );
      expect(best.diagnostics.faceOcclusion).toBeLessThanOrEqual(0.18);
      expect(best.diagnostics.foregroundTorsoWall).toBe(false);
    },
  );

  it('returns byte-equivalent deterministic ranking across repeat calls and profile registry insertion order', () => {
    const pair = dialoguePair('heavy', 'athletic');
    const intent = {
      subject: { objectId: 'speaker' },
      foreground: { objectId: 'listener' },
      shoulderSide: 'right',
      axisSidePolicy: { mode: 'negative' },
      shotSize: 'medium-close',
      intensity: 0.63,
      lensMm: 65,
      outputAspect: 16 / 9,
    } as const;

    const first = solveDialogueOts(intent, {
      speaker: pair.subject,
      listener: pair.foreground,
    });
    const second = solveDialogueOts(intent, {
      listener: pair.foreground,
      speaker: pair.subject,
    });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(new Set(first.candidates.map(({ id }) => id)).size).toBe(
      first.candidates.length,
    );
  });

  it('materially consumes physical lens, output aspect, shot size, and intensity', () => {
    const pair = dialoguePair();
    const baseIntent = {
      ...pair,
      shoulderSide: 'left',
      axisSidePolicy: { mode: 'positive' },
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    } as const;
    const base = solveDialogueOts(baseIntent).candidates[0];
    const longLens = solveDialogueOts({
      ...baseIntent,
      lensMm: 85,
    }).candidates[0];
    const portrait = solveDialogueOts({
      ...baseIntent,
      outputAspect: 9 / 16,
    }).candidates[0];
    const tight = solveDialogueOts({
      ...baseIntent,
      shotSize: 'tight',
    }).candidates[0];
    const stronger = solveDialogueOts({
      ...baseIntent,
      intensity: 0.9,
    }).candidates[0];

    expect(longLens.camera.focalLengthMm).toBe(85);
    expect(longLens.camera.target).not.toEqual(base.camera.target);
    expect(portrait.camera.target).not.toEqual(base.camera.target);
    expect(tight.camera.position).not.toEqual(base.camera.position);
    expect(tight.diagnostics.subjectFaceHeightOccupancy).toBeGreaterThan(
      base.diagnostics.subjectFaceHeightOccupancy,
    );
    expect(stronger.camera.position).not.toEqual(base.camera.position);
    expect(stronger.diagnostics.subjectEyeNdc.x).not.toBeCloseTo(
      base.diagnostics.subjectEyeNdc.x,
      3,
    );
  });

  it('fails closed on invalid numeric intent and unresolved profile IDs', () => {
    const pair = dialoguePair();
    const valid = {
      ...pair,
      shoulderSide: 'left',
      axisSidePolicy: { mode: 'positive' },
      shotSize: 'medium-close',
      intensity: 0.55,
      lensMm: 50,
      outputAspect: 16 / 9,
    } as const;

    expect(() => solveDialogueOts({ ...valid, lensMm: 0 })).toThrow(
      /lensMm.*positive finite/i,
    );
    expect(() =>
      solveDialogueOts({ ...valid, outputAspect: Number.NaN }),
    ).toThrow(/outputAspect.*positive finite/i);
    expect(() => solveDialogueOts({ ...valid, intensity: 1.01 })).toThrow(
      /intensity.*0 through 1/i,
    );
    expect(() =>
      solveDialogueOts({
        ...valid,
        subject: { objectId: 'missing-speaker' },
      }),
    ).toThrow(/missing cinematic subject profile/i);
  });
});
