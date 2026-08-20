import { describe, expect, it } from 'vitest';
import {
  createImageGenerationPrompt,
  createImageRefinementPrompt,
  createSceneAssistantPrompt,
  createWebImageGenerationPrompt,
  createWebImageRefinementPrompt,
} from './sceneAssistantPrompt';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';

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
  it('채팅이 아닌 저장된 spec을 안정 순서의 간결한 조건부 블록으로 직렬화한다', () => {
    const scene = createStarterSceneDocument({
      documentId: 'scene-1',
      floorId: 'floor-1',
      mannequinId: 'actor-b',
    });
    scene.objects.push({
      ...scene.objects[1]!,
      id: 'actor-a',
      name: 'Actor A',
    });
    scene.semanticSceneSpec = {
      version: 1,
      intent: {
        location: '한국 노포 야외 치킨집',
        timeOfDay: '해질녘',
        mood: '따뜻한 저녁의 조용한 대화',
        visualStyle: '시네마틱 2D 애니메이션',
      },
      generatedProps: [
        { name: '치킨', placement: '테이블 중앙', importance: '핵심' },
        { name: '맥주', placement: '테이블 오른쪽', importance: '보조' },
      ],
      extras: {
        enabled: true,
        minCount: 5,
        maxCount: 8,
        placement: '출입구와 오른쪽 배경 테이블',
        importance: '주인공보다 낮음',
      },
      relationships: [
        {
          subjectObjectId: 'actor-b',
          targetObjectId: 'actor-a',
          relationship: '친구',
          gaze: '서로 바라봄',
          action: '조용히 대화',
        },
        {
          subjectObjectId: 'actor-a',
          targetObjectId: 'actor-b',
          relationship: '친구',
          gaze: '서로 바라봄',
          action: '듣고 있음',
        },
      ],
      constraints: {
        preserve: ['인물 외형', '카메라 구도'],
        allowChanges: ['배경 디테일'],
      },
    };
    const prompt = createImageGenerationPrompt(scene, TEST_LAYOUT_SPEC, [
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
    ]);

    expect(prompt.startsWith('$imagegen')).toBe(true);
    expect(prompt).toContain('첨부 이미지 1은 현재 OutputCamera');
    expect(prompt).toContain(
      '[LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약]',
    );
    expect(prompt).toContain('"targetDistanceMeters":5');
    expect(prompt).toContain('semanticMeaning과 generationNotes');
    expect(prompt).toContain(
      'proxyVisualization.opacity는 내부 배치를 확인하기 위한 3D 편집 표시값',
    );
    expect(prompt).toContain(
      '최종 표면은 appearanceIntent.surfaceType과 materialNotes만',
    );
    expect(prompt).toContain('containment는 실제 포함 관계');
    expect(prompt).toContain('"attachmentIndex":2');
    expect(prompt).not.toContain('[사용자 연출]');
    expect(prompt).toContain('[장면 의도]');
    expect(prompt).toContain('- 장소: 한국 노포 야외 치킨집');
    expect(prompt).not.toContain('"semanticSceneSpec"');
    expect(prompt.match(/한국 노포 야외 치킨집/gu)).toHaveLength(1);
    expect(prompt.indexOf('- 맥주')).toBeLessThan(prompt.indexOf('- 치킨'));
    expect(prompt).toContain('[엑스트라]\n- 인원: 5~8명');
    expect(prompt.indexOf('- actor-a → actor-b')).toBeLessThan(
      prompt.indexOf('- actor-b → actor-a'),
    );
    expect(prompt).toContain('[필수 유지]\n- 인물 외형\n- 카메라 구도');
    expect(prompt).toContain('[변경 가능]\n- 배경 디테일');
  });

  it('빈 spec 필드는 prompt 블록 자체를 생략한다', () => {
    const scene = createStarterSceneDocument({
      documentId: 'scene-1',
      floorId: 'floor-1',
      mannequinId: 'actor-1',
    });
    const prompt = createImageGenerationPrompt(scene, TEST_LAYOUT_SPEC);

    expect(prompt).not.toContain('[장면 의도]');
    expect(prompt).not.toContain('[생성 전용 소품]');
    expect(prompt).not.toContain('[엑스트라]');
    expect(prompt).not.toContain('[인물/오브젝트 관계]');
    expect(prompt).not.toContain('[필수 유지]');
    expect(prompt).not.toContain('[변경 가능]');
  });
});

