import { useState, type ChangeEvent } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { CompanionBrowserClient } from '../../assistant/companionClient';
import type { RiggedCharacterAsset } from '../../../shared/riggedCharacterAsset';
import {
  analyzeRiggedCharacterGlb,
  getRiggedCharacterDisplayName,
} from '../character/analyzeRiggedCharacterGlb';
import type { AddableSceneObjectKind } from '../persistence/sceneSchema';
import { getNextAssetPosition } from '../scene/sceneObjectModel';
import type { EditorStore } from '../state/editorStore';

interface AssetPanelProps {
  store: StoreApi<EditorStore>;
  companionClient?: CompanionBrowserClient | null;
  onCharacterAssetAvailable?: (asset: RiggedCharacterAsset, file: File) => void;
}

const ASSETS: ReadonlyArray<{
  kind: AddableSceneObjectKind;
  label: string;
}> = [
  { kind: 'cube', label: '큐브' },
  { kind: 'sphere', label: '구' },
  { kind: 'cylinder', label: '원기둥' },
  { kind: 'plane', label: '평면' },
  { kind: 'rounded-cube', label: '라운드 큐브' },
  { kind: 'bent-plane', label: '곡면' },
  { kind: 'triangle', label: '정삼각형' },
  { kind: 'mannequin', label: '마네킹' },
  { kind: 'room', label: '방 세트' },
  { kind: 'character-glb', label: 'Meshy Idle 캐릭터' },
];

export function AssetPanel({
  store,
  companionClient = null,
  onCharacterAssetAvailable,
}: AssetPanelProps) {
  const objects = useStore(store, (state) => state.document.objects);
  const addObject = useStore(store, (state) => state.addObject);
  const [importState, setImportState] = useState<{
    status: 'idle' | 'loading' | 'error' | 'success';
    message: string;
  }>({ status: 'idle', message: '' });
  const canImport = companionClient?.importRiggedCharacter !== undefined;

  const handleCharacterFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (
      file === undefined ||
      companionClient?.importRiggedCharacter === undefined
    )
      return;
    setImportState({ status: 'loading', message: 'GLB를 분석하고 있습니다…' });
    try {
      const analysis = await analyzeRiggedCharacterGlb(file);
      setImportState({
        status: 'loading',
        message: '프로젝트에 저장하고 있습니다…',
      });
      const name = getRiggedCharacterDisplayName(file.name);
      const asset = await companionClient.importRiggedCharacter(
        file,
        name,
        analysis,
      );
      onCharacterAssetAvailable?.(asset, file);
      addObject({
        kind: 'character-glb',
        name,
        position: getNextAssetPosition(objects),
        characterAssetId: asset.id,
        characterAsset: {
          source: 'project',
          label: asset.name,
          originalFileName: asset.originalFileName,
          ...asset.analysis,
        },
        characterAnimation:
          asset.analysis.animation === null
            ? undefined
            : {
                ...asset.analysis.animation,
                timeSeconds: 0,
                playing: false,
              },
      });
      setImportState({
        status: 'success',
        message: `${name} · ${analysis.boneCount}본 · ${analysis.dimensions.y.toFixed(2)}m`,
      });
    } catch (error) {
      setImportState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'GLB 캐릭터를 가져오지 못했습니다.',
      });
    }
  };

  return (
    <section className="asset-panel" aria-labelledby="asset-panel-title">
      <h2 id="asset-panel-title">오브젝트 추가</h2>
      <p className="panel-description">
        장면에 배치할 기본 형태와 캐릭터를 고르세요.
      </p>
      <div className="asset-grid">
        {ASSETS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            aria-label={`${label} 추가`}
            onClick={() => {
              addObject({
                kind,
                position:
                  kind === 'room'
                    ? { x: 0, z: 0 }
                    : getNextAssetPosition(objects),
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label
        className="asset-import-button"
        aria-disabled={!canImport || importState.status === 'loading'}
        title={
          canImport
            ? 'Rodin/Meshy 리깅 GLB 가져오기'
            : '프로젝트 Companion 연결이 필요합니다.'
        }
      >
        리깅 GLB 가져오기
        <input
          type="file"
          accept=".glb,model/gltf-binary"
          disabled={!canImport || importState.status === 'loading'}
          onChange={(event) => void handleCharacterFile(event)}
        />
      </label>
      {importState.status === 'idle' ? null : (
        <p
          className={`asset-import-status asset-import-status--${importState.status}`}
          role={importState.status === 'error' ? 'alert' : 'status'}
        >
          {importState.message}
        </p>
      )}
    </section>
  );
}
