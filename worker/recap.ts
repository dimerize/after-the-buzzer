import type { Game, Highlight, Leader, Night, PlayerLine, Preferences } from '../src/shared/types';

const LEADER_STATS = [
  ['Points', 'points'], ['Rebounds', 'rebounds'], ['Assists', 'assists'],
  ['Blocks', 'blocks'], ['Steals', 'steals'], ['Threes', 'threes']
] as const;

/** Stories describe only this slate's supplied box scores, never historical records. */
export function buildRecap(games: Game[], players: PlayerLine[], preferences: Preferences, meta: Pick<Night, 'date' | 'season' | 'seasonType'>): Night {
  const byGame = new Map(games.map(game => [game.id, game]));
  const eligible = players.filter(player => !player.didNotPlay && player.minutes > 0 &&
    ['live', 'final'].includes(byGame.get(player.gameId)?.status ?? '') &&
    LEADER_STATS.every(([, key]) => Number.isFinite(player[key]) && player[key] >= 0));
  const leaders: Leader[] = LEADER_STATS.flatMap(([category, key]) => {
    const value = Math.max(0, ...eligible.map(player => player[key]));
    if (value === 0) return [];
    const tied = eligible.filter(player => player[key] === value).sort((a, b) => a.name.localeCompare(b.name));
    return [{ category, value, playerIds: tied.map(player => player.id), names: tied.map(player => player.name) }];
  });
  const preferencesById = new Map(preferences.players.map(player => [player.id, player]));
  const strongestStories = new Map<string, Highlight>();
  for (const player of eligible) {
    const game = byGame.get(player.gameId)!;
    const tier = preferencesById.get(player.id)?.tier;
    const strength = player.points + player.rebounds * 1.2 + player.assists * 1.5 + (player.steals + player.blocks) * 3 - player.turnovers;
    const weight = tier === 'favorite' ? 16 : tier === 'interest' ? 6 : 0;
    const line = `${player.points} PTS · ${player.rebounds} REB · ${player.assists} AST · ${player.steals} STL · ${player.blocks} BLK`;
    const timing = game.status === 'live' ? ' In progress.' : '';
    function add(category: Highlight['category'], suffix: string, title: string, detail: string, bonus: number, statLabel = 'PTS', statValue = String(player.points)) {
      const key = `${game.id}:${player.id}`;
      const story: Highlight = { id: `${key}:${suffix}`, playerId: player.id, category, title, detail: `${detail}${timing}`, score: strength + weight + bonus, statLabel, statValue, sourceUrl: game.sourceUrl };
      const current = strongestStories.get(key);
      if (!current || story.score > current.score || (story.score === current.score && story.id.localeCompare(current.id) < 0)) strongestStories.set(key, story);
    }
    const doubles = [player.points, player.rebounds, player.assists, player.steals, player.blocks].filter(value => value >= 10).length;
    const fiveByFive = [player.points, player.rebounds, player.assists, player.steals, player.blocks].every(value => value >= 5);
    const doubleLabel = doubles >= 4 ? 'quadruple-double' : 'triple-double';
    const doubleDetail = doubles >= 3 ? ` ${doubleLabel}.` : '';
    if (fiveByFive) add('milestone', 'five-by-five', `${player.name}: five-by-five`, `${line}.${doubleDetail}`, 55, '5 × 5', '5');
    if (doubles >= 3) add('milestone', 'triple-double', `${player.name}: ${doubleLabel}`, `${line}.`, 35, 'DOUBLE FIGURES', String(doubles));
    if (player.points >= 40 || player.rebounds >= 20 || player.assists >= 15 || player.blocks >= 5 || player.steals >= 5 || player.threes >= 8) {
      const standout = player.points >= 40 ? `${player.points} points` : player.blocks >= 5 ? `${player.blocks} blocks` : player.steals >= 5 ? `${player.steals} steals` : player.rebounds >= 20 ? `${player.rebounds} rebounds` : player.assists >= 15 ? `${player.assists} assists` : `${player.threes} threes`;
      add('standout', 'standout', `${player.name}: ${standout}`, `${line}. ${player.fgMade}-${player.fgAttempted} FG · ${Math.round(player.minutes)} MIN · vs ${player.opponent}.`, 15);
    } else if (player.points >= 20 || strength >= 38) {
      add('standout', 'standout', `${player.name}: ${player.points} points`, `${line} against ${player.opponent}.`, 0);
    }
    if (player.fgAttempted >= 10 && player.points >= 20 && player.fgMade / player.fgAttempted >= 0.65) {
      add('efficiency', 'efficiency', `${player.name}: ${player.fgMade}/${player.fgAttempted} FG`, `${player.points} PTS · ${Math.round(player.fgMade / player.fgAttempted * 100)}% FG · vs ${player.opponent}.`, 5, 'FG', `${player.fgMade}/${player.fgAttempted}`);
    }
    if (player.rookie && (player.points >= 15 || strength >= 30)) add('rookie', 'rookie', `${player.name}: ${player.points} points (rookie)`, `${line} against ${player.opponent}.`, 7);
    if (tier === 'favorite') add('favorite', 'favorite', `${player.name}: ${player.points} points`, `${line}. ${player.fgMade}-${player.fgAttempted} FG · ${player.threes} 3PM · ${Math.round(player.minutes)} MIN.`, 0);
  }
  const stories = [...strongestStories.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const limit = 16;
  const highlights = stories.slice(0, limit);
  // A quiet favorite still earns a mention, even on a busy league night.
  for (const story of stories.filter(story => preferencesById.get(story.playerId ?? '')?.tier === 'favorite')) {
    if (!highlights.some(highlight => highlight.id === story.id)) highlights.push(story);
  }
  const started = games.filter(game => game.status === 'live' || game.status === 'final');
  const missing = started.filter(game => !eligible.some(player => player.gameId === game.id));
  const missingScores = started.filter(game => game.homeScore === null || game.awayScore === null);
  const warnings = [
    ...missing.map(game => `Box score unavailable for ${game.away} at ${game.home} (${game.id}).`),
    ...missingScores.map(game => `Score unavailable for ${game.away} at ${game.home} (${game.id}).`)
  ];
  const partial = warnings.length > 0;
  const final = games.length > 0 && games.every(game => game.status === 'final') && !partial;
  const completed = games.filter(game => game.status === 'final').length;
  const live = games.filter(game => game.status === 'live').length;
  const scheduled = games.filter(game => game.status === 'scheduled').length;
  const postponed = games.filter(game => game.status === 'postponed').length;
  const counts = [`${completed} of ${games.length} games final`, live ? `${live} in progress` : '', scheduled ? `${scheduled} scheduled` : '', postponed ? `${postponed} postponed or canceled` : ''].filter(Boolean).join(' · ');
  const headline = highlights[0]?.title ?? (games.length === 0 ? 'No games on this date' : scheduled === games.length ? 'Games not started' : postponed === games.length ? 'Games postponed or canceled' : 'Box scores unavailable');
  let summary = games.length === 0 ? 'ESPN lists no NBA games for this basketball date.' : `${counts}.`;
  if (partial) summary += ' Incomplete box-score coverage.';
  return { ...meta, updatedAt: new Date().toISOString(), edition: final ? 'final' : 'live', games, players, highlights, leaders, headline, summary, source: 'espn', partial, warnings };
}
