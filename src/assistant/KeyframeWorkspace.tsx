import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  sceneDocumentSchema,
  type SceneDocument,
} from '../editor/persistence/sceneSchema';
import type { CompanionConnection } from './companionConnection';
import {
  CompanionClient,
  type CompanionBrowserClient,
  type GenerationRecord,
} from './companionClient';
import { parseGenerationUpdate } from './generationEvents';
import {
  compareGenerationVersions,
  getGenerationComparisonCandidates,
  type GenerationSnapshotComparison,
} from './generationComparison';
import {
  assessGenerationSceneIntegrity,
  compareSceneDocuments,
} from './sceneSnapshotComparison';
import {
  KEYFRAME_COMPARISON_STORAGE_KEY,
  KEYFRAME_SELECTION_STORAGE_KEY,
} from './keyframeStorage';

export {
  KEYFRAME_COMPARISON_STORAGE_KEY,
  KEYFRAME_SELECTION_STORAGE_KEY,
} from './keyframeStorage';

interface KeyframeWorkspaceProps {
  connection: CompanionConnection | null;
  storage?: Storage;
  clientFactory?: (connection: CompanionConnection) => CompanionBrowserClient;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  currentDocument?: SceneDocument;
  renderScenePreview?: (document: SceneDocument) => ReactNode;
  onApplyScene?: (generation: GenerationRecord) => void;
  onRefine: (generation: GenerationRecord) => void;
}

const defaultClientFactory = (connection: CompanionConnection) =>
  new CompanionClient(connection);
const defaultCreateObjectUrl = (blob: Blob) => URL.createObjectURL(blob);
const defaultRevokeObjectUrl = (url: string) => URL.revokeObjectURL(url);

function revokeAfterRender(
  revokeObjectUrl: (url: string) => void,
  url: string,
) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => revokeObjectUrl(url)),
    );
    return;
  }
  setTimeout(() => revokeObjectUrl(url), 32);
}

const STATUS_LABELS: Record<GenerationRecord['status'], string> = {
  inProgress: '진행 중',
  completed: '완료',
  failed: '실패',
  interrupted: '중단됨',
};

const EXECUTION_INTEGRITY_LABELS = {
  valid: '검증 통과',
  legacy: '구형 기록',
  mismatch: '불일치 발견',
} as const;

