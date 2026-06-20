import type { Receipt } from "../data/mock";

interface ReceiptPanelProps {
  receipts: Receipt[];
  loading?: boolean;
  error?: string | null;
}

export function ReceiptPanel({ receipts, loading = false, error = null }: ReceiptPanelProps) {
  return (
    <section className="panel receipt-panel" aria-labelledby="receipt-title">
      <div className="panel-heading compact">
        <span>Authoritative settlement</span>
        <h2 id="receipt-title">Settlement receipts</h2>
      </div>

      <div className="receipt-list">
        {loading ? (
          <article className="receipt-item" role="status">
            <div>
              <strong>Loading terminal receipts</strong>
              <small>Fetching authoritative SettlementReceipt records from the Worker.</small>
            </div>
          </article>
        ) : error ? (
          <article className="receipt-item" role="alert">
            <div>
              <strong>Receipt index unavailable</strong>
              <small>{error}</small>
            </div>
          </article>
        ) : receipts.length === 0 ? (
          <article className="receipt-item">
            <div>
              <strong>No terminal receipts returned</strong>
              <small>The Worker returned no depleted, expired, or cancelled receipt events.</small>
            </div>
          </article>
        ) : receipts.map((receipt) => (
          <article key={receipt.id} className="receipt-item">
            <div>
              <strong>{receipt.label}</strong>
              <small>{receipt.type} · {receipt.digest}</small>
            </div>
            <dl>
              <div>
                <dt>Paid</dt>
                <dd>{receipt.paid}</dd>
              </div>
              <div>
                <dt>Residual</dt>
                <dd>{receipt.residual}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
