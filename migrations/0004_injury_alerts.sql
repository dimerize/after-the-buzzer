CREATE TABLE IF NOT EXISTS injury_alert_state (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  game_date TEXT NOT NULL,
  status TEXT NOT NULL,
  feed_updated_at TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS injury_alert_state_date ON injury_alert_state(game_date);

CREATE TABLE IF NOT EXISTS injury_alert_events (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  feed_updated_at TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id, from_status, to_status, feed_updated_at)
);
CREATE INDEX IF NOT EXISTS injury_alert_events_age ON injury_alert_events(observed_at);

CREATE TABLE IF NOT EXISTS injury_alert_lock (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS injury_alert_pending (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  changes TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS injury_alert_generation (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL
);
INSERT OR IGNORE INTO injury_alert_generation (id,revision) VALUES ('owner',0);
