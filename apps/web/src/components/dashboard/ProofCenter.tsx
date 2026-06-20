import type { ProofCard } from "../../types/dashboard";
import type { OpenRailsProofRecord } from "../../services/openrailsApi";

interface ProofCenterProps {
  proofCards: ProofCard[];
  proofs?: OpenRailsProofRecord[];
  loading?: boolean;
  error?: string | null;
}

function short(value: string, head = 10, tail = 8) {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function ProofCenter({ proofCards, proofs = [], loading = false, error = null }: ProofCenterProps) {
  if (loading || error) {
    return (
      <div className="proof-center-grid">
        <article className="panel proof-card" role={error ? "alert" : "status"}>
          <span className={`matrix-badge matrix-${error ? "blocked" : "ready"}`}>
            {error ? "Unavailable" : "Loading"}
          </span>
          <h2>{error ? "Proof data unavailable" : "Loading Worker proof data"}</h2>
          <p>{error ?? "Fetching stream projections and authoritative receipt records from the deployed Worker."}</p>
        </article>
      </div>
    );
  }

  return (
    <div className="proof-center-grid">
      {proofs.map((proof) => (
        <article key={proof.paycardId} className="panel proof-card">
          <span className="matrix-badge matrix-ready">
            {proof.status === "settled" ? "Settled proof" : "Active proof"}
          </span>
          <h2>{short(proof.paycardId)}</h2>
          <p>
            Protocol {proof.protocolVersion} joins package, paycard, gateway projection, recent
            event metadata, and terminal receipt data when available.
          </p>
          <dl className="detail-grid">
            <div><dt>Package</dt><dd>{short(proof.packageId)}</dd></div>
            <div><dt>Stream state</dt><dd>{proof.latestStreamState?.latestEventType ?? "not indexed"}</dd></div>
            <div><dt>Recent events</dt><dd>{proof.recentStreamEvents.length}</dd></div>
            <div><dt>Receipt</dt><dd>{proof.terminalReceipt?.transactionDigest ? short(proof.terminalReceipt.transactionDigest) : "pending"}</dd></div>
            <div><dt>Trust labels</dt><dd>{proof.trustBoundaries.map((label) => label.label).join(" · ")}</dd></div>
          </dl>
          <a href={proof.explorerLinks.paycard} target="_blank" rel="noreferrer">
            Open paycard proof
          </a>
        </article>
      ))}
      {proofCards.map((proof) => (
        <article key={proof.id} className="panel proof-card">
          <span className={`matrix-badge matrix-${proof.status === "not-connected" ? "blocked" : "ready"}`}>
            {proof.status === "real-testnet" ? "Real testnet" : proof.status === "reference" ? "Reference" : "Not connected"}
          </span>
          <h2>{proof.title}</h2>
          <p>{proof.detail}</p>
          {proof.href ? (
            <a href={proof.href} target="_blank" rel="noreferrer">
              Open proof link
            </a>
          ) : (
            <small>Reference only, no live fetch from this UI.</small>
          )}
        </article>
      ))}
    </div>
  );
}
