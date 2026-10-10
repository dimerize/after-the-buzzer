CREATE TABLE preferences (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE editions (date TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE notifications (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE budget (month TEXT PRIMARY KEY, reserved REAL NOT NULL DEFAULT 0);
CREATE TABLE ai_editions (id TEXT PRIMARY KEY, month TEXT NOT NULL, reserved REAL NOT NULL, state TEXT NOT NULL, result TEXT);
CREATE TABLE locks (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE roster_cache (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE login_attempts (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
