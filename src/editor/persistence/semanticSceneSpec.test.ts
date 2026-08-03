import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_SCENE_SPEC_VERSION,
  createDefaultSemanticSceneSpec,
  normalizeSemanticSceneSpec,
  semanticSceneSpecSchema,
} from './semanticSceneSpec';

describe('SemanticSceneSpec', () => {
  it('버전이 명시된 안전한 빈 기본값을 만든다', () => {
    expect(createDefaultSemanticSceneSpec()).toEqual({
      version: SEMANTIC_SCENE_SPEC_VERSION,
      intent: {
        location: '',
        timeOfDay: '',
        mood: '',
        visualStyle: '',
      },
      generatedProps: [],
      extras: {
        enabled: false,
        minCount: 0,
        maxCount: 0,
        placement: '',
        importance: '',
      },
      relationships: [],
      constraints: {
        preserve: [],
        allowChanges: [],
      },
    });
  });

  it('문자열과 목록을 정규화하고 prompt 재생성을 위한 안정 순서로 만든다', () => {
    expect(
      normalizeSemanticSceneSpec({
        version: 1,
        intent: {
          location: '  야외 치킨집  ',
          timeOfDay: ' sunset ',
          mood: ' 조용한 대화 ',
          visualStyle: ' 2D animation ',
        },
        generatedProps: [
          { name: ' 맥주 ', placement: ' 테이블 ', importance: ' 보조 ' },
          { name: ' 치킨 ', placement: ' 중앙 ', importance: ' 핵심 ' },
        ],
        extras: {
          enabled: true,
          minCount: 8,
          maxCount: 5,
          placement: ' 오른쪽 배경 ',
          importance: ' 주인공보다 낮음 ',
        },
        relationships: [
          {
            subjectObjectId: ' b ',
            targetObjectId: ' a ',
            relationship: ' 친구 ',
            gaze: ' 바라봄 ',
            action: ' 대화 ',
          },
          {
            subjectObjectId: ' a ',
            targetObjectId: ' b ',
            relationship: ' 친구 ',
            gaze: '',
            action: '',
          },
        ],
        constraints: {
          preserve: [' 카메라 ', '카메라', ' 인물 외형 '],
          allowChanges: [' 배경 디테일 ', '배경 디테일'],
        },
      }),
    ).toEqual({
      version: 1,
      intent: {
        location: '야외 치킨집',
        timeOfDay: 'sunset',
        mood: '조용한 대화',
        visualStyle: '2D animation',
      },
      generatedProps: [
        { name: '맥주', placement: '테이블', importance: '보조' },
        { name: '치킨', placement: '중앙', importance: '핵심' },
      ],
      extras: {
        enabled: true,
        minCount: 5,
        maxCount: 8,
        placement: '오른쪽 배경',
        importance: '주인공보다 낮음',
      },
      relationships: [
        {
          subjectObjectId: 'a',
          targetObjectId: 'b',
          relationship: '친구',
          gaze: '',
          action: '',
        },
        {
          subjectObjectId: 'b',
          targetObjectId: 'a',
          relationship: '친구',
          gaze: '바라봄',
          action: '대화',
        },
      ],
      constraints: {
        preserve: ['인물 외형', '카메라'],
        allowChanges: ['배경 디테일'],
      },
    });
  });

  it('malformed 및 unknown-version 데이터는 fail-closed로 거부한다', () => {
    expect(
      semanticSceneSpecSchema.safeParse({
        ...createDefaultSemanticSceneSpec(),
        version: 99,
      }).success,
    ).toBe(false);
    expect(
      semanticSceneSpecSchema.safeParse({
        ...createDefaultSemanticSceneSpec(),
        extras: { enabled: true, minCount: -1, maxCount: 2 },
      }).success,
    ).toBe(false);
  });
});
