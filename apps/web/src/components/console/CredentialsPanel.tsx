import { useState } from "react";
import { OPENRAILS_API_BASE_URL } from "../../services/openrailsApi";

interface VerifyResult {
  granted?: boolean;
  reason?: string;
  paycardId?: string;
  service?: string;
  error?: { code?: string; message?: string };
}

export function CredentialsPanel() {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${OPENRAILS_API_BASE_URL}/v1/access/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: value }),
      });
      setResult((await res.json()) as VerifyResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="ph"><h3>⚿ access credentials</h3><span className="badge b-stream">verify</span></div>
      <div className="pb">
        <div className="form">
          <label className="full">
            credential token (Authorization: OpenRails &lt;token&gt;)
            <textarea rows={4} value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste a credential token (issued via `openrails credential issue`)" />
          </label>
          <button type="button" className="btn btn-primary" onClick={verify} disabled={busy}>{busy ? "verifying…" : "verify"}</button>
        </div>

        {error ? <div className="status-line err">{error}</div> : null}
        {result ? (
          result.error ? (
            <div className="status-line err">{result.error.code}: {result.error.message}</div>
          ) : (
            <div className={`status-line ${result.granted ? "ok" : "warn"}`}>
              <span className={`badge ${result.granted ? "b-proven" : "b-err"}`}>{result.granted ? "granted" : "denied"}</span>
              reason: {result.reason}{result.service ? ` · service: ${result.service}` : ""}
            </div>
          )
        ) : null}

        <div className="warn-row" style={{ background: "var(--blue-soft)", color: "oklch(0.46 0.16 252)" }}>
          ℹ verification checks the payer signature, expiry, and live channel state. Issuing from the browser wallet is on the roadmap — use the CLI: <span className="mono">openrails credential issue …</span>
        </div>
      </div>
    </div>
  );
}
