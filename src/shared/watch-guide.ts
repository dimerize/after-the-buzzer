import type { Broadcast, Game } from './types';
import { canonicalTeam } from './team-matching';

/** League Pass blackout areas. A market blacks out its own teams' local broadcasts. */
export interface TvMarket { id: string; label: string; teams: string[] }
const single: [string, string, string][] = [
  ['ATL', 'Atlanta', 'Hawks'], ['BOS', 'Boston', 'Celtics'], ['CHA', 'Charlotte', 'Hornets'], ['CHI', 'Chicago', 'Bulls'], ['CLE', 'Cleveland', 'Cavaliers'],
  ['DAL', 'Dallas', 'Mavericks'], ['DEN', 'Denver', 'Nuggets'], ['DET', 'Detroit', 'Pistons'], ['GSW', 'Bay Area', 'Warriors'], ['HOU', 'Houston', 'Rockets'],
  ['IND', 'Indiana', 'Pacers'], ['MEM', 'Memphis', 'Grizzlies'], ['MIA', 'Miami', 'Heat'], ['MIL', 'Milwaukee', 'Bucks'], ['MIN', 'Minnesota', 'Timberwolves'],
  ['NOP', 'New Orleans', 'Pelicans'], ['OKC', 'Oklahoma City', 'Thunder'], ['ORL', 'Orlando', 'Magic'], ['PHI', 'Philadelphia', '76ers'], ['PHX', 'Phoenix', 'Suns'],
  ['POR', 'Portland', 'Trail Blazers'], ['SAC', 'Sacramento', 'Kings'], ['SAS', 'San Antonio', 'Spurs'], ['TOR', 'Toronto', 'Raptors'], ['UTA', 'Utah', 'Jazz'], ['WAS', 'Washington', 'Wizards'],
];
export const TV_MARKETS: TvMarket[] = [
  { id: 'NY', label: 'New York (Knicks, Nets)', teams: ['NYK', 'BKN'] },
  { id: 'LA', label: 'Los Angeles (Lakers, Clippers)', teams: ['LAL', 'LAC'] },
  ...single.map(([team, city, name]) => ({ id: team, label: `${city} (${name})`, teams: [team] })),
  { id: 'NONE', label: 'No local team', teams: [] },
];
export const DEFAULT_TV_MARKET = 'NY';
export const tvMarket = (id: string | undefined) => TV_MARKETS.find(market => market.id === id) ?? TV_MARKETS[0];

const TEAM_NAMES: Record<string, string> = { NYK: 'Knicks', BKN: 'Nets', LAL: 'Lakers', LAC: 'Clippers', ...Object.fromEntries(single.map(([team, , name]) => [team, name])) };

// How each network streams, as of the 2026–27 season (checked 2026-10-14).
const NATIONAL: [RegExp, string, string][] = [
  [/^prime( video)?$|amazon/i, 'Prime Video', 'Prime Video app'],
  [/^abc$/i, 'ABC', 'ABC · ESPN app · YouTube TV'],
  [/^espn(2|news)?$|^espn (app|unlimited)$|^espn\+$/i, 'ESPN', 'ESPN app · YouTube TV'],
  [/^nbc$/i, 'NBC', 'Peacock · NBC · YouTube TV'],
  [/^peacock$/i, 'Peacock', 'Peacock'],
  [/^nbcsn$/i, 'NBCSN', 'Peacock · NBCSN'],
];
const NBA_TV = /^nba ?tv$/i;
const LOCAL: [RegExp, string, string][] = [
  [/^msg/i, 'MSG', 'TV provider or DAZN (MSG streaming)'],
  [/^yes/i, 'YES', 'TV provider or DAZN (YES streaming)'],
];

/** Regional networks when ESPN has not listed the local feed yet. */
const USUAL_LOCAL: Record<string, string> = { NYK: 'MSG', BKN: 'YES' };

export type LeaguePassStatus = 'available' | 'national' | 'local' | 'listings-pending';
export interface WatchLine { network: string; detail: string; scope: string }
export interface WatchGuide { status: LeaguePassStatus; chip: string; headline: string; reason: string; lines: WatchLine[] }

const scopeLabel = (broadcast: Broadcast, game: Game) => broadcast.market === 'national' ? 'National' : `${broadcast.market === 'home' ? game.home : game.away} local`;

/** Where to watch from ESPN's US listings and the viewer's blackout market. Pure; listings may change before tipoff. */
export function watchGuide(game: Game, marketId?: string): WatchGuide {
  const market = tvMarket(marketId);
  const listings = game.broadcasts ?? [];
  const national = listings.filter(item => item.market === 'national');
  const exclusive = national.filter(item => NATIONAL.some(([pattern]) => pattern.test(item.name)));
  const nbaTv = national.some(item => NBA_TV.test(item.name));
  const sides = [canonicalTeam(game.away), canonicalTeam(game.home)];
  const local = sides.find(team => market.teams.includes(team));
  const lines: WatchLine[] = [];
  for (const item of listings) {
    const nationalNetwork = NATIONAL.find(([pattern]) => pattern.test(item.name));
    const localNetwork = LOCAL.find(([pattern]) => pattern.test(item.name));
    const detail = nationalNetwork ? nationalNetwork[2]
      : NBA_TV.test(item.name) ? 'NBA TV (included with League Pass) · YouTube TV'
        : localNetwork ? localNetwork[2]
          : item.type === 'streaming' ? 'Team streaming app (in market)' : 'Local TV (in market)';
    const network = nationalNetwork?.[1] ?? (localNetwork ? localNetwork[1] : item.name);
    if (!lines.some(line => line.network === network && line.scope === scopeLabel(item, game))) lines.push({ network, detail, scope: scopeLabel(item, game) });
  }
  const order = (line: WatchLine) => line.scope === 'National' ? 0 : local && line.scope.startsWith(local) ? 1 : 2;
  lines.sort((a, b) => order(a) - order(b));
  if (exclusive.length) {
    const names = [...new Set(exclusive.map(item => NATIONAL.find(([pattern]) => pattern.test(item.name))![1]))];
    return { status: 'national', chip: names[0], headline: 'Not on League Pass live', reason: `National broadcast on ${names.join(' / ')}. League Pass replay the next morning.`, lines };
  }
  if (local) {
    const channel = listings.find(item => item.market === (local === sides[1] ? 'home' : 'away') && item.type === 'tv');
    const usual = USUAL_LOCAL[local];
    const label = channel ? LOCAL.find(([pattern]) => pattern.test(channel.name))?.[1] ?? channel.name : usual ?? 'Local TV';
    // Local listings often post late; New York's regional networks are known.
    if (!channel && usual && !lines.some(line => line.scope === `${local} local`)) lines.push({ network: usual, detail: LOCAL.find(([pattern]) => pattern.test(usual))![2], scope: `${local} local (usual)` });
    return { status: 'local', chip: label, headline: 'Blacked out on League Pass', reason: `${TEAM_NAMES[local] ?? local} games are local in your area (${market.label.replace(/ \(.*/, '')}). Watch the local broadcast${label === 'Local TV' ? '' : ` on ${label}`}.`, lines };
  }
  if (!listings.length) return { status: 'listings-pending', chip: 'League Pass', headline: 'League Pass (expected)', reason: 'TV listings are not posted yet. Out-of-market games stream on League Pass unless a national broadcast is added.', lines };
  return { status: 'available', chip: 'League Pass', headline: 'Stream on League Pass', reason: nbaTv ? 'Also on NBA TV, which League Pass includes.' : 'Out-of-market game: home and away feeds are on League Pass.', lines };
}
