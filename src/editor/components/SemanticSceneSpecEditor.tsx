import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import {
  normalizeSemanticSceneSpec,
  type SemanticSceneSpec,
} from '../persistence/semanticSceneSpec';
import type { EditorStore } from '../state/editorStore';

interface SemanticSceneSpecEditorProps {
  store: StoreApi<EditorStore>;
}

function lines(values: string[]) {
  return values.join('\n');
}

function parseLines(value: string) {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function propsText(spec: SemanticSceneSpec) {
  return spec.generatedProps
    .map(({ name, placement, importance }) =>
      [name, placement, importance].join(' | '),
    )
    .join('\n');
}

function relationshipsText(spec: SemanticSceneSpec) {
  return spec.relationships
    .map(({ subjectObjectId, targetObjectId, relationship, gaze, action }) =>
      [subjectObjectId, targetObjectId, relationship, gaze, action].join(' | '),
    )
    .join('\n');
}

export function SemanticSceneSpecEditor({
  store,
}: SemanticSceneSpecEditorProps) {
  const spec = useStore(store, (state) => state.document.semanticSceneSpec);
  return (
    <SemanticSceneSpecForm
      key={JSON.stringify(spec)}
      store={store}
      spec={spec}
    />
  );
}

function SemanticSceneSpecForm({
  store,
  spec,
}: SemanticSceneSpecEditorProps & { spec: SemanticSceneSpec }) {
  const objects = useStore(store, (state) => state.document.objects);
  const objectIds = useMemo(() => objects.map(({ id }) => id), [objects]);
  const [draft, setDraft] = useState(() => structuredClone(spec));
  const [generatedProps, setGeneratedProps] = useState(() => propsText(spec));
  const [relationships, setRelationships] = useState(() =>
    relationshipsText(spec),
  );
  const [preserve, setPreserve] = useState(() =>
    lines(spec.constraints.preserve),
  );
  const [allowChanges, setAllowChanges] = useState(() =>
    lines(spec.constraints.allowChanges),
  );
  const [error, setError] = useState<string | null>(null);

  const objectIdHint = useMemo(() => objectIds.join(', '), [objectIds]);
  const setIntent = (
    field: keyof SemanticSceneSpec['intent'],
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      intent: { ...current.intent, [field]: value },
    }));
  };
  const setExtras = <Field extends keyof SemanticSceneSpec['extras']>(
    field: Field,
    value: SemanticSceneSpec['extras'][Field],
  ) => {
    setDraft((current) => ({
      ...current,
      extras: { ...current.extras, [field]: value },
    }));
  };

  const apply = () => {
    try {
      const next = normalizeSemanticSceneSpec({
        ...draft,
        generatedProps: parseLines(generatedProps).map((entry) => {
          const [name = '', placement = '', importance = ''] = entry
            .split('|')
            .map((part) => part.trim());
          return { name, placement, importance };
        }),
        relationships: parseLines(relationships).map((entry) => {
          const [
            subjectObjectId = '',
            targetObjectId = '',
            relationship = '',
            gaze = '',
            action = '',
          ] = entry.split('|').map((part) => part.trim());
          return {
            subjectObjectId,
            targetObjectId,
            relationship,
            gaze,
            action,
          };
        }),
        constraints: {
          preserve: parseLines(preserve),
          allowChanges: parseLines(allowChanges),
        },
      });
      store.getState().setSemanticSceneSpec(next);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `장면 명세를 적용하지 못했습니다: ${cause.message}`
          : '장면 명세를 적용하지 못했습니다.',
      );
    }
  };

  return (
    <div className="semantic-spec-editor">
      <p className="semantic-spec-note">
        장면 전체 연출은 여기에서 관리합니다. 오브젝트의 실제 의미와 생성 메모는
        장면 탭의 각 오브젝트가 권위 있는 원본입니다.
      </p>
      <fieldset className="object-controls">
        <legend>장면 의도</legend>
        <label className="object-text-field">
          <span>장소</span>
          <input
            aria-label="장소"
            value={draft.intent.location}
            onChange={(event) =>
              setIntent('location', event.currentTarget.value)
            }
          />
        </label>
        <label className="object-text-field">
          <span>시간대</span>
          <input
            aria-label="시간대"
            value={draft.intent.timeOfDay}
            onChange={(event) =>
              setIntent('timeOfDay', event.currentTarget.value)
            }
          />
        </label>
        <label className="object-text-field">
          <span>분위기</span>
          <input
            aria-label="분위기"
            value={draft.intent.mood}
            onChange={(event) => setIntent('mood', event.currentTarget.value)}
          />
        </label>
        <label className="object-text-field">
          <span>화풍 의도</span>
          <input
            aria-label="화풍 의도"
            value={draft.intent.visualStyle}
            onChange={(event) =>
              setIntent('visualStyle', event.currentTarget.value)
            }
          />
        </label>
      </fieldset>

      <fieldset className="object-controls">
        <legend>생성 전용 요소</legend>
        <label className="object-text-field">
          <span>생성 전용 소품</span>
          <textarea
            aria-label="생성 전용 소품"
            rows={3}
            value={generatedProps}
            placeholder="이름 | 배치 | 중요도 (한 줄에 하나)"
            onChange={(event) => setGeneratedProps(event.currentTarget.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.extras.enabled}
            onChange={(event) =>
              setExtras('enabled', event.currentTarget.checked)
            }
          />
          <span>엑스트라 사용</span>
        </label>
        <div className="semantic-spec-counts">
          <label>
            <span>최소 인원</span>
            <input
              aria-label="엑스트라 최소 인원"
              type="number"
              min={0}
              max={200}
              value={draft.extras.minCount}
              onChange={(event) =>
                setExtras('minCount', Number(event.currentTarget.value))
              }
            />
          </label>
          <label>
            <span>최대 인원</span>
            <input
              aria-label="엑스트라 최대 인원"
              type="number"
              min={0}
              max={200}
              value={draft.extras.maxCount}
              onChange={(event) =>
                setExtras('maxCount', Number(event.currentTarget.value))
              }
            />
          </label>
        </div>
        <label className="object-text-field">
          <span>엑스트라 배치</span>
          <input
            aria-label="엑스트라 배치"
            value={draft.extras.placement}
            onChange={(event) =>
              setExtras('placement', event.currentTarget.value)
            }
          />
        </label>
        <label className="object-text-field">
          <span>엑스트라 중요도</span>
          <input
            aria-label="엑스트라 중요도"
            value={draft.extras.importance}
            onChange={(event) =>
              setExtras('importance', event.currentTarget.value)
            }
          />
        </label>
      </fieldset>

      <fieldset className="object-controls">
        <legend>관계와 제약</legend>
        <label className="object-text-field">
          <span>인물 및 오브젝트 관계</span>
          <textarea
            aria-label="인물 및 오브젝트 관계"
            aria-describedby="semantic-relationship-help"
            rows={3}
            value={relationships}
            placeholder="주체 ID | 대상 ID | 관계 | 시선 | 행동"
            onChange={(event) => setRelationships(event.currentTarget.value)}
          />
        </label>
        <small id="semantic-relationship-help">
          현재 ID: {objectIdHint || '없음'}
        </small>
        <label className="object-text-field">
          <span>필수 유지 요소</span>
          <textarea
            aria-label="필수 유지 요소"
            rows={3}
            value={preserve}
            placeholder="한 줄에 하나"
            onChange={(event) => setPreserve(event.currentTarget.value)}
          />
        </label>
        <label className="object-text-field">
          <span>변경 가능 요소</span>
          <textarea
            aria-label="변경 가능 요소"
            rows={3}
            value={allowChanges}
            placeholder="한 줄에 하나"
            onChange={(event) => setAllowChanges(event.currentTarget.value)}
          />
        </label>
      </fieldset>

      {error === null ? null : (
        <p className="semantic-spec-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" type="button" onClick={apply}>
        장면 명세 적용
      </button>
    </div>
  );
}
