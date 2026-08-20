import { useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { EditorStore } from '../state/editorStore';

interface OutlinerProps {
  store: StoreApi<EditorStore>;
}

export function Outliner({ store }: OutlinerProps) {
  const objects = useStore(store, (state) => state.document.objects);
  const groups = useStore(store, (state) => state.document.groups);
  const selectedObjectIds = useStore(store, (state) => state.selectedObjectIds);
  const selectedGroupId = useStore(store, (state) => state.selectedGroupId);
  const selectObject = useStore(store, (state) => state.selectObject);
  const toggleObjectSelection = useStore(
    store,
    (state) => state.toggleObjectSelection,
  );
  const selectGroup = useStore(store, (state) => state.selectGroup);
  const createObjectGroup = useStore(store, (state) => state.createObjectGroup);
  const ungroupObjects = useStore(store, (state) => state.ungroupObjects);
  const translateObjectGroup = useStore(
    store,
    (state) => state.translateObjectGroup,
  );
  const setObjectViewportSelectionLocked = useStore(
    store,
    (state) => state.setObjectViewportSelectionLocked,
  );
  const [translation, setTranslation] = useState({ x: '0', y: '0', z: '0' });
  const groupedObjectIds = new Set(
    groups.flatMap((group) => group.memberObjectIds),
  );
  const selectedObjects = objects.filter((object) =>
    selectedObjectIds.includes(object.id),
  );
  const canCreateGroup =
    selectedObjects.length >= 2 &&
    selectedObjects.every(
      (object) => object.kind !== 'floor' && !groupedObjectIds.has(object.id),
    );
  const selectedGroup = groups.find(({ id }) => id === selectedGroupId);

  return (
    <section className="outliner" aria-labelledby="outliner-title">
      <h2 id="outliner-title">장면 목록</h2>
      <div className="outliner-group-actions">
        <span>{selectedObjectIds.length}개 선택</span>
        <button
          type="button"
          disabled={!canCreateGroup}
          onClick={() => {
            createObjectGroup(selectedObjectIds);
          }}
        >
          그룹화
        </button>
      </div>
      <p className="outliner-hint">Ctrl/⌘ 또는 Shift 클릭으로 다중 선택</p>
      {groups.length === 0 ? null : (
        <ul className="outliner-group-list" aria-label="오브젝트 그룹">
          {groups.map((group) => (
            <li key={group.id} className="outliner-group-row">
              <button
                type="button"
                aria-label={`${group.name} 그룹 선택`}
                aria-pressed={selectedGroupId === group.id}
                onClick={() => selectGroup(group.id)}
              >
                {group.name} · {group.memberObjectIds.length}개
              </button>
              <button
                type="button"
                aria-label={`${group.name} 그룹 해제`}
                onClick={() => ungroupObjects(group.id)}
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedGroup === undefined ? null : (
        <fieldset key={selectedGroup.id} className="outliner-group-translate">
          <legend>{selectedGroup.name} 위치 이동</legend>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <label key={axis}>
              {axis.toUpperCase()}
              <input
                type="number"
                step="0.1"
                aria-label={`그룹 이동 ${axis.toUpperCase()}`}
                value={translation[axis]}
                onChange={(event) => {
                  setTranslation((current) => ({
                    ...current,
                    [axis]: event.target.value,
                  }));
                }}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => {
              const delta = {
                x: Number(translation.x),
                y: Number(translation.y),
                z: Number(translation.z),
              };
              if (Object.values(delta).every(Number.isFinite)) {
                translateObjectGroup(selectedGroup.id, delta);
                setTranslation({ x: '0', y: '0', z: '0' });
              }
            }}
          >
            이동 적용
          </button>
          <span>회전·스케일은 아직 지원하지 않습니다.</span>
        </fieldset>
      )}
      <ul className="outliner-list">
        {objects.map((object) => (
          <li key={object.id} className="outliner-row">
            <button
              type="button"
              className="outliner-item"
              aria-label={object.name}
              aria-pressed={selectedObjectIds.includes(object.id)}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                  toggleObjectSelection(object.id);
                  return;
                }
                selectObject(object.id);
              }}
            >
              <span className="object-visibility" aria-hidden="true">
                {object.visible ? '●' : '○'}
              </span>
              <span>{object.name}</span>
            </button>
            <button
              type="button"
              className="outliner-lock"
              aria-label={`${object.name} 뷰포트 선택 잠금`}
              aria-pressed={object.viewportSelectionLocked}
              title={
                object.viewportSelectionLocked
                  ? '뷰포트 선택 잠금 해제'
                  : '뷰포트 선택 잠금'
              }
              onClick={() => {
                setObjectViewportSelectionLocked(
                  object.id,
                  !object.viewportSelectionLocked,
                );
              }}
            >
              <span aria-hidden="true">
                {object.viewportSelectionLocked ? '🔒' : '🔓'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
