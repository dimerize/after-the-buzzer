# After the Buzzer

A private NBA night reader for bedtime and nights out. React phone app, ESPN data adapter, deterministic stat detection, Cloudflare Worker/D1 backend, optional Web Push and bounded OpenAI editing.

The interface is inspired by the Xbox 360 / PS3-era NBA 2K7 Association menus: cyan-lit city scenery, blue/chrome panel frames, silver stat cells and condensed roster tables. `public/city-night.svg`, the red/white Buzzer wordmark, and the BZ home-screen icon are original artwork. This is an independent personal reader, not an official NBA 2K product.

Live app: https://after-the-buzzer.omar518khan.workers.dev — private password sign-in. Cloudflare hosts the Worker, assets, D1 database and five-minute scheduler; GitHub stores the source. No paid plan or OpenAI key was activated during launch.

## Run it locally

Node 22.12+ or 24 LTS is recommended. From this directory:

```sh
npm ci
npm run build
npm run db:local
npm run dev:api
```

In another terminal run `npm run dev`, then open the printed localhost URL. The API development command intentionally bypasses login **only on loopback addresses**. It is never enabled by the production configuration. Local D1 is stored under ignored `.wrangler/`. To test production login locally instead, set `APP_PASSWORD` in an ignored `.dev.vars` file and run `npx wrangler dev --ip 127.0.0.1 --port 8787` without `LOCAL_DEV`.

The frontend also has a clearly labeled sample mode. Sample preferences are local to that browser and sample nights cannot be saved to the real archive. If the real API fails, the UI reports the failure; fictional statistics are never presented as live data.

## What works

- Tonight: source-linked story cards, game states, stat leaders including ties, every favorite who played, and clear partial-data warnings.
- Favorites and Following watchlist tiers (old League entries become Following), player search from ESPN rosters, phone-editable bedtime/timezone and score hiding. Watched players' teams update from tonight's box scores or injury listings after a trade.
- Full Detail is the only recap length: up to eight stories plus additional player statistics. Settings is four panels: Recap, Notifications, TV Market and Account.
- Small verified 2007–08 team logos accompany team abbreviations throughout the app. Current franchise abbreviations keep their historical marks (for example, OKC uses Seattle). See [logo sources and rights](docs/team-logo-sources.md).
- Persistent night archive. Recap trackers cover **collected completed games** only; the separate Careers screen imports full available season/career aggregates and individual season game logs.
- Careers: regular season/playoffs, totals/averages, every available year, game logs, top scoring games and box-score milestones. Historical logs reconcile against season totals; incomplete years stay explicitly partial. All-Star, play-in and non-counting NBA Cup finals are excluded.
- Hall of Fame: Season Leaders for every regular season since 1946–47 (plus the in-progress season from ESPN), all-time Single Game records with dates and opponents, and all-time Single Season records. Per-game ranks need 20 games played; totals have no minimum. The season picker is a native scroll wheel on iPhone. Photos are NBA.com/ESPN transparent headshots or Basketball-Reference cutouts on the blue gradient. Sources and rules: [historical coverage](docs/data/historical-coverage.md).
- All favorites are visible together in the Player Roster, with small headshots and aligned PTS/REB/AST/BLK columns. Rows without a stat line show one status plate instead: tipoff and opponent, OUT or questionable from today's ESPN injury feed, DNP with reason, no game, live or final. Desktop and phone use the same grid; there is no single-player hero. The retired jersey viewer is not imported or shipped in the application bundle.
- Games: today's Eastern slate by default, with date controls, tipoffs in your chosen timezone, matchups, game status, a TV chip and source links. Games with a Favorite (gold star) or Following (ice-blue diamond) player show the players under the matchup; watched players on both teams make a Marquee Matchup. The Recap scoreboard, highlights and Around the League use the same marks. Uses real ESPN schedules only; unavailable data never becomes a fictional schedule.
- Tap a game in Games or the Recap scoreboard for a blue/chrome injury report: both teams, headshots, status, reason, estimated return when supplied, and each entry's update time. This uses ESPN's full league injury feed, not the truncated game-summary list. ESPN and the NBA official-report link are clearly distinguished. The Injuries tab ends with Where to Watch, built from ESPN's US listings and your TV market: League Pass available, national blackout (Prime Video, ESPN/ABC, NBC/Peacock) or local blackout (default New York: Knicks on MSG, Nets on YES via a TV provider or DAZN). A one-line verdict also shows on the Box score tab.
- The same game report includes full ESPN box scores: both teams, starters/bench/DNP, sortable stats and one-tap watchlisting. Pregame opens Injuries; live/final games open Box score. Phone and desktop share the table; swipe sideways for extra columns while player names stay pinned. Hide Scores requires an explicit, game-local reveal.
- Separate opt-in injury alerts track explicit ESPN status changes for selected Favorites/Following players in the three hours before tipoff. Changes from one poll are grouped; first observations, timestamp/reason-only edits, missing players and stale feeds never produce a clearance notification.
- Five-minute scheduled updates independent of your laptop, a bedtime notification with up to two verified, favorite-first player stat lines and remaining-game status, silent later finalization, optional exceptional-performance alerts and quiet hours.
- Notifications lead with a verified performance—such as “Wembanyama swats 7 shots” or “Şengün posts a triple-double”—instead of a generic prompt. Live games are labeled; no unsupported “historic” or “legendary” claims. Score hiding keeps the notification spoiler-free.
- Notification taps open the matching game date and player, including after signing in. Settings includes a manual test for the current registered device; server acceptance is not a claim of confirmed device delivery.
- Home-screen manifest, offline shell and encrypted Web Push service worker.
- Private password authentication using a signed HttpOnly cookie, origin checks and login throttling. All data endpoints require authentication on production.
- AI is optional and disabled without a server API key. In this first version it can select/order existing verified story text, not generate historical claims. Templates keep the recap useful without it.

