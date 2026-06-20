import { useEffect, useRef } from "react";
import type { Receipt } from "../../data/mock";
import type { InspectTarget, StreamDetail } from "../../types/dashboard";
import { JsonBlock } from "./JsonBlock";

interface InspectModalProps {
  inspect: InspectTarget | null;
  streams: StreamDetail[];
  receipts: Receipt[];
  onClose: () => void;
}

function Wave3() {
  return (
    <div className="wave3" aria-hidden="true">
      <svg viewBox="0 0 600 56" preserveAspectRatio="none">
        <path d="M0 36 Q75 12 150 30 T300 28 T450 32 T600 26 V56 H0 Z" fill="oklch(0.74 0.13 50 / 0.5)" />
        <path d="M0 42 Q75 24 150 38 T300 36 T450 40 T600 32 V56 H0 Z" fill="oklch(0.75 0.11 232 / 0.4)" />
      </svg>
    </div>
  );
}

const PROOF_STEPS = [
  { state: "done", title: "Intent", detail: "permission envelope signed" },
  { state: "done", title: "Channel opened", detail: "paycard funded on testnet" },
  { state: "now", title: "Flowing", detail: "gateway heartbeats · not yet final" },
  { state: "", title: "STN-Delta", detail: "earned + residual routing" },
  { state: "", title: "Receipt", detail: "terminal receipt pending" },
] as const;

