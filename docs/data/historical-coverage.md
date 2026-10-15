# Hall of Fame data provenance

`src/data/records.json` is built by `node scripts/history/build-records.mjs` and ships as a lazy-loaded chunk, so the Hall of Fame works offline for every completed season.

## Sources (checked 2026-10-13/14)

- **Season totals:** Basketball-Reference regular-season totals tables, every season 1946–47 (BAA) through 2025–26. Each page's title and table are verified; traded players count once through the combined `2TM/3TM/TOT` row. Cached privately in `.superpowers/history-ingest/` (ignored); the build only refetches a missing season, below 20 requests/minute. 2025–26 totals were cross-checked against ESPN for 568 players (6 single-unit provider corrections).
- **Single-game records:** Wikipedia's NBA single-game leader lists (record-book data with dates, teams, opponents). Basketball-Reference's single-game pages were rejected: they start at 1983–84 for rebounds and 1985 for blocks/steals and miss Chamberlain's 55 rebounds, Elmore Smith's 17 blocks and Larry Kenon's 11 steals. Playoff rows (the lists' green key colour) are excluded. The build records each page revision.
- **Identities:** Wikidata links Basketball-Reference IDs (P2685) to NBA.com (P3647) and ESPN (P3685) IDs; Wikipedia player links resolve to Wikidata items. IDs from one provider are never reused as another provider's IDs.
- **Photos:** NBA.com transparent headshots when the CDN returns a real photo rather than its generic silhouette (checked at build time), then ESPN headshots, then Basketball-Reference headshots, whose white backgrounds are removed in the browser (`src/photo-cutout.ts`). Older photos with real backgrounds get a vignette. No images are stored in the repository.
- **Newer seasons:** seasons after the dataset (the in-progress 2026–27 season, then later completed seasons) come straight from ESPN's season statistics in the browser and are cached on the device (30 minutes live, 30 days complete). Completed ones join the all-time single-season rankings.

## Rules

Regular season only. Per-game rankings require 20 games played (in an in-progress season: half the most games played, capped at 20). Totals have no minimum. Values are ranked from exact integer totals and rounded only for display; ties keep competition ranks (1, 2, 2, 4) and every tied row inside the top ten. Rebounds start in 1950–51, blocks and steals in 1973–74, threes in 1979–80; earlier seasons show "Not recorded", never zero.

The build asserts known records before writing: Chamberlain 100 points / 55 rebounds / 50.4 PPG (1961–62) / 4,029 points, Skiles 30 assists, E. Smith 17 blocks, Kenon and Gill 11 steals, Thompson 14 threes, Wembanyama 2024–25 blocks leader.
