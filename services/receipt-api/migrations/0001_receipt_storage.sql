CREATE TABLE IF NOT EXISTS gateway_events (
  event_id TEXT PRIMARY KEY,
  paycard_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  event_timestamp INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gateway_events_paycard_order
  ON gateway_events (paycard_id, event_sequence, event_timestamp, event_id);

CREATE TABLE IF NOT EXISTS paycard_states (
  paycard_id TEXT PRIMARY KEY,
  latest_event_id TEXT NOT NULL,
  latest_event_type TEXT NOT NULL,
  latest_sequence INTEGER NOT NULL,
  latest_timestamp INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settlement_receipts (
  receipt_id TEXT PRIMARY KEY,
  paycard_id TEXT NOT NULL,
  payer TEXT NOT NULL,
  recipient TEXT NOT NULL,
  settlement_type INTEGER NOT NULL,
  transaction_digest TEXT NOT NULL,
  event_seq TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  indexed_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_receipts_paycard
  ON settlement_receipts (paycard_id, indexed_at_ms, receipt_id);

CREATE INDEX IF NOT EXISTS idx_settlement_receipts_filters
  ON settlement_receipts (payer, recipient, settlement_type, indexed_at_ms, receipt_id);

CREATE TABLE IF NOT EXISTS indexer_state (
  indexer_name TEXT PRIMARY KEY,
  cursor_tx_digest TEXT,
  cursor_event_seq TEXT,
  updated_at_ms INTEGER NOT NULL
);
