import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SceneDocument } from '../editor/persistence/sceneSchema';
import type { CompanionConnection } from './companionConnection';
import {
  CompanionClient,
  type CompanionBrowserClient,
  type GenerationRecord,
} from './companionClient';
import { parseGenerationUpdate } from './generationEvents';
import {
  assessGenerationSceneIntegrity,
  compareSceneDocuments,
} from './sceneSnapshotComparison';

export const KEYFRAME_SELECTION_STORAGE_KEY =
  'i2v.keyframe-workspace.selection.v1';

interface KeyframeWorkspaceProps {
  connection: CompanionConnection | null;
  storage?: Storage;
  clientFactory?: (connection: CompanionConnection) => CompanionBrowserClient;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  currentDocument?: SceneDocument;
  renderScenePreview?: (document: SceneDocument) => ReactNode;
  onRefine: (generation: GenerationRecord) => void;
}

const defaultClientFactory = (connection: CompanionConnection) =>
  new CompanionClient(connection);
const defaultCreateObjectUrl = (blob: Blob) => URL.createObjectURL(blob);
const defaultRevokeObjectUrl = (url: string) => URL.revokeObjectURL(url);

const STATUS_LABELS: Record<GenerationRecord['status'], string> = {
  inProgress: '진행 중',
  completed: '완료',
  failed: '실패',
  interrupted: '중단됨',
};

