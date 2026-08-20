# S42 Planar mirror reflections handoff

## Session / branch

- Worktree: `D:\Projects\3d-scene-helper-worktrees\layout-authority-object-workflow`
- Branch: `codex/layout-authority-object-workflow`
- Parent commit: `68219e0 feat(editor): add containment and surface intent`
- Product design: `docs/layout-authority-and-object-workflow-improvement-plan.md`

## Product boundary

S42 implements the first mirror slice as planar reflection only. A `plane` object may use the `mirror` final
surface and record existing objects that must appear in its reflection. Curved surfaces, recursive reflection,
mirror-in-mirror targets and a separate “visible only in reflection” object mode remain out of scope.

## Schema and editor contract

SceneDocument v4 now enforces mirror surface type on `plane` objects only. Each mirror can own at most one
`spatialRelations.reflects` record, target IDs must be unique existing objects, and a mirror cannot target itself
or another mirror. The Inspector enables the mirror surface option only for planes and exposes candidate objects
as an accessible checkbox list.

`setMirrorReflectionTargets` creates, updates or removes the mirror's single relation as one validated history
mutation. Switching the plane back to a non-mirror surface removes its reflection relation within the same
appearance mutation, so no temporarily invalid or dangling state is persisted. Undo/redo, autosave, JSON and
generation snapshot behavior comes from the existing SceneDocument mutation path.

The selected IDs are a must-reflect semantic contract, not an exclusive physics mask. The real mirror reflects
the visible scene naturally; target IDs tell LayoutSpec and the image model which reflected subjects must not be
lost or misinterpreted.

## Runtime and export reflection

The mirror primitive is a Three planar `Reflector`. Its local plane is the same plane primitive orientation used
by the editor: local +Y after the fixed child rotation. `getPlanarMirrorWorldPlane` applies the SceneObject world
rotation to that same normal, so rendered direction and serialized generation evidence share one convention.

Reflector `onBeforeRender` receives whichever camera is currently rendering. It therefore uses the interactive
OutputCamera in the viewport and the offscreen export camera during clean PNG capture instead of reusing a stale
viewport reflection. Each instance owns a 512×512 multisampled reflection target. Unmount or mirror replacement
explicitly disposes the plane geometry, shader material and render target.

## LayoutSpec and generation safety

LayoutSpec v2 now emits a `mirrors` collection with relation ID, mirror object ID, reflected target IDs, normalized
screen bounds, world plane point and world normal. Old v1/v2 fixtures remain readable through an empty default.

Fresh and refinement prompts constrain reflected content to the mirror bounds and plane direction. They also
forbid turning reflected people or props into duplicate physical scene objects. This extends the S38 rule: the
current 3D render remains Image 1 and the highest authority for camera, crop and blocking.

## Verification

- Focused mirror/schema/store/Inspector/LayoutSpec/prompt suite: 8 files, 114 tests passed.
- Full unit suite: 74 files, 598 tests passed, excluding only `companion/staticEditor.test.ts`, whose two Windows
  symlink cases fail with environment-level `EPERM`.
- Typecheck passed.
- Chromium persistence passed: mirror surface and checked reflected target survived autosave and reload.
- Chromium clean export passed: the same staged scene produced measurably different opaque-plane and planar-
  reflection PNGs through the offscreen export camera.
- Typecheck, ESLint, changed-file Prettier check, E2E build and production build passed; Vite reports only the
  existing chunk-size advisory and production excludes E2E diagnostics.

## Integration / deferred work

After final regression, review the complete S38–S42 branch in one user flow before merging it into the actively
used main worktree. A future mirror phase needs a deliberate data and rendering design for curved mirrors,
recursive bounces, multiple interacting mirrors and objects hidden from direct view but visible in reflection;
none should be inferred from the current reflected-target checklist.
