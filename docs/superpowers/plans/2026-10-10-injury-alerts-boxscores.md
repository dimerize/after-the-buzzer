# Injury Alerts and Full Box Scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Implement the two features explicitly selected by the owner, deploy, and send one release notification after production verification.
**Architecture:** Keep React/Cloudflare/D1/ESPN and existing 2K7 menus. Injury alerts compare durable explicit statuses; full box scores use a verified per-game ESPN summary with cache fallback. Existing notification delivery and preference queue remain the integration points.
**Tech Stack:** TypeScript, React, Vitest, Cloudflare Workers/D1/Web Push.
**Spec:** User-approved feature descriptions in this conversation: opted-in favorite injury transitions, grouped updates, no timestamp-only/absence-as-cleared notifications; full in-app box scores with both teams, starter/bench grouping, sorting and one-tap watchlisting.

## Global Constraints

- Preserve desktop-style grid on phone, safe areas, historical logos and existing typography. No card redesign or filler copy.
- No paid services, AI calls, credential rotation, preference reset or unsolicited test pushes.
- Injury alerts are separately opt-in globally (`Preferences.injuryAlerts?: boolean`) and per player (`WatchPlayer.injuryAlerts?: boolean`), default false for old/new settings.
- Only non-league watched players explicitly opted in; no assumption an absent player is healthy. No score information in injury alerts, so Hide Scores does not suppress them.
- Injury alert window: scheduled games starting within three hours, never after tipoff. Fresh feed only; quiet hours suppress delivery without later backlogging. First observation per game/player is a silent baseline.
- Combine one polling run's meaningful explicit status changes into one bounded notification. Same transition/source observation must not repeat. No timestamp/reason-only alerts. Unknown statuses do not become inferred available statuses.
- Use authenticated APIs with date/game association verified on server. Current and old box scores are legitimate, but current injuries must never appear as historical.
- Additive migrations only. Existing public repo and canonical local Code checkout are the approved workflow; publish only after tests/review/live checks. The owner authorized one completion notification.

## Review Focus

- Injury feed missing/stale/partial, trade/wrong team, removed opt-in, repeated poll and concurrent cron: no false or duplicate alerts (Task 1).
- Quiet-hour or tipoff boundary must not deliver queued stale changes later (Task 1).
- Missing/partial box score, DNP, unknown starter and malformed stat columns must not become fictional zero lines (Task 2).
- Mobile wide table must remain reachable; previous game's request cannot overwrite the new game, sorting handles DNP/nulls and hidden scores (Task 3).
- Notification deep links survive sign-in and are same-origin/validated; one-tap watchlisting preserves concurrent preferences (Task 4).

### Task 1: Durable injury-status alerts

**Own:** `worker/injury-alerts.ts`, `worker/injuries.ts` minimal feed export if needed, `migrations/0004_injury_alerts.sql`, `tests/injury-alerts.test.ts`.
**Consume:** optional global/per-player injuryAlerts flags; existing `fetchSchedule`, injury report/cache, `isQuietHour`, Env/Preferences.
**Produce:** `runInjuryAlerts(env: Env, preferences: Preferences, now: Date, notify: (id: string, payload: {title:string;body:string;url:string;tag:string}) => Promise<boolean>): Promise<void>`; root calls independently at start of cron before existing early returns. Export a reset/disable baseline function only if needed for preference integration; communicate signature to root.
- [ ] Write failing behavior tests for silent baseline, questionable→out, unchanged status, disappearance/reappearance, stale/malformed list, game/team mapping, removed/global opt-out, quiet/tipoff windows, grouped changes and repeated/concurrent polls.
- [ ] Implement bounded source fetches, durable comparison state/dedupe and owner-coordinated delivery. Scope locks to this operation, do not mutate recap delivery.
- [ ] Injury notification URL `/?date=YYYY-MM-DD&game=ID&view=injuries`; multi-game grouped alert may use first changed game. Keep body ≤200 chars, title ≤100, clear ESPN attribution.
- [ ] Run focused/full tests; report integration requirements. Do not edit index/App/shared preference types or deploy/commit.

### Task 2: Full box-score backend