function readSelection(storage: Storage) {
  try {
    return storage.getItem(KEYFRAME_SELECTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSelection(storage: Storage, generationId: string) {
  try {
    storage.setItem(KEYFRAME_SELECTION_STORAGE_KEY, generationId);
  } catch {
    // Selection persistence is best-effort and must not break browsing.
  }
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}

type ImageLoadState =
  | { generationId: string; status: 'loaded'; url: string }
  | { generationId: string; status: 'error'; message: string };

function errorMessage(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : '저장된 이미지를 불러오지 못했습니다.';
}

export function KeyframeWorkspace({
  connection,
  storage = window.localStorage,
  clientFactory = defaultClientFactory,
  createObjectUrl = defaultCreateObjectUrl,
  revokeObjectUrl = defaultRevokeObjectUrl,
  currentDocument,
  renderScenePreview,
  onRefine,
}: KeyframeWorkspaceProps) {
  const client = useMemo(
    () => (connection === null ? null : clientFactory(connection)),
    [clientFactory, connection],
  );
  const [generations, setGenerations] = useState<GenerationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    readSelection(storage),
  );
  const [isLoading, setIsLoading] = useState(connection !== null);
  const [error, setError] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<ImageLoadState | null>(null);
  const [layoutImage, setLayoutImage] = useState<ImageLoadState | null>(null);
  const [previewGenerationId, setPreviewGenerationId] = useState<string | null>(
    null,
  );
  const resultUrlRef = useRef<string | null>(null);
  const layoutUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (client === null) {
      return undefined;
    }
    const controller = new AbortController();
    void client
      .listGenerations(controller.signal)
      .then((records) => {
        if (controller.signal.aborted) return;
        setGenerations(records);
        setSelectedId((current) => {
          if (current !== null && records.some(({ id }) => id === current)) {
            return current;
          }
          return records.at(-1)?.id ?? null;
        });
        setIsLoading(false);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Generation 이력을 불러오지 못했습니다.',
        );
        setIsLoading(false);
      });
    const unsubscribe = client.subscribe(
      (event) => {
        const update = parseGenerationUpdate(event);
        if (update?.type !== 'record') return;
        setGenerations((current) => {
          const index = current.findIndex(
            ({ id }) => id === update.generation.id,
          );
          if (index < 0) return [...current, update.generation];
          const next = [...current];
          next[index] = update.generation;
          return next;
        });
      },
      (reason) => setError(reason.message),
    );
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [client]);

  const selected =
    generations.find((generation) => generation.id === selectedId) ?? null;
  const sceneIntegrity =
    selected === null ? null : assessGenerationSceneIntegrity(selected);
  const sceneComparison =
    selected?.sceneSnapshot === null ||
    selected?.sceneSnapshot === undefined ||
    currentDocument === undefined ||
    sceneIntegrity?.status !== 'valid'
      ? null
      : compareSceneDocuments(currentDocument, selected.sceneSnapshot);
  const previewEnabled =
    selected?.sceneSnapshot !== null &&
    selected?.sceneSnapshot !== undefined &&
    sceneIntegrity?.status === 'valid';
  const previewOpen = selected?.id === previewGenerationId && previewEnabled;
  const currentResultImage =
    resultImage?.generationId === selected?.id ? resultImage : null;
  const currentLayoutImage =
    layoutImage?.generationId === selected?.id ? layoutImage : null;
  const resultUrl =
    currentResultImage?.status === 'loaded' ? currentResultImage.url : null;
  const layoutUrl =
    currentLayoutImage?.status === 'loaded' ? currentLayoutImage.url : null;

  useEffect(() => {
    if (selected === null) return;
    storeSelection(storage, selected.id);
  }, [selected, storage]);

  useEffect(() => {
    const previousResultUrl = resultUrlRef.current;
    const previousLayoutUrl = layoutUrlRef.current;
    resultUrlRef.current = null;
    layoutUrlRef.current = null;
    if (previousResultUrl !== null) revokeObjectUrl(previousResultUrl);
    if (previousLayoutUrl !== null) revokeObjectUrl(previousLayoutUrl);
    if (client === null || selected === null) return undefined;

    const controller = new AbortController();
    const loadLayout = async () => {
      const blob = await client.loadSceneRenderBlob(
        selected.layoutRenderId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = createObjectUrl(blob);
      layoutUrlRef.current = url;
      setLayoutImage({ generationId: selected.id, status: 'loaded', url });
    };
    const loadResult = async () => {
      if (selected.result === null) return;
      const blob = await client.loadGenerationBlob(
        selected.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = createObjectUrl(blob);
      resultUrlRef.current = url;
      setResultImage({ generationId: selected.id, status: 'loaded', url });
    };
    void loadLayout().catch((reason) => {
      if (controller.signal.aborted) return;
      setLayoutImage({
        generationId: selected.id,
        status: 'error',
        message: errorMessage(reason),
      });
    });
    void loadResult().catch((reason) => {
      if (controller.signal.aborted) return;
      setResultImage({
        generationId: selected.id,
        status: 'error',
        message: errorMessage(reason),
      });
    });
    return () => controller.abort();
  }, [client, createObjectUrl, revokeObjectUrl, selected]);

  useEffect(
    () => () => {
      if (resultUrlRef.current !== null) revokeObjectUrl(resultUrlRef.current);
      if (layoutUrlRef.current !== null) revokeObjectUrl(layoutUrlRef.current);
    },
    [revokeObjectUrl],
  );

  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const generation of generations) {
      if (generation.parentGenerationId === null) continue;
      counts.set(
        generation.parentGenerationId,
        (counts.get(generation.parentGenerationId) ?? 0) + 1,
      );
    }
    return counts;
  }, [generations]);
  const byId = useMemo(
    () => new Map(generations.map((generation) => [generation.id, generation])),
    [generations],
  );

  return (
    <section className="keyframe-workspace" aria-labelledby="keyframe-title">
      <header className="keyframe-workspace-heading">
        <div>
          <p className="eyebrow">Project generations</p>
          <h2 id="keyframe-title">키프레임 작업 공간</h2>
        </div>
        <span>{generations.length} generations</span>
      </header>

      {connection === null ? (
        <p className="keyframe-workspace-empty">
          Companion에 연결하면 프로젝트의 키프레임 이력을 볼 수 있습니다.
        </p>
      ) : isLoading ? (
        <p className="keyframe-workspace-empty" role="status">
          Generation 이력을 불러오고 있습니다.
        </p>
      ) : error !== null && generations.length === 0 ? (
        <p className="keyframe-workspace-error" role="alert">
          {error}
        </p>
      ) : generations.length === 0 ? (
        <p className="keyframe-workspace-empty">
          아직 프로젝트에 저장된 generation이 없습니다.
        </p>
      ) : (
        <div className="keyframe-workspace-grid">
          <aside className="generation-history" aria-label="Generation 탐색">
            <h3>Generation 이력</h3>
            <ul aria-label="Generation 이력">
              {generations.map((generation) => {
                const parent =
                  generation.parentGenerationId === null
                    ? null
                    : byId.get(generation.parentGenerationId);
                const childCount = childCounts.get(generation.id) ?? 0;
                return (
                  <li key={generation.id}>
                    <button
                      type="button"
                      aria-pressed={generation.id === selected?.id}
                      aria-label={`${generation.id} · v${generation.versionNumber} · ${STATUS_LABELS[generation.status]}`}
                      onClick={() => {
                        setSelectedId(generation.id);
                        setPreviewGenerationId(null);
                      }}
                    >
                      <span className="generation-history-primary">
                        <strong>v{generation.versionNumber}</strong>
                        <span>{STATUS_LABELS[generation.status]}</span>
                        <span>
                          {generation.generationMode === 'fresh'
                            ? '새 생성'
                            : '보정'}
                        </span>
                      </span>
                      <span className="generation-history-lineage">
                        {parent === null || parent === undefined
                          ? generation.parentGenerationId === null
                            ? '루트 generation'
                            : '부모 기록 없음'
                          : `부모 v${parent.versionNumber}`}
                        {childCount === 0 ? '' : ` · 자식 ${childCount}`}
                      </span>
                      <span>{formatTimestamp(generation.updatedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {selected === null ? null : (
            <article
              className="generation-detail"
              aria-label="선택 Generation 상세"
            >
              <header className="generation-detail-heading">
                <div>
                  <p>
                    v{selected.versionNumber} · {STATUS_LABELS[selected.status]}{' '}
                    · {selected.generationMode === 'fresh' ? 'fresh' : 'edit'}
                  </p>
                  <h3>{selected.id}</h3>
                </div>
                {selected.status === 'completed' && selected.result !== null ? (
                  <button type="button" onClick={() => onRefine(selected)}>
                    선택 결과로 보정
                  </button>
                ) : null}
              </header>

              {selected.sceneSnapshot === null ? (
                <div className="generation-restore-limit" role="status">
                  <strong>구형 기록 · 3D 장면 복원 제한</strong>
                  <span>
                    SceneDocument 스냅샷이 없어 당시 3D 장면을 편집기에 복원할
                    수 없습니다. 저장된 이미지와 레이아웃 렌더 비교는
                    가능합니다.
                  </span>
                </div>
              ) : null}

              {sceneIntegrity?.status !== 'mismatch' ? null : (
                <div
                  className="generation-integrity-error"
                  role="alert"
                  aria-label="장면 ID 무결성 오류"
                >
                  <strong>장면 ID 무결성 오류</strong>
                  <span>
                    저장된 3D 장면과 생성 당시 레이아웃의 출처가 일치하지 않아
                    미리보기를 열지 않았습니다.
                  </span>
                  <ul>
                    <li>
                      SceneSnapshot · {sceneIntegrity.snapshotSceneId ?? '없음'}
                    </li>
                    <li>
                      LayoutSpec · {sceneIntegrity.layoutSpecSceneId ?? '없음'}
                    </li>
                    <li>
                      Layout render ·{' '}
                      {sceneIntegrity.layoutRenderSceneId ?? '없음'}
                    </li>
                  </ul>
                </div>
              )}

              <section
                className="scene-snapshot-inspector"
                aria-labelledby="scene-snapshot-title"
              >
                <header>
                  <div>
                    <h4 id="scene-snapshot-title">생성 당시 3D 씬</h4>
                    <span>
                      {sceneComparison === null
                        ? selected.sceneSnapshot === null
                          ? '스냅샷 없음'
                          : sceneIntegrity?.status === 'mismatch'
                            ? '무결성 확인 필요'
                            : '현재 씬 비교 불가'
                        : sceneComparison.changed
                          ? '현재 씬과 변경 있음'
                          : '현재 씬과 동일'}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-pressed={previewOpen}
                    disabled={!previewEnabled}
                    onClick={() =>
                      setPreviewGenerationId((current) =>
                        current === selected.id ? null : selected.id,
                      )
                    }
                  >
                    생성 당시 3D 씬 미리보기
                  </button>
                </header>
                {sceneComparison === null ? null : sceneComparison.differences
                    .length === 0 ? (
                  <p>카메라, 출력 설정과 장면 오브젝트가 현재 씬과 같습니다.</p>
                ) : (
                  <ul className="scene-snapshot-differences">
                    {sceneComparison.differences.map((difference) => (
                      <li key={difference.id}>
                        <strong>{difference.label}</strong> ·{' '}
                        {difference.detail}
                      </li>
                    ))}
                  </ul>
                )}
                {!previewOpen ||
                selected.sceneSnapshot === null ||
                renderScenePreview === undefined
                  ? null
                  : renderScenePreview(selected.sceneSnapshot)}
              </section>

              {error === null ? null : (
                <p className="keyframe-workspace-error" role="alert">
                  {error}
                </p>
              )}

              <div
                className="generation-comparison"
                aria-label="Generation 이미지 비교"
              >
                <figure>
                  <figcaption>선택 generation 결과</figcaption>
                  {resultUrl === null ? (
                    <div
                      className="generation-image-placeholder"
                      role={
                        currentResultImage?.status === 'error'
                          ? 'alert'
                          : undefined
                      }
                    >
                      {currentResultImage?.status === 'error'
                        ? `결과 이미지 불러오기 실패 · ${currentResultImage.message}`
                        : selected.result === null
                          ? '저장된 결과 이미지 없음'
                          : '결과 이미지 불러오는 중'}
                    </div>
                  ) : (
                    <img src={resultUrl} alt="선택 generation 결과" />
                  )}
                </figure>
                <figure>
                  <figcaption>생성 당시 3D 레이아웃</figcaption>
                  {layoutUrl === null ? (
                    <div
                      className="generation-image-placeholder"
                      role={
                        currentLayoutImage?.status === 'error'
                          ? 'alert'
                          : undefined
                      }
                    >
                      {currentLayoutImage?.status === 'error'
                        ? `레이아웃 렌더 불러오기 실패 · ${currentLayoutImage.message}`
                        : '레이아웃 렌더 불러오는 중'}
                    </div>
                  ) : (
                    <img src={layoutUrl} alt="생성 당시 3D 레이아웃" />
                  )}
                </figure>
              </div>

              {selected.error === null ? null : (
                <p className="generation-record-error" role="alert">
                  {selected.error}
                </p>
              )}

              <div className="generation-metadata">
                <section>
                  <h4>생성 지시</h4>
                  <p>{selected.prompt}</p>
                </section>
                <section>
                  <h4>피드백</h4>
                  <p>
                    {selected.feedback ?? 'fresh generation · 별도 피드백 없음'}
                  </p>
                </section>
                <section>
                  <h4>생성 모델의 수정 프롬프트</h4>
                  <p>{selected.revisedPrompt ?? '기록 없음'}</p>
                </section>
                <section>
                  <h4>레퍼런스 스냅샷</h4>
                  {selected.referenceSnapshots.length === 0 ? (
                    <p>저장된 레퍼런스 스냅샷 없음</p>
                  ) : (
                    <ul>
                      {selected.referenceSnapshots.map((reference) => (
                        <li key={reference.id}>
                          {reference.name} · {reference.kind}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <details>
                  <summary>LayoutSpec 상세</summary>
                  <pre>
                    {selected.layoutSpec === null
                      ? '구형 기록에는 LayoutSpec 스냅샷이 없습니다.'
                      : JSON.stringify(selected.layoutSpec, null, 2)}
                  </pre>
                </details>
              </div>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
