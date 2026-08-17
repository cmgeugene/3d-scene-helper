import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import type { CompanionConnection } from './companionConnection';
import {
  CompanionClient,
  type CompanionBrowserClient,
  type ReferenceArtifact,
  type ReferenceKind,
  type ReferenceMetadataInput,
} from './companionClient';
import {
  FRESH_GENERATION_MAX_REFERENCES,
  IMAGEGEN_MAX_INPUT_IMAGES,
} from '../../shared/imageInputBudget';

type ReferenceClient = Pick<
  CompanionBrowserClient,
  'listReferences' | 'importReference' | 'loadReferenceBlob' | 'updateReference'
>;

export interface ReferenceTarget {
  id: string;
  name: string;
}

interface ReferenceManagerProps {
  connection: CompanionConnection | null;
  clientFactory?: (connection: CompanionConnection) => ReferenceClient;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  targets?: ReferenceTarget[];
  maximumSelected?: number;
  reservedInputImages?: number;
  onSelectionChange?: (references: ReferenceArtifact[]) => void;
}

interface ConnectedReferenceManagerProps {
  connection: CompanionConnection;
  clientFactory: (connection: CompanionConnection) => ReferenceClient;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  targets: ReferenceTarget[];
  maximumSelected: number;
  reservedInputImages: number;
  onSelectionChange: (references: ReferenceArtifact[]) => void;
}

interface ReferenceCard extends ReferenceArtifact {
  thumbnailUrl: string;
}

const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  layout: '레이아웃',
  background: '배경',
  character: '캐릭터',
  style: '스타일',
};

const defaultClientFactory = (connection: CompanionConnection) =>
  new CompanionClient(connection);
const defaultCreateObjectUrl = (blob: Blob) => URL.createObjectURL(blob);
const defaultRevokeObjectUrl = (url: string) => URL.revokeObjectURL(url);
const ignoreSelectionChange = () => undefined;

