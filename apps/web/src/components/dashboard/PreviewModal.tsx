import { useEffect, useRef } from "react";
import { createPreviews } from "../../data/mock";
import type { FlowKind } from "../../types/dashboard";

interface PreviewModalProps {
  modal: FlowKind | null;
  onClose: () => void;
}

export function PreviewModal({ modal, onClose }: PreviewModalProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const preview = modal ? createPreviews.find((item) => item.kind === modal) : undefined;

  useEffect(() => {
    if (!modal) return;

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
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
  }, [modal, onClose]);

  if (!preview) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modalRef}
        className="modal-card preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" ref={closeRef} className="modal-close" aria-label="Close preview" onClick={onClose}>
          ×
        </button>
        <span className="panel-kicker">Guided preview</span>
        <h2 id="preview-modal-title">{preview.title}</h2>
        <p>{preview.subtitle}</p>
        <ol className="preview-steps">
          {preview.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <dl className="preview-rows">
          {preview.previewRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="modal-warning">
          Preview only. No wallet signature, Sui write, Walrus upload, or receipt API call will run.
        </div>
        <button type="button" className="modal-action" onClick={onClose}>Close preview</button>
      </section>
    </div>
  );
}
