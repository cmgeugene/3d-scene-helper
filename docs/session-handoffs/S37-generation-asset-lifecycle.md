# S37 Generation Asset Lifecycle handoff

## Session / branch

- Hermes session: `20260817_211839_f90fd0`
- Worktree: `/Users/js/Documents/3d-scene-helper-worktrees/s37-generation-asset-lifecycle`
- Branch: `feat/s37-generation-asset-lifecycle`
- Start: `main` at `b11440a66921c5295a2d65f60e06db0dae67dfb6`
- Intended commit message: `feat(assistant): bound generation asset lifecycle`
- Final commit SHA is reported in the post-commit session closeout. A commit cannot contain its own SHA.
- Push: not requested and not performed.

## Product boundary

S37 keeps the Assistant as a scene interpreter, semantic/reference orchestrator, prompt builder, and start-frame generation/history manager. It does not add or integrate automatic shot composition, camera solving, pose solving, the old `CompanionPanel`, or the old Codex Vite planner prototype.

Existing generation history, source snapshots, fresh/edit lineage, refinement directives, Semantic Scene Spec, `LayoutSpec`, references, prompt/export, and preflight behavior remain unchanged.

## Lifecycle ownership frozen by S37

- Project generation originals are durable and immutable.
- Companion thumbnails are derived, replaceable, source-hash-bound assets.
- Thumbnail policy version 1 is WebP quality 78, auto-oriented, aspect-preserving, no enlargement, and bounded to 320 × 320 px.
- The generation history renders at most 24 rows per page and list rows request thumbnail content only.
- Only the selected result, selected layout render, and active comparison result may own full-resolution URLs.
- Each URL owner aborts stale loads and revokes its URL exactly once on replacement/unmount.
- A read-only snapshot preview owns an isolated store, Canvas, renderer, and WebGL context. Close/unmount disposes render lists and renderer, loses a still-live context, avoids re-losing an already-lost context, and cannot mutate live document/history/selection/dirty/autosave state.
- Legacy records with no thumbnail metadata, or valid records whose derived file is missing, are restored from a validated original. Malformed metadata, traversal/symlink escape, source/original/thumbnail hash mismatch, or decoded metadata mismatch fails closed.
- E2E resource diagnostics exist only in `mode=e2e`; ordinary production rejects the marker.

## Implementation

### Companion / durable assets

- `companion/generationStore.ts`
  - stores original plus derived thumbnail metadata and hashes;
  - creates original/thumbnail temp files, atomically publishes both, then updates the manifest;
  - rolls back task-created files if a write/publish/manifest step fails;
  - validates original bytes, MIME, dimensions, byte length, and SHA-256 before recovery;
  - validates stored thumbnail source hash, path/artifact identity, bytes, decoded WebP metadata, and SHA-256;
  - lazily restores legacy/missing derived thumbnails under the store mutation queue;
  - verifies full-resolution original integrity before serving it.
- `companion/server.ts` adds the authenticated private immutable thumbnail content route.
- `src/assistant/companionClient.ts` accepts legacy `thumbnail: null` records and fetches thumbnail blobs separately from originals.
- `sharp@0.34.4` is a production dependency for real decode, resize, orientation, and WebP encoding.

### Browser / runtime ownership

- `src/assistant/KeyframeWorkspace.tsx`
  - renders hash-aware thumbnail owners for visible list rows;
  - pages history newest-first in bounded sets of 24;
  - preserves lazy selected/layout/comparison full-resolution ownership and exact revocation.
- `src/editor/scene/SceneViewport.tsx` registers read-only renderer ownership at actual Canvas creation.
- `src/editor/scene/previewResourceLifecycle.ts` provides idempotent renderer/WebGL release and avoids duplicate `loseContext` calls after R3F has already lost the context.
- `src/app/runtimeMode.ts` exposes a distinct E2E-build constant.
- `scripts/assert-production-bridge-absent.mjs` rejects the preview resource diagnostic marker from ordinary production bundles.

## Integrity evidence

Deterministic `640 × 360` PNG test fixture and its real Sharp thumbnail:

