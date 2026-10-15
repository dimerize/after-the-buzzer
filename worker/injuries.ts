import type { Dashboard, Game } from '../src/shared/types';
import type { GameInjuryReport, InjuryPlayer, InjuryTeam } from '../src/shared/injury-types';
import { validDate } from './validation';

const FEED_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
const SOURCE_URL = 'https://www.espn.com/nba/injuries';
// Verified public NBA reporting page; the 2026–27 page is not published yet.
const OFFICIAL_URL = 'https://official.nba.com/nba-injury-report-2025-26-season/';
const TTL = 60_000;
const STALE_AFTER = 15 * 60_000;
const TEAM_CODES: Record<string, string> = {
  '1': 'ATL', '2': 'BOS', '3': 'NOP', '4': 'CHI', '5': 'CLE', '6': 'DAL', '7': 'DEN', '8': 'DET',
  '9': 'GSW', '10': 'HOU', '11': 'IND', '12': 'LAC', '13': 'LAL', '14': 'MIA', '15': 'MIL',
  '16': 'MIN', '17': 'BKN', '18': 'NYK', '19': 'ORL', '20': 'PHI', '21': 'PHX', '22': 'POR',
  '23': 'SAC', '24': 'SAS', '25': 'OKC', '26': 'UTA', '27': 'WAS', '28': 'TOR', '29': 'MEM', '30': 'CHA',
};
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const text = (value: unknown, max = 120): string => typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '';
const id = (value: unknown): string => typeof value === 'number' ? String(value) : text(value, 16);
const validId = (value: string) => /^[1-9]\d{0,11}$/.test(value);
function timestamp(value: unknown): string | null {
  const raw = text(value, 40);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}
function athleteId(athlete: Obj): string {
  const direct = id(athlete.id);
  if (validId(direct)) return direct;
  for (const item of Array.isArray(athlete.links) ? athlete.links : []) {
    const href = text(obj(item).href, 400);
    const match = /^https:\/\/(?:www\.)?espn\.com\/nba\/player\/(?:[a-z]+\/)?_\/id\/([1-9]\d{0,11})(?:\/|$)/.exec(href);
    if (match) return match[1];
  }
  return '';
}
interface Feed { feedUpdatedAt: string | null; teams: InjuryTeam[]; warnings: string[]; verifiedPlayerKeys?: string[]; }
type FreshFeed = Feed & { feedUpdatedAt: string };
interface CacheRow { payload: string | null; checked_at: number | null; attempted_at: number; }
interface LoadedFeed { feed: Feed | null; fetchedAt: string | null; failed: boolean; }

