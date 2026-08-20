# S38 Layout Authority Contract handoff

## Session / branch

- Worktree: `D:\Projects\3d-scene-helper-worktrees\layout-authority-object-workflow`
- Branch: `codex/layout-authority-object-workflow`
- Start: `main` at `5ac967b64961ca1995a01437d7a82180c9ac1d4c`
- Product design: `docs/layout-authority-and-object-workflow-improvement-plan.md`

## Product boundary

S38 fixes the authority and ordering of image inputs used by fresh and edit generation. It does not begin
SceneDocument v4, object selection locking, grouping, containment, opacity or mirror work.

## Frozen contract

- The current OutputCamera 3D layout is always Image 1.
- Fresh generation appends selected references after Image 1.
- Edit generation uses Image 2 as the source generation and appends references from Image 3.
- The 3D layout is the highest authority for camera, perspective, crop, screen placement, scale, pose,
  facing, depth order and occlusion.
- A source generation is authority only for finished appearance, identity, clothing, materials, color
  treatment and rendering detail.
- Conversation intent and role-bound references cannot override the spatial layout contract.
- Imported layout references are `layoutReference`, distinct from the primary `layout` input.

## Implementation

### Canonical image descriptors

`shared/generationImageContract.ts` defines attachment contract version 2, canonical roles, role-specific
authority/prohibited-authority lists and validation helpers. Validation requires exactly one primary layout
at Image 1, allows at most one source generation at Image 2 and rejects weakened authority arrays.

### Companion ordering and persistence

`companion/server.ts` resolves all input artifacts once and builds one canonical descriptor array. The same
array drives:

- direct Codex `TurnInput` ordering;
- OAuth prompt compilation;
- OAuth image provider `filePaths` ordering;
- generation attachment records;
- persisted `imageBindings`.

New records store `attachmentContractVersion: 2` and the validated image bindings. Legacy records without
these fields remain readable.

### Prompt compiler fail-closed boundary

`companion/imagegenSkillPromptCompiler.ts` now asks the planning-only imagegen turn for both `finalPrompt`
and structured `bindings`. The compiler request includes canonical descriptors and exact expected bindings.
Before provider execution, Companion verifies:

- binding index, role and authority arrays match exactly;
- final prompt contains one readable `Image N` line per input;
- each line uses vocabulary compatible with its canonical role;
- no role is unassigned, ignored or omitted.

Role changes, authority weakening and text/structured-binding contradictions fail before image generation.

### Browser and web export

- The edit prompt describes Image 1 as the highest spatial authority and Image 2 as appearance evidence.
- The refinement preserve contract no longer lets a source keyframe override spatial attributes.
- The Assistant displays the edit lineage as fixed 3D spatial authority plus source appearance authority.
- Manual web export lists the 3D layout first and labels both authority scopes.
- Keyframe execution details display attachment contract version and persisted canonical bindings.

## Verification

- Focused generation contract suite: 7 files, 106 tests passed.
- Keyframe workspace: 13 tests passed.
- Editor shell: 23 tests passed.
- Full unit suite excluding the Windows symlink-only static editor test: 70 files, 577 tests passed.
- Typecheck passed.
- ESLint passed.
- Production build passed; E2E-only diagnostics were absent.
- Chromium E2E: the refinement authority round trip and three keyframe flows passed. The remaining
  many-generations resource-count scenario also fails unchanged `main` under Playwright Chromium 151
  because one additional full-resolution request/object URL is observed; it is not introduced by S38.
- Existing build advisory remains: some generated chunks exceed 500 kB.

The unexcluded full unit run reached 577 passing tests plus two pre-existing environment failures in
`companion/staticEditor.test.ts`. Both fail while creating a Windows symlink with `EPERM` before application
code executes; this machine does not currently grant symlink creation permission.

## Next step

S39 should introduce the SceneDocument v4 foundation and viewport selection lock without starting group or
mirror behavior. It should add migration defaults first, then the Outliner lock control and viewport
click-through semantics.
