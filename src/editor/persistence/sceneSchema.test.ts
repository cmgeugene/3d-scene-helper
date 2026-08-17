import { describe, expect, it } from 'vitest';
import {
  FILM_GAUGE_MM,
  MANNEQUIN_REFERENCE_HEIGHT_M,
  RENDER_LAYERS,
  SAFE_AREA_INSETS,
  SCENE_STORAGE_KEY,
} from '../constants';
import { ASPECT_RATIO_PRESETS } from '../presets/aspectRatios';
import { CAMERA_SHOT_PRESETS, LENS_PRESETS } from '../presets/cameras';
import { LIGHTING_PRESETS } from '../presets/lighting';
import {
  createSceneObject,
  createStarterSceneDocument,
  sceneDocumentSchema,
} from './sceneSchema';

const STARTER_IDS = {
  documentId: 'scene-starter',
  floorId: 'object-floor',
  mannequinId: 'object-mannequin',
} as const;

describe('sceneDocumentSchema', () => {
  it('결정적 starter 문서를 직렬화 왕복하며 핵심 불변식을 보존한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    const parsed = sceneDocumentSchema.parse(
      JSON.parse(JSON.stringify(document)),
    );

    expect(parsed).toEqual(document);
    expect(parsed.id).toBe('scene-starter');
    expect(parsed.version).toBe(3);
    expect(parsed.objects).toHaveLength(2);
    expect(parsed.objects.find(({ kind }) => kind === 'floor')).toMatchObject({
      id: 'object-floor',
      exportable: true,
      visible: true,
    });
    expect(
      parsed.objects.find(({ kind }) => kind === 'mannequin'),
    ).toMatchObject({
      id: 'object-mannequin',
      dimensions: { x: 0.5, y: 1.7, z: 0.3 },
      mannequinBodyType: 'standard',
      mannequinPose: {
        id: 'default',
        arms: {
          left: { shoulderRotationDeg: { z: -6 } },
          right: { shoulderRotationDeg: { z: 6 } },
        },
      },
      visible: true,
    });
    expect(parsed.background).toEqual({ color: '#d8d8d8' });
    expect(parsed.lighting.presetId).toBe('neutral-studio');
    expect(parsed.outputCamera).toMatchObject({
      position: { x: 0, y: 1.6, z: -5 },
      target: { x: 0, y: 1.6, z: 0 },
      focalLengthMm: 50,
      rollDeg: 0,
      depthOfField: {
        enabled: true,
        apertureMode: 'auto',
        fStop: 2.8,
      },
    });
  });

  it('기존 마네킹 JSON에 체형이 없으면 일반 체형으로 복원한다', () => {
    const legacyDocument = createStarterSceneDocument(STARTER_IDS);
    const legacyMannequin = legacyDocument.objects.find(
      ({ kind }) => kind === 'mannequin',
    );
    if (legacyMannequin === undefined)
      throw new Error('starter mannequin 누락');
    delete legacyMannequin.mannequinBodyType;

    const parsed = sceneDocumentSchema.parse(
      JSON.parse(JSON.stringify(legacyDocument)),
    );

    expect(
      parsed.objects.find(({ kind }) => kind === 'mannequin')
        ?.mannequinBodyType,
    ).toBe('standard');
  });

  it('중복 object ID를 거부한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    document.objects[1].id = document.objects[0].id;

    expect(sceneDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('0 이하인 object scale을 거부한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    document.objects[1].transform.scale.y = 0;

    expect(sceneDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('sceneNotes는 2000자를 허용하고 2001자를 거부한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    document.sceneNotes = 'a'.repeat(2000);

    expect(sceneDocumentSchema.safeParse(document).success).toBe(true);

    document.sceneNotes += 'a';
    expect(sceneDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('output 크기는 lock 양방향 반올림과 canonical cinematic만 허용한다', () => {
    const mismatched = createStarterSceneDocument(STARTER_IDS);
    mismatched.output = {
      aspectRatioId: '9:16',
      width: 1920,
      height: 1080,
      mode: 'clean',
    };
    const cinematic = createStarterSceneDocument(STARTER_IDS);
    cinematic.output = {
      aspectRatioId: '2.39:1',
      width: 1920,
      height: 804,
      mode: 'clean',
    };
    const widthDriven = createStarterSceneDocument(STARTER_IDS);
    widthDriven.output = {
      aspectRatioId: '16:9',
      width: 113,
      height: 64,
      mode: 'clean',
    };
    const heightDriven = createStarterSceneDocument(STARTER_IDS);
    heightDriven.output = {
      aspectRatioId: '9:16',
      width: 64,
      height: 113,
      mode: 'clean',
    };
    const onePixelMismatches = [
      { aspectRatioId: '1:1', width: 100, height: 99 },
      { aspectRatioId: '16:9', width: 1280, height: 719 },
      { aspectRatioId: '9:16', width: 1080, height: 1919 },
    ] as const;

    expect(sceneDocumentSchema.safeParse(mismatched).success).toBe(false);
    expect(sceneDocumentSchema.safeParse(cinematic).success).toBe(true);
    expect(sceneDocumentSchema.safeParse(widthDriven).success).toBe(true);
    expect(sceneDocumentSchema.safeParse(heightDriven).success).toBe(true);
    for (const output of onePixelMismatches) {
      const document = createStarterSceneDocument(STARTER_IDS);
      document.output = { ...output, mode: 'clean' };
      expect(sceneDocumentSchema.safeParse(document).success).toBe(false);
    }
  });

  it('reserved scene notes와 optional motion guide를 v3 JSON으로 왕복한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    document.sceneNotes =
      'Subject moves right while the camera dollies in. Keep the clean start frame free of guides.';
    document.subjectMotionGuide = {
      subjectId: STARTER_IDS.mannequinId,
      direction: { x: 1, y: 0, z: 0 },
      strength: 0.75,
      label: '오른쪽',
    };
    document.cameraMotionGuide = {
      motionType: 'dolly',
      direction: { x: 0, y: 0, z: -1 },
      strength: 0.5,
      label: '돌리 인',
    };

    const parsed = sceneDocumentSchema.parse(
      JSON.parse(JSON.stringify(document)),
    );

    expect(parsed).toEqual(document);
    expect(parsed.version).toBe(3);

    if (parsed.subjectMotionGuide === undefined) {
      throw new Error('subject motion guide was not restored');
    }
    parsed.subjectMotionGuide.subjectId = 'missing-object';
    expect(sceneDocumentSchema.safeParse(parsed).success).toBe(false);
  });

  it('zero-length subject/camera motion directions를 거부한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    document.subjectMotionGuide = {
      subjectId: STARTER_IDS.mannequinId,
      direction: { x: 0, y: 0, z: 0 },
      strength: 0.5,
      label: '정지',
    };
    expect(sceneDocumentSchema.safeParse(document).success).toBe(false);

    delete document.subjectMotionGuide;
    document.cameraMotionGuide = {
      motionType: 'dolly',
      direction: { x: 0, y: 0, z: 0 },
      strength: 0.5,
      label: '정지',
    };
    expect(sceneDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('빈 stable ID, 미지원 version, runtime 필드를 거부한다', () => {
    const withEmptyId = createStarterSceneDocument(STARTER_IDS);
    withEmptyId.objects[0].id = '';

    const withUnsupportedVersion = {
      ...createStarterSceneDocument(STARTER_IDS),
      version: 999,
    };
    const withRuntimeField = {
      ...createStarterSceneDocument(STARTER_IDS),
      runtime: () => undefined,
    };

    expect(sceneDocumentSchema.safeParse(withEmptyId).success).toBe(false);
    expect(sceneDocumentSchema.safeParse(withUnsupportedVersion).success).toBe(
      false,
    );
    expect(sceneDocumentSchema.safeParse(withRuntimeField).success).toBe(false);
  });

  it('DOF schema는 자동/수동 조리개와 f/1.4..f/22 범위만 허용한다', () => {
    const document = createStarterSceneDocument(STARTER_IDS);
    document.outputCamera.depthOfField = {
      enabled: true,
      apertureMode: 'manual',
      fStop: 1.4,
    };
    expect(sceneDocumentSchema.safeParse(document).success).toBe(true);
    document.outputCamera.depthOfField.fStop = 22;
    expect(sceneDocumentSchema.safeParse(document).success).toBe(true);
    document.outputCamera.depthOfField.fStop = 22.1;
    expect(sceneDocumentSchema.safeParse(document).success).toBe(false);
    document.outputCamera.depthOfField.fStop = Number.NaN;
    expect(sceneDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('MVP의 모든 addable object를 plain-data factory로 결정적으로 만든다', () => {
    const kinds = ['cube', 'sphere', 'cylinder', 'plane', 'mannequin'] as const;

    const objects = kinds.map((kind) =>
      createSceneObject(`object-${kind}`, { kind }),
    );

    expect(objects.map(({ kind }) => kind)).toEqual(kinds);
    expect(objects.every(({ transform }) => transform.scale.x > 0)).toBe(true);
    expect(
      objects.every(
        (object) =>
          sceneDocumentSchema.shape.objects.element.safeParse(object).success,
      ),
    ).toBe(true);
    expect(createSceneObject('object-cube', { kind: 'cube' })).toEqual(
      createSceneObject('object-cube', { kind: 'cube' }),
    );
  });

  it('Room Set은 기본 정면 카메라 쪽으로 열린 면을 향해 생성된다', () => {
    const room = createSceneObject('room-facing-camera', { kind: 'room' });

    expect(room.transform.rotationDeg).toEqual({ x: 0, y: 180, z: 0 });
  });

  it('starter factory는 주입 ID까지 최종 schema로 검증한다', () => {
    expect(() =>
      createStarterSceneDocument({ ...STARTER_IDS, documentId: '' }),
    ).toThrow();
    expect(() =>
      createStarterSceneDocument({
        ...STARTER_IDS,
        mannequinId: STARTER_IDS.floorId,
      }),
    ).toThrow();
  });

  it('고정 상수와 typed preset 계약을 한 곳에서 제공한다', () => {
    expect(FILM_GAUGE_MM).toBe(36);
    expect(MANNEQUIN_REFERENCE_HEIGHT_M).toBe(1.7);
    expect(RENDER_LAYERS).toEqual({ scene: 0, editor: 1, reference: 2 });
    expect(SAFE_AREA_INSETS).toEqual({ action: 0.05, title: 0.1 });
    expect(SCENE_STORAGE_KEY).toMatch(/^i2v-3d-scene-helper:/);

    expect(ASPECT_RATIO_PRESETS.map(({ id }) => id)).toEqual([
      '16:9',
      '9:16',
      '1:1',
      '2.39:1',
    ]);
    expect(LENS_PRESETS.map(({ focalLengthMm }) => focalLengthMm)).toEqual([
      18, 24, 35, 50, 85,
    ]);
    expect(CAMERA_SHOT_PRESETS).toHaveLength(6);
    expect(
      CAMERA_SHOT_PRESETS.every(
        ({ framing }) => framing.reference === 'subject-bounds',
      ),
    ).toBe(true);
    expect(LIGHTING_PRESETS.map(({ id }) => id)).toEqual([
      'neutral-studio',
      'daylight',
      'sunset',
      'night',
      'cinematic-backlight',
    ]);
    expect(
      LIGHTING_PRESETS.every(
        ({ value }) =>
          sceneDocumentSchema.shape.lighting.safeParse(value).success,
      ),
    ).toBe(true);
  });
});
