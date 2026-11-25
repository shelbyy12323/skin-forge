CREATE TABLE IF NOT EXISTS upgrade_feed (
  event_id TEXT PRIMARY KEY,
  player_label TEXT NOT NULL,
  skin_id TEXT NOT NULL,
  chance REAL NOT NULL,
  success INTEGER NOT NULL,
  happened_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS upgrade_feed_recent ON upgrade_feed(happened_at DESC);
