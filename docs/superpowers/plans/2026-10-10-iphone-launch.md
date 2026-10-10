# iPhone launch implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans; preserve the current preview and all unrelated edits.

**Goal:** Remove Jersey Select, give iPhone users useful stat-based push notifications, add original 2K7-inspired branding, and prepare or complete private Cloudflare hosting.

**Architecture:** Keep React/Vite, the authenticated Worker, D1, and Web Push. Improve existing flows rather than migrate hosting. Notifications contain verified data and safe same-origin links.

**Tech Stack:** React, TypeScript, SVG/PNG PWA icons, Cloudflare Workers/D1, Vitest.

**Spec:** Latest user request: remove jerseys if they cannot be true to 2K7; useful iPhone notifications; cool logo inspired by the attached 2K7 cover; do the hosting work and identify any payment step. User wants execution with minimal further choices.

## Global constraints

- Preserve approved city/chrome desktop, real headshots, careers, and Hall of Fame. Latest correction: phone must preserve the desktop roster grid, eight-column expanded stat row, panel order/proportions and metadata; do not substitute stacked mobile cards or hide columns.
- No generic celebratory copy, fabricated stats, unofficial-record claims, automatic permission requests, or surprise paid services.
- Keep quiet hours, spoiler hiding, deduplication, per-player alert opt-in, and private API authentication.
- iOS Web Push requires an installed HTTPS home-screen web app and user-granted permission. Do not claim phone delivery until tested on the user's phone.
- Do not alter helenzhang.studio, DNS, existing Workers, or existing databases. Never expose credentials in chat/logs.
- Existing repository is an unborn feature branch with the whole app untracked. Work in place; do not manufacture commits or move to an empty worktree. Scope edits explicitly and use local snapshots for review.

## Review focus

- Notification taps after midnight must open the source date, not a different slate.
- Hidden scores must not leak through notification titles or bodies.
- Malformed or hostile push URLs must not navigate outside the app.
- No-game/DNP/incomplete data must not become invented performances.
- iPhone permission flow must originate from a user gesture; test-send must be authenticated and device-scoped.

## Task 1: Watchlist and phone controls

Files: src/App.tsx; new src/notification-navigation.ts and tests/notification-navigation.test.ts; narrow src/styles.css if needed.

- [ ] Add failing behavior tests for valid date/player notification links and invalid values.
- [ ] Remove Jersey Select navigation/render/import/state. Watchlist opens roster management directly; keep the selected-player card.
- [ ] Read safe date/player parameters on entry, bypass sample mode for notification launches, preserve them through login, and select the notified player.
- [ ] Add a user-triggered Test notification action using POST /api/push/test with the current subscription endpoint. Clear actionable iPhone installation/permission instructions only.
- [ ] Run focused tests, full tests, typecheck. Verify mobile and desktop visually.

## Task 2: Useful notification payloads and delivery

Files: worker/index.ts; worker/notifications.ts (new); worker/push.ts if required; public/sw.js; tests/notifications.test.ts, backend/push/service-worker tests.

- [ ] Add failing tests for favorite-first bedtime stats, multiple/no favorites, partial/live/final state, spoiler mode, DNP, bounded messages, and safe links.
- [ ] Build bedtime payloads from verified player lines and actual game state. Include up to two useful player lines and remaining-game context. Retain once-per-night and quiet-hours behavior.
- [ ] Improve opted-in milestone notifications with stat lines/opponent/state; retain deduplication and no spam.
- [ ] Add authenticated POST /api/push/test for an already registered endpoint only, with rate limiting and no broadcast. Return useful failures without secrets.
- [ ] Service worker honors validated same-origin date/player links, rejects external/malformed routes, preserves current safe caching, and uses app PNG icons.
- [ ] Run focused RED/GREEN tests and the full suite; report realistic iOS limitations.

## Task 3: Original launch identity and hosting

Files: public/icon.svg and PNG derivatives, public/wordmark.svg, public/manifest.webmanifest, index.html, README.md, deployment helpers only if useful.

- [ ] Build a bold slanted white/red BUZZER identity with black outline inspired by the supplied cover, not an official NBA/2K badge. Keep small-icon legibility and maskable safe area.
- [ ] Export 180px Apple touch icon and 192/512px PWA PNGs from the vector; inspect rendered results.
- [ ] Confirm Cloudflare authentication. If absent, start the scoped sign-in and hand off only login/authorization. Do not charge a plan automatically.
- [ ] Once authorized, create only the app's new D1 database, configure private app/VAPID secrets without logging them, apply migrations, deploy, verify authentication, and backfill production history if feasible.
- [ ] If account access remains unavailable, stop before remote writes and identify the single account step required. Do not claim hosting or real-device push is complete.
- [ ] Fresh full tests/build, independent review, phone-size visual QA, and concise install/payment handoff.

