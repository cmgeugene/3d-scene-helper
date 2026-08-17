# S37 Generation Asset Lifecycle

## Boundary

Implement only long-lived generation asset/resource ownership. The Assistant remains a scene interpreter, semantic/reference orchestrator, prompt builder, and start-frame generation/history manager. This phase does not add automatic shot composition, camera solving, pose solving, the removed CompanionPanel, or the Codex Vite planner prototype.

Start: `main` / `b11440a66921c5295a2d65f60e06db0dae67dfb6`
Branch/worktree: `feat/s37-generation-asset-lifecycle` in this worktree only.
Closeout: one reviewed conventional commit and `docs/session-handoffs/S37-generation-asset-lifecycle.md`; no push.

## Inventory and ownership contract

Current path:

1. Codex result path enters `GenerationStore.importGenerationResult`; the Companion copies it to `assets/generations/` and records `result` metadata in `generations.json`.
2. Authenticated Companion routes expose `/api/generations`, `/api/generations/:id/content`, `/api/scene-renders/:id/content`, and SSE `/api/events`.
3. `CompanionClient` validates records and fetches binary content as blobs.
4. `KeyframeWorkspace` restores selection/comparison, loads the selected result and layout plus one comparison result, and creates browser blob URLs. History rows currently have no thumbnails.
5. `SceneSnapshotPreview` creates an isolated editor store and mounts one read-only R3F `SceneViewport`; closing/changing selection unmounts it.
6. `SceneAssistantPanel` independently owns only the currently displayed generation result URL and reload/SSE recovery.

Frozen S37 ownership:

- Project generation originals are durable, immutable artifacts. Their bytes/path/hash are never rewritten by thumbnail creation or repair.
- A thumbnail is a derived, replaceable artifact bound to the original SHA-256. Policy v1: WebP, maximum 320×320 CSS-independent pixels, preserved aspect ratio, no enlargement, quality 78, auto-oriented before resize. Metadata records source hash, thumbnail hash, decoded dimensions, byte length, MIME, policy version, and project-relative path.
- New imports stage/validate the original and derived thumbnail before publishing either in the manifest. Any decode/write/rename/manifest failure removes task-created artifacts and leaves the previous manifest and existing originals unchanged.
- Legacy completed results without thumbnail metadata are repaired lazily under the GenerationStore mutation queue only after the original path, bytes, hash, MIME, and decoded dimensions validate. Missing derived files may be regenerated from the same validated original. Malformed metadata, traversal/symlink escape, original hash mismatch, thumbnail source-hash mismatch, thumbnail byte-hash mismatch, or decoded-metadata mismatch fails closed without manifest/original mutation.
- Generation history is paged to a bounded visible row count. Visible rows request only thumbnail content; list rows never request/decode original generation content.
- Full-resolution browser owners are explicit and bounded: selected result, selected layout render, and active comparison result. Each slot creates lazily and revokes its current URL exactly once on replacement, deselection, connection loss, or unmount. Stale async results are discarded safely.
- At most one read-only scene preview is mounted. It owns an isolated store, R3F Canvas/renderer/context, and read-only runtime resources; close/selection/unmount disposes them and cannot mutate live document/history/selection/dirty/autosave state.
- Narrow lifecycle diagnostics exist only in `e2e` builds and report owned thumbnail/full-resolution URLs and preview Canvas/context create/dispose counts. Ordinary production must not expose the diagnostics.

## Strict vertical TDD tracer bullets

1. Companion import: RED with a real decoded large PNG; GREEN creates a bounded WebP atomically, records original/thumbnail hashes and dimensions, reuses it after restart, and proves original bytes/hash unchanged.
2. Companion failure/integrity: RED malformed input and injected thumbnail-write failure; GREEN leaves manifest/project originals unchanged. Add traversal, source/hash, and metadata mismatch fail-closed tests.
3. Legacy recovery: RED restart/list with a valid legacy result and missing thumbnail; GREEN safely regenerates/persists it. Missing derived file is repaired; invalid original/metadata is not.
4. Client/routes/UI list: RED authenticated thumbnail route/client schema and visible list rows; GREEN history requests thumbnails only and bounds visible rows/thumbnail owners.
5. Full-resolution URL slots: RED replacement/deselection/unmount/race tests; GREEN explicit slot ownership with exactly-once revocation and a maximum of three concurrent full-resolution URLs.
6. Preview lifecycle: RED component/runtime tests and Chromium evidence; GREEN close/selection/unmount releases isolated preview WebGL resources while live document/history/selection/dirty/autosave remain byte-identical.
7. Many-generation Chromium/WebGL: RED a high-generation mock project; GREEN proves bounded visible rows, thumbnail owners, ≤3 full-resolution owners, ≤1 preview canvas/context, no canvas accumulation across repeated open/close/switch, real decoded dimensions, and e2e-only diagnostics absent from ordinary production.

Run the focused test after each RED and after minimal GREEN, then related Companion/client/workspace/runtime suites.

## Stable-snapshot review and gates

1. Create the handoff before stable-snapshot review/gates, excluding only the impossible final self-referential commit SHA.
2. Record a binary diff hash and exact task-owned file manifest.
3. Run read-only `agy` with `gemini-3.6-flash-high`: spec compliance first, quality/security second, against the same hash. Verify no repository drift. Important/Critical findings require focused RED→GREEN and review of the new hash.
4. Gates on the unchanged candidate: focused suites; complete unit suite; typecheck; lint; changed-file Prettier plus repository format check; `git diff --check`; ordinary production build; focused actual Chromium/WebGL E2E on 4173/4174; serial preview E2E if shared seams changed; final fresh ordinary production build and diagnostic-absence check.
5. Commit exactly once with a focused conventional message. Verify SHA/message, clean status, no push, no task-owned 4173/4174 listener/process, and protected 127.0.0.1:5173 remains HTTP healthy.

## Remaining boundary

S37 ends after asset/resource lifecycle closeout. Do not begin provider expansion, batch generation/automatic candidate comparison, shot/camera solving, pose solving, or another roadmap phase.
