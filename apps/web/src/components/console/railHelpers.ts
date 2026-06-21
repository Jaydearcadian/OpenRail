import type { Stream } from "../../data/mock";

export function streamBadge(status: Stream["status"]): string {
  if (status === "active") return "b-stream";
  if (status === "settled") return "b-settled";
  if (status === "warning") return "b-err";
  return "b-mock";
}

export function progressPct(stream: Stream): number {
  const accrued = parseFloat(stream.accrued);
  const remaining = parseFloat(stream.remaining);
  if (Number.isNaN(accrued) || Number.isNaN(remaining)) return stream.status === "settled" ? 100 : 0;
  const total = accrued + remaining;
  if (total <= 0) return stream.status === "settled" ? 100 : 0;
  return Math.min(100, Math.round((accrued / total) * 100));
}

export type SurfaceStatus = "loading" | "ready" | "error";
