import type { Dispatch } from "react";
import { createPreviews } from "../../data/mock";
import type { DashboardAction } from "../../types/dashboard";

export function CreatePreview({ dispatch }: { dispatch: Dispatch<DashboardAction> }) {
  return (
    <div className="create-preview-grid">
      {createPreviews.map((preview) => (
        <article key={preview.kind} className="panel create-preview-card">
          <span className="panel-kicker">{preview.kind === "railscard" ? "Outbound grant" : "Merchant invoice"}</span>
          <h2>{preview.title}</h2>
          <p>{preview.subtitle}</p>
          <ol>
            {preview.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <dl>
            {preview.previewRows.slice(0, 2).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={() => dispatch({ type: "open-modal", modal: preview.kind })}>
            Inspect preview
          </button>
          <small>No signature, funding, upload, submit, claim, cancel, or API call will run.</small>
        </article>
      ))}
    </div>
  );
}
