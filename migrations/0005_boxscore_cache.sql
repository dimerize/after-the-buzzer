CREATE TABLE IF NOT EXISTS boxscore_cache (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
