import type { Stream } from "../data/mock";
import { StatusPill } from "./StatusPill";

interface StreamTableProps {
  streams: Stream[];
  selectedId?: string;
  onSelect?: (streamId: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function StreamTable({ streams, selectedId, onSelect, loading = false, error = null }: StreamTableProps) {
  return (
    <section className="panel stream-panel" aria-labelledby="streams-title">
      <div className="panel-heading">
        <div>
          <span>Live Worker channels</span>
          <h2 id="streams-title">Payment stream activity</h2>
        </div>
        <button type="button" className="ghost-button" disabled>Worker data</button>
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
        <>
          <div className="stream-table-wrap">
            <table className="stream-table">
              <caption>Live Worker payment streams and projected balances</caption>
              <thead>
                <tr>
                  <th scope="col">Stream</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Rate</th>
                  <th scope="col">Accrued</th>
                  <th scope="col">Remaining</th>
                  <th scope="col">Region</th>
                  <th scope="col">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {streams.map((stream) => (
                  <tr key={stream.id} className={selectedId === stream.id ? "selected-row" : ""}>
                    <th scope="row">
                      {onSelect ? (
                        <button
                          type="button"
                          className="row-select"
                          aria-pressed={selectedId === stream.id}
                          onClick={() => onSelect(stream.id)}
                        >
                          <strong>{stream.label}</strong>
                          <small>{stream.id} · {stream.counterparty}</small>
                        </button>
                      ) : (
                        <>
                          <strong>{stream.label}</strong>
                          <small>{stream.id} · {stream.counterparty}</small>
                        </>
                      )}
                    </th>
                    <td>{stream.type}</td>
                    <td><StatusPill status={stream.status} /></td>
                    <td>{stream.rate}</td>
                    <td>{stream.accrued}</td>
                    <td>{stream.remaining}</td>
                    <td>{stream.region}</td>
                    <td>{stream.receipt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stream-card-list" aria-label="Live payment stream cards">
            {streams.map((stream) => (
              <article key={stream.id} className={`stream-card ${selectedId === stream.id ? "selected-card" : ""}`}>
                <div className="stream-card-top">
                  <div>
                    <h3>{stream.label}</h3>
                    <p>{stream.id} · {stream.counterparty}</p>
                  </div>
                  <StatusPill status={stream.status} />
                </div>
                <dl>
                  <div><dt>Type</dt><dd>{stream.type}</dd></div>
                  <div><dt>Rate</dt><dd>{stream.rate}</dd></div>
                  <div><dt>Accrued</dt><dd>{stream.accrued}</dd></div>
                  <div><dt>Remaining</dt><dd>{stream.remaining}</dd></div>
                  <div><dt>Region</dt><dd>{stream.region}</dd></div>
                  <div><dt>Receipt</dt><dd>{stream.receipt}</dd></div>
                </dl>
                {onSelect ? (
                  <button
                    type="button"
                    className="ghost-button"
                    aria-pressed={selectedId === stream.id}
                    onClick={() => onSelect(stream.id)}
                  >
                    Inspect stream
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
