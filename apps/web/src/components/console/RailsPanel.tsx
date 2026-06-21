import { useEffect, useState } from "react";
import type { LiveDashboardData } from "../../data/showcase";
import type { StreamDetail } from "../../types/dashboard";
import { streamBadge, progressPct, type SurfaceStatus } from "./railHelpers";
import { humanRate, humanDuration, clockOf, shortId } from "../../lib/format";

function StreamMeter({ detail }: { detail: StreamDetail }) {
  const [display, setDisplay] = useState<string | null>(null);

  useEffect(() => {
    const { ratePerSecMist, startTimestampSec, endTimestampSec } = detail;
    if (!ratePerSecMist || !startTimestampSec) return;

    const rateSui = Number(ratePerSecMist) / 1e9;
    const now = Date.now() / 1000;
    const isSettled = now > endTimestampSec!;

    if (isSettled && endTimestampSec !== undefined) {
      const finalSui = rateSui * (endTimestampSec - startTimestampSec);
      const t0 = performance.now();
      const duration = 1800;
      const frame = (ts: number) => {
        const p = Math.min((ts - t0) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        setDisplay(`◎${(finalSui * ease).toFixed(6)}`);
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    } else {
      const tick = () => {
        const elapsed = Math.max(0, Date.now() / 1000 - startTimestampSec);
        setDisplay(`◎${(rateSui * elapsed).toFixed(6)}`);
      };
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
  }, [detail.ratePerSecMist, detail.startTimestampSec, detail.endTimestampSec]);

  return <div className="big">{display ?? detail.accrued}</div>;
}

interface RailsPanelProps {
  live: LiveDashboardData | null;
  status: SurfaceStatus;
  error: string | null;
  search: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  onCreate?: () => void;
}

export function RailsPanel({ live, status, error, search, selectedId, onSelect, onCreate }: RailsPanelProps) {
  const query = search.trim().toLowerCase();
  const streams = (live?.streams ?? []).filter(
    (s) => !query || [s.label, s.id, s.type, s.counterparty].some((f) => f.toLowerCase().includes(query)),
  );
  const detail = (live?.streamDetails ?? []).find((d) => d.id === selectedId) ?? (live?.streamDetails ?? [])[0];

  return (
    <div className="cols">
      <div className="panel">
        <div className="ph"><h3>⇄ all rails</h3>{onCreate ? <button type="button" className="act-link" onClick={onCreate}>+ create</button> : null}</div>
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>id</th><th>type</th><th>status</th><th>progress</th><th className="num">accrued</th><th className="num">remaining</th></tr></thead>
            <tbody>
              {streams.length === 0 ? (
                <tr className="static"><td colSpan={6} className="dt-empty">{status === "loading" ? "loading…" : error ? error : "no live streams"}</td></tr>
              ) : streams.map((s) => (
                <tr key={s.id} className={selectedId === s.id ? "row-active" : ""} onClick={() => onSelect(s.id)}>
                  <td className="id" title={s.id}>{shortId(s.id, 8, 6)}</td>
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
      </div>

      <div className="col">
        <div className="stream-card">
          {detail ? (
            <>
              <div className="l">
                {detail.ratePerSecMist
                  ? detail.endTimestampSec && Date.now() / 1000 > detail.endTimestampSec
                    ? "settled · terminal receipt"
                    : "accruing · live estimate"
                  : "projected accrued · gateway estimate"}
              </div>
              <StreamMeter detail={detail} />
              <div className="rate">{detail.ratePerSecMist ? humanRate(detail.ratePerSecMist) : detail.rate} · capital-bounded</div>
              <div className="strack"><i style={{ width: `${progressPct(detail)}%` }} /></div>
              <div className="smeta">
                <div><div className="l2">remaining</div><div className="v2">{detail.remaining}</div></div>
                <div><div className="l2">type</div><div className="v2">{detail.type}</div></div>
                {detail.startTimestampSec && detail.endTimestampSec ? (
                  <>
                    <div><div className="l2">duration</div><div className="v2">{humanDuration(detail.endTimestampSec - detail.startTimestampSec)}</div></div>
                    <div><div className="l2">opened</div><div className="v2">{clockOf(detail.startTimestampSec)}</div></div>
                  </>
                ) : (
                  <>
                    <div><div className="l2">region</div><div className="v2">{detail.region}</div></div>
                    <div><div className="l2">heartbeat</div><div className="v2">{detail.asOf}</div></div>
                  </>
                )}
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
