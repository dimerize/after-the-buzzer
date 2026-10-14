# Buzzer: daily roster and historical records

Status: approved by the user on 2026-10-13, including the non-Hall-of-Fame changes. No product implementation or deployment yet.

## Intent

Make Buzzer useful for checking watched players' games today and browsing basketball records. Preserve the existing blue/chrome 2K7 presentation and compact desktop-style grid on phones. Keep installed-app identity, notification subscriptions, login and existing watchlists intact.

## Requested changes

- Games initially opens on the current Eastern calendar day, not tomorrow. Previous/next dates remain available. A Today action returns to the current date. Reopening a stale default view after midnight refreshes its day; explicitly selected historical dates stay selected.
- Game rows identify favorite players associated with either team, using small real headshots and names. Following players are distinguished from favorites. These indicators mean their team has a game, not that the player is confirmed to play; existing injury reports remain accessible.
- Roster supports Favorites and Following, retaining the same multi-player stat grid. Builder choice: add an All view too, with Favorites as the initial view. Following maps to the existing interest tier.
- Match the roster's status to its displayed recap date, not blindly to today's date when browsing older recaps. Use verified complete schedule data to distinguish No game scheduled, Scheduled (with opponent/tipoff), Live, Final, DNP and Postponed. Missing/unavailable data stays explicitly unavailable, never falsely No game scheduled. A scheduled team game does not establish player participation.
- Remove League as a user-facing watchlist category and selector option. Preserve saved League entries by treating/migrating them as Following; do not drop players or their alert choices. This does not remove highlights for unwatched players or the league-wide scoreboard.
- Full Detail becomes the only recap mode, including existing saved Quick/Standard preferences. Remove the choice controls; enforce full detail in client and server recap/notification generation without resetting any unrelated settings.
- Hall of Fame gets historical season browsing, single-game records and single-season records, with real player pictures wherever a verified image is available.
- Replace the freeform season-ending field and Load button with a season dropdown using labels such as 2024–25 and loading on selection.
- Fix mobile Three-pointers wrapping and uneven card headers. Builder choice: use the short label 3-Pointers and equal-height single-line headers.

## Hall of Fame structure

Three views within Hall of Fame: Season Leaders, Single Game, Single Season. Keep the existing card-to-ranking-table interaction and desktop-like compact layout on phones.

### Season Leaders

Browse individual regular seasons, defaulting to the last completed season. Rank points, rebounds, assists, blocks, steals and made threes per game from the full available player dataset, not a provider's already-qualified leaders list.

Use at least 30 games played for per-game rankings. Show GP in the ranking table and a concise 30-game minimum label. These are Buzzer rankings, not official NBA qualified-leader awards. Do not specially boost any player. Sort using source precision, preserve genuine ties and format numbers for display only afterward.

### Single Game

All-time regular-season individual game records for the same six categories, with ranked performances, real player photos, value, date, team and opponent when recorded, and source links. Preserve tied records. No games-played minimum applies to an individual performance. No career-total rankings requested.

### Single Season

All-time regular-season individual season rankings for the same six categories. Provide Totals and Per Game; builder choice: default Totals. Each row includes player photo, season, team(s), GP and value. Per Game requires at least 30 games played. Totals have no GP minimum. Do not calculate totals from rounded averages. Combine traded-player seasons once using verified combined totals; avoid double counting team splits.

### Historical coverage and sources

Target the full NBA/BAA history from 1946–47, rather than silently offering old years that return blank screens. Do not mix ABA, preseason, playoffs or exhibitions into regular-season records. Stats that were not recorded in an era are unavailable, not zero.

Current implementation relies on ESPN season leaders and ESPN player-ID image URLs. Implementation must verify historical data coverage and select a reliable primary historical source or a source-attributed dataset where the ESPN leader endpoint is insufficient. This source selection is delegated to the builder and must be supported by actual endpoint/data checks before promising coverage. Avoid scraping the entire historical game universe per user request; precompute/cache records where appropriate. Use existing Cloudflare Worker/D1 and stay within the existing low-cost hosting approach. A new paid data subscription requires user approval.

All-time means source-backed coverage, not maxima from the user's watchlist or a partial sample of fetched games. Record response metadata must identify supported seasons/stat eras, provenance, verification time and completeness. Do not label partial top lists as complete all-time rankings. If verified complete rankings cannot be obtained, present verified record holders with accurate scope rather than invented lower ranks, and report the limitation before release.

Resolve historical player identities across source namespaces explicitly; never construct an ESPN image URL from a different provider's player ID. Use actual historical player photos from verified sources, cached where permitted. Use an honest neutral fallback for genuinely unavailable photos, not AI-generated portraits or another player's image. Missing images must not break ranking layout.

## Existing code observations

- src/schedule-view.ts nextScheduleDate advances one day after 06:00 Eastern.
- src/PlayerRoster.tsx only selects favorites and falls through to No data without matching a team schedule.
- src/App.tsx still exposes League and Quick/Standard/Full Detail controls.
- src/History.tsx uses a numeric season input, ESPN-ID-only Portrait component and current season honors API.
- Existing historical requests have loading, retry, key isolation and partial-coverage notices; preserve these protections.

## Verification and release expectations

Test midnight/DST/current-day selection, explicit date navigation, schedule unavailable versus verified no-game states, team abbreviation aliases, favorites/following grouping, saved preference compatibility and full-detail enforcement. Check record ties, 29/30-game boundaries, traded seasons, stat-era gaps, identity/photo mappings, source season validation and stale/cached historical data. Verify older seasons and historical record holders with source evidence, not merely mock fixtures.

Visually check the existing mobile roster and Hall of Fame at iPhone widths, including long player names and all six headers. Preserve safe-area spacing and notification behavior. Run the existing full suite and production build. Do not publish incomplete or mislabeled historical coverage. Release through the existing GitHub/Cloudflare workflow after approval of this scope; no reinstall or notification re-registration is part of the implementation.
