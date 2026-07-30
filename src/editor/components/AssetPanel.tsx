export function AssetPanel() {
  return (
    <section className="asset-panel" aria-labelledby="asset-panel-title">
      <h2 id="asset-panel-title">오브젝트 추가</h2>
      <p className="panel-description">장면에 배치할 기본 형태를 고르세요.</p>
      <div className="asset-grid">
        {['큐브', '구', '원기둥', '평면', '마네킹'].map((label) => (
          <button
            key={label}
            type="button"
            aria-label={`${label} 추가`}
            disabled
            title="3D 오브젝트 추가는 S04에서 제공됩니다."
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
