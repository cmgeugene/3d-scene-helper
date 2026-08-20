# S40 Translate-only object groups handoff

## Session / branch

- Worktree: `D:\Projects\3d-scene-helper-worktrees\layout-authority-object-workflow`
- Branch: `codex/layout-authority-object-workflow`
- Parent commit: `3dcdee1 feat(editor): add scene v4 viewport selection locks`
- Product design: `docs/layout-authority-and-object-workflow-improvement-plan.md`

## Product boundary

S40 exposes the SceneDocument v4 `groups` collection as an editor feature. It supports Outliner multi-select,
group creation/selection/removal and atomic world-space translation. Rotation, scale, nested groups, group
duplication and synthetic generation objects remain explicitly unsupported.

## Selection compatibility

The editor store now keeps `selectedObjectIds` and `selectedGroupId` beside the existing compatibility field
`selectedObjectId`. A normal object click produces one selected object. Ctrl/Cmd or Shift click toggles a
member; `selectedObjectId` remains non-null only when exactly one object is selected. Existing Inspector,
shortcut and single-object transform consumers therefore keep their scalar contract and cannot accidentally
operate on one member while a multi-selection or group is active.

Selecting a group sets its complete member list as the visual selection while leaving `selectedObjectId`
null. The viewport renders selection helpers for all members but attaches no single-object transform gizmo.

## Group lifecycle

`createObjectGroup` accepts at least two unique existing objects. Floor objects and objects already assigned
to another group are rejected. A group is persisted in SceneDocument v4 with an ID, default or supplied name,
and member IDs. `ungroupObjects` removes only the group record; member objects and transforms are unchanged.

Deletion uses the S39 cleanup contract: a deleted member is removed from its group and a group with fewer
than two remaining members is dropped. Duplicating an object copies its authoring fields but does not silently
copy group membership.

## Translate-only movement

The selected group exposes X/Y/Z world delta inputs in the Outliner. `translateObjectGroup` validates finite
numbers and applies the same delta to every member position. Rotation and scale remain untouched. The whole
document update is recorded as one `translate-object-group` history mutation, so undo/redo restores every
member atomically and group selection remains active while the group still exists.

## Verification

- Focused store/Outliner/EditorShell suite: 3 files, 75 tests passed.
- Full unit suite excluding the Windows symlink-only static editor test: 71 files, 587 tests passed.
- Typecheck passed.
- ESLint passed.
- E2E build passed.
- Chromium grouping test passed: two objects were grouped, translated by one XYZ delta, undone together and
  redone together while no single-object transform control was attached.
- Chromium persistence test passed with group membership, v4 format and selection lock preserved after reload.

## Next step

S41 should expose proxy visualization opacity, final surface intent and typed containment authoring, then
project them into LayoutSpec v2 and generation prompt evidence. Mirror reflection should remain a separate S42
slice because it adds viewport/export rendering and resource-lifecycle work.