The NBA slate date follows Eastern time, rolling over at 06:00 so overnight games stay together. Bedtime and quiet hours follow your selected timezone independently. The schedule revisits unfinished recent nights in the Eastern daytime after an outage. Push delivery depends on browser/OS permission and network conditions, so five-minute polling is a target, not an exact delivery promise.

Injury reports refresh when opened, every minute while visible, and when the app returns to the foreground or regains connectivity. The league feed is shared in D1 with a one-minute fetch cooldown; failures retain the saved list with its original timestamps and a stale warning. Feed update time and app check time are shown separately. A missing player or empty list does not establish health or game availability. Past-date, completed and postponed games do not show today's injury list as a historical report. No extra service subscription or AI call is used.

## Publish to your Cloudflare account

The owner account and this app's D1 database are configured in `wrangler.jsonc`. The commands below document initial setup for a different account; do not recreate the existing database for routine updates. No custom domain is required, and this deployment does not change `helenzhang.studio`.

1. Run `npx wrangler login --use-keyring` and authorize your Cloudflare account. For another account, replace `account_id` with that account's ID.
2. Run `npx wrangler d1 create nba-recap` only if it does not already exist. Copy its returned database ID into `wrangler.jsonc`.
3. Run `npx wrangler secret put APP_PASSWORD` and enter a long, unique password. Keep it in your password manager. Never put it in source or a `VITE_*` variable.
4. Run `npm run db:remote`, then `npm run deploy`.
5. Open the returned `workers.dev` address, sign in, and refresh Tonight. The five-minute cron trigger is included in the deployment; no separate scheduler or GitHub token is needed.

The React files are public assets; your recaps, settings, archive and push subscriptions are behind the authenticated API. The source contains no API keys. Rotating `APP_PASSWORD` revokes all existing login sessions.

### Install on your phone

Use the deployed **HTTPS `workers.dev` address**, not `127.0.0.1`. The computer's local preview is not a phone-accessible deployment.

- **iPhone:** open the address in Safari → Share (under More on some layouts) → Add to Home Screen → enable Open as Web App → Add. Open the new icon and sign in. [Apple instructions](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios).
- **Android:** open the address in Chrome → ⋮ → Install and create shortcut → Install. Some versions say Install app or Add to Home screen. [Google instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).

The app shell works offline; fresh recaps and historical stats need a connection. iPhone Web Push needs iOS 16.4 or later and the installed home-screen app. Once signed in from the home-screen icon, open Settings → Enable notifications → Allow, then Test. Focus modes, notification settings and connectivity can delay or suppress the banner. No App Store purchase or Apple developer membership is needed.

Updates do not require reinstalling. To load a newly deployed interface immediately, swipe Buzzer away in the iPhone app switcher, then reopen its home-screen icon while online. Returning to an already-open app can resume its old interface. The in-app Refresh button refreshes game data only. Normal deployments preserve login and notification subscriptions; do not delete the app or clear site data to update it.

### Historical cache and backfill

Apply all D1 migrations before using the app (`0002_historical_stats.sql` adds history; `0003_injury_cache.sql` adds the shared injury cache). `/api/history/career?id=1966`, `/api/history/games?id=1966&season=2026`, and `/api/history/honors?season=2026` (kept for older clients) are authenticated on production. The Hall of Fame record book is a lazy-loaded app chunk rebuilt with `node scripts/history/build-records.mjs`; newer seasons load from ESPN on the device. `season=2026` means 2025–26. Opening a player/year automatically imports and persists it. Career snapshots refresh after 24 hours; completed-season logs/leaderboards after 30 days. Partial snapshots retry after five minutes when requested. Failures retain the saved data and its original timestamp.

Both the original local development database and the production database were backfilled at launch with 36 cache records and 2,345 player-game rows, including all available career seasons. All four established players' 2025–26 logs reconcile; Wagler has no prior NBA history. LeBron has older log gaps/provider discrepancies that remain marked partial, while his career aggregates reconcile across all 23 seasons. New databases do **not** receive this data automatically; production imports through the authenticated endpoints on demand. The configuration's all-zero `preview_database_id` deliberately preserves the original local cache identity; the production `database_id` is the real provisioned database.

