import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  ReferenceArtifact,
  ReferenceMetadataInput,
} from './companionClient';
import { ReferenceManager } from './ReferenceManager';

const connection = {
  version: 1 as const,
  url: 'http://127.0.0.1:61234',
  token: 'a'.repeat(43),
};

const characterReference: ReferenceArtifact = {
  id: 'ref-1',
  name: '정민 캐릭터 시트',
  kind: 'character',
  artifactId: 'artifact-1',
  contentHash: `sha256:${'a'.repeat(64)}`,
  mimeType: 'image/png',
  width: 1536,
  height: 2048,
  originalFileName: 'jeongmin.png',
  byteLength: 1024,
  createdAt: '2026-08-03T00:00:00.000Z',
  targetObjectId: null,
  use: ['face', 'body', 'hair', 'clothing'],
  exclude: ['pose', 'background', 'text'],
  enabled: true,
};

describe('ReferenceManager', () => {
  it('Companion 연결 전에는 가져오기 안내를 표시한다', () => {
    render(<ReferenceManager connection={null} />);

    expect(screen.getByRole('heading', { name: 'References' })).toBeVisible();
    expect(screen.getByText(/Companion 연결 후/)).toBeVisible();
  });

  it('manifest와 썸네일을 불러오고 unmount에서 object URL을 해제한다', async () => {
    const revokeObjectUrl = vi.fn();
    const onSelectionChange = vi.fn();
    const client = {
      listReferences: async () => [characterReference],
      importReference: async () => characterReference,
      loadReferenceBlob: async () => new Blob(['image'], { type: 'image/png' }),
      updateReference: async () => ({ ...characterReference, enabled: false }),
    };
    const rendered = render(
      <ReferenceManager
        connection={connection}
        clientFactory={() => client}
        createObjectUrl={() => 'blob:reference-1'}
        revokeObjectUrl={revokeObjectUrl}
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(await screen.findByText('정민 캐릭터 시트')).toBeVisible();
    expect(screen.getByText('캐릭터 · 1536×2048')).toBeVisible();
    const checkbox = screen.getByRole('checkbox', {
      name: '정민 캐릭터 시트 생성에 포함',
    });
    expect(checkbox).toBeChecked();
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith([characterReference]),
    );
    await userEvent.click(checkbox);
    expect(
      screen.getByRole('checkbox', {
        name: '정민 캐릭터 시트 생성에 포함',
      }),
    ).not.toBeChecked();
    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith([]));

    rendered.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:reference-1');
  });

  it('파일의 이름과 역할을 확인한 뒤 프로젝트에 가져온다', async () => {
    const user = userEvent.setup();
    const importReference = vi.fn(async () => characterReference);
    const client = {
      listReferences: async () => [],
      importReference,
      loadReferenceBlob: async () => new Blob(['image'], { type: 'image/png' }),
      updateReference: async () => characterReference,
    };
    render(
      <ReferenceManager
        connection={connection}
        clientFactory={() => client}
        createObjectUrl={() => 'blob:imported'}
        revokeObjectUrl={() => undefined}
      />,
    );
    const file = new File(['png'], 'jeongmin.png', { type: 'image/png' });

    await user.upload(screen.getByLabelText('이미지 가져오기'), file);
    expect(screen.getByLabelText('이름')).toHaveValue('jeongmin');
    await user.selectOptions(screen.getByLabelText('역할'), 'character');
    await user.clear(screen.getByLabelText('이름'));
    await user.type(screen.getByLabelText('이름'), '정민 캐릭터 시트');
    await user.click(screen.getByRole('button', { name: '프로젝트에 추가' }));

    await waitFor(() =>
      expect(importReference).toHaveBeenCalledWith(
        file,
        '정민 캐릭터 시트',
        'character',
      ),
    );
    expect(await screen.findByText('정민 캐릭터 시트')).toBeVisible();
  });

  it('캐릭터 레퍼런스를 마네킹에 연결하고 사용 범위를 저장한다', async () => {
    const user = userEvent.setup();
    const updateReference = vi.fn(async (_id, metadata) => ({
      ...characterReference,
      ...metadata,
    }));
    const client = {
      listReferences: async () => [characterReference],
      importReference: async () => characterReference,
      loadReferenceBlob: async () => new Blob(['image'], { type: 'image/png' }),
      updateReference,
    };
    render(
      <ReferenceManager
        connection={connection}
        clientFactory={() => client}
        createObjectUrl={() => 'blob:reference-1'}
        revokeObjectUrl={() => undefined}
        targets={[{ id: 'blue-mannequin', name: 'Blue actor' }]}
      />,
    );

    await screen.findByText('정민 캐릭터 시트');
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.selectOptions(
      screen.getByLabelText('연결 대상'),
      'blue-mannequin',
    );
    await user.clear(screen.getByLabelText(/사용 범위/));
    await user.type(screen.getByLabelText(/사용 범위/), 'face, clothing');
    await user.clear(screen.getByLabelText(/제외 범위/));
    await user.type(screen.getByLabelText(/제외 범위/), 'pose, text');
    await user.click(screen.getByRole('button', { name: '설정 저장' }));

    await waitFor(() =>
      expect(updateReference).toHaveBeenCalledWith('ref-1', {
        targetObjectId: 'blue-mannequin',
        use: ['face', 'clothing'],
        exclude: ['pose', 'text'],
        enabled: true,
      }),
    );
    expect(await screen.findByText('연결 · Blue actor')).toBeVisible();
  });

  it('삭제된 object 연결을 표시하고 사용자가 연결을 해제할 수 있다', async () => {
    const user = userEvent.setup();
    const danglingReference = {
      ...characterReference,
      targetObjectId: 'deleted-mannequin',
    };
    const updateReference = vi.fn(async (_id, metadata) => ({
      ...danglingReference,
      ...metadata,
    }));
    const client = {
      listReferences: async () => [danglingReference],
      importReference: async () => danglingReference,
      loadReferenceBlob: async () => new Blob(['image'], { type: 'image/png' }),
      updateReference,
    };
    render(
      <ReferenceManager
        connection={connection}
        clientFactory={() => client}
        createObjectUrl={() => 'blob:reference-1'}
        revokeObjectUrl={() => undefined}
        targets={[{ id: 'current-mannequin', name: 'Current actor' }]}
      />,
    );

    expect(await screen.findByText(/삭제된 object에 연결됨/)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: '연결 · deleted-mannequin' }),
    );
    expect(
      screen.getByRole('option', {
        name: '삭제된 object · deleted-mannequin',
      }),
    ).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('연결 대상'), '');
    await user.click(screen.getByRole('button', { name: '설정 저장' }));

    await waitFor(() =>
      expect(updateReference).toHaveBeenCalledWith('ref-1', {
        targetObjectId: null,
        use: characterReference.use,
        exclude: characterReference.exclude,
        enabled: true,
      }),
    );
    expect(await screen.findByRole('button', { name: '설정' })).toBeVisible();
  });

  it('생성에 사용할 레퍼런스를 최대 네 장으로 제한한다', async () => {
    const user = userEvent.setup();
    const references = Array.from({ length: 5 }, (_, index) => ({
      ...characterReference,
      id: `ref-${index + 1}`,
      artifactId: `artifact-${index + 1}`,
      name: `레퍼런스 ${index + 1}`,
      enabled: false,
    }));
    const updateReference = vi.fn(async (id, metadata) => ({
      ...references.find((reference) => reference.id === id)!,
      ...metadata,
    }));
    const client = {
      listReferences: async () => references,
      importReference: async () => references[0],
      loadReferenceBlob: async () => new Blob(['image'], { type: 'image/png' }),
      updateReference,
    };
    render(
      <ReferenceManager
        connection={connection}
        clientFactory={() => client}
        createObjectUrl={() => 'blob:reference'}
        revokeObjectUrl={() => undefined}
      />,
    );

    await screen.findByText('레퍼런스 1');
    for (let index = 1; index <= 4; index += 1) {
      await user.click(
        screen.getByRole('checkbox', {
          name: `레퍼런스 ${index} 생성에 포함`,
        }),
      );
    }

    expect(screen.getByText('선택 4/4 · 전체 입력 5/5')).toBeVisible();
    expect(
      screen.getByRole('checkbox', { name: '레퍼런스 5 생성에 포함' }),
    ).toBeDisabled();
    expect(updateReference).toHaveBeenCalledTimes(4);
  });

  it('보정 모드에서는 원본과 레이아웃 슬롯을 제외한 세 장만 선택한다', async () => {
    const references = Array.from({ length: 4 }, (_, index) => ({
      ...characterReference,
      id: `edit-ref-${index + 1}`,
      artifactId: `edit-artifact-${index + 1}`,
      name: `보정 레퍼런스 ${index + 1}`,
      enabled: index < 3,
    }));
    const client = {
      listReferences: async () => references,
      importReference: async () => references[0],
      loadReferenceBlob: async () => new Blob(['image'], { type: 'image/png' }),
      updateReference: async (
        id: string,
        metadata: ReferenceMetadataInput,
      ) => ({
        ...references.find((reference) => reference.id === id)!,
        ...metadata,
      }),
    };
    render(
      <ReferenceManager
        connection={connection}
        clientFactory={() => client}
        createObjectUrl={() => 'blob:edit-reference'}
        revokeObjectUrl={() => undefined}
        maximumSelected={3}
        reservedInputImages={2}
      />,
    );

    expect(await screen.findByText('선택 3/3 · 전체 입력 5/5')).toBeVisible();
    expect(
      screen.getByRole('checkbox', {
        name: '보정 레퍼런스 4 생성에 포함',
      }),
    ).toBeDisabled();
  });
});
