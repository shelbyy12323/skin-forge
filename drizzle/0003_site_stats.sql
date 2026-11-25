CREATE TABLE IF NOT EXISTS site_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  spins INTEGER NOT NULL
);
INSERT OR IGNORE INTO site_stats (id, spins) SELECT 1, COUNT(*) FROM upgrade_feed;