function readSelection(storage: Storage) {
  try {
    return storage.getItem(KEYFRAME_SELECTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readComparison(storage: Storage) {
  try {
    return storage.getItem(KEYFRAME_COMPARISON_STORAGE_KEY);
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

function storeComparison(storage: Storage, generationId: string) {
  try {
    storage.setItem(KEYFRAME_COMPARISON_STORAGE_KEY, generationId);
  } catch {
    // Comparison persistence is best-effort and must not break browsing.
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

const COMPARISON_STATUS_LABELS: Record<
  GenerationSnapshotComparison['status'],
  string
> = {
  same: '동일',
  changed: '변경 있음',
  unavailable: '비교 자료 없음',
  mismatch: '장면 ID 다름',
};

function directiveItems(
  directive: GenerationRecord['refinementDirective'],
  field: 'preserve' | 'change',
) {
  if (directive === null) {
    return field === 'preserve' ? '구조화 지시 없음' : 'fresh 또는 구형 기록';
  }
  const items = directive[field];
  return items.length === 0 ? '명시 항목 없음' : items.join(' · ');
}

function GenerationThumbnail({
  client,
  generation,
  createObjectUrl,
  revokeObjectUrl,
}: {
  client: CompanionBrowserClient | null;
  generation: GenerationRecord;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
}) {
  const [thumbnail, setThumbnail] = useState<
    | { hash: string; status: 'loaded'; url: string }
    | { hash: string; status: 'error' }
    | null
  >(null);
  const thumbnailHash = generation.result?.thumbnail?.contentHash ?? null;
  const currentThumbnail = thumbnail?.hash === thumbnailHash ? thumbnail : null;

  useEffect(() => {
    let ownedUrl: string | null = null;
    const controller = new AbortController();
    if (
      client === null ||
      thumbnailHash === null ||
      client.loadGenerationThumbnailBlob === undefined
    ) {
      return () => controller.abort();
    }
    void client
      .loadGenerationThumbnailBlob(generation.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        ownedUrl = createObjectUrl(blob);
        setThumbnail({
          hash: thumbnailHash,
          status: 'loaded',
          url: ownedUrl,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setThumbnail({ hash: thumbnailHash, status: 'error' });
        }
      });
    return () => {
      controller.abort();
      if (ownedUrl !== null) revokeObjectUrl(ownedUrl);
    };
  }, [client, createObjectUrl, generation.id, revokeObjectUrl, thumbnailHash]);

  if (currentThumbnail?.status === 'loaded') {
    return (
      <img
        className="generation-history-thumbnail"
        src={currentThumbnail.url}
        alt={`${generation.id} generation thumbnail`}
        width={generation.result?.thumbnail?.width}
        height={generation.result?.thumbnail?.height}
      />
    );
  }
  return (
    <span
      className="generation-history-thumbnail-placeholder"
      aria-hidden="true"
    >
      {currentThumbnail?.status === 'error' ? '!' : ''}
    </span>
  );
}

const HISTORY_PAGE_SIZE = 24;

export function KeyframeWorkspace({
  connection,
  storage = window.localStorage,
  clientFactory = defaultClientFactory,
  createObjectUrl = defaultCreateObjectUrl,
  revokeObjectUrl = defaultRevokeObjectUrl,
  currentDocument,
  renderScenePreview,
  onApplyScene,
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
  const [comparisonId, setComparisonId] = useState<string | null>(() =>
    readComparison(storage),
  );
  const [historyPage, setHistoryPage] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(connection !== null);
  const [error, setError] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<ImageLoadState | null>(null);
  const [layoutImage, setLayoutImage] = useState<ImageLoadState | null>(null);
  const [comparisonResultImage, setComparisonResultImage] =
    useState<ImageLoadState | null>(null);
  const [previewGenerationId, setPreviewGenerationId] = useState<string | null>(
    null,
  );
  const [pendingApply, setPendingApply] = useState<GenerationRecord | null>(
    null,
  );
  const [applyError, setApplyError] = useState<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const layoutUrlRef = useRef<string | null>(null);
  const comparisonResultUrlRef = useRef<string | null>(null);
  const applyInFlightRef = useRef(false);

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
  const selectedIndex = generations.findIndex(({ id }) => id === selectedId);
  const targetIndex =
    selectedIndex < 0 ? Math.max(0, generations.length - 1) : selectedIndex;
  const automaticHistoryPage = Math.floor(
    Math.max(0, generations.length - 1 - targetIndex) / HISTORY_PAGE_SIZE,
  );
  const historyPageCount = Math.max(
    1,
    Math.ceil(generations.length / HISTORY_PAGE_SIZE),
  );
  const boundedHistoryPage = Math.min(
    historyPage ?? automaticHistoryPage,
    historyPageCount - 1,
  );
  const historyPageEnd =
    generations.length - boundedHistoryPage * HISTORY_PAGE_SIZE;
  const visibleGenerations = generations.slice(
    Math.max(0, historyPageEnd - HISTORY_PAGE_SIZE),
    historyPageEnd,
  );
  const comparisonCandidates = useMemo(
    () =>
      selected === null
        ? []
        : getGenerationComparisonCandidates(selected, generations),
    [generations, selected],
  );
  const comparisonCandidate =
    comparisonCandidates.find(
      ({ generation }) => generation.id === comparisonId,
    ) ??
    comparisonCandidates[0] ??
    null;
  const comparison = comparisonCandidate?.generation ?? null;
  const versionComparison =
    selected === null || comparison === null
      ? null
      : compareGenerationVersions(selected, comparison);
  const sceneIntegrity =
    selected === null ? null : assessGenerationSceneIntegrity(selected);
  const sceneComparison =
    selected?.sceneSnapshot === null ||
    selected?.sceneSnapshot === undefined ||
    currentDocument === undefined ||
    sceneIntegrity?.status !== 'valid'
      ? null
      : compareSceneDocuments(currentDocument, selected.sceneSnapshot);
  const pendingSceneComparison =
    pendingApply?.sceneSnapshot === null ||
    pendingApply?.sceneSnapshot === undefined ||
    currentDocument === undefined ||
    assessGenerationSceneIntegrity(pendingApply).status !== 'valid'
      ? null
      : compareSceneDocuments(currentDocument, pendingApply.sceneSnapshot);
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
  const currentComparisonResultImage =
    comparisonResultImage?.generationId === comparison?.id
      ? comparisonResultImage
      : null;
  const comparisonResultUrl =
    currentComparisonResultImage?.status === 'loaded'
      ? currentComparisonResultImage.url
      : null;

  useEffect(() => {
    if (selected === null) return;
    storeSelection(storage, selected.id);
  }, [selected, storage]);

  useEffect(() => {
    if (comparison === null) return;
    storeComparison(storage, comparison.id);
  }, [comparison, storage]);

  useEffect(() => {
    const previousResultUrl = resultUrlRef.current;
    const previousLayoutUrl = layoutUrlRef.current;
    resultUrlRef.current = null;
    layoutUrlRef.current = null;
    if (previousResultUrl !== null) {
      revokeAfterRender(revokeObjectUrl, previousResultUrl);
    }
    if (previousLayoutUrl !== null) {
      revokeAfterRender(revokeObjectUrl, previousLayoutUrl);
    }
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

  useEffect(() => {
    const previousUrl = comparisonResultUrlRef.current;
    comparisonResultUrlRef.current = null;
    if (previousUrl !== null) revokeAfterRender(revokeObjectUrl, previousUrl);
    if (client === null || comparison === null || comparison.result === null) {
      return undefined;
    }

    const controller = new AbortController();
    void client
      .loadGenerationBlob(comparison.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        const url = createObjectUrl(blob);
        comparisonResultUrlRef.current = url;
        setComparisonResultImage({
          generationId: comparison.id,
          status: 'loaded',
          url,
        });
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setComparisonResultImage({
          generationId: comparison.id,
          status: 'error',
          message: errorMessage(reason),
        });
      });
    return () => controller.abort();
  }, [client, comparison, createObjectUrl, revokeObjectUrl]);

  useEffect(
    () => () => {
      if (resultUrlRef.current !== null) revokeObjectUrl(resultUrlRef.current);
      if (layoutUrlRef.current !== null) revokeObjectUrl(layoutUrlRef.current);
      if (comparisonResultUrlRef.current !== null) {
        revokeObjectUrl(comparisonResultUrlRef.current);
      }
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
              {visibleGenerations.map((generation) => {
                const parent =
                  generation.parentGenerationId === null
                    ? null
                    : byId.get(generation.parentGenerationId);
                const childCount = childCounts.get(generation.id) ?? 0;
                const source =
                  generation.sourceGenerationId === undefined ||
                  generation.sourceGenerationId === null
                    ? null
                    : byId.get(generation.sourceGenerationId);
                return (
                  <li key={generation.id}>
                    <button
                      type="button"
                      aria-pressed={generation.id === selected?.id}
                      aria-label={`${generation.id} · v${generation.versionNumber} · ${STATUS_LABELS[generation.status]}`}
                      onClick={() => {
                        setSelectedId(generation.id);
                        setHistoryPage(null);
                        setPreviewGenerationId(null);
                      }}
                    >
                      <GenerationThumbnail
                        client={client}
                        generation={generation}
                        createObjectUrl={createObjectUrl}
                        revokeObjectUrl={revokeObjectUrl}
                      />
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
                        {generation.sourceGenerationId !== undefined &&
                        generation.sourceGenerationId !== null
                          ? source === null || source === undefined
                            ? '3D 출처 기록 없음 · fresh root'
                            : `3D 출처 v${source.versionNumber} · fresh root`
                          : parent === null || parent === undefined
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
            {historyPageCount > 1 ? (
              <nav
                className="generation-history-pagination"
                aria-label="Generation 페이지"
              >
                <button
                  type="button"
                  aria-label="이전 generation 페이지"
                  disabled={boundedHistoryPage >= historyPageCount - 1}
                  onClick={() =>
                    setHistoryPage(
                      Math.min(historyPageCount - 1, boundedHistoryPage + 1),
                    )
                  }
                >
                  이전
                </button>
                <span>
                  {historyPageCount - boundedHistoryPage} / {historyPageCount}
                </span>
                <button
                  type="button"
                  aria-label="다음 generation 페이지"
                  disabled={boundedHistoryPage === 0}
                  onClick={() =>
                    setHistoryPage(Math.max(0, boundedHistoryPage - 1))
                  }
                >
                  다음
                </button>
              </nav>
            ) : null}
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
                  {onApplyScene === undefined ? null : (
                    <button
                      type="button"
                      disabled={!previewEnabled}
                      onClick={() => {
                        applyInFlightRef.current = false;
                        setApplyError(null);
                        setPendingApply(selected);
                      }}
                    >
                      현재 씬으로 불러오기
                    </button>
                  )}
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

              <section
                className="generation-version-comparison"
                aria-labelledby="generation-version-comparison-title"
              >
                <header>
                  <div>
                    <h4 id="generation-version-comparison-title">
                      부모·형제 generation 비교
                    </h4>
                    <span>
                      결과와 생성 계약 스냅샷을 같은 두 버전으로 비교합니다.
                    </span>
                  </div>
                  {comparison === null ? null : (
                    <label>
                      비교 대상
                      <select
                        aria-label="비교 대상 generation"
                        value={comparison.id}
                        onChange={(event) =>
                          setComparisonId(event.currentTarget.value)
                        }
                      >
                        {comparisonCandidates.map(
                          ({ generation, relation }) => (
                            <option key={generation.id} value={generation.id}>
                              {relation === 'parent' ? '부모' : '형제'} · v
                              {generation.versionNumber} · {generation.id}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  )}
                </header>
                {comparison === null || versionComparison === null ? (
                  <p className="generation-version-empty">
                    비교 가능한 부모·형제 generation이 없습니다.
                  </p>
                ) : (
                  <>
                    <div className="generation-version-images">
                      <figure>
                        <figcaption>
                          선택 · v{selected.versionNumber} ·{' '}
                          {selected.generationMode}
                        </figcaption>
                        {resultUrl === null ? (
                          <div className="generation-image-placeholder">
                            {selected.result === null
                              ? '저장된 결과 이미지 없음'
                              : '결과 이미지 불러오는 중'}
                          </div>
                        ) : (
                          <img
                            src={resultUrl}
                            alt="선택 generation 비교 결과"
                          />
                        )}
                      </figure>
                      <figure>
                        <figcaption>
                          {comparisonCandidate.relation === 'parent'
                            ? '부모'
                            : '형제'}{' '}
                          · v{comparison.versionNumber} ·{' '}
                          {comparison.generationMode}
                        </figcaption>
                        {comparisonResultUrl === null ? (
                          <div
                            className="generation-image-placeholder"
                            role={
                              currentComparisonResultImage?.status === 'error'
                                ? 'alert'
                                : undefined
                            }
                          >
                            {currentComparisonResultImage?.status === 'error'
                              ? `비교 결과 불러오기 실패 · ${currentComparisonResultImage.message}`
                              : comparison.result === null
                                ? '저장된 결과 이미지 없음'
                                : '비교 결과 불러오는 중'}
                          </div>
                        ) : (
                          <img
                            src={comparisonResultUrl}
                            alt="비교 generation 결과"
                          />
                        )}
                      </figure>
                    </div>

                    <div className="generation-version-facts">
                      <section>
                        <h5>선택 generation</h5>
                        <p>
                          v{selected.versionNumber} · {selected.generationMode}{' '}
                          · {STATUS_LABELS[selected.status]}
                        </p>
                        <p>
                          parent {selected.parentGenerationId ?? '없음'} ·
                          source {selected.sourceGenerationId ?? '없음'}
                        </p>
                      </section>
                      <section>
                        <h5>비교 generation</h5>
                        <p>
                          v{comparison.versionNumber} ·{' '}
                          {comparison.generationMode} ·{' '}
                          {STATUS_LABELS[comparison.status]}
                        </p>
                        <p>
                          parent {comparison.parentGenerationId ?? '없음'} ·
                          source {comparison.sourceGenerationId ?? '없음'}
                        </p>
                      </section>
                    </div>

                    <div className="generation-version-directives">
                      <section>
                        <h5>선택 RefinementDirective</h5>
                        <dl>
                          <div>
                            <dt>유지</dt>
                            <dd>
                              {directiveItems(
                                selected.refinementDirective,
                                'preserve',
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>변경</dt>
                            <dd>
                              {directiveItems(
                                selected.refinementDirective,
                                'change',
                              )}
                            </dd>
                          </div>
                        </dl>
                      </section>
                      <section>
                        <h5>비교 RefinementDirective</h5>
                        <dl>
                          <div>
                            <dt>유지</dt>
                            <dd>
                              {directiveItems(
                                comparison.refinementDirective,
                                'preserve',
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>변경</dt>
                            <dd>
                              {directiveItems(
                                comparison.refinementDirective,
                                'change',
                              )}
                            </dd>
                          </div>
                        </dl>
                      </section>
                    </div>
                    <p className="generation-version-directive-status">
                      RefinementDirective ·{' '}
                      {versionComparison.directiveChanged
                        ? '변경 있음'
                        : '동일'}
                    </p>

                    <div className="generation-version-differences">
                      {(
                        [
                          ['SceneDocument', versionComparison.scene],
                          ['LayoutSpec', versionComparison.layout],
                        ] as const
                      ).map(([label, comparisonResult]) => (
                        <section key={label}>
                          <h5>
                            {label} ·{' '}
                            {COMPARISON_STATUS_LABELS[comparisonResult.status]}
                          </h5>
                          {comparisonResult.differences.length === 0 ? (
                            <p>두 generation의 저장 스냅샷이 같습니다.</p>
                          ) : (
                            <ul>
                              {comparisonResult.differences.map((item) => (
                                <li key={item.id}>
                                  <strong>{item.label}</strong> · {item.detail}
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      ))}
                    </div>
                  </>
                )}
              </section>

              {selected.error === null ? null : (
                <p className="generation-record-error" role="alert">
                  {selected.error}
                </p>
              )}

              <div
                className="generation-metadata"
                role="region"
                aria-label="선택 Generation 메타데이터"
              >
                <section>
                  <h4>생성 지시</h4>
                  <p>{selected.prompt}</p>
                </section>
                <section>
                  <h4>보정 지시</h4>
                  {selected.refinementDirective === null ? (
                    <p>
                      {selected.feedback ??
                        'fresh generation · 별도 보정 지시 없음'}
                    </p>
                  ) : (
                    <dl className="generation-refinement-directive">
                      <div>
                        <dt>유지</dt>
                        <dd>
                          {selected.refinementDirective.preserve.length === 0
                            ? '명시 항목 없음'
                            : selected.refinementDirective.preserve.join(' · ')}
                        </dd>
                      </div>
                      <div>
                        <dt>변경</dt>
                        <dd>
                          {selected.refinementDirective.change.join(' · ')}
                        </dd>
                      </div>
                    </dl>
                  )}
                </section>
                <section>
                  <h4>생성 모델의 수정 프롬프트</h4>
                  <p>{selected.revisedPrompt ?? '기록 없음'}</p>
                </section>
                <section>
                  <h4>Generation 요청 상태</h4>
                  <p>
                    request ID · {selected.requestId ?? '구형 기록 · 없음'}
                    {' · '}
                    {STATUS_LABELS[selected.status]}
                  </p>
                </section>
                <section className="generation-execution-summary">
                  <h4>재현 가능한 실행 요약</h4>
                  {selected.executionSummary == null ? (
                    <p>구형 기록 · 저장된 실행 요약 없음</p>
                  ) : (
                    <>
                      <p>
                        입력 무결성 ·{' '}
                        {selected.executionIntegrity === undefined
                          ? '검증 정보 없음'
                          : EXECUTION_INTEGRITY_LABELS[
                              selected.executionIntegrity.status
                            ]}
                      </p>
                      <dl className="generation-execution-hashes">
                        <div>
                          <dt>prompt</dt>
                          <dd>
                            {selected.executionSummary.prompt.contentHash}
                          </dd>
                        </div>
                        <div>
                          <dt>SceneDocument</dt>
                          <dd>
                            {selected.executionSummary.sceneDocument.id} · scene
                            r
                            {
                              selected.executionSummary.sceneDocument
                                .sceneRevision
                            }{' '}
                            · spec r
                            {
                              selected.executionSummary.sceneDocument
                                .specRevision
                            }{' '}
                            ·{' '}
                            {
                              selected.executionSummary.sceneDocument
                                .contentHash
                            }
                          </dd>
                        </div>
                        <div>
                          <dt>Semantic Scene Spec</dt>
                          <dd>
                            v
                            {
                              selected.executionSummary.semanticSceneSpec
                                .version
                            }{' '}
                            ·{' '}
                            {
                              selected.executionSummary.semanticSceneSpec
                                .contentHash
                            }
                          </dd>
                        </div>
                        <div>
                          <dt>LayoutSpec</dt>
                          <dd>
                            {selected.executionSummary.layoutSpec.sceneId} · v
                            {selected.executionSummary.layoutSpec.version} ·{' '}
                            {selected.executionSummary.layoutSpec.contentHash}
                          </dd>
                        </div>
                        <div>
                          <dt>레이아웃 렌더</dt>
                          <dd>
                            {selected.executionSummary.layoutRender.id} ·{' '}
                            {selected.executionSummary.layoutRender.contentHash}
                          </dd>
                        </div>
                        <div>
                          <dt>원본 키프레임</dt>
                          <dd>
                            {selected.executionSummary.sourceGeneration === null
                              ? '없음'
                              : `${selected.executionSummary.sourceGeneration.id} · ${selected.executionSummary.sourceGeneration.usage} · ${selected.executionSummary.sourceGeneration.contentHash ?? '결과 해시 없음'}`}
                          </dd>
                        </div>
                      </dl>
                      <h5>실제 첨부 순서</h5>
                      <ol>
                        {selected.executionSummary.attachments.map(
                          (attachment) => (
                            <li
                              key={`${attachment.attachmentIndex}-${attachment.type}-${attachment.id}`}
                            >
                              {attachment.attachmentIndex} · {attachment.type} ·{' '}
                              {attachment.id} ·{' '}
                              {attachment.contentHash ?? '해시 없음'}
                            </li>
                          ),
                        )}
                      </ol>
                      <h5>레퍼런스</h5>
                      {selected.executionSummary.references.length === 0 ? (
                        <p>첨부 레퍼런스 없음</p>
                      ) : (
                        <ul>
                          {selected.executionSummary.references.map(
                            (reference) => (
                              <li key={reference.id}>
                                {reference.id} · {reference.kind} ·{' '}
                                {reference.contentHash}
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                      {selected.executionIntegrity?.issues.length ? (
                        <ul
                          className="generation-execution-issues"
                          role="alert"
                        >
                          {selected.executionIntegrity.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
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
      {pendingApply === null ? null : (
        <div
          className="generation-apply-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="generation-apply-dialog-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              applyInFlightRef.current = false;
              setPendingApply(null);
              setApplyError(null);
              return;
            }
            if (event.key !== 'Tab') return;
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
              ),
            ];
            if (controls.length === 0) return;
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
        >
          <div className="generation-apply-dialog-card">
            <h3 id="generation-apply-dialog-title">현재 씬 덮어쓰기 확인</h3>
            <p>
              v{pendingApply.versionNumber} · {pendingApply.id}의 생성 당시 3D
              씬으로 현재 편집 내용을 덮어씁니다.
            </p>
            {pendingSceneComparison?.differences.length === 0 ? (
              <p>현재 씬과 주요 차이가 없습니다.</p>
            ) : (
              <ul>
                {pendingSceneComparison?.differences
                  .slice(0, 6)
                  .map((difference) => (
                    <li key={difference.id}>
                      <strong>{difference.label}</strong> · {difference.detail}
                    </li>
                  ))}
              </ul>
            )}
            {applyError === null ? null : <p role="alert">{applyError}</p>}
            <div>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  applyInFlightRef.current = false;
                  setPendingApply(null);
                  setApplyError(null);
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  if (applyInFlightRef.current) return;
                  if (selected?.id !== pendingApply.id) {
                    setApplyError(
                      '선택한 generation이 변경되었습니다. 다시 선택하고 확인해 주세요.',
                    );
                    return;
                  }
                  const currentIntegrity =
                    assessGenerationSceneIntegrity(selected);
                  if (
                    currentIntegrity.status !== 'valid' ||
                    selected.sceneSnapshot === null ||
                    !sceneDocumentSchema.safeParse(selected.sceneSnapshot)
                      .success
                  ) {
                    setApplyError(
                      '선택한 generation의 snapshot 무결성을 다시 확인할 수 없습니다. 현재 씬은 변경하지 않았습니다.',
                    );
                    return;
                  }
                  if (
                    JSON.stringify(selected) !== JSON.stringify(pendingApply)
                  ) {
                    setApplyError(
                      '선택한 generation 기록이 변경되었습니다. 다시 선택하고 확인해 주세요.',
                    );
                    return;
                  }
                  applyInFlightRef.current = true;
                  try {
                    onApplyScene?.(selected);
                    setPendingApply(null);
                  } catch (reason) {
                    applyInFlightRef.current = false;
                    setApplyError(
                      reason instanceof Error
                        ? reason.message
                        : '3D 씬을 적용하지 못했습니다.',
                    );
                  }
                }}
              >
                현재 씬으로 적용
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
