import { describe, expect, it } from 'vitest';
import {
  createImageGenerationPrompt,
  createImageRefinementPrompt,
  createSceneAssistantPrompt,
} from './sceneAssistantPrompt';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';

describe('createSceneAssistantPrompt', () => {
  it('사용자 메시지와 현재 SceneDocument를 분리해 전달한다', () => {
    const prompt = createSceneAssistantPrompt('노란 물체는 전봇대야.', {
      version: 1,
      objects: [{ id: 'foreground-1', color: '#ffff00' }],
    });

    expect(prompt).toContain('[사용자 메시지]\n노란 물체는 전봇대야.');
    expect(prompt).toContain('[현재 SceneDocument]');
    expect(prompt).toContain('"id":"foreground-1"');
    expect(prompt).toContain(
      '색상만으로 오브젝트의 실제 의미를 단정하지 않는다',
    );
  });

  it('선택한 레퍼런스 역할과 마네킹 매핑을 첨부 순서대로 전달한다', () => {
    const prompt = createSceneAssistantPrompt('이 구도로 생성해줘.', {}, [
      {
        id: 'ref-character',
        name: '정민 캐릭터 시트',
        kind: 'character',
        artifactId: 'artifact-character',
        contentHash: `sha256:${'a'.repeat(64)}`,
        mimeType: 'image/png',
        width: 1536,
        height: 2048,
        originalFileName: 'character.png',
        byteLength: 1024,
        createdAt: '2026-08-03T00:00:01.000Z',
        targetObjectId: 'blue-mannequin',
        use: ['face', 'clothing'],
        exclude: ['pose', 'text'],
        enabled: true,
      },
      {
        id: 'ref-layout',
        name: '카메라 레이아웃',
        kind: 'layout',
        artifactId: 'artifact-layout',
        contentHash: `sha256:${'b'.repeat(64)}`,
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
        originalFileName: 'layout.png',
        byteLength: 2048,
        createdAt: '2026-08-03T00:00:02.000Z',
        targetObjectId: null,
        use: ['camera', 'composition'],
        exclude: ['appearance', 'text'],
        enabled: true,
      },
    ]);

    expect(prompt).toContain('[선택 레퍼런스 매니페스트 / 첨부 순서]');
    expect(prompt.indexOf('ref-layout')).toBeLessThan(
      prompt.indexOf('ref-character'),
    );
    expect(prompt).toContain('"targetObjectId":"blue-mannequin"');
    expect(prompt).toContain('"exclude":["pose","text"]');
  });
});

describe('createImageGenerationPrompt', () => {
  it('3D 캡처를 첫 첨부로 고정하고 imagegen을 명시한다', () => {
    const prompt = createImageGenerationPrompt(
      '전경의 전봇대는 아웃포커스해줘.',
      { id: 'scene-1' },
      TEST_LAYOUT_SPEC,
      [
        {
          id: 'ref-background',
          name: '치킨집 배경',
          kind: 'background',
          artifactId: 'artifact-background',
          contentHash: `sha256:${'a'.repeat(64)}`,
          mimeType: 'image/png',
          width: 1920,
          height: 1080,
          originalFileName: 'background.png',
          byteLength: 1024,
          createdAt: '2026-08-03T00:00:00.000Z',
          targetObjectId: null,
          use: ['location'],
          exclude: ['characters'],
          enabled: true,
        },
      ],
    );

    expect(prompt.startsWith('$imagegen')).toBe(true);
    expect(prompt).toContain('첨부 이미지 1은 현재 OutputCamera');
    expect(prompt).toContain(
      '[LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약]',
    );
    expect(prompt).toContain('"targetDistanceMeters":5');
    expect(prompt).toContain('semanticMeaning과 generationNotes');
    expect(prompt).toContain('"attachmentIndex":2');
    expect(prompt).toContain('전경의 전봇대는 아웃포커스해줘.');
  });
});

describe('createImageRefinementPrompt', () => {
  it('기존 키프레임과 3D 캡처 뒤에 레퍼런스를 배치한다', () => {
    const prompt = createImageRefinementPrompt(
      '전봇대가 가리는 비율만 줄여줘.',
      { id: 'scene-1' },
      TEST_LAYOUT_SPEC,
      { id: 'generation-1', versionNumber: 1 },
      [
        {
          id: 'ref-background',
          name: '치킨집 배경',
          kind: 'background',
          artifactId: 'artifact-background',
          contentHash: `sha256:${'a'.repeat(64)}`,
          mimeType: 'image/png',
          width: 1920,
          height: 1080,
          originalFileName: 'background.png',
          byteLength: 1024,
          createdAt: '2026-08-03T00:00:00.000Z',
          targetObjectId: null,
          use: ['location'],
          exclude: ['characters'],
          enabled: true,
        },
      ],
    );

    expect(prompt.startsWith('$imagegen')).toBe(true);
    expect(prompt).toContain('첨부 이미지 1은 보정의 기준');
    expect(prompt).toContain('첨부 이미지 2는 현재 OutputCamera');
    expect(prompt).toContain('한 번의 완성 이미지 재생성');
    expect(prompt).toContain('"attachmentIndex":3');
    expect(prompt).toContain('"id":"generation-1"');
  });
});
