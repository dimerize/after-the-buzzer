CREATE TABLE IF NOT EXISTS injury_cache (
  id TEXT PRIMARY KEY,
  payload TEXT,
  checked_at INTEGER,
  attempted_at INTEGER NOT NULL
);
