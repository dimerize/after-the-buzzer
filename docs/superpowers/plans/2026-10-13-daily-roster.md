# Daily Games and Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Show today's watched-player games, distinguish roster participation states, and simplify watchlist and recap settings.

**Architecture:** Keep React/Vite and the existing Cloudflare Worker/D1. Share pure date, team matching and preference normalization helpers across UI and worker; do not change push identity or permissions. Ship together with the companion historical-records plan after independent verification of both.

**Tech Stack:** TypeScript, React 19, Vitest, Cloudflare Workers/D1.

**Spec:** `docs/superpowers/specs/2026-10-13-roster-and-records-design.md`

## Global Constraints

- Preserve the existing blue/chrome 2K7 presentation and compact desktop-style grid on phones.
- Keep installed-app identity, notification subscriptions, login and existing watchlists intact.
- Full Detail becomes the only recap mode.
- A scheduled team game does not establish player participation.
- Missing/unavailable data stays explicitly unavailable, never falsely No game scheduled.

## Review Focus

- A stale app crossing Eastern midnight updates its default date, not an explicitly chosen date (task 1).
- Team aliases and stale team information cannot silently produce false no-game status (task 2).
- A incomplete slate with zero games cannot mean a verified off day (task 2).
- Old clients and saved preferences retain player alert choices when League becomes Following (task 3).
- Archived recaps use their own date, including after a selection changes during a request (task 2).

## Task 1: Today's schedule and watched-player indicators

**Files:** modify `src/schedule-view.ts`, `src/Schedule.tsx`, `src/schedule.css`, `worker/index.ts`; create `src/shared/team-matching.ts`; tests in `tests/schedule-ui.test.tsx`, `tests/schedule-api.test.ts`.

**Interfaces:** `currentScheduleDate(now = new Date()): string` returns Eastern calendar date. `canonicalTeam(team: string): string` normalizes aliases. `watchedPlayersForGame(game: Game, players: WatchPlayer[]): WatchPlayer[]` returns matching Favorites first, then Following, deduplicated by player ID. Schedule consumes `Pick<Preferences, 'timezone' | 'hideScores' | 'players'>`.

- [ ] Write failing tests: Oct 13 at 16:00 Eastern returns Oct 13; midnight, year boundary and both DST transitions return the local calendar day. Preserve explicit dates across refresh. Verify LA/NY/SA/GS aliases and multiple favorites on one game; indicator text does not say confirmed starter/playing.
- [ ] Run `npx vitest run tests/schedule-ui.test.tsx tests/schedule-api.test.ts` and confirm new tests fail for intended reasons.
- [ ] Replace next-day default and Next slate action with Today; align API omitted-date default. Track default-versus-explicit selection; refresh default date on visibility/focus and minute tick. Preserve request-key isolation.
- [ ] Render small headshot/name indicators within each game row, Favorites distinguished from Following, without adding wide stat columns or changing game-report interactions.
- [ ] Run the same tests, `npm run check` and inspect mobile game rows; commit task files after success.

## Task 2: Schedule-aware roster and Following view

**Files:** modify `src/PlayerRoster.tsx`, `src/player-roster.css`, `src/App.tsx`; create `src/roster-view.ts`; tests in `tests/player-roster.test.tsx`, new `tests/roster-view.test.ts`.

**Interfaces:** `RosterScope = 'favorite' | 'interest' | 'all'`. `rosterPlayerStatus(player: WatchPlayer, line: PlayerLine | undefined, games: Game[], scheduleVerified: boolean, timezone: string): string`. Add `date`, `timezone`, `scheduleVerified` to PlayerRoster props. Reuse task 1 team matching. Preserve the selected nonfavorite notification target when appropriate.

- [ ] Write failing tests for scheduled opponent/tipoff, verified no-game, live, final missing line, DNP, postponed, unverified identity, unknown team and partial schedule. Assert no-game is never inferred from incomplete data or missing player stats. Test Favorites/Following/All selection without dropping watched players, and an archived recap date rather than today.
- [ ] Run `npx vitest run tests/player-roster.test.tsx tests/roster-view.test.ts` to establish red.
- [ ] Implement pure status and grouping helpers. Prefer actual game/box-score team data; only assert no-game when player team is known and schedule is verified. Missing box score for a completed game remains unavailable, not DNP.
- [ ] Wire the recap's own slate and completeness metadata into PlayerRoster. If current metadata cannot establish schedule completeness independently of box scores, add explicit validated schedule metadata rather than inferring completeness from a nonempty list. Add chrome Favorites/Following/All controls; initial Favorites.
- [ ] Verify grid at 390px/430px and desktop, all tests and typecheck; commit task files.

## Task 3: Only Full Detail, no League watchlist tier

**Files:** create `src/shared/normalize-preferences.ts`; modify `src/App.tsx`, `worker/store.ts`, `worker/validation.ts`, `worker/recap.ts` and any actual length-dependent generation call sites; tests in `tests/default-preferences.test.ts`, `tests/api.test.ts`, `tests/notifications.test.ts`.

**Interfaces:** `normalizePreferences(preferences: Preferences): Preferences` returns a copy with `length: 'nerd'`, saved League entries mapped to `interest`, all other fields unchanged. Keep legacy input types accepted at boundaries for existing clients.

- [ ] Replace tests expecting saved Quick/Standard truncation with tests expecting Full Detail. Assert bedtime, timezone, quiet hours, hideScores, player IDs and alert flags remain byte-for-byte equivalent. Test old-client PUT and local sample preferences too.
- [ ] Run focused tests and confirm intended failures.
- [ ] Normalize on storage reads, validated writes and sample hydration. Remove League category/selector option and recap-length buttons. Enforce full candidate generation and full display limit regardless of legacy input; preserve league-wide basketball highlights.
- [ ] Verify task tests plus `tests/preference-save-queue.test.ts`; confirm no notification subscription code changed. Commit on green.

## Execution/release

Complete the companion `2026-10-13-historical-records.md` plan next. Do not deploy half of the agreed scope without explicitly reporting and resolving a data-source blocker. Final verification and deployment are defined there.
