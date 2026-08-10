# S16 visual inspection notes

Verdict: PASS after fixture and solver-policy correction; earlier weak outputs remain represented by the committed standing negative control and the TDD/E2E chronology in the S16 handoff.

Accepted clean PNG observations:

- The planted left support foot visibly meets the floor; its solved landmark is exactly `floorTopY + clearance = 0.056 m`, with zero support-contact error.
- The opposite advancing foot is visibly airborne and separated from the floor. Its solved landmark clearance is `0.260296788 m`, well above the solver's non-support-foot minimum of `0.12 m`.
- Bent opposing arms, the raised/bent advancing leg, forward torso attitude, and asymmetric silhouette read as an approaching run rather than a standing pose.
- The camera is a static 24 mm OutputCamera at absolute world `y = 0.08 m`, with no camera motion and `19.389999496°` upward pitch. Strong foot foreshortening and visible floor perspective establish the ground-level worm's-eye read.
- Head and face remain inside frame and readable. The action-critical right knee and right foot remain inside frame.
- Projected subject height occupancy is `0.7239377227631534`; the isolated actual subject pixel envelope is `0.7485380116959064` of the OutputCamera frame.
- The floor isolation control finds `25519` changed pixels in the lower 45% of the frame, so the ground plane is actually rendered rather than inferred only from landmarks.
- Pelvis dominance ratio is `0.578717725`, below the enforced `1.5` limit. No critical landmark is clipped.
- Selected and deselected clean exports are pixel-identical. A reference export with thirds differs from clean, proving editor/helper layers are excluded from clean output while reference guides use a separate path.

Rejected standing control observations:

- Upright torso, straight parallel legs, both arms hanging, and symmetric silhouette read as standing/generic low angle.
- It intentionally fails action-silhouette and free-foot-clearance policy and is not used as accepted evidence.

Visual target handling:

- `/Users/js/Documents/3d-scene-helper/artifacts/wormeye-front-running-24mm-1280x720.png` was viewed only as a visual target.
- It was neither copied into this evidence directory nor used as solver/runtime evidence.
