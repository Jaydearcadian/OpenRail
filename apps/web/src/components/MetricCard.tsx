import type { Metric } from "../data/mock";

export function MetricCard({ metric }: { metric: Metric }) {
  return (
    <article className={`metric-card metric-${metric.tone ?? "blue"}${metric.dominant ? " metric-dominant" : ""}`}>
      <div>
        <p>{metric.label}</p>
        <strong>{metric.value}</strong>
      </div>
      <span>{metric.trend}</span>
      <small>{metric.helper}</small>
    </article>
  );
}
