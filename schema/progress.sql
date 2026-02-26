PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  last_ip TEXT,
  progress_json TEXT NOT NULL DEFAULT 'null'
);

CREATE TABLE IF NOT EXISTS ip_index (
  ip TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_ip_index_session_id ON ip_index(session_id);
