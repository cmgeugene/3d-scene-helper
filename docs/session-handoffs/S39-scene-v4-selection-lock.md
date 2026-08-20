# S39 SceneDocument v4 and viewport selection lock handoff

## Session / branch

- Worktree: `D:\Projects\3d-scene-helper-worktrees\layout-authority-object-workflow`
- Branch: `codex/layout-authority-object-workflow`
- Parent commit: `c18940e feat(assistant): lock 3d layout generation authority`
- Product design: `docs/layout-authority-and-object-workflow-improvement-plan.md`

## Product boundary

S39 creates the complete SceneDocument v4 authoring foundation and exposes only
`viewportSelectionLocked`. Group creation and movement, containment/opacity authoring, LayoutSpec v2 and
mirror rendering remain later vertical slices.

## SceneDocument v4

`SCENE_DOCUMENT_VERSION` and the current localStorage key are now v4. Each scene object has deterministic
defaults for:

- `viewportSelectionLocked: false`;
- `visualization.proxyOpacity: 1`;
- `appearanceIntent.surfaceType: 'opaque'` and empty `materialNotes`.

Documents also contain `groups: []` and `spatialRelations: []`. The v4 schema already validates unique group
and relation IDs, group membership, missing references, one-group-per-object, containment duplicates and
cycles, and plane/mirror reflection constraints. This prevents later UI slices from storing structurally
invalid intermediate data.

`sceneMigration.ts` migrates v1, v2 and v3 without mutating the input. v1 mannequin pose and v1/v2 disabled
DOF compatibility remain intact. Stored generation records and browser generation responses use the same
legacy-compatible snapshot schema, while new editor and Companion requests remain strict v4.

Deleting an object now removes its containment relations, removes it from reflection target lists, deletes
relations whose mirror was removed, and updates or drops groups that no longer have two members. Duplication
copies the source object's authoring properties but does not silently add the copy to a group or relation.

## Viewport selection lock

The Outliner renders separate selection and lock buttons for every object. The lock button has a stable
accessible name, pressed state and explanatory title. Toggling it records the dedicated
`update-object-selection-lock` mutation, so dirty state, undo/redo, autosave, JSON and generation snapshots
all use the normal SceneDocument path.

`SceneObject` checks the lock before stopping the React Three Fiber pointer event. A locked intersection is
therefore ignored and the next unlocked intersection receives the click. Selecting the locked object from
the Outliner still creates its selection helper and transform controls; this is not a transform lock.

## Verification

- Focused schema/codec/store/Outliner/generation/client/EditorShell suite: 7 files, 134 tests passed.
- Full unit suite excluding the Windows symlink-only static editor test: 71 files, 584 tests passed.
- Typecheck passed.
- ESLint passed.
- E2E build passed.
- Chromium viewport lock test passed: locked foreground click selected the unlocked object behind it, then
  Outliner selection attached the gizmo to the locked foreground.
- Chromium persistence suite: 4 tests passed.
- Focused v4 autosave test passed with the lock preserved after reload.
- Existing chunk-size advisory remains for generated bundles over 500 kB.

The broader editor E2E run exposed pre-existing exact-name selector ambiguity between `큐브 추가` and
`라운드 큐브 추가`; the touched editor/persistence selectors were made exact. Its unrelated 50-primitive
export timing check measured 3397 ms against a 3000 ms threshold on this run.

## Next step

S40 should introduce an explicit selection model and translate-only group operations on the v4 `groups`
collection. It must keep one atomic history entry per group move and exclude rotation, scale, nested groups
and group duplication.
