import type { LiveDashboardData } from "../../data/showcase";
import { streamBadge, progressPct, type SurfaceStatus } from "./railHelpers";

interface OverviewProps {
  live: LiveDashboardData | null;
  status: SurfaceStatus;
  error: string | null;
  search: string;
  onSelectRail: (id: string) => void;
}

const PROOF_STEPS = [
  { state: "done", label: "intent · envelope signed" },
  { state: "done", label: "channel · paycard opened" },
  { state: "now", label: "accruing · lazy · gateway estimate" },
  { state: "", label: "stn-delta · earned + residual" },
  { state: "", label: "receipt · terminal settlement" },
];

export function Overview({ live, status, error, search, onSelectRail }: OverviewProps) {
  const metrics = (live?.metrics ?? []).slice(0, 4);
  const query = search.trim().toLowerCase();
  const streams = (live?.streams ?? []).filter(
    (s) => !query || [s.label, s.id, s.type, s.counterparty].some((f) => f.toLowerCase().includes(query)),
  );
  const matrix = live?.statusMatrix ?? [];

  return (
    <>
      <div className="stat-row">
        {metrics.length > 0
          ? metrics.map((m) => (
              <div className="stat" key={m.label}>
                <div className="l">{m.label}</div>
                <div className="v">{m.value}</div>
                <div className="d">{m.trend}</div>
              </div>
            ))
          : (
            <div className="stat"><div className="l">worker</div><div className="v">{status === "loading" ? "…" : error ? "error" : "—"}</div><div className="d">{error ?? "loading live data"}</div></div>
          )}
      </div>

      <div className="cols">
        <div className="panel">
          <div className="ph"><h3>⇄ active rails</h3></div>
          <table className="dt">
            <thead><tr><th>id</th><th>type</th><th>status</th><th>progress</th><th className="num">accrued</th></tr></thead>
            <tbody>
              {streams.length === 0 ? (
                <tr className="static"><td colSpan={5} className="dt-empty">{status === "loading" ? "loading…" : error ? error : "no live streams"}</td></tr>
              ) : streams.map((s) => (
                <tr key={s.id} onClick={() => onSelectRail(s.id)}>
                  <td className="id">{s.id}</td>
                  <td className="mut">{s.type}</td>
                  <td><span className={`badge ${streamBadge(s.status)}`}>{s.status}</span></td>
                  <td><span className="barmini"><i style={{ width: `${progressPct(s)}%` }} /></span></td>
                  <td className="num">{s.accrued}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="col">
          <div className="panel">
            <div className="ph"><h3>◷ proof trail</h3></div>
            <div>
              {PROOF_STEPS.map((p) => (
                <div key={p.label} className={`pline ${p.state}`}>
                  <span className="pnode">{p.state === "done" ? "✓" : p.state === "now" ? "◷" : ""}</span>
                  {p.label}
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="ph"><h3>⚖ trust boundary</h3></div>
            <div>
              {matrix.map((item) => (
                <div className="acc" key={item.label}>
                  <div className="t">
                    <span className="nm">{item.label}</span>
                    <span className={`badge ${item.status === "ready" ? "b-proven" : item.status === "blocked" ? "b-err" : "b-mock"}`}>{item.state}</span>
                  </div>
                  <div className="desc">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
