import type { StatusMatrixItem } from "../../types/dashboard";

export function StatusMatrix({ items }: { items: StatusMatrixItem[] }) {
  return (
    <section className="panel status-matrix" aria-labelledby="status-matrix-title">
      <div className="panel-heading compact">
        <span>Integration status</span>
        <h2 id="status-matrix-title">What is projected vs authoritative</h2>
      </div>
      <div className="matrix-list">
        {items.map((item) => (
          <article key={item.label}>
            <span className={`matrix-badge matrix-${item.status}`}>{item.state}</span>
            <strong>{item.label}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
