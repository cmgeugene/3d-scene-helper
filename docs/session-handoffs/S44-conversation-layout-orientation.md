# S44 Conversation layout orientation handoff

## Session / branch

- Worktree: `D:\Projects\3d-scene-helper-worktrees\layout-authority-object-workflow`
- Branch: `codex/conversation-layout-orientation`
- Parent commit: `58a562a fix(assistant): make generation bindings server-owned`

## Reproduced interpretation failure

Normal Scene Assistant turns previously received only the serialized `SceneDocument` and selected reference
images. The current OutputCamera render and `LayoutSpec` were created only after the user pressed an image
generation button. As a result, the assistant could see a mannequin's world-space `rotationDeg.y = 0`, but could
not reliably determine how that unchanged forward direction appeared from an offset camera. It could incorrectly
claim that a requested screen-space diagonal required changing the object's world Y rotation or moving the camera.

`SceneDocument.transform.rotationDeg` remains the authoritative world transform. Apparent orientation is derived
from the world transform and current camera and is never written back as a replacement transform.

## Derived orientation contract

`LayoutSpec v2` mannequin `facing` now includes optional additive fields:

- `cameraAzimuthFromForwardDeg`: signed horizontal angle from mannequin forward to the mannequin-to-camera
  direction. Positive places the camera on the mannequin's left and negative on its right.
- `viewClassification`: front, left/right three-quarter, left/right profile, left/right back three-quarter, or
  back.
- `screenDirection`: normalized projection of the mannequin's local forward direction into output image
  coordinates, where positive X is right and positive Y is down.
- `screenDirectionLabel`: the corresponding eight-way screen label: up, down, left, right, or a diagonal such as
  `down-left`.

The existing `yawDeg`, `worldDirection`, and coarse `relativeToCamera` fields remain intact. New schema fields are
optional so existing saved generation records and older LayoutSpec v2 payloads remain readable.

## Grounded normal conversation

When the current scene validates and viewport capture is available, sending a normal chat message now:

1. Builds `LayoutSpec` from the exact SceneDocument and selected references.
2. Captures and uploads the current OutputCamera 3D render.
3. Sends that render as conversation attachment 1.
4. Sends selected references after it, with manifest and persisted conversation binding indices shifted to match
   the real attachment order.
5. Includes the same LayoutSpec and SceneDocument snapshot in the assistant prompt.

Unchanged SceneDocument snapshots reuse the most recently uploaded conversation render instead of creating a
new durable artifact for every follow-up message. Any scene or camera change produces a new snapshot and capture.

The server resolves the render artifact itself, places it before reference images, and rejects a render whose
stored `sceneId` does not match the submitted scene ID. If viewport capture or render upload fails, normal chat
still proceeds with LayoutSpec and SceneDocument; reference numbering falls back to starting at attachment 1.
Clients without the grounded conversation API continue to use the previous text/reference turn path.

Scene Assistant instructions explicitly distinguish world heading, camera-relative view, and screen-space
projection. They prohibit treating a diagonal screen appearance as evidence that world Y rotation is wrong and
prohibit choosing an object or camera transform change unless the user actually requested one.

## Verification

- Grounded prompt, orientation math, browser client, panel and server focused suite: 5 files, 71 tests passed.
- Full unit suite excluding the existing Windows symlink-only `companion/staticEditor.test.ts`: 74 files,
  603 tests passed.
- Typecheck and ESLint passed.
- Changed-file Prettier check passed.
- Production build passed and excluded E2E diagnostics. Vite reports only the existing chunk-size advisory.

## Manual acceptance

1. Open a scene with a mannequin whose Y rotation is 0 and place the OutputCamera slightly to one side of the
   mannequin's forward axis.
2. Ask: `한나 몸의 회전이 화면에서 ↙ 방향인지 확인해줘.`
3. Confirm the reply distinguishes the unchanged world Y rotation from the camera-relative and screen-space
   directions. It must not say that Y=0 is un-applied merely because the camera is offset.
4. Change only the camera position and ask again. Confirm the derived camera azimuth/view classification/screen
   direction changes while the reported world Y rotation stays unchanged.
5. Select a reference and send another message. Confirm the current 3D render is attachment 1 and the reference
   binding begins at attachment 2.
6. Temporarily make viewport capture unavailable and confirm the message still sends using LayoutSpec and
   SceneDocument without a render image.