**Own:** `src/shared/boxscore-types.ts`, `worker/boxscores.ts`, `migrations/0005_boxscore_cache.sql` if persisted cache is used, `tests/boxscores.test.ts`.
**Consume:** server-verified Game/date; existing ESPN parseSummary can be reused without editing espn.ts unless coordinated.
**Produce:** `loadGameBoxScore(db: D1Database, game: Game, date: string): Promise<GameBoxScore>`; root route `/api/boxscore?date=...&gameId=...`.
**Contract:** `GameBoxScore {gameId:string;date:string;game:Game;source:'espn';sourceUrl:string;fetchedAt:string|null;stale:boolean;availability:'available'|'not-started'|'unavailable';teams:BoxScoreTeam[];warnings:string[]}`. `BoxScoreTeam {team:string;players:BoxScorePlayer[]}` away then home. `BoxScorePlayer extends PlayerLine` with `threesAttempted:number|null; offensiveRebounds:number|null; defensiveRebounds:number|null; fouls:number|null; didNotPlayReason:string|null; starterKnown:boolean`. Nullable extra stats, never fabricated. IDs verified.
- [ ] Write failing parser/load tests: teams/all rows, starter/bench/DNP, decimal minutes, shooting pairs, missing extra fields, mismatched game/header and team, partial coverage, refresh failure keeping timestamp, scheduled game.
- [ ] Fetch only fixed ESPN summary URL for verified ID, bounded timeout/body. Cache per game with short live TTL and longer final TTL; failure fallback visibly stale. No unbounded history import or roster fanout.
- [ ] UI can consume shared contract as soon as written; message root/Task3. Report tests, no index/App edits or commits/deploy.

### Task 3: 2K7 game sheet / box-score UI

**Own:** `src/GameReport.tsx`, `src/BoxScore.tsx`, `src/boxscore-view.ts`, `src/boxscore.css`, necessary `src/InjuryReport.tsx`/injury styles changes, `tests/boxscore-ui.test.tsx`, optional test fixtures. Do not edit App or Schedule.
**Consume:** GameBoxScore contract and `/api/boxscore`; existing injury UI/endpoint, TeamLabel and table palette.
**Produce:** default `GameReport` props `{game:Game;date:string;timezone:string;demo:boolean;hideScores:boolean;watchedIds:string[];initialTab:'injuries'|'boxscore';onWatch:(player:WatchPlayer)=>void;onClose:()=>void;onConnectLive:()=>void}`. One native modal with Injuries / Box score tabs, no nested native dialogs. Existing InjuryReport export stays compatible for existing tests if feasible.
- [ ] Use frontend-design skill to extend current blue/chrome/Barlow condensed aesthetic, compact rows and headshots; desktop and mobile use same table with sticky player column and intentional horizontal scroll.
- [ ] Tests first for numeric sorting (null/DNP stable bottom), starter/bench groups (unknown marked), watched/add button state, safe request identity, error/stale/empty and explicit local score reveal when hideScores is true.
- [ ] Stats: MIN, PTS, REB, AST, STL, BLK, FG, 3PT, FT, ORB, DRB, TO, PF, +/-; both teams, DNP reason. Header sorting within grouping. No made-up totals. Add to Watchlist defaults interest, no alert opt-in.
- [ ] Refresh live boxscore every60s while visible/on resume; fail preserves prior rows/timestamp. Sample mode labeled/no live fetch. Preserve safe top/bottom, focus/Escape/background lock.
- [ ] Run focused/full tests/build; no App/index changes, commits, browser actions or deployment. Parent handles integration/visual QA.

### Task 4: Integration, preferences, notification routing and release

**Own (root):** shared preference types/defaults, validation/store as needed, App/Settings/Watchlist, index routes/cron, notification-navigation, service worker, tests, README, release tooling.
- [ ] Add tested backward-compatible optional injury flags and separate explicit controls. Preserve current production flags and all other preferences.
- [ ] Wire verified boxscore endpoint; game click opens injury tab pregame, boxscore live/final, tab always allows other report. Notification deep link game/view validated in client+service worker; survives auth.
- [ ] Wire cron injury poll before early returns with isolated failure handling. Reset opted-out baselines safely on preference save if Task1 requires it.
- [ ] Provide tightly scoped authenticated once-per-release notification operation using fixed server copy (not arbitrary user-supplied push content), or equivalent secure one-off existing server sender. Send only after successful deployment and verification, never while testing.
- [ ] Fresh independent review; full tests/typecheck/build; real desktop/390/320 browser QA; live endpoint/auth/state preservation checks. Sync original localhost preview after baseline comparison.
- [ ] Apply additive migrations, commit/push/deploy authorized update, then notify registered Buzzer devices once. Report push-service acceptance accurately, not guaranteed OS display.