- Original: `145754` bytes, `sha256:5922132a612b1c6cb86bbebc239259303834418d2c423530293a0975c7986961`
- Thumbnail: WebP quality 78, `320 × 180`, `9434` bytes, `sha256:1ec2ea8d2e2d23681eb5133aa5382f644c250d610fdec8dc5576383b835ce91b`
- Recorded thumbnail `sourceContentHash` equals the original hash.
- Tests prove original bytes/hash are unchanged after initial creation and thumbnail reuse.

## RED → GREEN evidence

All production changes were driven vertically by focused failures.

1. Thumbnail creation/reuse
   - RED: `npm test -- --run companion/generationStore.test.ts -t "hash-bound 320px WebP"` → exit 1 because result metadata/derived WebP did not exist.
   - GREEN: same command → exit 0.
2. Failed derived write atomicity
   - RED: `npm test -- --run companion/generationStore.test.ts -t "thumbnail write 실패"` → exit 1 before injectable derived-write failure handling existed.
   - GREEN: same command → exit 0; manifest/original unchanged and temp/published task artifacts absent.
3. Restart/legacy restoration
   - RED: `npm test -- --run companion/generationStore.test.ts -t "legacy 원본"` → exit 1 because missing legacy thumbnails were not restored.
   - GREEN: same command → exit 0.
4. Malformed/path/hash fail-closed behavior and original integrity
   - RED: focused `누락 derived file` and `전체 해상도 원본` tests exited 1 before validation.
   - GREEN: both focused commands exited 0 after validation/recovery.
5. Authenticated thumbnail route/client
   - RED: focused Companion client/server route tests exited 1 before the thumbnail endpoint/client method.
   - GREEN: both focused commands exited 0.
6. Thumbnail-only list and URL ownership
   - RED: `npm test -- --run src/assistant/KeyframeWorkspace.test.tsx -t "bounded thumbnail" --reporter=dot` → exit 1 because rows had no thumbnail owner.
   - GREEN: same command → exit 0 and proves lazy selected full-resolution replacement/unmount revocation.
7. Bounded history DOM
   - RED: focused `한 페이지의 thumbnail DOM` test exited 1 with all generations mounted.
   - GREEN: same command exited 0 with at most 24 row/thumbnail nodes and navigable older/newer pages.
8. Read-only renderer release
   - RED: `npm test -- --run src/editor/scene/SceneViewport.previewLifecycle.test.ts --reporter=dot` → exit 1 because no explicit idempotent release function existed.
   - GREEN: exit 0.
9. Actual Chromium/WebGL resource policy
   - RED: the focused many-generation E2E initially failed because the E2E-only preview resource diagnostic was absent.
   - GREEN: the same focused Chromium test passed with decoded 320 × 180 images and bounded resource counts.
10. R3F duplicate context loss
    - RED: focused `이미 잃은` unit test reported `forceContextLoss` called once; full parallel E2E also exposed `WebGL: INVALID_OPERATION: loseContext: context already lost`.
    - GREEN: focused unit test and the three serial keyframe Chromium tests passed with no browser warning.
11. Null context closure from independent re-review
    - RED: focused `null context` test threw `TypeError: Cannot read properties of null (reading 'isContextLost')`.
    - GREEN: all 3 preview lifecycle tests passed with optional-result chaining.

## Actual Chromium/WebGL evidence

Focused serial command:

`npm_lifecycle_event=test:e2e:external ./node_modules/.bin/playwright test e2e/keyframe-workspace.spec.ts --workers=1`

Result: `3 passed`.

Many-generation metrics from real Chromium/WebGL:

- generations: `72`
- simultaneously mounted thumbnail rows/images: `24`
- decoded thumbnail dimensions: `320 × 180`
- thumbnail requests while visiting all three pages: `72`
- selected full-resolution requests in the Keyframe workspace transition: `1`
- active Object URLs after page cycling: `26` = 24 thumbnails + 2 selected full-resolution/layout URLs
- peak active Object URLs: `26`
- full-resolution active URLs: `2` (no comparison candidate in this fixture; policy maximum remains 3)
- Object URLs created/released at measurement: `75 / 49`, leaving the expected active `26`
- duplicate revokes: `0`
- preview cycles: created `3`, released `3`, peak active `1`, final active `0`
- final preview Canvas count: `0`

