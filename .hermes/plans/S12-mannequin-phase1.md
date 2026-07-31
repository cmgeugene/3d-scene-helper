# S12 Poseable Articulated Mannequin Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the fixed primitive mannequin with a poseable procedural hierarchy, clear facing cues, camera views, persistent poses, and two runtime-safe arm IK targets.

**Architecture:** Keep SceneDocument JSON as authority and Three.js objects runtime-only. Version the document to v2, migrate v1 mannequins to a validated default pose, derive articulated geometry/IK/bounds from shared pure rig math, and commit pose changes only at preset or IK interaction boundaries. Use scene layer 0 for all permanent facing geometry and editor layer 1 for IK handles/gizmos.

**Tech Stack:** TypeScript 6, React 19, React Three Fiber, Three.js, Zustand, Zod, Vitest, Playwright/pngjs/pixelmatch.

---

### Task 1: Pure rig, pose presets, IK, and posed bounds

- Create focused Vitest REDs for `-Z` forward semantics, four pose presets, stable/clamped two-bone arm IK, joint limits, and pose-aware local bounds.
- Implement minimal JSON-safe rig math and verify focused GREEN.

### Task 2: v2 schema, v1 migration, store/history

- Create focused REDs for mannequin pose schema/factory, v1 JSON and v1 localStorage migration, round-trip/duplicate preservation, preset history, and one-commit IK boundary.
- Implement v2 codec fallback plus pose/store APIs; verify focused GREEN and regression unit suite.

### Task 3: Articulated procedural runtime and facing geometry

- Create a real-Canvas RED for root selection and visible hierarchy/facing pixels.
- Replace independent absolute parts with anatomical pivots and improved proportions, joints, hands/feet, face/nose/chest/toe cues; wire posed bounds, root selection, shadows, whole-object transform, and export.
- Verify focused Canvas GREEN.

### Task 4: View and pose UI

- Create focused unit/component/E2E REDs for six view presets and four pose controls without changing lens/shot contracts.
- Add independent camera view presets and mannequin pose/IK tool controls; verify explicit one-commit behavior and persistence/undo/redo GREEN.

### Task 5: Hand IK runtime interaction

- Create focused Playwright RED for left/right actual Canvas drag, runtime-only movement, exactly one document/history commit, stable elbow direction/limits, orbit disable/restore, root-gizmo arbitration, and cancellation.
- Implement editor-layer IK handles and transient rig updates; verify focused GREEN repeatedly.

### Task 6: Pixel/export/integration closure

- Add decoded-PNG E2E for front/rear clean/reference readability, selected/deselected IK-helper exclusion, pose silhouette differences, posed frame-selected, duplicate/delete/transform, and console cleanliness.
- Run focused/full tests; perform independent spec review then quality review, fix Important+ findings with focused RED→GREEN and re-review.
- Write `docs/session-handoffs/S12-mannequin-phase1.md`, run all final gates, manually verify desktop Chromium/WebGL, rerun ordinary production build last, commit exactly `feat: add poseable articulated mannequin`, verify clean worktree and clear task-owned servers/ports.
