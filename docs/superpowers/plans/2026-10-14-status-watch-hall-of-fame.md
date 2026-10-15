# Status plates, watched games, where to watch and Hall of Fame — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-14-status-watch-hall-of-fame-design.md`

**Stack:** TypeScript, React 19, Vitest, Cloudflare Worker + D1. Keep the 2K7 blue/chrome look; new styles live in per-component CSS files.

## Task 1: Historical records dataset

Files: `scripts/history/build-records.mjs`, `worker/data/records.json`, `docs/data/historical-coverage.md`.

- Read the verified Basketball-Reference season totals cache (`.superpowers/history-ingest/<season>.json`, ignored by git).
- Fetch Wikipedia single-game leader tables (points, rebounds, assists, steals, blocks, threes); parse rowspans; keep regular-season rows only; resolve player pages to Wikidata items.
- Fetch the Wikidata crosswalk (Basketball-Reference ID → NBA.com ID, ESPN ID). Check NBA.com headshots against the generic fallback image; check ESPN headshots for the rest.
- Precompute: per-season top ten with ties (per game ≥ 20 GP, totals), all-time single-season top ten (both measures), all-time single-game top ten. Store compact rows plus a player table.
- Assert known records before writing (Chamberlain 100 pts / 55 reb / 50.4 PPG 1961–62, Skiles 30 ast, E. Smith 17 blk, Kenon + Gill 11 stl, Thompson 14 3PM, Wembanyama 2024–25 BPG leader).

## Task 2: Records API

Files: `src/shared/records-types.ts`, `worker/records.ts`, `worker/records-live.ts`, `worker/index.ts`; tests `tests/records.test.ts`, `tests/records-api.test.ts`.

- `GET /api/history/records?mode=season|game|single-season&measure=per-game|totals&season=YYYY` (authenticated, strict validation).
- Seasons after the snapshot come from ESPN `statistics/byathlete` (all pages, integer totals), cached in `historical_cache` (1 hour in progress, 30 days complete). In-progress per-game minimum is `min(20, floor(max GP / 2))`, labeled.
- Completed live seasons merge into all-time single-season rankings.

## Task 3: Hall of Fame UI

Files: `src/Records.tsx`, `src/PlayerPortrait.tsx`, `src/records.css`, `src/History.tsx`; tests `tests/records-ui.test.tsx`.

- View tabs, season select with steppers, Per Game/Totals segment, six cards with single-line headers, full-width ranking table sized for 360px, info strip (scope, minimum, source, verification date).
- Portrait: explicit image URL from the API's photo field; neutral silhouette fallback.

## Task 4: Broadcasts and Where to Watch

Files: `worker/espn.ts`, `src/shared/types.ts`, `src/shared/watch-guide.ts`, `src/WatchGuide.tsx`, `src/watch-guide.css`, `src/InjuryReport.tsx`, `src/Schedule.tsx`, preference validation/normalization; tests `tests/watch-guide.test.ts`, `tests/espn.test.ts`.

- `Game.broadcasts` from `geoBroadcasts` (fallback `broadcasts`), radio excluded.
- `watchGuide(game, market)` returns League Pass verdict, ordered options, listings-pending flag.
- `Preferences.tvMarket` (default `NY`), validated against the market list.

## Task 5: Watched games, highlights, Around the League

Files: `src/shared/team-matching.ts` (`gameWatch`), `src/Schedule.tsx`, `src/schedule.css`, `src/App.tsx` (GameRow, highlights, Around the League), `src/watch-marks.css`; tests `tests/schedule-ui.test.tsx`, `tests/team-matching.test.ts`.

## Task 6: Roster status plates

Files: `src/roster-view.ts` (structured status), `src/PlayerRoster.tsx`, `src/player-roster.css`, `worker/espn.ts` (DNP reason), `worker/injuries.ts` + `worker/index.ts` (dashboard injuries for today's slate, watched-team sync), `src/shared/types.ts`; tests `tests/roster-view.test.ts`, `tests/player-roster.test.tsx`, `tests/api.test.ts`.

## Task 7: Settings simplification

Files: `src/App.tsx`, `src/settings.css`.

## Task 8: Release

- `npm test`, `npm run build`, iPhone-width visual pass (390px) of every changed screen, README update, service worker cache bump.
- Commit, push the branch and fast-forward `codex/after-the-buzzer`, `npm run deploy`, check production health and assets.
