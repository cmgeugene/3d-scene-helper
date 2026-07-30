import { useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  ArrowHelper,
  CanvasTexture,
  Color,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
  type Group,
  type Object3D,
} from 'three';
import { IS_EDITOR_TEST_BRIDGE_ENABLED } from '../../app/runtimeMode';
import { RENDER_LAYERS } from '../constants';
import {
  hasRenderableMotionDirection,
  type SceneDocument,
} from '../persistence/sceneSchema';

interface MotionGuidesProps {
  document: SceneDocument;
}

interface GuideArrowProps {
  kind: 'subject' | 'camera';
  label: string;
  direction: SceneDocument['outputCamera']['position'];
  origin: SceneDocument['outputCamera']['position'];
  strength: number;
  color: string;
}

function moveToReferenceLayer(object: Object3D) {
  object.traverse((child) => {
    child.layers.set(RENDER_LAYERS.reference);
    child.renderOrder = 20;
    child.raycast = () => undefined;
  });
}

function createLabelSprite(label: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context === null)
    throw new Error('Motion guide label canvas unavailable.');
  context.fillStyle = '#080e18';
  context.fillRect(4, 4, 504, 120);
  context.strokeStyle = color;
  context.lineWidth = 8;
  context.strokeRect(4, 4, 504, 120);
  context.fillStyle = '#ffffff';
  context.font = '700 54px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 256, 66, 470);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = 'srgb';
  texture.needsUpdate = true;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.name = `MotionGuideLabel:${label}.layer2`;
  sprite.scale.set(0.72, 0.18, 1);
  return { sprite, texture, material };
}

function GuideArrow({
  kind,
  label,
  direction,
  origin,
  strength,
  color,
}: GuideArrowProps) {
  const root = useRef<Group>(null);
  const directionIsRenderable = hasRenderableMotionDirection(direction);

  useLayoutEffect(() => {
    const container = root.current;
    if (container === null || !directionIsRenderable) return;

    const normalizedDirection = new Vector3(
      direction.x,
      direction.y,
      direction.z,
    ).normalize();
    const length = 0.35 + strength * 0.4;
    const helper = new ArrowHelper(
      normalizedDirection,
      new Vector3(origin.x, origin.y, origin.z),
      length,
      new Color(color),
      Math.min(0.28, length * 0.28),
      0.16,
    );
    helper.name = `MotionGuideArrow:${kind}:${label}.layer2`;
    const labelSprite = createLabelSprite(label, color);
    labelSprite.sprite.position.set(0, length + 0.12, 0);
    helper.add(labelSprite.sprite);
    moveToReferenceLayer(helper);
    helper.userData.motionGuideLength = length;
    helper.userData.disposeMotionGuideLabel = () => {
      labelSprite.texture.dispose();
      labelSprite.material.dispose();
    };
    container.add(helper);

    return () => {
      container.remove(helper);
      helper.userData.disposeMotionGuideLabel?.();
      helper.dispose();
    };
  }, [
    color,
    directionIsRenderable,
    direction.x,
    direction.y,
    direction.z,
    kind,
    label,
    origin.x,
    origin.y,
    origin.z,
    strength,
  ]);

  return <group ref={root} />;
}

function publishMotionGuideDiagnostics(
  runtimeCanvas: HTMLCanvasElement,
  root: Group,
  camera: Camera,
) {
  if (!IS_EDITOR_TEST_BRIDGE_ENABLED) return;
  camera.updateMatrixWorld();
  root.updateWorldMatrix(true, true);
  const diagnostics: Array<{
    kind: 'subject' | 'camera';
    label: string;
    layer: number;
    labelNdc: { x: number; y: number };
    originNdc: { x: number; y: number };
    tipNdc: { x: number; y: number };
  }> = [];
  root.traverse((child) => {
    const match = /^MotionGuideArrow:(subject|camera):(.+)\.layer2$/.exec(
      child.name,
    );
    if (match !== null) {
      const labelObject = child.children.find((object) =>
        object.name.startsWith('MotionGuideLabel:'),
      );
      const labelNdc =
        labelObject?.getWorldPosition(new Vector3()).project(camera) ??
        new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0);
      const originNdc = child
        .localToWorld(new Vector3(0, 0, 0))
        .project(camera);
      const tipNdc = child
        .localToWorld(
          new Vector3(0, Number(child.userData.motionGuideLength ?? 0), 0),
        )
        .project(camera);
      diagnostics.push({
        kind: match[1] as 'subject' | 'camera',
        label: match[2],
        layer: child.layers.mask === 1 << RENDER_LAYERS.reference ? 2 : -1,
        labelNdc: { x: labelNdc.x, y: labelNdc.y },
        originNdc: { x: originNdc.x, y: originNdc.y },
        tipNdc: { x: tipNdc.x, y: tipNdc.y },
      });
    }
  });
  if (diagnostics.length === 0) delete runtimeCanvas.dataset.motionGuides;
  else runtimeCanvas.dataset.motionGuides = JSON.stringify(diagnostics);
}

function clearMotionGuideDiagnostics(runtimeCanvas: HTMLCanvasElement) {
  if (IS_EDITOR_TEST_BRIDGE_ENABLED) {
    delete runtimeCanvas.dataset.motionGuides;
  }
}

export function MotionGuides({ document }: MotionGuidesProps) {
  const group = useRef<Group>(null);
  const runtimeCanvas = useThree((state) => state.gl.domElement);
  const outputCamera = useThree((state) => state.camera);
  const subjectGuide = document.subjectMotionGuide;
  const cameraGuide = document.cameraMotionGuide;
  const subject =
    subjectGuide === undefined
      ? undefined
      : document.objects.find(({ id }) => id === subjectGuide.subjectId);

  useLayoutEffect(() => {
    if (group.current === null) return;
    publishMotionGuideDiagnostics(runtimeCanvas, group.current, outputCamera);
    return () => {
      clearMotionGuideDiagnostics(runtimeCanvas);
    };
  }, [cameraGuide, outputCamera, runtimeCanvas, subjectGuide, subject]);

  return (
    <group ref={group} name="MotionGuides.layer2">
      {subjectGuide !== undefined && subject !== undefined ? (
        <GuideArrow
          kind="subject"
          label={subjectGuide.label}
          direction={subjectGuide.direction}
          strength={subjectGuide.strength}
          color="#24d4ff"
          origin={{
            x: subject.transform.position.x,
            y:
              subject.transform.position.y +
              (subject.dimensions.y * subject.transform.scale.y) / 2 +
              0.2,
            z: subject.transform.position.z,
          }}
        />
      ) : null}
      {cameraGuide === undefined ? null : (
        <GuideArrow
          kind="camera"
          label={cameraGuide.label}
          direction={cameraGuide.direction}
          strength={cameraGuide.strength}
          color="#ffb347"
          origin={{
            x: document.outputCamera.target.x - 0.9,
            y: document.outputCamera.target.y + 0.35,
            z: document.outputCamera.target.z + 0.8,
          }}
        />
      )}
    </group>
  );
}