## Progress

- Baseline: 193 tests passing. Cloudflare OAuth from the earlier turn expired without authorization; deployment has not occurred.
- Work split: phone UI and notification backend use disjoint ownership; root handles branding, hosting, integration, and verification.
- User authorized Cloudflare. New nba-recap D1 created and both migrations applied. No Worker deployed or paid plan activated yet. Production database ID and account pinned; preview_database_id preserves the original local database identity.
- Jersey UI removed; dated notification navigation, current-device test action, verified push payloads and safe service-worker links implemented. Fresh combined verification before latest additions: 271 tests passing and typecheck passing. Original BZ icon rendered at 180/192/512px; original Buzzer wordmark integrated.
- Deployment paused while addressing the user's mobile-grid correction and added Schedule request.
- Latest visual clarification superseded the spotlight design: the hero is replaced by all five favorites in a shared PTS/REB/AST/BLK roster on phone and desktop, with one night-status strip. Verified five 45px rows, no horizontal overflow at 420px; eight expanded detail stats remain one row and header centers align at 390px.
- Games table shows seven real upcoming matchups for October 10, with timezone-aware tipoffs. Full suite: 316 tests passing; TypeScript and production build passing. Independent notification, schedule, and roster reviews found no blocking issues. Minor known behavior: schedule date resets to next slate after reauthentication.
- Cloudflare deployed at https://after-the-buzzer.omar518khan.workers.dev. Verified actual remote version binds the real D1 ID (Wrangler's console label misleadingly displays the preview ID). Four secrets configured privately; history's 36 verified cache records imported to empty remote storage; owner's five-player preferences copied.
- Production checks passed: private API 401, login 200 with Secure/HttpOnly/SameSite session, real dashboard, push public key, seven-game schedule, 23-season LeBron career and six honors categories. No paid plan activated. Real iPhone notification delivery still requires installation, explicit permission and a device test.
- User requested a GitHub repository and a new local folder under /Users/wemby/Code, then explicitly chose public visibility under dimerize. Created https://github.com/dimerize/after-the-buzzer and /Users/wemby/Code/after-the-buzzer; original preview directory preserved. Private launch credentials and local databases stay ignored and out of Git.
- Added all 30 verified 2007–08 primary team logos with per-file provenance and historical franchise aliases; integrated compact logos into rosters, scores, schedules, reports, and history. Fresh full verification: 388 tests passing and production build passing. At an actual 320px viewport, five roster rows and all schedule columns fit without page overflow; all 14 schedule team logos load.
- Full Detail is now the default for unsaved preferences. The owner's local and production settings were each updated by merging only length=nerd, preserving other settings. Regression tests retain explicit Quick and Standard choices; browser verification shows Full Detail selected.
- User rejected the opaque logo canvases. Replaced all 12 affected files with source-published transparent versions of the same historical marks. Added decoded-pixel regression checks for all 30; inspected every mark on navy and verified clean Spurs/76ers cutouts in the actual 390px roster. Corrected contextual prose rendering so minutes (MIN) never become a Minnesota logo. Fresh full suite: 425 tests passing; production build passing.

## Task 4: Desktop-grid parity and upcoming games (user addition)

- Keep all eight expanded stat columns on phones, align roster headers with their numeric columns, preserve desktop rail proportions and metadata. Preserve desktop layout unchanged.
- Add a GAMES navigation tab for the next basketball slate. Default is the day after the Eastern 06:00-rollover slate; label the actual date explicitly and allow previous/next dates.
- Authenticated GET /api/schedule?date=YYYY-MM-DD returns {date,games,source:'espn',updatedAt,warnings}. Fetch only the ESPN scoreboard, not boxes/AI/history, and never mutate recaps or preferences. Differentiate no games from unavailable data.
- Render matchups, local tipoff times and game status in the same condensed chrome table on phone and desktop; honor score hiding, do not invent schedule/sample data.
- TDD date/format/parser/API behavior; root visual QA at 320/390/desktop, including eight-column geometry and no overflow. Resume launch work after integrated verification.
