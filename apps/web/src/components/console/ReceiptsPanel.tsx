import { useState } from "react";
import type { LiveDashboardData } from "../../data/showcase";
import type { Receipt } from "../../data/mock";
import { JsonBox, type JsonValue } from "./JsonBox";
import type { SurfaceStatus } from "./railHelpers";
import { suiGlyph, shortId } from "../../lib/format";
import { explorerTxUrl } from "../../config";

function receiptBadge(type: Receipt["type"]): string {
  if (type === "depleted") return "b-settled";
  if (type === "expired") return "b-mock";
  return "b-err";
}

/** Plain-language summary of where the money went. */
function outcomeSentence(r: Receipt): string {
  const paid = suiGlyph(r.paidMist);
  const residual = suiGlyph(r.residualMist);
  switch (r.type) {
    case "depleted":
      return `Fully streamed. The recipient received the entire allocation (${paid}); nothing was left to return.`;
    case "expired":
      return `The channel reached its deadline. The recipient kept what had streamed (${paid}); the residual (${residual}) returned to the payer.`;
    case "cancelled":
      return `The payer closed the channel early. The recipient kept what had streamed (${paid}); the unstreamed residual (${residual}) was refunded to the payer.`;
    default:
      return `Settled. ${paid} paid, ${residual} returned.`;
  }
}

function conserves(r: Receipt): boolean {
  try {
    return BigInt(r.paidMist ?? "0") + BigInt(r.residualMist ?? "0") === BigInt(r.initialMist ?? "0");
  } catch {
    return false;
  }
}

function payloadOf(receipt: Receipt): Array<{ key: string; value: JsonValue }> {
  const rows: Array<{ key: string; value: JsonValue }> = [
    { key: "receipt", value: receipt.txDigest ?? receipt.digest },
    { key: "paycard", value: receipt.paycardId ?? receipt.label },
    { key: "outcome", value: receipt.type },
  ];
  if (receipt.paidMist) rows.push({ key: "paid", value: Number(receipt.paidMist) });
  if (receipt.residualMist) rows.push({ key: "residual", value: Number(receipt.residualMist) });
  if (receipt.initialMist) rows.push({ key: "initial", value: Number(receipt.initialMist) });
  if (receipt.payer) rows.push({ key: "residualTarget", value: receipt.payer });
  rows.push({ key: "conserved", value: conserves(receipt) });
  return rows;
}

function ReceiptCard({ r }: { r: Receipt }) {
  const [showRaw, setShowRaw] = useState(false);
  const href = r.txDigest ? explorerTxUrl(r.txDigest) : r.explorerHref;
  const pct = (() => {
    try {
      const init = Number(BigInt(r.initialMist ?? "0"));
      const paid = Number(BigInt(r.paidMist ?? "0"));
      return init > 0 ? Math.min(100, Math.round((paid / init) * 100)) : r.type === "depleted" ? 100 : 0;
    } catch { return 0; }
  })();

  return (
    <div className="receipt-card">
      <div className="rc-head">
        <span className={`badge ${receiptBadge(r.type)}`}>{r.type}</span>
        <span className="mono mut">{shortId(r.txDigest ?? r.digest, 8, 6)}</span>
      </div>

      <p className="rc-sentence">{outcomeSentence(r)}</p>

      <div className="rc-flow">
        <div className="rc-party"><div className="rc-l">payer</div><div className="rc-v mono">{shortId(r.payer, 8, 6)}</div></div>
        <div className="rc-arrow">
          <div className="rc-amount">{suiGlyph(r.paidMist)}</div>
          <div className="rc-bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="rc-arrow-l">{pct}% streamed</div>
        </div>
        <div className="rc-party"><div className="rc-l">recipient</div><div className="rc-v mono">{shortId(r.recipient, 8, 6)}</div></div>
      </div>

      <div className="rc-grid">
        <div><div className="rc-l">allocation</div><div className="rc-v">{suiGlyph(r.initialMist)}</div></div>
        <div><div className="rc-l">paid out</div><div className="rc-v">{suiGlyph(r.paidMist)}</div></div>
        <div><div className="rc-l">residual returned</div><div className="rc-v">{suiGlyph(r.residualMist)}</div></div>
        <div><div className="rc-l">closed</div><div className="rc-v">{r.closedAt ?? "—"}</div></div>
      </div>

      <div className={`rc-conserve ${conserves(r) ? "ok" : "bad"}`}>
        {conserves(r) ? "✓ conserved — paid + residual = allocation" : "⚠ amounts do not reconcile"}
      </div>

      <div className="rc-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setShowRaw((v) => !v)}>{showRaw ? "hide raw payload" : "raw payload"}</button>
        {href ? <a className="btn btn-ghost" href={href} target="_blank" rel="noreferrer">explorer →</a> : null}
      </div>

      {showRaw ? <JsonBox data={payloadOf(r)} note="mist · paid + residual = initial" /> : null}
    </div>
  );
}

interface ReceiptsPanelProps {
  live: LiveDashboardData | null;
  status: SurfaceStatus;
  error: string | null;
  search: string;
}

export function ReceiptsPanel({ live, status, error, search }: ReceiptsPanelProps) {
  const query = search.trim().toLowerCase();
  const receipts = (live?.receipts ?? []).filter(
    (r) => !query || [r.label, r.digest, r.type].some((f) => f.toLowerCase().includes(query)),
  );
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = receipts.find((r) => r.id === selectedId) ?? receipts[0];

  return (
    <div className="cols">
      <div className="panel">
        <div className="ph"><h3>▤ settlement receipts</h3><span className="badge b-proven">on-chain</span></div>
        <table className="dt">
          <thead><tr><th>receipt</th><th>channel</th><th>outcome</th><th className="num">paid</th><th className="num">residual</th></tr></thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr className="static"><td colSpan={5} className="dt-empty">{status === "loading" ? "loading…" : error ? error : "no terminal receipts"}</td></tr>
            ) : receipts.map((r) => (
              <tr key={r.id} className={selected?.id === r.id ? "row-active" : ""} onClick={() => setSelectedId(r.id)}>
                <td className="id">{r.digest}</td>
                <td className="mut">{r.paycardId ?? r.label}</td>
                <td><span className={`badge ${receiptBadge(r.type)}`}>{r.type}</span></td>
                <td className="num">{r.paid}</td>
                <td className="num mut">{r.residual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="col">
        {selected ? <ReceiptCard r={selected} /> : <div className="panel"><div className="pb"><div className="dt-empty">select a receipt</div></div></div>}
      </div>
    </div>
  );
}
