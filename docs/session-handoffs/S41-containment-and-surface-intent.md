# S41 Containment and surface intent handoff

## Session / branch

- Worktree: `D:\Projects\3d-scene-helper-worktrees\layout-authority-object-workflow`
- Branch: `codex/layout-authority-object-workflow`
- Parent commit: `d923832 feat(editor): add translate-only object groups`
- Product design: `docs/layout-authority-and-object-workflow-improvement-plan.md`

## Product boundary

S41 exposes the SceneDocument v4 visualization, appearance-intent and typed containment fields as one vertical
slice. An object's translucent editor proxy is intentionally not the same concept as a transparent final
surface. Containment records which existing object is inside another and how it should be visible in the final
image. Planar mirror authoring and reflection rendering remain S42 scope.

## Editor authoring

The Scene Inspector now separates two controls:

- `visualization.proxyOpacity` ranges from 0.05 to 1 and affects only the viewport proxy.
- `appearanceIntent.surfaceType` selects opaque, transparent or translucent final output, independently of the
  proxy value. `appearanceIntent.materialNotes` carries object-specific final material direction.

The mirror option remains visible but disabled to avoid storing a final surface mode without its S42 reflection
workflow. Proxy rendering traverses the object's materials, caches each material's original opacity and
depth-write state, applies the proxy multiplier, and restores the original values when opacity returns to one.
Selection helpers stay outside that visualization group and remain readable.

The `내부 오브젝트 관계` editor creates a typed `contains` relation between the selected container and another
scene object. Its visibility is one of `occluded`, `through-opening`, `through-transparent-surface` or `cutaway`.
Existing relations are listed and can be deleted. The store builds a candidate document and validates the whole
v4 schema before committing, so missing references, self-containment, duplicate edges and cycles fail closed.
Creation, deletion and both object field edits are normal history mutations and therefore participate in
undo/redo, autosave and JSON import/export.

## LayoutSpec v2 and generation evidence

LayoutSpec now emits version 2. Each object carries `proxyVisualization.opacity`, `appearanceIntent`, and an
optional `groupId`; the document also projects typed containment relations. The version-1 parser path remains
readable through defaults, while all newly generated specs use v2.

Fresh and refinement prompts explicitly state that proxy opacity is only an editor/X-ray placement aid and must
not be interpreted as final material transparency. Final surface type, material notes and containment visibility
are the authoritative image intent. The existing S38 contract still keeps the current 3D render as Image 1 and
the highest authority for camera and blocking.

## Verification

- Focused S41 unit suite: 6 files, 88 tests passed.
- Full unit suite: 72 files, 592 tests passed, excluding only `companion/staticEditor.test.ts`, whose two Windows
  symlink cases fail with environment-level `EPERM`.
- Typecheck passed.
- ESLint passed.
- Changed-file Prettier check passed.
- E2E build and production build passed; Vite reports only the existing chunk-size advisory.
- Chromium persistence scenario passed: proxy opacity, final surface type/material notes and a cutaway containment
  relation were autosaved and restored after a real page reload.

## Next step

S42 should allow only a `plane` object to become a mirror, author `spatialRelations.reflects` targets, and use one
reflection-plane contract in the viewport and clean export. LayoutSpec should add mirror screen bounds, plane
orientation and reflected target IDs; the generation prompt must forbid turning a reflected image into a second
physical object. Curved mirrors, recursive reflections and mirror-in-mirror composition remain out of scope.