## Enable phone notifications

Production VAPID keys are already configured. Do not regenerate them for routine updates. For a new installation only, run `node scripts/generate-vapid.mjs` privately. It prints a public/private key pair; keep the private value out of source and chat transcripts. Configure these with `npx wrangler secret put NAME`, then redeploy:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (a `mailto:` contact or the deployed HTTPS app URL)

On iPhone, open the hosted HTTPS app in Safari, choose Share → Add to Home Screen, open the new icon and enable notifications in Settings. A local desktop preview cannot receive notifications on your phone. See [Apple's Web Push requirements](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

Live alerts start disabled. Once enabled, only watchlisted players with their alert switch enabled can trigger them. The first thresholds are 40/50/60 points, 7/10 blocks, 15 assists or 20 rebounds. Alerts include the verified stat line, opponent and game state. Persistent IDs prevent repeats. Score hiding suppresses live alerts and removes statistics from the bedtime notification. Overnight finalization is silent. Scheduled notifications respect quiet hours; an explicit test is immediate and limited to the selected registered device with a cooldown.

For injury changes, enable **Settings → Injury-status alerts**, then enable **Injury** beside each wanted player in Watchlist. This is independent of Live performance alerts and starts off for existing and newly added players. A five-minute poll compares explicit statuses only, silently establishes a baseline per game, and groups changes into one ESPN-attributed notification that opens that game's injury report. Quiet-hour changes are not backlogged; failed delivery retries only while the same fresh status is still relevant before tipoff. Disappearing from the feed never means “cleared.” No scores appear in injury alerts.

Apply migrations `0004_injury_alerts.sql` and `0005_boxscore_cache.sql` before deploying this feature. Box scores refresh while visible and on resume; provider failures retain saved rows with their original check time and a warning. The authenticated `/api/push/release` operation sends only fixed, once-per-release update copy to already registered devices; it does not enable injury alerts or accept arbitrary notification content.

## Optional AI and budget

The app works without an OpenAI account. To enable the editor, configure `OPENAI_API_KEY` as a Worker secret and redeploy. API billing is separate from a ChatGPT subscription. The supported `AI_MODEL` is `gpt-6.1-sol`; changes require rechecking the price bound.

Before each AI request, D1 atomically reserves **$0.04**, with no more than **$3 total reserved per UTC calendar month**. Calls are limited to a given date/edition, 12,000 UTF-8 bytes for the complete request, and 600 output tokens including reasoning. Failed or uncertain requests retain the reservation. The UI therefore shows a conservative budget reservation, not an invoice or an exact provider bill. Once the budget is exhausted, templates continue with no AI request. This cap only controls this application's calls, not other usage on the same account.

At the rates checked on 2026-10-10 ($2/million input, $10/million output), the maximum payload costs less than the reserved amount. [Verify current model pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol) before changing the model. No automated paid web searches are implemented. Historical game logs do not establish league-wide first-ever records, so those claims remain deliberately absent.

Expected infrastructure: Cloudflare free allocations at personal usage plus at most $3 reserved for AI. Free Workers have a CPU limit: profile real busy nights after launch. If the full-slate parsing exceeds that allowance, Workers Paid currently starts at $5/month, leaving the design within an $8 baseline before taxes/overages. This is an estimate, not a guaranteed bill. [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Checks and troubleshooting

```sh
npm test
npm run check
npm run build
npm audit
```

For the browser-based safe-area regression, open `/tests/fixtures/iphone-safe-area.html?suite` on the local Vite server. It renders the real stylesheet with controlled 59px, 20px and zero device insets in phone/desktop frames, checking header position and the black status-bar strip. This supplements, rather than replaces, an installed-iPhone check.

The injury dialog preview at `/tests/fixtures/injury-app-preview.html?width=390&safe=59` embeds the actual local app with a simulated top inset. Widths 320, 390 and 1280 and insets 0, 20 and 59 are supported; open a real game to inspect scrolling and dialog bounds.

- Feed errors: ESPN JSON endpoints are undocumented and have no service guarantee. Retry later; stored editions remain accessible. The adapter is isolated in `worker/espn.ts` for replacement.
- Rookie context uses provider experience metadata only; unavailable metadata is not guessed.
- Empty favorite: no game, DNP, future start or incomplete provider box score is different from scoring zero.
- No push: confirm HTTPS, installation on iPhone, permission, all three VAPID values, a saved subscription, quiet-hour settings and successful cron logs.
- No recap while asleep: run `npx wrangler tail` and inspect scheduler failures. Manual refresh remains available. Confirm the deployed D1 database received migrations.

Source plan: `docs/superpowers/plans/2026-10-10-nba-recap.md`.