function parseScopeList(value: string) {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function defaultReferenceName(file: File) {
  return file.name.replace(/\.[^.]+$/, '').slice(0, 120) || '새 레퍼런스';
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function ConnectedReferenceManager({
  connection,
  clientFactory,
  createObjectUrl,
  revokeObjectUrl,
  targets,
  maximumSelected,
  reservedInputImages,
  onSelectionChange,
}: ConnectedReferenceManagerProps) {
  const client = useMemo(
    () => clientFactory(connection),
    [clientFactory, connection],
  );
  const [references, setReferences] = useState<ReferenceCard[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [pendingKind, setPendingKind] = useState<ReferenceKind>('background');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetObjectId, setTargetObjectId] = useState('');
  const [useScope, setUseScope] = useState('');
  const [excludeScope, setExcludeScope] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrls = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedCount = references.filter(({ enabled }) => enabled).length;
  const selectionAtLimit = selectedCount >= maximumSelected;

  const loadCard = useCallback(
    async (reference: ReferenceArtifact, signal?: AbortSignal) => {
      const blob = await client.loadReferenceBlob(reference.id, signal);
      const thumbnailUrl = createObjectUrl(blob);
      objectUrls.current.add(thumbnailUrl);
      return { ...reference, thumbnailUrl };
    },
    [client, createObjectUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    void client
      .listReferences(controller.signal)
      .then((items) =>
        Promise.all(items.map((item) => loadCard(item, controller.signal))),
      )
      .then((cards) => {
        if (controller.signal.aborted) return;
        setReferences(cards);
        setLoading(false);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : '레퍼런스를 불러오지 못했습니다.',
        );
        setLoading(false);
      });

    const currentObjectUrls = objectUrls.current;
    return () => {
      controller.abort();
      for (const url of currentObjectUrls) revokeObjectUrl(url);
      currentObjectUrls.clear();
    };
  }, [client, loadCard, revokeObjectUrl]);

  useEffect(() => {
    onSelectionChange(
      references
        .filter(({ enabled }) => enabled)
        .map(({ thumbnailUrl, ...reference }) => {
          void thumbnailUrl;
          return reference;
        }),
    );
  }, [onSelectionChange, references]);

  const chooseFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file === null) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('레퍼런스 이미지는 25MB 이하여야 합니다.');
      event.target.value = '';
      return;
    }
    setPendingFile(file);
    setPendingName(defaultReferenceName(file));
    setError(null);
  }, []);

  const cancelImport = useCallback(() => {
    setPendingFile(null);
    setPendingName('');
    if (inputRef.current !== null) inputRef.current.value = '';
  }, []);

  const importReference = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (pendingFile === null || pendingName.trim() === '' || importing)
        return;
      setImporting(true);
      setError(null);
      try {
        const imported = await client.importReference(
          pendingFile,
          pendingName.trim(),
          pendingKind,
        );
        const card = await loadCard(imported);
        setReferences((current) => [...current, card]);
        cancelImport();
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : '레퍼런스를 가져오지 못했습니다.',
        );
      } finally {
        setImporting(false);
      }
    },
    [
      cancelImport,
      client,
      importing,
      loadCard,
      pendingFile,
      pendingKind,
      pendingName,
    ],
  );

  const updateCard = useCallback((updated: ReferenceArtifact) => {
    setReferences((current) =>
      current.map((reference) =>
        reference.id === updated.id
          ? { ...updated, thumbnailUrl: reference.thumbnailUrl }
          : reference,
      ),
    );
  }, []);

  const toggleSelection = useCallback(
    async (reference: ReferenceCard) => {
      const nextEnabled = !reference.enabled;
      setError(null);
      if (nextEnabled && selectionAtLimit) {
        setError(
          `현재 생성 구성에서는 레퍼런스를 최대 ${maximumSelected}장까지 선택할 수 있습니다.`,
        );
        return;
      }
      setReferences((current) =>
        current.map((item) =>
          item.id === reference.id ? { ...item, enabled: nextEnabled } : item,
        ),
      );
      try {
        const updated = await client.updateReference(reference.id, {
          targetObjectId: reference.targetObjectId,
          use: reference.use,
          exclude: reference.exclude,
          enabled: nextEnabled,
        });
        updateCard(updated);
      } catch (reason) {
        setReferences((current) =>
          current.map((item) =>
            item.id === reference.id
              ? { ...item, enabled: reference.enabled }
              : item,
          ),
        );
        setError(
          reason instanceof Error
            ? reason.message
            : '레퍼런스 선택을 저장하지 못했습니다.',
        );
      }
    },
    [client, maximumSelected, selectionAtLimit, updateCard],
  );

  const beginEditing = useCallback((reference: ReferenceCard) => {
    setEditingId(reference.id);
    setTargetObjectId(reference.targetObjectId ?? '');
    setUseScope(reference.use.join(', '));
    setExcludeScope(reference.exclude.join(', '));
    setError(null);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveMetadata = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const reference = references.find(({ id }) => id === editingId);
      if (reference === undefined || saving) return;
      const metadata: ReferenceMetadataInput = {
        targetObjectId:
          reference.kind === 'character' && targetObjectId !== ''
            ? targetObjectId
            : null,
        use: parseScopeList(useScope),
        exclude: parseScopeList(excludeScope),
        enabled: reference.enabled,
      };
      setSaving(true);
      setError(null);
      try {
        updateCard(await client.updateReference(reference.id, metadata));
        setEditingId(null);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : '레퍼런스 설정을 저장하지 못했습니다.',
        );
      } finally {
        setSaving(false);
      }
    },
    [
      client,
      editingId,
      excludeScope,
      references,
      saving,
      targetObjectId,
      updateCard,
      useScope,
    ],
  );

  return (
    <section className="reference-manager" aria-labelledby="references-title">
      <div className="reference-manager-heading">
        <div>
          <p className="eyebrow">Project assets</p>
          <h2 id="references-title">References</h2>
          <p
            id="reference-selection-budget"
            className="reference-selection-count"
            role="status"
          >
            선택 {selectedCount}/{maximumSelected} · 전체 입력{' '}
            {selectedCount + reservedInputImages}/{IMAGEGEN_MAX_INPUT_IMAGES}
          </p>
        </div>
        <label className="reference-import-button">
          이미지 가져오기
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={chooseFile}
          />
        </label>
      </div>

      {pendingFile === null ? null : (
        <form className="reference-import-form" onSubmit={importReference}>
          <label>
            <span>이름</span>
            <input
              value={pendingName}
              maxLength={120}
              onChange={(event) => setPendingName(event.target.value)}
            />
          </label>
          <label>
            <span>역할</span>
            <select
              value={pendingKind}
              onChange={(event) =>
                setPendingKind(event.target.value as ReferenceKind)
              }
            >
              {Object.entries(REFERENCE_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={importing || pendingName.trim() === ''}
          >
            {importing ? '가져오는 중…' : '프로젝트에 추가'}
          </button>
          <button type="button" onClick={cancelImport} disabled={importing}>
            취소
          </button>
        </form>
      )}

      {editingId === null ? null : (
        <form className="reference-metadata-form" onSubmit={saveMetadata}>
          <label>
            <span>연결 대상</span>
            <select
              value={targetObjectId}
              disabled={
                references.find(({ id }) => id === editingId)?.kind !==
                'character'
              }
              onChange={(event) => setTargetObjectId(event.target.value)}
            >
              <option value="">장면 전체 / 연결 안 함</option>
              {targetObjectId !== '' &&
              !targets.some(({ id }) => id === targetObjectId) ? (
                <option value={targetObjectId} disabled>
                  삭제된 object · {targetObjectId}
                </option>
              ) : null}
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>사용 범위 · 쉼표 구분</span>
            <input
              value={useScope}
              onChange={(event) => setUseScope(event.target.value)}
            />
          </label>
          <label>
            <span>제외 범위 · 쉼표 구분</span>
            <input
              value={excludeScope}
              onChange={(event) => setExcludeScope(event.target.value)}
            />
          </label>
          <div className="reference-metadata-actions">
            <button type="submit" disabled={saving}>
              {saving ? '저장 중…' : '설정 저장'}
            </button>
            <button type="button" onClick={cancelEditing} disabled={saving}>
              취소
            </button>
          </div>
        </form>
      )}

      {error === null ? null : (
        <p className="reference-error" role="alert">
          {error}
        </p>
      )}

      {selectedCount <= maximumSelected ? null : (
        <p className="reference-error" role="alert">
          현재 모드에서는 {selectedCount - maximumSelected}장을 더 해제해야
          합니다.
        </p>
      )}

      <div className="reference-list">
        {loading ? <p className="reference-empty">불러오는 중…</p> : null}
        {!loading && references.length === 0 ? (
          <p className="reference-empty">
            배경, 캐릭터, 레이아웃 또는 스타일 이미지를 추가하세요.
          </p>
        ) : null}
        {references.map((reference) => (
          <article
            key={reference.id}
            className={`reference-card${reference.enabled ? ' reference-card--selected' : ''}`}
          >
            <label className="reference-card-select">
              <input
                type="checkbox"
                checked={reference.enabled}
                disabled={!reference.enabled && selectionAtLimit}
                onChange={() => void toggleSelection(reference)}
                aria-label={`${reference.name} 생성에 포함`}
                aria-describedby="reference-selection-budget"
                title={
                  !reference.enabled && selectionAtLimit
                    ? `레퍼런스는 최대 ${maximumSelected}장까지 선택할 수 있습니다.`
                    : undefined
                }
              />
              <img src={reference.thumbnailUrl} alt="" />
              <span className="reference-card-copy">
                <strong>{reference.name}</strong>
                <span>
                  {REFERENCE_KIND_LABELS[reference.kind]} ·{' '}
                  {reference.width === null || reference.height === null
                    ? formatBytes(reference.byteLength)
                    : `${reference.width}×${reference.height}`}
                </span>
              </span>
            </label>
            <button type="button" onClick={() => beginEditing(reference)}>
              {reference.targetObjectId === null
                ? '설정'
                : `연결 · ${targets.find(({ id }) => id === reference.targetObjectId)?.name ?? reference.targetObjectId}`}
            </button>
            {reference.targetObjectId !== null &&
            !targets.some(({ id }) => id === reference.targetObjectId) ? (
              <span className="reference-integrity-warning" role="alert">
                삭제된 object에 연결됨 · 설정에서 연결을 해제하세요.
              </span>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function ReferenceManager({
  connection,
  clientFactory = defaultClientFactory,
  createObjectUrl = defaultCreateObjectUrl,
  revokeObjectUrl = defaultRevokeObjectUrl,
  targets = [],
  maximumSelected = FRESH_GENERATION_MAX_REFERENCES,
  reservedInputImages = 1,
  onSelectionChange = ignoreSelectionChange,
}: ReferenceManagerProps) {
  useEffect(() => {
    if (connection === null) onSelectionChange([]);
  }, [connection, onSelectionChange]);

  if (connection === null) {
    return (
      <section className="reference-manager" aria-labelledby="references-title">
        <div className="reference-manager-heading">
          <div>
            <p className="eyebrow">Project assets</p>
            <h2 id="references-title">References</h2>
          </div>
        </div>
        <p className="reference-empty">
          Companion 연결 후 프로젝트 레퍼런스를 가져올 수 있습니다.
        </p>
      </section>
    );
  }

  return (
    <ConnectedReferenceManager
      key={connection.url}
      connection={connection}
      clientFactory={clientFactory}
      createObjectUrl={createObjectUrl}
      revokeObjectUrl={revokeObjectUrl}
      targets={targets}
      maximumSelected={maximumSelected}
      reservedInputImages={reservedInputImages}
      onSelectionChange={onSelectionChange}
    />
  );
}
