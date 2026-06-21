import type { LiveDashboardData } from "../../data/showcase";
import { streamBadge, progressPct, type SurfaceStatus } from "./railHelpers";

interface RailsPanelProps {
  live: LiveDashboardData | null;
  status: SurfaceStatus;
  error: string | null;
  search: string;
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function RailsPanel({ live, status, error, search, selectedId, onSelect }: RailsPanelProps) {
  const query = search.trim().toLowerCase();
  const streams = (live?.streams ?? []).filter(
    (s) => !query || [s.label, s.id, s.type, s.counterparty].some((f) => f.toLowerCase().includes(query)),
  );
  const detail = (live?.streamDetails ?? []).find((d) => d.id === selectedId) ?? (live?.streamDetails ?? [])[0];

  return (
    <div className="cols">
      <div className="panel">
        <div className="ph"><h3>⇄ all rails</h3></div>
        <table className="dt">
          <thead><tr><th>id</th><th>type</th><th>status</th><th>progress</th><th className="num">accrued</th><th className="num">remaining</th></tr></thead>
          <tbody>
            {streams.length === 0 ? (
              <tr className="static"><td colSpan={6} className="dt-empty">{status === "loading" ? "loading…" : error ? error : "no live streams"}</td></tr>
            ) : streams.map((s) => (
              <tr key={s.id} className={selectedId === s.id ? "" : ""} onClick={() => onSelect(s.id)}>
                <td className="id">{s.id}</td>
                <td className="mut">{s.type}</td>
                <td><span className={`badge ${streamBadge(s.status)}`}>{s.status}</span></td>
                <td><span className="barmini"><i style={{ width: `${progressPct(s)}%` }} /></span></td>
                <td className="num">{s.accrued}</td>
                <td className="num mut">{s.remaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="col">
        <div className="stream-card">
          {detail ? (
            <>
              <div className="l">projected accrued · gateway estimate</div>
              <div className="big">{detail.accrued}</div>
              <div className="rate">{detail.rate} · capital-bounded</div>
              <div className="strack"><i style={{ width: `${progressPct(detail)}%` }} /></div>
              <div className="smeta">
                <div><div className="l2">remaining</div><div className="v2">{detail.remaining}</div></div>
                <div><div className="l2">type</div><div className="v2">{detail.type}</div></div>
                <div><div className="l2">region</div><div className="v2">{detail.region}</div></div>
                <div><div className="l2">heartbeat</div><div className="v2">{detail.asOf}</div></div>
              </div>
            </>
          ) : (
            <div className="detail-empty">{status === "loading" ? "loading…" : "select a rail"}</div>
          )}
        </div>

        {detail ? (
          <div className="panel">
            <div className="ph"><h3>⚖ stn-delta</h3></div>
            <div className="pb">
              <table className="dt" style={{ marginTop: -8 }}>
                <tbody>
                  <tr className="static"><td className="mut">earned</td><td className="num">{detail.accrued}</td></tr>
                  <tr className="static"><td className="mut">residual</td><td className="num">{detail.remaining}</td></tr>
                  <tr className="static"><td className="mut">payer</td><td className="num">{detail.payer}</td></tr>
                  <tr className="static"><td className="mut">recipient</td><td className="num">{detail.recipient}</td></tr>
                  <tr className="static"><td className="mut">receipt</td><td className="num">{detail.receipt}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
