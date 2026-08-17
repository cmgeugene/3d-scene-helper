import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createStarterSceneDocument } from '../editor/persistence/sceneSchema';
import { TEST_LAYOUT_SPEC } from '../../shared/layoutSpecTestFixture';
import type {
  CompanionBrowserClient,
  GenerationRecord,
} from './companionClient';
import {
  KEYFRAME_COMPARISON_STORAGE_KEY,
  KEYFRAME_SELECTION_STORAGE_KEY,
  KeyframeWorkspace,
} from './KeyframeWorkspace';

const connection = {
  version: 1 as const,
  url: 'http://127.0.0.1:61234',
  token: 'a'.repeat(43),
};

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

const reference = {
  id: 'ref-character',
  name: '정민 캐릭터 시트',
  kind: 'character' as const,
  artifactId: 'artifact-reference',
  contentHash: `sha256:${'a'.repeat(64)}`,
  mimeType: 'image/png' as const,
  width: 1024,
  height: 1024,
  originalFileName: 'jeongmin.png',
  byteLength: 100,
  createdAt: '2026-08-03T00:00:00.000Z',
  targetObjectId: 'mannequin-test',
  use: ['face', 'hair', 'clothing'],
  exclude: ['pose'],
  enabled: true,
};

function generation(
  overrides: Partial<GenerationRecord> & Pick<GenerationRecord, 'id'>,
): GenerationRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    threadId: 'thread-1',
    turnId: `turn-${id}`,
    status: 'completed',
    prompt: '$imagegen 저녁 치킨집 장면을 만들어줘.',
    layoutSpec: TEST_LAYOUT_SPEC,
    sceneSnapshot: createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: 'mannequin-test',
    }),
    referenceSnapshots: [reference],
    parentGenerationId: null,
    versionNumber: 1,
    feedback: null,
    refinementDirective: null,
    generationMode: 'fresh',
    layoutRenderId: `render-${overrides.id}`,
    sceneIntegrity: {
      status: 'valid',
      snapshotSceneId: 'scene-test',
      layoutSpecSceneId: 'scene-test',
      layoutRenderSceneId: 'scene-test',
    },
    referenceIds: [reference.id],
    attachments: [
      { type: 'layout', id: `render-${overrides.id}`, kind: 'layout' },
      { type: 'reference', id: reference.id, kind: 'character' },
    ],
    revisedPrompt: 'cinematic chicken restaurant at dusk',
    result: {
      artifactId: `artifact-${overrides.id}`,
      contentHash: `sha256:${'b'.repeat(64)}`,
      mimeType: 'image/png',
      width: 1920,
      height: 1080,
      byteLength: 2048,
    },
    error: null,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:01:00.000Z',
    ...rest,
    semanticSceneSpecSnapshot: rest.semanticSceneSpecSnapshot ?? null,
  };
}

function clientWith(generations: GenerationRecord[]): CompanionBrowserClient {
  return {
    getRuntime: async () => ({
      state: 'ready',
      version: 'codex-test',
      account: { type: 'chatgpt', email: null, planType: 'plus' },
      requiresOpenaiAuth: true,
      error: null,
    }),
    startThread: async () => 'thread-1',
    startTurn: async () => 'turn-1',
    interruptTurn: async () => undefined,
    listReferences: async () => [],
    importReference: async () => {
      throw new Error('not used');
    },
    updateReference: async () => {
      throw new Error('not used');
    },
    loadReferenceBlob: async () => new Blob(),
    createSceneRender: async () => {
      throw new Error('not used');
    },
    loadSceneRenderBlob: async (id) =>
      new Blob([`layout:${id}`], { type: 'image/png' }),
    listGenerations: async () => generations,
    startGeneration: async () => {
      throw new Error('not used');
    },
    loadGenerationBlob: async (id) =>
      new Blob([`result:${id}`], { type: 'image/png' }),
    subscribe: () => () => undefined,
  };
}

