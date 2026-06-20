import type { Stream } from "../data/mock";
import { StatusPill } from "./StatusPill";

interface StreamTableProps {
  streams: Stream[];
  selectedId?: string;
  onSelect?: (streamId: string) => void;
  onInspect?: (streamId: string) => void;
  loading?: boolean;
  error?: string | null;
}

const toneByType: Record<Stream["type"], { tone: string; glyph: string }> = {
  RailsCard: { tone: "clay", glyph: "C" },
  RailsFlow: { tone: "sage", glyph: "F" },
};

function progressPct(stream: Stream): number {
  const accrued = parseFloat(stream.accrued);
  const remaining = parseFloat(stream.remaining);
  if (Number.isNaN(accrued) || Number.isNaN(remaining)) return stream.status === "settled" ? 100 : 0;
  const total = accrued + remaining;
  if (total <= 0) return stream.status === "settled" ? 100 : 0;
  return Math.min(100, Math.round((accrued / total) * 100));
}

export function StreamTable({ streams, selectedId, onSelect, onInspect, loading = false, error = null }: StreamTableProps) {
  const activate = (streamId: string) => {
    onSelect?.(streamId);
    onInspect?.(streamId);
  };

  return (
    <section className="panel stream-panel" aria-labelledby="streams-title">
      <div className="panel-heading">
        <div>
          <span>⇄ Live Worker channels</span>
          <h2 id="streams-title">Active rails</h2>
        </div>
        <span className="chip c-stream"><span className="dot" style={{ background: "var(--sky)" }} />live</span>
      </div>

      {loading ? (
        <div className="stream-empty-state" role="status">
          <strong>Loading live streams</strong>
          <p>Fetching RailsCard and RailsFlow projections from the deployed OpenRails Worker.</p>
        </div>
      ) : error ? (
        <div className="stream-empty-state" role="alert">
          <strong>Stream projections unavailable</strong>
          <p>{error}</p>
        </div>
      ) : streams.length === 0 ? (
        <div className="stream-empty-state" role="status">
          <strong>No live streams returned</strong>
          <p>The Worker returned no stream projections for the configured paycards.</p>
        </div>
      ) : (
        <div className="rail-list">
          {streams.map((stream) => {
            const { tone, glyph } = toneByType[stream.type];
            const pct = progressPct(stream);
            return (
              <button
                key={stream.id}
                type="button"
                className="rail"
                aria-pressed={selectedId === stream.id}
                aria-label={`Inspect ${stream.label}`}
                onClick={() => activate(stream.id)}
              >
                <span className="rail-ic" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }} aria-hidden="true">{glyph}</span>
                <span className="rail-main">
                  <span className="t">{stream.label} <StatusPill status={stream.status} /></span>
                  <span className="s">{stream.id} · {stream.counterparty}</span>
                  <span className="rail-bar" aria-hidden="true"><i style={{ width: `${pct}%`, background: `var(--${tone})` }} /></span>
                </span>
                <span className="rail-amt">
                  <span className="a">{stream.accrued}</span>
                  <span className="b">{stream.remaining} left</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
