import type { Receipt } from "../data/mock";

interface ReceiptPanelProps {
  receipts: Receipt[];
  loading?: boolean;
  error?: string | null;
  onInspect?: (receiptId: string) => void;
}

export function ReceiptPanel({ receipts, loading = false, error = null, onInspect }: ReceiptPanelProps) {
  return (
    <section className="panel receipt-panel" aria-labelledby="receipt-title">
      <div className="panel-heading compact">
        <span>▤ Authoritative settlement</span>
        <h2 id="receipt-title">Settlement receipts</h2>
      </div>

      <div className="receipt-list">
        {loading ? (
          <div className="rcard static" role="status">
            <span className="ri" aria-hidden="true">…</span>
            <span className="rm"><span className="t">Loading terminal receipts</span><span className="s">Fetching SettlementReceipt records from the Worker.</span></span>
          </div>
        ) : error ? (
          <div className="rcard static" role="alert">
            <span className="ri" aria-hidden="true">!</span>
            <span className="rm"><span className="t">Receipt index unavailable</span><span className="s">{error}</span></span>
          </div>
        ) : receipts.length === 0 ? (
          <div className="rcard static">
            <span className="ri" aria-hidden="true">∅</span>
            <span className="rm"><span className="t">No terminal receipts</span><span className="s">No depleted, expired, or cancelled receipt events.</span></span>
          </div>
        ) : receipts.map((receipt) => (
          <button
            key={receipt.id}
            type="button"
            className="rcard"
            aria-label={`Inspect ${receipt.type} receipt ${receipt.digest}`}
            onClick={() => onInspect?.(receipt.id)}
          >
            <span className="ri" aria-hidden="true">✓</span>
            <span className="rm">
              <span className="t">{receipt.label}</span>
              <span className="s">{receipt.type} · paid {receipt.paid} · residual {receipt.residual}</span>
            </span>
            <span className="ra">
              <span className="a">{receipt.paid}</span>
              <span className="b">{receipt.txDigest ? "explorer →" : receipt.digest}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