describe('createImageRefinementPrompt', () => {
  it('3D 캡처를 최상위 공간 기준으로 두고 기존 키프레임과 레퍼런스를 뒤에 배치한다', () => {
    const prompt = createImageRefinementPrompt(
      {
        version: 1,
        preserve: ['전체 구도', '인물 정체성'],
        change: ['전봇대가 가리는 비율만 줄여줘.'],
      },
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
    expect(prompt).toContain('첨부 이미지 1은 현재 OutputCamera');
    expect(prompt).toContain('최상위 공간 설계도');
    expect(prompt).toContain('첨부 이미지 2는 보정의 기준');
    expect(prompt).toContain('외형 기준으로 사용');
    expect(prompt).toContain('한 번의 완성 이미지 재생성');
    expect(prompt).toContain(
      'proxyVisualization.opacity는 내부 배치를 확인하기 위한 3D 편집 표시값',
    );
    expect(prompt).toContain('containment는 실제 포함 관계');
    expect(prompt).toContain('[보정 지시 / RefinementDirective]');
    expect(prompt).toContain('"preserve":["전체 구도","인물 정체성"]');
    expect(prompt).toContain('"change":["전봇대가 가리는 비율만 줄여줘."]');
    expect(prompt).toContain(
      '두 목록에 없는 외형 요소도 기존 키프레임을 우선 보존',
    );
    expect(prompt).toContain(
      '현재 3D 레이아웃과 LayoutSpec이 항상 최상위 권위',
    );
    expect(prompt).toContain('"attachmentIndex":3');
    expect(prompt).toContain('"id":"generation-1"');
  });
});

describe('GPT 웹용 이미지 프롬프트', () => {
  it('fresh 생성 요청에서 Codex 명령을 제거하고 수동 지시를 포함한다', () => {
    const scene = createStarterSceneDocument({
      documentId: 'scene-web',
      floorId: 'floor-web',
      mannequinId: 'actor-web',
    });
    const prompt = createWebImageGenerationPrompt(
      scene,
      TEST_LAYOUT_SPEC,
      [],
      '비 오는 밤 장면으로 완성해줘.',
    );

    expect(prompt).not.toContain('$imagegen');
    expect(prompt).toContain(
      '[이번 수동 생성 요청]\n비 오는 밤 장면으로 완성해줘.',
    );
    expect(prompt).toContain('첨부 이미지 1은 현재 OutputCamera');
    expect(prompt).toContain(
      '[LayoutSpec / 3D 레이아웃과 최종 키프레임의 변환 계약]',
    );
  });

  it('보정 요청에서 기존 키프레임과 구조화된 변경 지시를 유지한다', () => {
    const prompt = createWebImageRefinementPrompt(
      {
        version: 1,
        preserve: ['전체 구도'],
        change: ['전봇대 가림만 줄이기'],
      },
      { id: 'scene-web-edit' },
      TEST_LAYOUT_SPEC,
      { id: 'generation-web-source', versionNumber: 2 },
    );

    expect(prompt).not.toContain('$imagegen');
    expect(prompt).toContain('첨부 이미지 1은 현재 OutputCamera');
    expect(prompt).toContain('첨부 이미지 2는 보정의 기준');
    expect(prompt).toContain('"change":["전봇대 가림만 줄이기"]');
    expect(prompt).toContain('"id":"generation-web-source"');
  });
});
