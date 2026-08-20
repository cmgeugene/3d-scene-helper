# S43 Server-owned generation bindings handoff

## Session / branch

- Worktree: `D:\Projects\3d-scene-helper-worktrees\layout-authority-object-workflow`
- Branch: `codex/canonical-generation-bindings`
- Parent commit: `06d4fd0 feat(editor): add planar mirror reflections`

## Reproduced failure

A real OAuth generation kept `Image 1 = layout` in its structured `imageBindings` and execution attachments, but
the planning-only imagegen prompt compiler returned prose whose Image 1 role description did not satisfy the
readable-role validator. The generation correctly stopped before the provider call, but users had to retry and
the failure appeared as if the Companion had removed the 3D binding.

Conversation turns used a separate numbering space: selected references started at image 1, while production
fresh/edit generations reserve Image 1 for the current 3D layout. Persisting an assistant sentence such as
“apply image 1 to the whole background” therefore carried an ambiguous, potentially conflicting number into the
next production prompt.

## Server-owned production authority

The prompt compiler still returns exact structured bindings and those bindings must byte-for-byte match the
canonical server expectation. The compiler no longer owns production image-role prose. After compilation the
Companion validates the actual ordered descriptors, removes any compiler-authored Input images/Image roles
section, and prepends an immutable canonical authority block generated from the descriptors.

The block lists every production image index, role, artifact ID, target scope, allowed authority and prohibited
authority. Image 1 is explicitly fixed as the current OutputCamera layout and highest spatial authority. Missing,
unassigned or contradictory compiler prose is replaced rather than causing a retry; altered structured bindings,
invalid descriptor order or a missing layout still fail closed.

## Conversation reference identity

Conversation reference attachments are now sent in the same stable role/creation order shown by their manifest.
Turn metadata snapshots each conversation-local attachment index together with reference id, name, role, target,
use and exclude fields. Scene Assistant instructions require name/id/role language rather than image numbers.

For defensive compatibility with user wording and older model responses, a completed conversation normalizes
`이미지 N`/`Image N` into the matching stable reference name, role and id before promoting it to generation
intent. Unmatched numbers are marked conversation-local and never treated as production attachment identities.
Background references with no target object are represented as scene-wide rather than weak or unbound.

The new metadata fields are optional, so existing `conversations.json` and generation snapshots remain readable.

## Verification

- Focused prompt compiler, conversation store, Scene Assistant prompt and panel suite: 4 files, 54 tests passed.
- Related server, generation contract/store, browser client and keyframe suite: 5 files, 61 tests passed.
- Full unit suite excluding the existing Windows symlink-only `companion/staticEditor.test.ts`: 74 files,
  599 tests passed.
- Typecheck and ESLint passed.
- Changed-file Prettier check passed. The repository-wide check continues to report the existing CRLF baseline
  across unrelated files, so only this change set was formatted.
- Production build passed and excluded E2E diagnostics. Vite reports only the existing chunk-size advisory.

## Manual acceptance

1. Select a background reference and tell the Companion that it was not applied strongly enough.
2. Confirm the reply uses the reference name/role rather than `이미지 1`.
3. Generate fresh and inspect generation execution details: Image 1 must be layout and the background reference
   must follow it.
4. Repeat in edit mode: Image 1 must be layout, Image 2 the source keyframe, and the background reference later.
5. Inspect `generationSpec`; its first block must be server-owned canonical authority and list every actual input.
