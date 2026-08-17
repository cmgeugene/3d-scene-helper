import { describe, expect, it } from 'vitest';
import { createSceneObject } from '../persistence/sceneSchema';
import {
  createCinematicSubjectProfile,
  type CinematicSubjectProfile,
} from './cinematicSubjectProfile';
import { computeCinematicProjectionMetrics } from './projectionMetrics';
import {
  solveStaticWormEyeApproach,
  validateStaticWormEyeApproach,
} from './staticWormEyeApproachSolver';

function runningProfile(
  bodyType: 'standard' | 'athletic' | 'heavy' = 'standard',
): CinematicSubjectProfile {
  const object = createSceneObject(`wormeye-runner-${bodyType}`, {
    kind: 'mannequin',
    name: 'Unmistakable custom running pose',
    position: { x: 0.35, z: 1.1 },
  });
  object.transform.position.y = 0.85;
  object.mannequinBodyType = bodyType;
  if (bodyType === 'athletic') {
    object.dimensions.y = 1.8;
  }
  if (object.mannequinPose === undefined) {
    throw new Error('running mannequin pose is required');
  }
  object.mannequinPose = {
    ...structuredClone(object.mannequinPose),
    id: 'custom',
    torsoRotationDeg: { x: -12, y: 0, z: -4 },
    headRotationDeg: { x: 8, y: 0, z: 4 },
    arms: {
      left: {
        ...object.mannequinPose.arms.left,
        shoulderRotationDeg: { x: 58, y: -8, z: -12 },
        elbowBendDeg: 76,
      },
      right: {
        ...object.mannequinPose.arms.right,
        shoulderRotationDeg: { x: -52, y: 8, z: 12 },
        elbowBendDeg: 68,
      },
    },
    legs: {
      left: {
        ...object.mannequinPose.legs.left,
        hipRotationDeg: { x: -18, y: -4, z: -3 },
        kneeBendDeg: 22,
        ankleRotationDeg: { x: 18, y: 0, z: 0 },
      },
      right: {
        ...object.mannequinPose.legs.right,
        hipRotationDeg: { x: 55, y: 4, z: 3 },
        kneeBendDeg: 115,
        ankleRotationDeg: { x: -20, y: 0, z: 0 },
      },
    },
  };
  const profile = createCinematicSubjectProfile(object);
  if (profile === null) throw new Error('running profile is required');
  return profile;
}

function standardIntent(subject = runningProfile()) {
  return {
    subject,
    motionDirection: { x: 0, y: 0, z: -1 },
    actionPhase: 'support-contact',
    supportFoot: 'left',
    floorTopY: 0.05,
    groundClearanceM: 0.006,
    lensMm: 24,
    cameraHeightM: 0.08,
    outputAspect: 16 / 9,
    targetOccupancy: 0.75,
    intensity: 0.72,
    cameraMotion: 'none',
  } as const;
}

function standingProfile(): CinematicSubjectProfile {
  const object = createSceneObject('wormeye-standing-negative', {
    kind: 'mannequin',
    name: 'Standing negative control',
    position: { x: 0, z: 0 },
  });
  object.transform.position.y = 0.85;
  const profile = createCinematicSubjectProfile(object);
  if (profile === null) throw new Error('standing profile is required');
  return profile;
}