describe('KeyframeWorkspace', () => {
  it('부모·형제 결과와 계약 차이를 비교하고 비교 선택을 reload 뒤 복원한다', async () => {
    const user = userEvent.setup();
    const parent = generation({ id: 'generation-parent' });
    const selectedScene = structuredClone(parent.sceneSnapshot!);
    selectedScene.sceneRevision = 2;
    selectedScene.outputCamera.focalLengthMm = 35;
    selectedScene.semanticSceneSpec.intent.mood = '비 오는 긴장된 저녁';
    const selectedLayout = structuredClone(TEST_LAYOUT_SPEC);
    selectedLayout.camera.focalLengthMm = 35;
    const selected = generation({
      id: 'generation-selected',
      parentGenerationId: parent.id,
      versionNumber: 2,
      generationMode: 'edit',
      sceneSnapshot: selectedScene,
      layoutSpec: selectedLayout,
      refinementDirective: {
        version: 1,
        preserve: ['카메라 구도'],
        change: ['표정을 긴장되게 바꿔줘'],
      },
    });
    const sibling = generation({
      id: 'generation-sibling',
      parentGenerationId: parent.id,
      versionNumber: 3,
      generationMode: 'edit',
      refinementDirective: {
        version: 1,
        preserve: ['인물 의상'],
        change: ['배경 조명을 밝게 바꿔줘'],
      },
    });
    const unrelated = generation({ id: 'generation-unrelated' });
    const storage = createMemoryStorage({
      [KEYFRAME_SELECTION_STORAGE_KEY]: selected.id,
      [KEYFRAME_COMPARISON_STORAGE_KEY]: sibling.id,
    });
    let urlSequence = 0;
    const renderWorkspace = () =>
      render(
        <KeyframeWorkspace
          connection={connection}
          storage={storage}
          clientFactory={() =>
            clientWith([parent, selected, sibling, unrelated])
          }
          createObjectUrl={() => `blob:comparison-${++urlSequence}`}
          revokeObjectUrl={() => undefined}
          onRefine={() => undefined}
        />,
      );

    const first = renderWorkspace();
    const select = await screen.findByRole('combobox', {
      name: '비교 대상 generation',
    });
    expect(select).toHaveValue(sibling.id);
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    expect(
      within(select).queryByRole('option', { name: /unrelated/ }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: '선택 generation 비교 결과' }),
    ).toBeVisible();
    expect(
      await screen.findByRole('img', { name: '비교 generation 결과' }),
    ).toBeVisible();
    const comparisonRegion = screen.getByRole('region', {
      name: '부모·형제 generation 비교',
    });
    expect(comparisonRegion).toHaveTextContent('v2 · edit');
    expect(comparisonRegion).toHaveTextContent('v3 · edit');
    expect(comparisonRegion).toHaveTextContent('표정을 긴장되게 바꿔줘');
    expect(comparisonRegion).toHaveTextContent('배경 조명을 밝게 바꿔줘');
    expect(comparisonRegion).toHaveTextContent('SceneDocument · 변경 있음');
    expect(comparisonRegion).toHaveTextContent('LayoutSpec · 변경 있음');

    await user.selectOptions(select, parent.id);
    await waitFor(() =>
      expect(storage.getItem(KEYFRAME_COMPARISON_STORAGE_KEY)).toBe(parent.id),
    );
    await user.selectOptions(select, sibling.id);
    await waitFor(() =>
      expect(storage.getItem(KEYFRAME_COMPARISON_STORAGE_KEY)).toBe(sibling.id),
    );

    first.unmount();
    renderWorkspace();
    expect(
      await screen.findByRole('button', { name: /generation-selected/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      await screen.findByRole('combobox', {
        name: '비교 대상 generation',
      }),
    ).toHaveValue(sibling.id);
  });

  it('계보 밖 비교 저장값은 부모 generation으로 안전하게 복원한다', async () => {
    const parent = generation({ id: 'generation-parent-fallback' });
    const selected = generation({
      id: 'generation-selected-fallback',
      parentGenerationId: parent.id,
      versionNumber: 2,
      generationMode: 'edit',
    });
    const storage = createMemoryStorage({
      [KEYFRAME_SELECTION_STORAGE_KEY]: selected.id,
      [KEYFRAME_COMPARISON_STORAGE_KEY]: 'generation-outside-lineage',
    });

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={storage}
        clientFactory={() => clientWith([parent, selected])}
        createObjectUrl={() => 'blob:fallback'}
        revokeObjectUrl={() => undefined}
        onRefine={() => undefined}
      />,
    );

    expect(
      await screen.findByRole('combobox', {
        name: '비교 대상 generation',
      }),
    ).toHaveValue(parent.id);
    await waitFor(() =>
      expect(storage.getItem(KEYFRAME_COMPARISON_STORAGE_KEY)).toBe(parent.id),
    );
  });

  it('프로젝트 전체 계보를 표시하고 저장된 선택의 결과와 당시 레이아웃을 비교한다', async () => {
    const user = userEvent.setup();
    const parent = generation({ id: 'generation-parent' });
    const child = generation({
      id: 'generation-child',
      status: 'failed',
      result: null,
      parentGenerationId: parent.id,
      versionNumber: 2,
      generationMode: 'edit',
      feedback: '전봇대 가림을 줄여줘.',
      refinementDirective: {
        version: 1,
        preserve: ['카메라 구도', '인물 의상'],
        change: ['전봇대 가림을 줄여줘.'],
      },
      error: '생성이 중단되었습니다.',
    });
    const appliedLayoutFresh = generation({
      id: 'generation-from-applied-layout',
      sourceGenerationId: parent.id,
      versionNumber: 1,
      generationMode: 'fresh',
    });
    const legacy = generation({
      id: 'generation-legacy',
      sceneSnapshot: null,
      layoutSpec: null,
      sceneIntegrity: {
        status: 'legacy',
        snapshotSceneId: null,
        layoutSpecSceneId: null,
        layoutRenderSceneId: 'scene-test',
      },
      referenceSnapshots: [],
    });
    const storage = createMemoryStorage({
      [KEYFRAME_SELECTION_STORAGE_KEY]: parent.id,
    });
    const refine = vi.fn();
    const urls: string[] = [];

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={storage}
        clientFactory={() =>
          clientWith([parent, child, appliedLayoutFresh, legacy])
        }
        createObjectUrl={(blob: Blob) => {
          const url = `blob:${urls.length + 1}:${blob.size}`;
          urls.push(url);
          return url;
        }}
        revokeObjectUrl={() => undefined}
        onRefine={refine}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: '키프레임 작업 공간' }),
    ).toBeVisible();
    const history = screen.getByRole('list', { name: 'Generation 이력' });
    expect(within(history).getAllByRole('button')).toHaveLength(4);
    expect(within(history).getAllByText('완료')).toHaveLength(3);
    expect(within(history).getByText('실패')).toBeVisible();
    expect(within(history).getByText('부모 v1')).toBeVisible();
    expect(within(history).getByText('3D 출처 v1 · fresh root')).toBeVisible();
    expect(within(history).getByText(/자식 1/)).toBeVisible();

    expect(
      await screen.findByRole('img', { name: '선택 generation 결과' }),
    ).toBeVisible();
    expect(
      screen.getByRole('img', { name: '생성 당시 3D 레이아웃' }),
    ).toBeVisible();
    expect(
      screen.getByText('$imagegen 저녁 치킨집 장면을 만들어줘.'),
    ).toBeVisible();
    expect(
      screen.getByText('cinematic chicken restaurant at dusk'),
    ).toBeVisible();
    expect(screen.getByText(/정민 캐릭터 시트/)).toBeVisible();
    await user.click(screen.getByText('LayoutSpec 상세'));
    expect(screen.getByText(/"sceneId": "scene-test"/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: '선택 결과로 보정' }));
    expect(refine).toHaveBeenCalledWith(parent);

    await user.click(
      within(history).getByRole('button', { name: /generation-child/ }),
    );
    expect(screen.getAllByText('카메라 구도 · 인물 의상')[0]).toBeVisible();
    expect(screen.getAllByText('전봇대 가림을 줄여줘.')[0]).toBeVisible();

    await user.click(
      within(history).getByRole('button', { name: /generation-legacy/ }),
    );
    expect(storage.getItem(KEYFRAME_SELECTION_STORAGE_KEY)).toBe(legacy.id);
    expect(
      await screen.findByText('구형 기록 · 3D 장면 복원 제한'),
    ).toBeVisible();
    expect(screen.getByText(/SceneDocument 스냅샷이 없어/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: '생성 당시 3D 씬 미리보기' }),
    ).toBeDisabled();
  });

  it('snapshot을 별도 read-only preview로 열고 현재 씬과 주요 차이를 설명한다', async () => {
    const user = userEvent.setup();
    const selected = generation({ id: 'generation-preview' });
    const snapshot = structuredClone(selected.sceneSnapshot!);
    snapshot.outputCamera = {
      ...snapshot.outputCamera,
      position: { x: 2, y: 2.4, z: -7 },
      target: { x: 0.5, y: 1.2, z: 0 },
      focalLengthMm: 35,
      rollDeg: 3,
    };
    snapshot.output = {
      aspectRatioId: '2.39:1',
      width: 1920,
      height: 804,
      mode: 'reference',
    };
    snapshot.objects[1] = {
      ...snapshot.objects[1]!,
      name: '과거 정민',
      semantic: {
        meaning: '문을 바라보는 주인공',
        generationNotes: '실루엣 유지',
      },
      transform: {
        ...snapshot.objects[1]!.transform,
        position: { x: -1.25, y: 0.85, z: 1.5 },
      },
    };
    selected.sceneSnapshot = snapshot;
    const current = createStarterSceneDocument({
      documentId: 'scene-test',
      floorId: 'floor-test',
      mannequinId: 'mannequin-test',
    });
    current.objects.push({
      ...structuredClone(current.objects[0]!),
      id: 'cube-current',
      kind: 'cube',
      name: '현재 씬 큐브',
      dimensions: { x: 1, y: 1, z: 1 },
      transform: {
        position: { x: 2, y: 0.5, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });
    const renderPreview = vi.fn((document) => (
      <div data-testid="snapshot-preview">
        {document.outputCamera.focalLengthMm}mm
      </div>
    ));

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={createMemoryStorage()}
        currentDocument={current}
        clientFactory={() => clientWith([selected])}
        createObjectUrl={() => 'blob:test'}
        revokeObjectUrl={() => undefined}
        renderScenePreview={renderPreview}
        onRefine={() => undefined}
      />,
    );

    expect(await screen.findByText('현재 씬과 변경 있음')).toBeVisible();
    const differenceItem = (pattern: RegExp) =>
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'LI' && pattern.test(element.textContent ?? ''),
      );
    expect(differenceItem(/카메라.*35mm/)).toBeVisible();
    expect(differenceItem(/출력.*2.39:1.*1920×804/)).toBeVisible();
    expect(differenceItem(/과거 정민.*변형/)).toBeVisible();
    expect(differenceItem(/과거 정민.*의미/)).toBeVisible();
    expect(differenceItem(/현재 씬 큐브.*현재 씬에 추가/)).toBeVisible();

    const previewButton = screen.getByRole('button', {
      name: '생성 당시 3D 씬 미리보기',
    });
    await user.click(previewButton);
    expect(previewButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('snapshot-preview')).toHaveTextContent('35mm');
    expect(renderPreview).toHaveBeenCalledWith(snapshot);
    expect(current.outputCamera.focalLengthMm).toBe(50);
    expect(current.objects).toHaveLength(3);
  });

  it('browser가 scene ID mismatch를 재검증해 preview를 안전하게 막는다', async () => {
    const mismatched = generation({
      id: 'generation-mismatch',
      layoutSpec: { ...TEST_LAYOUT_SPEC, sceneId: 'scene-other' },
      sceneIntegrity: {
        status: 'valid',
        snapshotSceneId: 'scene-test',
        layoutSpecSceneId: 'scene-other',
        layoutRenderSceneId: 'scene-test',
      },
    });

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={createMemoryStorage()}
        currentDocument={mismatched.sceneSnapshot!}
        clientFactory={() => clientWith([mismatched])}
        createObjectUrl={() => 'blob:test'}
        revokeObjectUrl={() => undefined}
        renderScenePreview={() => <div>should not render</div>}
        onRefine={() => undefined}
      />,
    );

    expect(
      await screen.findByRole('alert', { name: '장면 ID 무결성 오류' }),
    ).toHaveTextContent('scene-test');
    expect(screen.getByText(/LayoutSpec.*scene-other/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: '생성 당시 3D 씬 미리보기' }),
    ).toBeDisabled();
    expect(screen.queryByText('should not render')).not.toBeInTheDocument();
  });

  it('현재 씬 불러오기 dialog 취소는 적용 callback과 현재 document를 변경하지 않는다', async () => {
    const user = userEvent.setup();
    const selected = generation({ id: 'generation-apply-cancel' });
    const current = createStarterSceneDocument({
      documentId: 'scene-current',
      floorId: 'floor-current',
      mannequinId: 'mannequin-current',
    });
    const before = JSON.stringify(current);
    const applyScene = vi.fn();

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={createMemoryStorage()}
        currentDocument={current}
        clientFactory={() => clientWith([selected])}
        createObjectUrl={() => 'blob:test'}
        revokeObjectUrl={() => undefined}
        onApplyScene={applyScene}
        onRefine={() => undefined}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: '현재 씬으로 불러오기' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: '현재 씬 덮어쓰기 확인',
    });
    expect(dialog).toHaveTextContent('generation-apply-cancel');
    expect(dialog).toHaveTextContent('v1');
    expect(dialog).toHaveTextContent('장면 ID');
    expect(applyScene).not.toHaveBeenCalled();
    expect(JSON.stringify(current)).toBe(before);

    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(
      screen.queryByRole('dialog', { name: '현재 씬 덮어쓰기 확인' }),
    ).not.toBeInTheDocument();
    expect(applyScene).not.toHaveBeenCalled();
    expect(JSON.stringify(current)).toBe(before);
  });

  it('dialog가 열린 뒤 선택 generation이 바뀌면 stale 적용을 fail-closed로 거부한다', async () => {
    const user = userEvent.setup();
    const first = generation({ id: 'generation-first' });
    const second = generation({ id: 'generation-second', versionNumber: 2 });
    const applyScene = vi.fn();

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={createMemoryStorage()}
        currentDocument={first.sceneSnapshot!}
        clientFactory={() => clientWith([first, second])}
        createObjectUrl={() => 'blob:test'}
        revokeObjectUrl={() => undefined}
        onApplyScene={applyScene}
        onRefine={() => undefined}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: /generation-first/ }),
    );
    await user.click(
      screen.getByRole('button', { name: '현재 씬으로 불러오기' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: '현재 씬 덮어쓰기 확인',
    });
    await user.click(screen.getByRole('button', { name: /generation-second/ }));
    await user.click(
      within(dialog).getByRole('button', { name: '현재 씬으로 적용' }),
    );

    expect(applyScene).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '선택한 generation이 변경되었습니다',
    );
  });

  it('dialog가 열린 뒤 같은 generation의 snapshot 무결성이 바뀌면 확인 시 재검증해 거부한다', async () => {
    const user = userEvent.setup();
    const original = generation({ id: 'generation-integrity-race' });
    let emit: ((event: { event: string; data: unknown }) => void) | undefined;
    const client: CompanionBrowserClient = {
      ...clientWith([original]),
      subscribe: (listener) => {
        emit = listener;
        return () => undefined;
      },
    };
    const applyScene = vi.fn();

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={createMemoryStorage()}
        currentDocument={original.sceneSnapshot!}
        clientFactory={() => client}
        createObjectUrl={() => 'blob:test'}
        revokeObjectUrl={() => undefined}
        onApplyScene={applyScene}
        onRefine={() => undefined}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: '현재 씬으로 불러오기' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: '현재 씬 덮어쓰기 확인',
    });
    const changed = generation({
      id: original.id,
      updatedAt: '2026-08-03T00:05:00.000Z',
      layoutSpec: { ...TEST_LAYOUT_SPEC, sceneId: 'scene-tampered' },
      sceneIntegrity: {
        status: 'mismatch',
        snapshotSceneId: 'scene-test',
        layoutSpecSceneId: 'scene-tampered',
        layoutRenderSceneId: 'scene-test',
      },
    });
    act(() => emit?.({ event: 'generation', data: changed }));
    await user.click(
      within(dialog).getByRole('button', { name: '현재 씬으로 적용' }),
    );

    expect(applyScene).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '무결성을 다시 확인할 수 없습니다',
    );
  });

  it('완료 결과가 아닌 generation에서는 보정 진입과 결과 이미지를 제공하지 않는다', async () => {
    const failed = generation({
      id: 'generation-failed',
      status: 'failed',
      result: null,
      error: 'imagegen 실패',
    });

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={createMemoryStorage()}
        clientFactory={() => clientWith([failed])}
        createObjectUrl={() => 'blob:test'}
        revokeObjectUrl={() => undefined}
        onRefine={() => undefined}
      />,
    );

    expect(await screen.findByText('imagegen 실패')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '선택 결과로 보정' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('img', { name: '선택 generation 결과' }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: '생성 당시 3D 레이아웃' }),
      ).toBeVisible(),
    );
  });

  it('실행 요약의 스냅샷 해시와 실제 첨부 순서 및 검증 오류를 표시한다', async () => {
    const selected = generation({
      id: 'generation-execution-summary',
      executionSummary: {
        version: 1,
        requestId: 'request-execution-summary',
        prompt: { contentHash: `sha256:${'1'.repeat(64)}` },
        sceneDocument: {
          id: 'scene-test',
          sceneRevision: 3,
          specRevision: 2,
          contentHash: `sha256:${'2'.repeat(64)}`,
        },
        semanticSceneSpec: {
          version: 1,
          contentHash: `sha256:${'3'.repeat(64)}`,
        },
        layoutSpec: {
          version: 1,
          sceneId: 'scene-test',
          contentHash: `sha256:${'4'.repeat(64)}`,
        },
        layoutRender: {
          id: 'render-summary',
          sceneId: 'scene-test',
          contentHash: `sha256:${'5'.repeat(64)}`,
        },
        sourceGeneration: {
          id: 'generation-source',
          usage: 'editSource',
          contentHash: `sha256:${'6'.repeat(64)}`,
        },
        references: [
          {
            id: reference.id,
            kind: 'character',
            contentHash: reference.contentHash,
          },
        ],
        attachments: [
          {
            attachmentIndex: 1,
            type: 'sourceGeneration',
            id: 'generation-source',
            kind: null,
            contentHash: `sha256:${'6'.repeat(64)}`,
          },
          {
            attachmentIndex: 2,
            type: 'layout',
            id: 'render-summary',
            kind: 'layout',
            contentHash: `sha256:${'5'.repeat(64)}`,
          },
          {
            attachmentIndex: 3,
            type: 'reference',
            id: reference.id,
            kind: 'character',
            contentHash: reference.contentHash,
          },
        ],
      },
      executionIntegrity: {
        status: 'mismatch',
        issues: ['prompt의 LayoutSpec 입력이 저장 스냅샷과 일치하지 않습니다.'],
      },
    });

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={createMemoryStorage()}
        clientFactory={() => clientWith([selected])}
        createObjectUrl={(blob) => `blob:${blob.size}`}
        revokeObjectUrl={() => undefined}
        onRefine={() => undefined}
      />,
    );

    const heading = await screen.findByRole('heading', {
      name: '재현 가능한 실행 요약',
    });
    const summary = heading.closest('section');
    expect(summary).not.toBeNull();
    expect(
      within(summary!).getByText(/입력 무결성 · 불일치 발견/),
    ).toBeVisible();
    expect(within(summary!).getByText(/scene r3 · spec r2/)).toBeVisible();
    const attachments = within(summary!).getAllByRole('listitem');
    expect(attachments[0]).toHaveTextContent('1 · sourceGeneration');
    expect(attachments[1]).toHaveTextContent('2 · layout');
    expect(attachments[2]).toHaveTextContent('3 · reference');
    expect(within(summary!).getByRole('alert')).toHaveTextContent(
      'prompt의 LayoutSpec 입력이 저장 스냅샷과 일치하지 않습니다.',
    );
  });

  it('이미지 로드 실패를 loading과 구분하고 다른 generation 선택 시 오류를 지운다', async () => {
    const user = userEvent.setup();
    const good = generation({ id: 'generation-good' });
    const bad = generation({ id: 'generation-bad' });
    const client: CompanionBrowserClient = {
      ...clientWith([good, bad]),
      loadSceneRenderBlob: vi.fn(async (renderId) => {
        if (renderId === bad.layoutRenderId) {
          throw new Error('stored layout missing');
        }
        return new Blob(['layout'], { type: 'image/png' });
      }),
    };

    render(
      <KeyframeWorkspace
        connection={connection}
        storage={createMemoryStorage()}
        clientFactory={() => client}
        createObjectUrl={(blob) => `blob:${blob.size}`}
        revokeObjectUrl={() => undefined}
        onRefine={() => undefined}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'stored layout missing',
    );
    expect(
      screen.queryByText('레이아웃 렌더 불러오는 중'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /generation-good/ }));
    expect(
      await screen.findByRole('img', { name: '생성 당시 3D 레이아웃' }),
    ).toBeVisible();
    expect(screen.queryByText('stored layout missing')).not.toBeInTheDocument();
  });
});
