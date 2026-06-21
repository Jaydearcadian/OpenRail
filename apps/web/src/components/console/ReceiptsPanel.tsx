import { useState } from "react";
import type { LiveDashboardData } from "../../data/showcase";
import type { Receipt } from "../../data/mock";
import { JsonBox, type JsonValue } from "./JsonBox";
import type { SurfaceStatus } from "./railHelpers";

function receiptBadge(type: Receipt["type"]): string {
  if (type === "depleted") return "b-settled";
  if (type === "expired") return "b-mock";
  return "b-err";
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
  rows.push({ key: "conserved", value: true });
  return rows;
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
              <tr key={r.id} onClick={() => setSelectedId(r.id)}>
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
        <div className="panel">
          <div className="ph"><h3>{"{}"} receipt payload</h3></div>
          {selected ? <JsonBox data={payloadOf(selected)} note="mist · paid + residual = initial" /> : <div className="dt-empty">select a receipt</div>}
        </div>
      </div>
    </div>
  );
}