export function parseInjuryFeed(value: unknown): Feed {
  const root = obj(value);
  if (!Array.isArray(root.injuries)) throw new Error('Injury feed is unavailable.');
  const warnings: string[] = [];
  const teams: InjuryTeam[] = [];
  const verifiedPlayerKeys: string[] = [];
  for (const raw of root.injuries) {
    const block = obj(raw);
    const teamId = id(block.id);
    const team = TEAM_CODES[teamId];
    if (!team || teams.some(existing => existing.team === team)) {
      warnings.push('Some team injury coverage could not be verified.'); continue;
    }
    const displayName = text(block.displayName) || team;
    if (!Array.isArray(block.injuries)) {
      teams.push({ team, displayName, coverage: 'unavailable', players: [] }); continue;
    }
    const players: InjuryPlayer[] = [];
    let omitted = 0;
    for (const entry of block.injuries) {
      const injury = obj(entry);
      const athlete = obj(injury.athlete);
      const playerId = athleteId(athlete);
      const playerTeamId = id(obj(athlete.team).id);
      const name = text(athlete.displayName ?? athlete.fullName);
      const status = text(injury.status, 40);
      if (!playerId || !name || !status || (playerTeamId && playerTeamId !== teamId)) { omitted++; continue; }
      const details = obj(injury.details);
      const useful = (input: unknown) => { const value = text(input); return /^(?:not specified|n\/a|unknown)$/i.test(value) ? '' : value; };
      const location = [useful(details.side), useful(details.type) || useful(details.location)].filter(Boolean).join(' ');
      const detail = useful(details.detail);
      const reason = [location, detail && detail.toLowerCase() !== location.toLowerCase() ? detail : ''].filter(Boolean).join(' · ') || 'Reason not provided';
      const returnDate = text(details.returnDate, 10);
      const player: InjuryPlayer = { id: playerId, name, status, reason, updatedAt: timestamp(injury.date), estimatedReturn: validDate(returnDate) ? returnDate : null };
      if (playerTeamId === teamId) verifiedPlayerKeys.push(`${team}:${playerId}`);
      const duplicate = players.findIndex(saved => saved.id === playerId);
      if (duplicate < 0) players.push(player);
      else if ((Date.parse(player.updatedAt || '') || 0) > (Date.parse(players[duplicate].updatedAt || '') || 0)) players[duplicate] = player;
    }
    if (omitted) warnings.push(`${team}: ${omitted} unverified injury ${omitted === 1 ? 'entry' : 'entries'} omitted; coverage is incomplete.`);
    teams.push({ team, displayName, coverage: omitted && !players.length ? 'unavailable' : 'reported', players });
  }
  const feedUpdatedAt = timestamp(root.timestamp);
  if (!feedUpdatedAt) warnings.push('ESPN did not supply a valid feed update time.');
  return { feedUpdatedAt, teams, warnings: [...new Set(warnings)], verifiedPlayerKeys };
}

function savedFeed(row: CacheRow | null): LoadedFeed {
  if (row?.payload && row.checked_at !== null && Number.isFinite(row.checked_at)) {
    try {
      const saved = JSON.parse(row.payload) as Feed;
      if (Array.isArray(saved.teams) && Array.isArray(saved.warnings) && (saved.feedUpdatedAt === null || timestamp(saved.feedUpdatedAt))) {
        return { feed: saved, fetchedAt: new Date(row.checked_at).toISOString(), failed: row.attempted_at > row.checked_at };
      }
    } catch { /* Corrupt cache must never masquerade as an empty report. */ }
  }
  return { feed: null, fetchedAt: null, failed: true };
}

async function downloadFeed(): Promise<Feed> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(FEED_URL, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('ESPN injury feed is unavailable.');
    // Bound a malformed/upstream response instead of buffering an unlimited body.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('ESPN injury feed was empty.');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 3_000_000) { await reader.cancel(); throw new Error('ESPN injury feed exceeded its size limit.'); }
      chunks.push(value);
    }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    return parseInjuryFeed(JSON.parse(new TextDecoder().decode(joined)));
  } finally { clearTimeout(deadline); }
}

const inFlight = new WeakMap<D1Database, Promise<LoadedFeed>>();
async function loadFeed(db: D1Database): Promise<LoadedFeed> {
  const pending = inFlight.get(db); if (pending) return pending;
  const operation = (async (): Promise<LoadedFeed> => {
    const now = Date.now();
    const read = () => db.prepare("SELECT payload, checked_at, attempted_at FROM injury_cache WHERE id='league'").bind().first<CacheRow>();
    let row = await read();
    if (row && now - row.attempted_at < TTL) return savedFeed(row);
    // Atomic cooldown works across Worker instances; no expiring lock to release.
    const claim = await db.prepare("INSERT INTO injury_cache(id,attempted_at) VALUES ('league',?) ON CONFLICT(id) DO UPDATE SET attempted_at=excluded.attempted_at WHERE injury_cache.attempted_at <= ?").bind(now, now - TTL).run();
    if (!claim.meta.changes) return savedFeed(await read());
    try {
      const feed = await downloadFeed();
      const fetchedAt = Date.now();
      await db.prepare("UPDATE injury_cache SET payload=?,checked_at=? WHERE id='league'").bind(JSON.stringify(feed), fetchedAt).run();
      return { feed, fetchedAt: new Date(fetchedAt).toISOString(), failed: false };
    } catch (error) {
      console.warn('Injury feed refresh failed:', error instanceof Error ? error.message : 'unknown failure');
      row = await read();
      return { ...savedFeed(row), failed: true };
    }
  })();
  inFlight.set(db, operation);
  try { return await operation; } finally { inFlight.delete(db); }
}

