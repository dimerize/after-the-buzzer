import type { Game, Night, PlayerLine, Preferences } from '../src/shared/types';
import { validDate } from './validation';

export interface NotificationPayload { title: string; body: string; url: string; tag: string }
const BASIC_STATS = ['points', 'rebounds', 'assists', 'steals', 'blocks'] as const;
const clean = (text: string, limit: number) => text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, limit);
const link = (night: Night, player?: PlayerLine) => `/?date=${night.date}${player ? `&player=${player.id}` : ''}`;

function verifiedGame(night: Night, player: PlayerLine): Game | undefined {
  if (night.source !== 'espn' || !validDate(night.date) || !/^[1-9]\d{0,11}$/.test(player.id) || !player.name.trim()
    || player.didNotPlay || !Number.isFinite(player.minutes) || player.minutes <= 0
    || BASIC_STATS.some(key => !Number.isInteger(player[key]) || player[key] < 0)) return;
  return night.games.find(game => game.id === player.gameId && ['live', 'final'].includes(game.status)
    && game.status === player.status && [game.home, game.away].includes(player.team));
}
function opponent(game: Game, player: PlayerLine): string {
  return clean(game.home === player.team ? game.away : game.home, 8);
}
function state(game: Game): string {
  return game.status === 'final' ? 'final' : `live ${clean(game.statusText, 24)}`;
}
function context(night: Night): string {
  const live = night.games.filter(game => game.status === 'live').length;
  const later = night.games.filter(game => game.status === 'scheduled').length;
  const postponed = night.games.filter(game => game.status === 'postponed').length;
  const pieces = [live ? `${live} live` : '', later ? `${later} to start` : '', postponed ? `${postponed} postponed` : ''].filter(Boolean);
  if (!pieces.length) pieces.push('All games final');
  if (night.partial) pieces.push('partial data');
  return pieces.join(' · ');
}

export function bedtimeNotification(night: Night, preferences: Preferences): NotificationPayload | null {
  if (night.source !== 'espn' || !validDate(night.date) || !night.games.length) return null;
  const base = { title: 'NBA recap available', url: link(night), tag: `night-${night.date}` };
  // Do not rank players or expose completion/coverage when spoilers are hidden.
  if (preferences.hideScores) return { ...base, body: `Your recap for ${night.date} is ready. Open it when you want to see the scores.` };
  const ranking = (player: PlayerLine) => {
    const index = preferences.players.findIndex(watched => watched.id === player.id);
    if (index < 0 || preferences.players[index].tier === 'league') return 200;
    return (preferences.players[index].tier === 'favorite' ? 0 : 100) + index;
  };
  const performers = night.players.filter(player => verifiedGame(night, player)).sort((a, b) =>
    ranking(a) - ranking(b) || (b.points + b.rebounds + b.assists) - (a.points + a.rebounds + a.assists));
  const remaining = context(night);
  const lines: string[] = [];
  for (const player of performers) {
    if (lines.length === 2) break;
    const game = verifiedGame(night, player)!;
    const text = `${clean(player.name, 26)}: ${player.points} PTS ${player.rebounds} REB ${player.assists} AST · vs ${opponent(game, player)} · ${state(game)}`;
    if ([...lines, text, remaining].join('; ').length <= 200) lines.push(text);
  }
  return { ...base, url: lines.length ? link(night, performers[0]) : base.url,
    body: [...(lines.length ? lines : ['Player stats unavailable']), remaining].join('; ').slice(0, 200) };
}

export function milestoneNotification(night: Night, preferences: Preferences, player: PlayerLine, milestone: typeof BASIC_STATS[number]): NotificationPayload | null {
  const game = verifiedGame(night, player);
  if (preferences.hideScores || !game || game.status !== 'live') return null;
  return { title: `${clean(player.name, 50)} · ${player[milestone]} ${milestone}`,
    body: `${player.points} PTS · ${player.rebounds} REB · ${player.assists} AST · ${player.steals} STL · ${player.blocks} BLK · vs ${opponent(game, player)} · ${state(game)}${night.partial ? ' · partial data' : ''}`.slice(0, 200),
    url: link(night, player), tag: `live-${player.gameId}-${player.id}` };
}