The existing real-browser inertness probe also preserved the full editor evidence across preview open/close and refresh: serialized document, history, selection, dirty flag, autosave payload, and document identity.

## Independent review

All reviewer runs used `agy` with `gemini-3.6-flash-high`, read-only prompts, exact staged binary diff hashes, and post-run hash/status verification.

1. Spec compliance, hash `0b3dd26c5890dce6394b052603227e5b35e85c4f265c04c606d75b3de362c253`: PASS, 0 Critical / 0 Important / 0 Minor.
2. Quality/security, same hash: PASS, 0 Critical / 0 Important / 0 Minor.
3. Narrow review after duplicate-context-loss fix, hash `e66de3f76df6de479cbd7ab895f8388edc403ea465a76c3db81a1feab1e5c4d7`: PASS, 0 Critical / 0 Important, one Minor (`getContext()` nullability).
4. Final narrow closure after null-context RED/GREEN, hash `e11aabf8c954e286f2a3b78146cfafb340010b37609f4ea3873542d7b115088a`: PASS, 0 Critical / 0 Important / 0 Minor.

A final whole-snapshot spec/quality review is run after this handoff and roadmap completion are staged; its exact hash and verdict are recorded in the session closeout.

## Gates

- Focused related suite: `5` files, `54` tests passed.
- Final full unit suite: `60` files, `515` tests passed.
- Typecheck: `npm run typecheck` passed.
- Lint: `npm run lint` passed.
- Changed-file Prettier check passed.
- `git diff --check` and staged diff check passed.
- Focused final Keyframe Chromium/WebGL: `3/3` passed.
- First non-serial whole-project preview attempt: `94/96` passed. It intentionally remains recorded because it exposed the duplicate-context-loss warning; the other failure was the existing 3-second export performance gate under five-worker contention (`4236 ms`).
- Required serial whole-project Chromium/WebGL: `96/96` passed in `6.5m` with `--workers=1`.
- Fresh ordinary production build: passed; `732` modules transformed; E2E-only diagnostics absent.
- Ordinary bundle advisory: Vite reports chunks above 500 kB; unchanged as a non-blocking project advisory.
- Unit advisory: Node prints the pre-existing `--localstorage-file` warning while all tests pass.
- Pre-commit process check: task ports `4173` and `4174` free; protected `127.0.0.1:5173` returned HTTP `200` and was not touched.

## Changed files

- Planning/contracts: `.hermes/plans/S37-generation-asset-lifecycle.md`, `docs/roadmap.md`, this handoff.
- Companion lifecycle: `companion/generationStore.ts`, `companion/generationStore.test.ts`, `companion/server.ts`, `companion/server.test.ts`.
- Browser client/workspace: `src/assistant/companionClient.ts`, `src/assistant/companionClient.test.ts`, `src/assistant/KeyframeWorkspace.tsx`, `src/assistant/KeyframeWorkspace.test.tsx`, `src/app/App.css`.
- Preview/runtime: `src/editor/scene/SceneViewport.tsx`, `src/editor/scene/previewResourceLifecycle.ts`, `src/editor/scene/SceneViewport.previewLifecycle.test.ts`, `src/app/runtimeMode.ts`.
- Browser/build verification: `e2e/keyframe-workspace.spec.ts`, `scripts/assert-production-bridge-absent.mjs`.
- Dependency manifests: `package.json`, `package-lock.json`.

## Remaining roadmap boundary

S37 stops at generation asset lifecycle management. It does not begin another phase. The roadmap keeps later concerns in long-term hold: multi-provider/model input budgets, batch generation/automatic candidate comparison, arbitrary 3D import/timeline/physics, cloud collaboration, remote Codex App Server operation, and any product decision that would separately authorize shot/camera/pose solving.
