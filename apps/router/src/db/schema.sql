CREATE TABLE IF NOT EXISTS services (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  description  TEXT,
  upstream_url TEXT    NOT NULL,
  method       TEXT    NOT NULL DEFAULT 'POST',
  price_usdc   TEXT    NOT NULL,
  price_xlm    TEXT,
  asset        TEXT    NOT NULL DEFAULT 'USDC',
  input_schema TEXT,
  output_schema TEXT,
  tags         TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  tx_hash      TEXT    PRIMARY KEY,
  service_id   TEXT    NOT NULL,
  request_id   TEXT    NOT NULL UNIQUE,
  from_address TEXT    NOT NULL,
  amount_raw   TEXT    NOT NULL,
  asset        TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS request_log (
  id           TEXT    PRIMARY KEY,
  service_id   TEXT    NOT NULL,
  tx_hash      TEXT,
  from_address TEXT,
  status       TEXT    NOT NULL,
  duration_ms  INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  request_id   TEXT    PRIMARY KEY,
  service_id   TEXT    NOT NULL,
  amount       TEXT    NOT NULL,
  expires_at   INTEGER NOT NULL,
  consumed     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_request_id  ON payments(request_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at  ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_request_log_service  ON request_log(service_id);
CREATE INDEX IF NOT EXISTS idx_request_log_created  ON request_log(created_at);
CREATE INDEX IF NOT EXISTS idx_challenges_expires_at ON challenges(expires_at);
