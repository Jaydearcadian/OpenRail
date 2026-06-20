import type { StreamStatus } from "../data/mock";

const labels: Record<StreamStatus, string> = {
  active: "Active",
  pending: "Pending",
  settled: "Settled",
  warning: "Buffer low",
};

export function StatusPill({ status }: { status: StreamStatus }) {
  return <span className={`status-pill status-${status}`}>{labels[status]}</span>;
}