function StreamView({ stream }: { stream: StreamDetail }) {
  const numericStart = parseFloat(stream.accrued);
  const isNumeric = !Number.isNaN(numericStart);

  useEffect(() => {
    if (!isNumeric) return;
    let val = numericStart;
    const el = document.getElementById("inspectLiveValue");
    const iv = setInterval(() => {
      val += 0.000041 + Math.random() * 0.000014;
      if (el) el.textContent = val.toFixed(4);
    }, 900);
    return () => clearInterval(iv);
  }, [isNumeric, numericStart]);

  const settled = stream.status === "settled";

  return (
    <>
      <div className="stream-hero">
        <div className="l">{settled ? "Settled" : "Projected accrued · gateway estimate"}</div>
        {isNumeric ? (
          <div className="big">◎<span id="inspectLiveValue">{numericStart.toFixed(4)}</span><small> SUI</small></div>
        ) : (
          <div className="big" style={{ fontSize: "1.6rem" }}>{stream.accrued}</div>
        )}
        <div className="rate">{stream.rate} · capital-bounded</div>
        <Wave3 />
        <div className="smeta">
          <div><div className="l2">remaining</div><div className="v2">{stream.remaining}</div></div>
          <div><div className="l2">type</div><div className="v2">{stream.type}</div></div>
          <div><div className="l2">region</div><div className="v2">{stream.region}</div></div>
          <div><div className="l2">heartbeat</div><div className="v2">{stream.asOf}</div></div>
        </div>
      </div>

      <div>
        <div className="inspect-section-label">STN-Delta projection · earned + residual = initial</div>
        <div className="stn-grid" style={{ marginTop: 10 }}>
          <div className="dl"><span className="dk">Earned (projected)</span><span className="dv">{stream.accrued}</span></div>
          <div className="dl"><span className="dk">Residual (would return)</span><span className="dv">{stream.remaining}</span></div>
          <div className="dl"><span className="dk">Returns to</span><span className="dv">{stream.payer}</span></div>
          <div className="dl"><span className="dk">Recipient</span><span className="dv">{stream.recipient}</span></div>
        </div>
      </div>

      <div>
        <div className="inspect-section-label">Proof trail</div>
        <div className="proof-trail" style={{ marginTop: 8 }}>
          {PROOF_STEPS.map((step) => (
            <div key={step.title} className={`pstep ${step.state}`}>
              <span className="pnode">{step.state === "done" ? "✓" : step.state === "now" ? "◷" : ""}</span>
              <div>
                <div className="pt">{step.title}</div>
                <div className="pd">{step.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="inspect-section-label">Channel terms</div>
        <div className="detail-grid" style={{ marginTop: 8 }}>
          <div><dt>Type</dt><dd>{stream.type}</dd></div>
          <div><dt>Channel</dt><dd>{stream.id}</dd></div>
          <div><dt>Metadata</dt><dd>{stream.metadata}</dd></div>
          <div><dt>Receipt</dt><dd>{stream.receipt}</dd></div>
          <div><dt>Projection</dt><dd>{stream.projectionSource}</dd></div>
          <div><dt>Terms</dt><dd>{stream.terms}</dd></div>
        </div>
      </div>

      <div>
        <div className="inspect-section-label">Permission envelope</div>
        <div style={{ marginTop: 8 }}>
          <JsonBlock
            data={[
              { key: "type", value: stream.type },
              { key: "channel", value: stream.id },
              { key: "recipient", value: stream.recipient },
              { key: "residualTarget", value: stream.payer },
              { key: "projection", value: stream.region },
              { key: "receipt", value: stream.receiptDigest ?? "pending" },
            ]}
            note="signed gateway projection · receipt remains authoritative"
          />
        </div>
      </div>

      <p className="safety-note">{stream.safetyNote}</p>
    </>
  );
}

function ReceiptView({ receipt }: { receipt: Receipt }) {
  const json: Array<{ key: string; value: string | number | boolean }> = [
    { key: "receipt", value: receipt.txDigest ?? receipt.digest },
    { key: "paycard", value: receipt.paycardId ?? receipt.label },
    { key: "outcome", value: receipt.type },
  ];
  if (receipt.paidMist) json.push({ key: "paid", value: Number(receipt.paidMist) });
  if (receipt.residualMist) json.push({ key: "residual", value: Number(receipt.residualMist) });
  if (receipt.initialMist) json.push({ key: "initial", value: Number(receipt.initialMist) });
  if (receipt.payer) json.push({ key: "residualTarget", value: receipt.payer });
  json.push({ key: "conserved", value: true });

  return (
    <>
      <div className="stream-hero">
        <div className="l">{receipt.type} · settlement receipt</div>
        <div className="big" style={{ fontSize: "2.2rem" }}>{receipt.paid}<small> paid</small></div>
        <div className="rate">residual {receipt.residual} · of {receipt.initial ?? "—"} initial</div>
        <Wave3 />
        <div className="smeta">
          <div><div className="l2">paid</div><div className="v2">{receipt.paid}</div></div>
          <div><div className="l2">residual</div><div className="v2">{receipt.residual}</div></div>
          <div><div className="l2">initial</div><div className="v2">{receipt.initial ?? "—"}</div></div>
          <div><div className="l2">closed</div><div className="v2">{receipt.closedAt ?? "—"}</div></div>
        </div>
      </div>

      <div>
        <div className="inspect-section-label">STN-Delta conservation</div>
        <div className="stn-grid" style={{ marginTop: 10 }}>
          <div className="dl"><span className="dk">Paid to recipient</span><span className="dv">{receipt.paid}</span></div>
          <div className="dl"><span className="dk">Residual to payer</span><span className="dv">{receipt.residual}</span></div>
          <div className="dl"><span className="dk">Initial allocation</span><span className="dv">{receipt.initial ?? "—"}</span></div>
          {receipt.payer ? <div className="dl"><span className="dk">Payer</span><span className="dv">{receipt.payer}</span></div> : null}
          {receipt.recipient ? <div className="dl"><span className="dk">Recipient</span><span className="dv">{receipt.recipient}</span></div> : null}
        </div>
      </div>

      <div>
        <div className="inspect-section-label">Receipt payload</div>
        <div style={{ marginTop: 8 }}>
          <JsonBlock data={json} note="mist · stn-delta: paid + residual = initial" />
        </div>
      </div>

      {receipt.explorerHref ? (
        <a className="explorer-link" href={receipt.explorerHref} target="_blank" rel="noreferrer">
          Open settlement tx in Sui Explorer →
        </a>
      ) : null}
    </>
  );
}

export function InspectModal({ inspect, streams, receipts, onClose }: InspectModalProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const stream = inspect?.kind === "stream" ? streams.find((item) => item.id === inspect.id) : undefined;
  const receipt = inspect?.kind === "receipt" ? receipts.find((item) => item.id === inspect.id) : undefined;
  const open = Boolean(stream || receipt);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;

      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => previousFocusRef.current?.focus());
    };
  }, [open, onClose]);

  if (!open) return null;

  const title = stream ? stream.label : `${receipt?.type} receipt`;
  const sub = stream ? `${stream.id} · ${stream.type}` : `${receipt?.digest} · ${receipt?.paycardId ?? "settlement"}`;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modalRef}
        className="modal-card inspect-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspect-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" ref={closeRef} className="modal-close" aria-label="Close inspector" onClick={onClose}>×</button>
        <div className="inspect-head">
          <div>
            <span className="panel-kicker">{stream ? "Channel detail" : "Settlement detail"}</span>
            <h2 id="inspect-modal-title">{title}</h2>
            <div className="sub">{sub}</div>
          </div>
          <span className={`chip ${stream ? "c-stream" : "c-settled"}`}>
            <span className="dot" style={{ background: stream ? "var(--sky)" : "var(--plum)" }} />
            {stream ? (stream.status === "settled" ? "Settled" : "Flowing") : "On-chain"}
          </span>
        </div>
        <div className="inspect-body">
          {stream ? <StreamView stream={stream} /> : receipt ? <ReceiptView receipt={receipt} /> : null}
        </div>
      </section>
    </div>
  );
}
