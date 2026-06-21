import type { LiveDashboardData } from "../../data/showcase";
import type { SurfaceStatus } from "./railHelpers";

interface ProofPanelProps {
  live: LiveDashboardData | null;
  status: SurfaceStatus;
  error: string | null;
}

function badgeFor(s: string): string {
  if (s === "real-testnet") return "b-proven";
  if (s === "reference") return "b-mock";
  return "b-err";
}

export function ProofPanel({ live, status, error }: ProofPanelProps) {
  const cards = live?.proofCards ?? [];
  return (
    <div className="panel">
      <div className="ph"><h3>◷ proof center</h3><span className="badge b-proven">testnet evidence</span></div>
      <table className="dt">
        <thead><tr><th>proof</th><th>detail</th><th>status</th><th>link</th></tr></thead>
        <tbody>
          {cards.length === 0 ? (
            <tr className="static"><td colSpan={4} className="dt-empty">{status === "loading" ? "loading…" : error ? error : "no proof records"}</td></tr>
          ) : cards.map((c) => (
            <tr key={c.id} className="static">
              <td className="id">{c.title}</td>
              <td className="mut">{c.detail}</td>
              <td><span className={`badge ${badgeFor(c.status)}`}>{c.status}</span></td>
              <td>{c.href ? <a href={c.href} target="_blank" rel="noreferrer" style={{ color: "var(--blue)" }}>open →</a> : <span className="mut">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
