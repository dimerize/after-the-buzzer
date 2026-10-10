# Injury Reports and Notification Teasers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship the approved per-game ESPN injury popup and factual notification teasers, and report product/QOL opportunities separately.

**Architecture:** An authenticated game/date endpoint verifies the requested matchup against the schedule, then filters ESPN's full league injury feed. A small persistent feed cache preserves real fetch/source timestamps through outages. One shared, native-dialog React popup opens from schedule and recap games, refreshes only while visible, and preserves the existing 2K7 visual language. Notification copy stays deterministic and fact-backed.

**Tech Stack:** Existing React/TypeScript/Vite, Cloudflare Worker/D1, Vitest; no new runtime dependencies or paid provider.

**Spec:** User-approved design in the current conversation (2026-10-10): full ESPN injury feed, clearly labeled ESPN, NBA official-report link, both teams/logos/headshots/status/reason/timestamps, automatic open/resume refresh, honest stale/unavailable states, no current injuries portrayed as historical game reports. Added request: lively stat-backed push previews, product feature/QOL recommendations rather than regression findings.

## Global Constraints

- Keep desktop and phone roster layout unchanged; reuse blue/chrome 2K7 table styling.
- Use the full league injury feed, not the five-player game-summary list.
- No generated injury facts, availability predictions, unverified records, or "everyone healthy" inference.
- ESPN source timestamp, individual entry timestamp and app checked-at are distinct.
- Do not show current injury rows for completed, postponed or past-day games.
- Preserve auth, settings, quiet hours, notification dedupe and spoiler hiding.
- No unrelated audit repairs or feature implementation; recommendations only.
- Preserve live secrets, subscriptions, existing D1 records and the established deployment URL.

## Review Focus

- A team with more than five injuries must keep every valid listing (Task 1/2 tests).
- Missing team/list, malformed rows, provider outage, or old feed timestamp must not imply a clean bill of health (Task 1/2 tests).
- Opening game B before game A finishes must never flash A's report; abort on dismissal and don't poll while hidden (Task 2 tests/browser checks).
- Final/past games must not borrow today's injury feed (Task 1/2 tests).
- Teaser language must be supported by stats and distinguish live from final, including hidden-score mode (Task 3 tests).

## Task 1: Verified injury data and authenticated endpoint

**Files:** Create `src/shared/injury-types.ts`, `worker/injuries.ts`, `migrations/0003_injury_cache.sql`, `tests/injuries.test.ts`, `tests/injury-api.test.ts`. Modify `worker/index.ts` for one GET route.

**Interfaces:** `GET /api/injuries?date=YYYY-MM-DD&gameId=<digits>` returns `GameInjuryReport`. Shared contract: gameId/date/game/source='espn'/sourceUrl/officialSourceUrl; fetchedAt and feedUpdatedAt nullable; stale boolean; availability='current'|'historical-unavailable'|'unavailable'; teams array of team code/displayName/coverage='reported'|'not-listed'|'unavailable'/players; warnings. Each player has id, name, status, reason, updatedAt nullable, estimatedReturn nullable. Derive portrait URLs from validated ESPN athlete IDs only.

- [ ] Write behavior tests covering >5 rows, IDs from actual athlete links, both team IDs, status preservation, source dates, malformed/missing feed, old feed timestamps and no invented absence/health.
- [ ] Run `npm test -- tests/injuries.test.ts tests/injury-api.test.ts`; observe RED for missing route/behavior.
- [ ] Implement strict feed parsing, bounded HTTPS fetch, D1 cache (60-second success TTL, 60-second failure backoff, marked saved fallback), per-process single-flight; no client-supplied fetch URLs. Verify matchup via `fetchSchedule(date)` before feed access. Omit current rows for past NBA calendar dates or final/postponed games.
- [ ] Run focused tests then full suite; expect all green. Parent owns integration commit.

## Task 2: 2K7 injury dialog and game entry points

**Files:** Create `src/InjuryReport.tsx`, `src/injury-view.ts`, `src/injury-report.css`, `tests/injury-ui.test.tsx`. Modify `src/App.tsx`, `src/Schedule.tsx`, `src/schedule.css`.

**Interfaces:** Default `InjuryReport({game,date,timezone,demo,onClose,onConnectLive})`; consume shared `GameInjuryReport`. App owns selected game/date and passes `onOpenGame(game,date)` to Schedule. Recap GameRow becomes a button opening the same report; original ESPN source remains available inside it. Schedule row clickable with real accessible button, external source link stops propagation.

- [ ] Write request/render tests for verified response identity, error/401, data age, >5 players, source labels, statuses, historical and demo states; observe RED.
- [ ] Implement native modal dialog with accessible name, close/Escape/backdrop, focus restoration, body scroll locking, safe-area-aware positioning. Preserve table columns on phone; no card redesign.
- [ ] Refresh on open, every 60 seconds only while visible, and resume/online; dedupe in-flight work, abort on close/game changes, keep prior same-game data visibly stale on failed refresh. Show source/checked timestamps and explicit team-availability caveat.
- [ ] Verify browser desktop and 390px/320px dialog, scroll/close/focus, actual live API, source click isolation; full tests/build green. Parent owns integration commit.

**Visual direction:** Existing Barlow Condensed; navy #06101d, deep blue #102c67, selected blue #3047bb, chrome #b9c5d2, ice #e3edf8, warning amber #e1c38c. Dense left-aligned roster rows: headshot/name | status | reason/update. Two team sections in one scrollable chrome window; same structure on phone. No extra marketing copy or decorative labels.

## Task 3: Stat-backed notification headlines

**Files:** Modify `worker/notifications.ts`, `tests/notifications.test.ts` (additional focused file allowed).

**Interfaces:** Keep existing `bedtimeNotification`/`milestoneNotification` signatures and payload shape unchanged.

- [ ] Write failing tests: triple-double teaser, high points/blocks, mundane honest fallback, live wording, missing player facts, spoiler-hidden invariance, title/body limits.
- [ ] Observe RED, then implement concise dynamic titles from verified player stats. Preserve favorite priority and stat-rich bodies; don't call performances legendary/historic/career-best without evidence. No AI/API calls. Keep existing delivery rules/deeplinks.
- [ ] Run notification suites and full tests. Return changed files, examples, test evidence; parent owns commit/push/deploy.

## Task 4: Product review, verification and release

**Files:** Update README with actual behavior. Product/QOL review remains a user-facing report, not unrelated app edits.

- [ ] Review the user's before-bed and pregame workflows; recommend five concrete high-value enhancements ranked by usefulness/effort, without restating the bug audit.
- [ ] Fresh independent code review of the complete change; address important findings with RED/GREEN tests.
- [ ] Run `npm test`, `npm run build`, `git diff --check`; verify actual browser behavior and safe-area preservation.
- [ ] Apply only the new D1 migration locally/remotely; push the approved repo and deploy existing Worker. Verify live build byte hashes, authenticated injuries and unchanged settings/push configuration without sending a real notification.
- [ ] Report shipped behavior, source caveat, update instructions, and the top product recommendations.
