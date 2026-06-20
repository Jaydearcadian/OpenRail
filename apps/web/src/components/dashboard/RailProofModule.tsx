import type { LiveDashboardData } from "../../data/showcase";

interface RailProofModuleProps {
  data?: LiveDashboardData;
  loading?: boolean;
  error?: string | null;
}

export function RailProofModule({ data, loading = false, error = null }: RailProofModuleProps) {
  const primaryStream = data?.streams[0];
  const latestReceipt = data?.receipts[0];

  return (
    <section className="rail-proof-module" aria-labelledby="rail-proof-title">
      <div className="rail-proof-primary">
        <span className="panel-kicker">Primary rail</span>
        <h2 id="rail-proof-title">{primaryStream?.label ?? "OpenRails Worker"}</h2>
        <p>
          Live stream projections come from the deployed Worker. Gateway values are signed
          projections, while terminal receipts remain the authoritative accounting proof.
        </p>
        <dl className="rail-proof-stats">
          <div>
            <dt>Stream state</dt>
            <dd>{loading ? "Loading Worker projection" : error ? "Worker unavailable" : primaryStream?.status ?? "No stream returned"}</dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd>{data?.apiBaseUrl ?? "OpenRails Worker"}</dd>
          </div>
          <div>
            <dt>As of</dt>
            <dd>{primaryStream?.asOf ?? "not reported"}</dd>
          </div>
        </dl>
      </div>

      <div className="proof-ledger" aria-label="Selected proof identifiers">
        <div>
          <span>paycard id</span>
          <strong>{primaryStream?.id ?? "pending Worker response"}</strong>
        </div>
        <div>
          <span>projection</span>
          <strong>{primaryStream?.metadata ?? "pending Worker response"}</strong>
        </div>
        <div>
          <span>remaining</span>
          <strong>{primaryStream?.remaining ?? "pending Worker response"}</strong>
        </div>
        <div>
          <span>receipt digest</span>
          <strong>{latestReceipt?.digest ?? "pending terminal receipt"}</strong>
        </div>
      </div>
    </section>
  );
}