describe('solveStaticWormEyeApproach', () => {
  it('fails closed on invalid corridor, contact, floor, clearance, and camera-motion input', () => {
    const result = solveStaticWormEyeApproach({
      ...standardIntent(),
      motionDirection: { x: 0, y: 3, z: 0 },
      supportFoot: undefined,
      floorTopY: Number.NaN,
      groundClearanceM: 0.2,
      cameraMotion: 'pan' as never,
    });

    expect(result).toEqual({
      accepted: false,
      proposal: null,
      diagnostics: {
        evaluatedCount: 0,
        failureReasons: [
          'invalid-camera-motion',
          'invalid-clearance',
          'invalid-floor',
          'invalid-motion-direction',
          'invalid-support-foot',
        ],
        rejected: [],
      },
    });
  });

  it.each(['standard', 'athletic', 'heavy'] as const)(
    'is byte-deterministic and honest for the %s running body profile',
    (bodyType) => {
      const intent = standardIntent(runningProfile(bodyType));
      const first = solveStaticWormEyeApproach(intent);
      const repeated = solveStaticWormEyeApproach(intent);

      expect(JSON.stringify(repeated)).toBe(JSON.stringify(first));
      expect(JSON.parse(JSON.stringify(first))).toEqual(first);
      if (first.accepted) {
        expect(validateStaticWormEyeApproach(first)).toEqual({
          valid: true,
          reasons: [],
        });
      } else {
        expect(first.proposal).toBeNull();
        expect(first.diagnostics.failureReasons).toContain('no-candidate');
      }
    },
  );

  it('materially consumes target occupancy, intensity, output aspect, and a chest/head aim', () => {
    const restrained = solveStaticWormEyeApproach({
      ...standardIntent(),
      targetOccupancy: 0.68,
      intensity: 0.2,
      outputAspect: 1,
    });
    const strong = solveStaticWormEyeApproach({
      ...standardIntent(),
      targetOccupancy: 0.82,
      intensity: 0.95,
      outputAspect: 16 / 9,
    });
    const restrainedProposal = restrained.proposal;
    const strongProposal = strong.proposal;

    expect(restrainedProposal).not.toBeNull();
    expect(strongProposal).not.toBeNull();
    if (restrainedProposal === null || strongProposal === null) return;
    expect(strongProposal.metrics.occupancy.height).toBeGreaterThan(
      restrainedProposal.metrics.occupancy.height,
    );
    expect(strongProposal.camera.target).not.toEqual(
      restrainedProposal.camera.target,
    );
    expect(strongProposal.camera.target.y).toBeGreaterThan(
      strongProposal.transformedSubject.landmarks.pelvis.y,
    );
    expect(strongProposal.camera.target.y).toBeLessThanOrEqual(
      strongProposal.transformedSubject.landmarks.faceCenter.y,
    );
    expect(strongProposal.camera.target).not.toEqual(
      strongProposal.transformedSubject.bounds.center,
    );
  });

  it('accepts only readable action landmarks without pelvis-dominant framing', () => {
    const result = solveStaticWormEyeApproach(standardIntent());
    const proposal = result.proposal;

    expect(proposal).not.toBeNull();
    if (proposal === null) return;
    const leadingSide = proposal.diagnostics.leadingSide;
    expect(proposal.metrics.landmarks.headTop.insideFrame).toBe(true);
    expect(proposal.metrics.landmarks.faceCenter.insideFrame).toBe(true);
    expect(proposal.metrics.landmarks[`${leadingSide}Knee`].insideFrame).toBe(
      true,
    );
    expect(proposal.metrics.landmarks[`${leadingSide}Foot`].insideFrame).toBe(
      true,
    );
    expect(
      proposal.diagnostics.leadingKneePelvisSeparation,
    ).toBeGreaterThanOrEqual(0.08);
    expect(
      proposal.diagnostics.leadingFootPelvisSeparation,
    ).toBeGreaterThanOrEqual(0.12);
    expect(proposal.diagnostics.pelvisDominanceRatio).toBeLessThanOrEqual(1.5);
    expect(proposal.diagnostics.opposingLimbPhase).toBe(true);
    expect(proposal.diagnostics.handsBelowHead).toBe(true);
    expect(proposal.diagnostics.groundRoom).toBeGreaterThanOrEqual(0.025);
    expect(proposal.diagnostics.upwardPitchDeg).toBeGreaterThanOrEqual(12);
  });

  it('rejects a standing silhouette with canonical ordered reasons and stable candidate IDs', () => {
    const result = solveStaticWormEyeApproach(
      standardIntent(standingProfile()),
    );
    const canonicalOrder = [
      'approach-misaligned',
      'camera-height-out-of-range',
      'occupancy-out-of-range',
      'ordinary-low-angle',
      'head-clipped',
      'critical-leading-limb-clipped',
      'pelvis-dominant',
      'invalid-action-silhouette',
      'free-foot-too-low',
      'ground-room-insufficient',
      'support-contact-mismatch',
      'flight-not-airborne',
      'no-candidate',
    ] as const;

    expect(result.accepted).toBe(false);
    expect(result.proposal).toBeNull();
    expect(result.diagnostics.evaluatedCount).toBe(144);
    expect(result.diagnostics.failureReasons).toContain(
      'invalid-action-silhouette',
    );
    expect(result.diagnostics.failureReasons.at(-1)).toBe('no-candidate');
    expect(result.diagnostics.failureReasons).toEqual(
      [...result.diagnostics.failureReasons].sort(
        (left, right) =>
          canonicalOrder.indexOf(left as (typeof canonicalOrder)[number]) -
          canonicalOrder.indexOf(right as (typeof canonicalOrder)[number]),
      ),
    );
    const ids = result.diagnostics.rejected.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      JSON.stringify(
        solveStaticWormEyeApproach(standardIntent(standingProfile())),
      ),
    ).toBe(JSON.stringify(result));
  });

  it('fails closed before sampling when requested absolute camera height is not 5–15 cm', () => {
    const result = solveStaticWormEyeApproach({
      ...standardIntent(),
      cameraHeightM: 0.3,
    });

    expect(result).toEqual({
      accepted: false,
      proposal: null,
      diagnostics: {
        evaluatedCount: 0,
        failureReasons: ['camera-height-out-of-range'],
        rejected: [],
      },
    });
  });

  it('validator independently rejects a fabricated high-camera accepted result', () => {
    const solved = solveStaticWormEyeApproach(standardIntent());
    const fabricated = structuredClone(solved);
    if (fabricated.proposal === null)
      throw new Error('accepted proposal required');
    fabricated.proposal.camera.position.y = 0.6;

    expect(validateStaticWormEyeApproach(fabricated)).toEqual({
      valid: false,
      reasons: ['camera-height-out-of-range'],
    });
    expect(validateStaticWormEyeApproach(solved)).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('grounds only the selected posed support foot while camera world height stays absolute', () => {
    const raisedFloor = solveStaticWormEyeApproach({
      ...standardIntent(),
      floorTopY: 0.22,
      groundClearanceM: 0.01,
      cameraHeightM: 0.08,
    });
    const proposal = raisedFloor.proposal;

    expect(proposal).not.toBeNull();
    if (proposal === null) return;
    expect(proposal.camera.position.y).toBe(0.08);
    expect(proposal.diagnostics.supportFootWorldY).toBeCloseTo(0.23, 9);
    expect(proposal.diagnostics.supportContactErrorM).toBe(0);
    expect(proposal.subjectStaging.groundingDeltaY).toBeCloseTo(
      0.23 - standardIntent().subject.landmarks.leftFoot.y,
      9,
    );
    expect(proposal.transformedSubject.landmarks.leftFoot.y).toBeCloseTo(
      0.23,
      9,
    );
    expect(proposal.metrics).toEqual(
      computeCinematicProjectionMetrics(
        proposal.transformedSubject,
        proposal.camera,
        16 / 9,
      ),
    );
  });

  it('preserves an airborne flight pose without applying support-foot grounding', () => {
    const intent = {
      ...standardIntent(),
      actionPhase: 'flight',
      supportFoot: undefined,
      floorTopY: 0.05,
    } as const;
    const result = solveStaticWormEyeApproach(intent);
    const proposal = result.proposal;

    expect(proposal).not.toBeNull();
    if (proposal === null) return;
    expect(proposal.actionPhase).toBe('flight');
    expect(proposal.supportFoot).toBeNull();
    expect(proposal.subjectStaging.groundingDeltaY).toBe(0);
    expect(proposal.subjectStaging.translationDelta.y).toBe(0);
    expect(proposal.diagnostics.supportContactErrorM).toBeNull();
    expect(proposal.diagnostics.minimumFootClearanceM).toBeGreaterThan(0);
    expect(proposal.camera.position.y).toBe(0.08);
  });

  it('fails closed with ordered JSON-safe diagnostics for a nonfinite subject profile', () => {
    const subject = runningProfile();
    subject.landmarks.leftKnee.x = Number.NaN;
    const intent = standardIntent(subject);

    expect(() => solveStaticWormEyeApproach(intent)).not.toThrow();
    const result = solveStaticWormEyeApproach(intent);

    expect(result).toEqual({
      accepted: false,
      proposal: null,
      diagnostics: {
        evaluatedCount: 0,
        failureReasons: ['invalid-subject-profile'],
        rejected: [],
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('reverses yaw and subject placement when the ground-plane approach direction reverses', () => {
    const forward = solveStaticWormEyeApproach(standardIntent());
    const reverse = solveStaticWormEyeApproach({
      ...standardIntent(),
      motionDirection: { x: 0, y: 0, z: 1 },
    });
    const forwardProposal = forward.proposal;
    const reverseProposal = reverse.proposal;

    expect(forwardProposal).not.toBeNull();
    expect(reverseProposal).not.toBeNull();
    if (forwardProposal === null || reverseProposal === null) return;
    expect(
      Math.abs(
        forwardProposal.subjectStaging.yawDeltaDeg -
          reverseProposal.subjectStaging.yawDeltaDeg,
      ),
    ).toBeCloseTo(180, 6);
    expect(
      Math.abs(
        forwardProposal.subjectStaging.translationDelta.z -
          reverseProposal.subjectStaging.translationDelta.z,
      ),
    ).toBeGreaterThan(3);
    expect(
      forwardProposal.diagnostics.approachAlignment,
    ).toBeGreaterThanOrEqual(0.985);
    expect(
      reverseProposal.diagnostics.approachAlignment,
    ).toBeGreaterThanOrEqual(0.985);
    expect(reverseProposal.metrics.occupancy.height).toBeGreaterThanOrEqual(
      0.65,
    );
    expect(reverseProposal.metrics.occupancy.height).toBeLessThanOrEqual(0.85);
  });

  it('solves a deterministic 24 mm, 8 cm support-contact running approach proposal', () => {
    const intent = standardIntent();
    const before = structuredClone(intent);
    const result = solveStaticWormEyeApproach(intent);
    const repeated = solveStaticWormEyeApproach(intent);

    expect(result.accepted).toBe(true);
    expect(result.proposal).toMatchObject({
      camera: {
        focalLengthMm: 24,
        position: { y: 0.08 },
        rollDeg: 0,
        depthOfField: {
          enabled: true,
          apertureMode: 'auto',
          fStop: 5.6,
        },
      },
      cameraMotion: 'none',
      actionPhase: 'support-contact',
      supportFoot: 'left',
      diagnostics: { accepted: true },
    });
    expect(result.proposal?.metrics.occupancy.height).toBeGreaterThanOrEqual(
      0.65,
    );
    expect(result.proposal?.metrics.occupancy.height).toBeLessThanOrEqual(0.85);
    expect(
      result.proposal?.diagnostics.freeFootClearanceM,
    ).toBeGreaterThanOrEqual(0.12);
    expect(intent).toEqual(before);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(result));
  });
});