/** Fresh, verified provider rows for alert comparisons; cached failures never drive alerts. */
export async function loadAlertInjuryFeed(db: D1Database, now: Date): Promise<FreshFeed | null> {
  const loaded = await loadFeed(db);
  if (!loaded.feed || loaded.failed || !loaded.fetchedAt || !loaded.feed.feedUpdatedAt || !Array.isArray(loaded.feed.verifiedPlayerKeys)) return null;
  const age = now.getTime() - Date.parse(loaded.feed.feedUpdatedAt);
  const checkedAge = now.getTime() - Date.parse(loaded.fetchedAt);
  if (!Number.isFinite(age) || age < -5 * 60_000 || age > STALE_AFTER || checkedAge > 2 * TTL) return null;
  return loaded.feed as FreshFeed;
}

function easternDate(now: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function loadGameInjuries(db: D1Database, game: Game, date: string, now = new Date()): Promise<GameInjuryReport> {
  const teams = [game.away, game.home].map(team => ({ team, displayName: team, coverage: 'unavailable' as const, players: [] }));
  const base: GameInjuryReport = { gameId: game.id, date, game, source: 'espn', sourceUrl: SOURCE_URL, officialSourceUrl: OFFICIAL_URL,
    fetchedAt: null, feedUpdatedAt: null, stale: false, availability: 'unavailable', teams, warnings: [] };
  if (date < easternDate(now) || ['final', 'postponed'].includes(game.status)) {
    return { ...base, availability: 'historical-unavailable' };
  }
  const loaded = await loadFeed(db);
  if (!loaded.feed) return { ...base, warnings: ['ESPN injury data is unavailable. Try refreshing shortly.'] };
  const { feed } = loaded;
  const sourceAge = now.getTime() - Date.parse(feed.feedUpdatedAt || '');
  const stale = loaded.failed || !Number.isFinite(sourceAge) || sourceAge > STALE_AFTER || sourceAge < -5 * 60_000
    || now.getTime() - Date.parse(loaded.fetchedAt || '') > 2 * TTL;
  return { ...base, availability: 'current', fetchedAt: loaded.fetchedAt, feedUpdatedAt: feed.feedUpdatedAt, stale,
    teams: [game.away, game.home].map(team => feed.teams.find(candidate => candidate.team === team) ?? { team, displayName: team, coverage: 'not-listed', players: [] }),
    warnings: [...feed.warnings.filter(warning => {
      const teamWarning = /^([A-Z]{3}):/.exec(warning);
      return !teamWarning || [game.away, game.home].includes(teamWarning[1]);
    }),
      ...(loaded.failed ? ['Refresh unavailable. Showing the saved ESPN list with its original timestamps.'] : []),
      ...(stale && !loaded.failed ? ['The ESPN feed update time is old or unverified. Check the source before relying on availability.'] : []),
    ],
  };
}

/** Today's listings for watched players (roster status plates). Never used for alerts. */
export async function loadPlayerInjuries(db: D1Database, ids: string[], now = new Date()): Promise<NonNullable<Dashboard['injuries']> | null> {
  if (!ids.length) return null;
  const loaded = await loadFeed(db);
  if (!loaded.feed) return null;
  const sourceAge = now.getTime() - Date.parse(loaded.feed.feedUpdatedAt || '');
  const wanted = new Set(ids);
  const players: NonNullable<Dashboard['injuries']>['players'] = {};
  for (const team of loaded.feed.teams) for (const player of team.players) {
    if (wanted.has(player.id)) players[player.id] = { status: player.status, reason: player.reason === 'Reason not provided' ? '' : player.reason, updatedAt: player.updatedAt, team: team.team };
  }
  return { checkedAt: loaded.fetchedAt, stale: loaded.failed || !Number.isFinite(sourceAge) || sourceAge > STALE_AFTER, players };
}
