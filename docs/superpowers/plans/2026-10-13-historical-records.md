# Historical Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add reliable single-game and single-season records and repair historical season leaders with a 30-game per-game minimum and real player pictures.

**Architecture:** Normalize historical data separately from live ESPN identities. Store validated, versioned historical snapshots in D1 or repository data, not whole-history scrapes on page load. Keep existing career endpoints intact and use an isolated records API/cache namespace so old ESPN honors data cannot masquerade as new 30-game rankings.

**Tech Stack:** TypeScript, React, Vitest, Cloudflare Workers/D1; primary NBA/BAA statistics and record evidence.

**Spec:** `docs/superpowers/specs/2026-10-13-roster-and-records-design.md`

## Global Constraints

- Use at least 30 games played for per-game rankings.
- Totals have no GP minimum.
- No career-total rankings requested.
- Do not mix ABA, preseason, playoffs or exhibitions into regular-season records.
- Stats that were not recorded in an era are unavailable, not zero.
- A new paid data subscription requires user approval.
- Do not label partial top lists as complete all-time rankings.

## Review Focus

- Missing older statistics are not zeros or a claim of a complete all-time ranking (tasks 1–2).
- A player traded midseason counts once with verified combined totals (task 2).
- Different providers' numeric IDs cannot accidentally display another player's picture (tasks 1–3).
- A 29-game season is excluded from averages while a 30-game season qualifies (task 2).
- An interrupted refresh preserves provenance and the old actual verification time, rather than claiming fresh data (task 2).

## Task 1: Verify sources and normalized snapshot contract

**Files:** create `src/shared/records-types.ts`, `scripts/history/probe-sources.mjs`, `docs/data/historical-coverage.md`, `tests/records-source.test.ts`, and source-attributed fixtures in `tests/fixtures/history/`.

**Interfaces:** `RecordStat = 'points' | 'rebounds' | 'assists' | 'blocks' | 'steals' | 'threes'`; `RecordMode = 'season' | 'game' | 'single-season'`; `RecordMeasure = 'totals' | 'per-game'`. Player identity includes `{ source: string; id: string; name: string; imageUrl: string | null }`. A row includes stable row ID, player identity, team(s), season or game date, GP where applicable, nullable raw stat totals and source URL. A response includes mode, measure, season, categories with ranked rows, available seasons, source/coverage metadata, actual verification time and warnings.

- [ ] Write fixture validation tests rejecting mismatched seasons, malformed identities, absent provenance, negative/NaN totals and duplicated combined/team rows. Require null for unrecorded categories and correct image namespace.
- [ ] Run `npx vitest run tests/records-source.test.ts` for red, then implement validation and bounded read-only source probes.
- [ ] Probe NBA statistics feeds for full unqualified season rows, not only qualified leaders, at 2024–25, 2006–07, 1973–74, 1961–62 and 1946–47. Check source precision, combined-team rows, GP and available image mappings. Document actual endpoint outcomes and oldest supported data per statistic. Cross-check current single-game records against NBA.com record pages, starting at `https://www.nba.com/news/history-all-time-records`.
- [ ] Select verified ingestion inputs and document exact refresh procedure and licensing/access constraints. If a source cannot support all historical seasons, test alternative primary NBA data/downloads; do not declare complete coverage on the basis of recent-season fixtures. If no accessible source satisfies the approved scope, report the exact gap and recommended reduced scope or paid option before building misleading rankings.
- [ ] Validate fixtures, typecheck and commit source contract/evidence. Do not commit raw credentials, authenticated responses or unlicensed bulk media.

## Task 2: Ingestion, rankings, records API and cache

**Files:** create `worker/records.ts`, `worker/records-store.ts`, `scripts/history/import-records.mjs`, new migration only if existing historical cache cannot safely hold the versioned payload; modify `worker/index.ts`; tests `tests/records.test.ts`, `tests/records-api.test.ts`, `tests/records-store.test.ts`.

**Interfaces:** `rankRecords(rows, stat: RecordStat, measure: RecordMeasure, minGames: number | null)` derives values from verified totals/GP and returns competition ranks including ties. `loadRecords(db, query: { mode: RecordMode; measure: RecordMeasure; season?: number })` returns the task 1 response. Authenticated GET `/api/history/records?mode=season|game|single-season&measure=totals|per-game&season=YYYY` validates enums/year and never accepts arbitrary upstream URLs.

- [ ] Write tests for 29/30 GP, totals unaffected by GP, rational averages before rounding, ties at cutoff, combined traded seasons, missing categories, excluding nonregular/ABA records and zero-GP safety. Test invalid queries/unauthorized access and old cache payload rejection.
- [ ] Run records tests to establish red.
- [ ] Implement bounded ingestion of verified season rows and sourced single-game record lists. Record completeness per category/era and preserve original source timestamps. Use validated snapshot IDs/versioned cache keys; avoid loading all historical games on each HTTP request.
- [ ] Implement 30-game custom season rankings, all-time season Totals/Per Game and single-game records. Serve top 10 including ties where comprehensive source coverage supports ranking; otherwise expose explicitly scoped verified record holders, as permitted by the approved design. Keep preserved data marked stale on refresh failure and retain its original verification time.
- [ ] Verify real old/recent season outputs against sources, run focused tests/typecheck, commit task files and evidence. Any material scope limitation must be reported before release.

## Task 3: Hall of Fame views and verified historical photos

**Files:** create `src/Records.tsx`, `src/PlayerPortrait.tsx`; modify `src/History.tsx`, `src/history.css`; tests `tests/records-ui.test.tsx`, `tests/history-ui.test.ts`.

**Interfaces:** Records consumes the task 1 response through the existing request-key/loading/error conventions. Shared portrait takes explicit `{ name, imageUrl, team?, className? }`, never guesses source IDs. Existing ESPN career callers explicitly construct ESPN image URLs.

- [ ] Write tests for Season Leaders/Single Game/Single Season navigation, source-backed season dropdown, default completed season, Totals versus Per Game, 30-game label, GP/date/season columns, honest unavailable images and null stat-era states.
- [ ] Run tests for red; implement three chrome tabs and card/ranking views using existing layouts. Replace numeric season input/Load with dropdown, use 3-Pointers and equal single-line card headers. Real photos come from the verified source mapping, with neutral fallback on missing/error.
- [ ] Verify 390px, 430px and desktop visually, long names, all six categories, old season selection, loading/error/retry and rapid selection changes. Preserve grid and safe areas.
- [ ] Run focused tests/typecheck and commit on green.

## Task 4: Whole-app review and release

**Files:** release cache version in `public/sw.js` only as needed; release evidence in the two plans.

- [ ] Verify every requested daily-roster item against the companion plan, not only Hall of Fame. Run `npm test`, `npm run build`, `git diff --check`; confirm no secrets staged. Obtain whole-branch independent review and resolve important findings.
- [ ] Compare pre/post production preferences, allowing only requested length/tier migration. Verify push subscriptions/app identity untouched. Do not run legacy smoke scripts that overwrite preferences or send unnecessary notifications.
- [ ] Commit and push the reviewed changes to the user's existing GitHub repo, then deploy via the authenticated existing Cloudflare workflow. Verify published hashed assets, authenticated schedule/records endpoints, old-season output and source metadata. Do not claim GitHub Actions exists.
- [ ] Report completed items, any explicit historical coverage limits, live URL and phone update instructions. Reopening the installed app should obtain the app update; do not require reinstall or re-enabling push.
