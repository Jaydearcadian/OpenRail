import { StatusPill } from "../StatusPill";
import type { StreamDetail as StreamDetailType } from "../../types/dashboard";

export function StreamDetail({ stream }: { stream?: StreamDetailType }) {
  if (!stream) {
    return (
      <section className="panel stream-detail" aria-live="polite">
        <h2>No stream selected</h2>
        <p>Select a live stream to inspect projection, metadata, and receipt boundaries.</p>
      </section>
    );
  }

  return (
    <section className="panel stream-detail" aria-labelledby="stream-detail-title">
      <div className="panel-heading compact">
        <span>Selected rail</span>
        <h2 id="stream-detail-title">{stream.label}</h2>
      </div>
      <StatusPill status={stream.status} />
      <dl className="detail-grid">
        <div>
          <dt>Type</dt>
          <dd>{stream.type}</dd>
        </div>
        <div>
          <dt>Counterparty</dt>
          <dd>{stream.counterparty}</dd>
        </div>
        <div>
          <dt>Terms</dt>
          <dd>{stream.terms}</dd>
        </div>
        <div>
          <dt>Projected accrued</dt>
          <dd>{stream.accrued}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{stream.remaining}</dd>
        </div>
        <div>
          <dt>Metadata</dt>
          <dd>{stream.metadata}</dd>
        </div>
        <div>
          <dt>Projection source</dt>
          <dd>{stream.projectionSource}</dd>
        </div>
        <div>
          <dt>Receipt</dt>
          <dd>{stream.receiptDigest ?? stream.receipt}</dd>
        </div>
      </dl>
      <div className="safety-note">{stream.safetyNote}</div>
    </section>
  );
}
