# Buzzer: player status plates, watched games, where to watch, full Hall of Fame

Status: requested by the user on 2026-10-14 with screenshots of the installed app. The user asked for the changes to be planned, implemented, pushed and released to the phone without a further approval round. Builds on the unshipped 2026-10-13 daily-roster commits (Today default, Following roster, League removal, Full Detail only) and supersedes the unfinished 2026-10-13 historical-records work that was left uncommitted in the main checkout.

## Intent

Keep the NBA 2K7 Association look (blue/chrome frames, silver stat cells, royal-blue selection, condensed white text, red light streaks). Make the phone app answer, at a glance: is my player playing tonight, which games have my players, where can I watch, and who holds the records.

## Requested changes

### Player status plates (Recap and Watchlist rosters)

Rows with no stat line replace the four dashes with one status plate spanning the PTS/REB/AST/BLK columns:

- Tipoff plate (blue chrome): tipoff time and opponent for a scheduled game.
- OUT plate (red): ESPN injury feed lists the player Out for today's slate, with reason.
- Questionable / Doubtful / Day-to-day / Probable plate (amber), shown with tipoff.
- DNP plate (maroon): box score DNP with ESPN's reason when supplied.
- No game plate (dim steel): verified schedule has no game for the player's team.
- Live / final / postponed / unavailable plates for the remaining states.

A live player who has stats and is listed Out after tipoff keeps the stats and gets a small red OUT tag. Injury statuses are fetched only for the current slate and never shown for past dates. Missing data stays "unavailable", never a guessed "no game".

### Watched players on games

Favorites are gold (star), Following is ice blue (diamond). A game with a watched player on one side gets an accent rail and player chips with headshots. A game with watched players on both sides becomes a Marquee Matchup: gold chrome ribbon and glow. Applies to the Games schedule and the Recap scoreboard. Game Report highlights and Around the League get the same tier badges; Around the League lists Following players first, then the night's best lines.

Watched-player teams self-heal from the current night's box scores so a traded player is matched to the right games.

### Games default date

Games opens on today's Eastern calendar date (already on the branch); verify and keep the Today control.

### Where to watch

Parse ESPN's US broadcast listings (national/home/away, TV/streaming) into each game. The game report's Injuries tab ends with a Where to Watch panel: League Pass verdict (available, blacked out nationally, blacked out in your area, listings pending) plus the networks and how to stream them (Prime Video, ESPN app / YouTube TV, Peacock / NBC, NBA TV, MSG/YES via TV provider or DAZN). Schedule rows show a compact network chip. Settings has one TV market select (default New York: Knicks and Nets blacked out).

Rules (checked 2026-10-14): ESPN/ABC/NBC/Peacock/NBCSN/Prime Video national games are blacked out on League Pass in the US; NBA TV is included with League Pass but local blackouts still apply; local broadcasts of the user's market teams are blacked out on League Pass; 2026–27 MSG and YES streaming moves to DAZN.

### Watchlist

Same status plates; no League section (already removed on the branch).

### Hall of Fame

- Three views: Season Leaders, Single Game, Single Season.
- Season picker is a native select (iOS scroll wheel) with previous/next steppers; loads on change. Every regular season from 1946–47, plus the in-progress season from ESPN once it has games.
- Per-game rankings need 20 games played (user's choice; was ESPN qualification). Totals have no minimum. Season Leaders and Single Season offer Per Game / Totals.
- Single Game: all-time regular-season top ten (ties kept) per category, with date, team and opponent.
- Single-line, equal-height card headers ("3-Pointers"). Ranking tables fit the phone width so values such as 33.5 are visible without sideways scrolling.
- Player photos: NBA.com transparent headshots (checked available at build time) mapped through Wikidata identity links, ESPN headshots as second choice, otherwise a neutral silhouette. All sit on the existing blue radial gradient.

Sources: Basketball-Reference season totals (verified per season, already ingested 2026-10-13), Wikipedia single-game leader lists (official record-book data with dates/opponents; Basketball-Reference single-game pages lack pre-1983 rebounds and pre-1985 blocks/steals), Wikidata for player identity crosswalks, NBA.com/ESPN CDNs for photos, ESPN statistics for seasons after the snapshot. No paid service is needed.

### Settings

Single column of four panels: Recap (bedtime, time zone, hide scores), Notifications (enable, live alerts, injury alerts, quiet hours, test), TV Market, Account (sign out). Remove recap length choices, Install panel (footer keeps Install), connection details, AI budget (shown only if AI is configured) and the Sample mode button.

## Release

Run the full test suite and production build, check iPhone-width screens, commit, push to GitHub and deploy with `wrangler deploy` (pushing alone does not deploy; deployments are manual). No new D1 migration; live-season stats reuse `historical_cache`. Reopening the installed app picks up the new version.
