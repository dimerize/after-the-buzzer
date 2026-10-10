import { DEFAULT_PREFERENCES } from './shared/defaults';
import type { Dashboard, PlayerLine, Preferences } from './shared/types';

const sampleLine = (line: Partial<PlayerLine> & Pick<PlayerLine, 'id' | 'name' | 'team'>): PlayerLine => ({
  opponent: 'DEN', gameId: 'sample-sas-den', rookie: false, status: 'final', starter: true,
  didNotPlay: false, points: 18, rebounds: 5, assists: 4, steals: 1, blocks: 0, threes: 2,
  minutes: 32, fgMade: 7, fgAttempted: 14, ftMade: 2, ftAttempted: 2, turnovers: 2, plusMinus: 8, ...line
});

export const SAMPLE_PLAYERS = [
  ...DEFAULT_PREFERENCES.players,
  { id: '3975', name: 'Stephen Curry', team: 'GSW', tier: 'interest' as const, alerts: false },
  { id: '3112335', name: 'Nikola Jokić', team: 'DEN', tier: 'interest' as const, alerts: false },
  { id: '3945274', name: 'Luka Dončić', team: 'LAL', tier: 'interest' as const, alerts: false },
  { id: '4278073', name: 'Shai Gilgeous-Alexander', team: 'OKC', tier: 'interest' as const, alerts: false },
  { id: '4065648', name: 'Jayson Tatum', team: 'BOS', tier: 'interest' as const, alerts: false },
];

export function demoDashboard(preferences: Preferences = structuredClone(DEFAULT_PREFERENCES), date = '2026-10-09'): Dashboard {
  const players = [
    sampleLine({ id: '5104157', name: 'Victor Wembanyama', team: 'SAS', points: 34, rebounds: 16, assists: 5, blocks: 7, steals: 2, threes: 3, fgMade: 13, fgAttempted: 21, ftMade: 5, ftAttempted: 6, plusMinus: 18, minutes: 35 }),
    sampleLine({ id: '1966', name: 'LeBron James', team: 'PHI', opponent: 'GSW', gameId: 'sample-phi-gsw', points: 28, rebounds: 8, assists: 11, threes: 2, fgMade: 11, fgAttempted: 19, ftMade: 4, ftAttempted: 5, plusMinus: 9, minutes: 34 }),
    sampleLine({ id: '5037871', name: 'Dylan Harper', team: 'SAS', points: 19, rebounds: 4, assists: 6, steals: 2, threes: 1, fgMade: 7, fgAttempted: 13, ftMade: 4, ftAttempted: 4, plusMinus: 12, minutes: 29 }),
    sampleLine({ id: '4845367', name: 'Stephon Castle', team: 'SAS', points: 17, rebounds: 5, assists: 7, steals: 3, threes: 1, fgMade: 6, fgAttempted: 12, ftMade: 4, ftAttempted: 4, plusMinus: 14, minutes: 31 }),
    sampleLine({ id: '3112335', name: 'Nikola Jokić', team: 'DEN', opponent: 'SAS', points: 29, rebounds: 12, assists: 10, fgMade: 12, fgAttempted: 20, threes: 1, ftMade: 4, ftAttempted: 4, plusMinus: -6 }),
    sampleLine({ id: '3975', name: 'Stephen Curry', team: 'GSW', opponent: 'PHI', gameId: 'sample-phi-gsw', points: 32, rebounds: 4, assists: 6, threes: 7, fgMade: 10, fgAttempted: 23, ftMade: 5, ftAttempted: 5, plusMinus: -4 }),
    sampleLine({ id: '4278073', name: 'Shai Gilgeous-Alexander', team: 'OKC', opponent: 'DAL', gameId: 'sample-dal-okc', points: 38, rebounds: 6, assists: 8, threes: 2, fgMade: 14, fgAttempted: 24, ftMade: 8, ftAttempted: 9, minutes: 36, plusMinus: 15 }),
  ];
  return {
    night: {
      date, updatedAt: `${date}T23:48:00-04:00`, edition: 'bedtime', season: '2026–27', seasonType: 'preseason',
      games: [
        { id: 'sample-sas-den', away: 'DEN', home: 'SAS', awayScore: 108, homeScore: 119, status: 'final', statusText: 'Final', startsAt: `${date}T19:30:00-04:00`, sourceUrl: '' },
        { id: 'sample-phi-gsw', away: 'PHI', home: 'GSW', awayScore: 116, homeScore: 112, status: 'final', statusText: 'Final', startsAt: `${date}T21:00:00-04:00`, sourceUrl: '' },
        { id: 'sample-dal-okc', away: 'DAL', home: 'OKC', awayScore: 101, homeScore: 118, status: 'final', statusText: 'Final', startsAt: `${date}T20:00:00-04:00`, sourceUrl: '' },
        { id: 'sample-phx-sac', away: 'PHX', home: 'SAC', awayScore: 87, homeScore: 91, status: 'live', statusText: '4th · 8:42', startsAt: `${date}T22:00:00-04:00`, sourceUrl: '' },
      ], players,
      highlights: [
        { id: 'sample-wemby', playerId: '5104157', title: 'Wembanyama: 7 blocks', detail: '34 PTS · 16 REB · 5 AST · 2 STL · 7 BLK · vs DEN.', category: 'favorite', score: 100, statLabel: 'blocks', statValue: '7', sourceUrl: '' },
        { id: 'sample-shai', playerId: '4278073', title: 'Gilgeous-Alexander: 38 points', detail: '38 PTS · 6 REB · 8 AST · 14/24 FG · vs DAL.', category: 'standout', score: 90, statLabel: 'points', statValue: '38', sourceUrl: '' },
        { id: 'sample-jokic', playerId: '3112335', title: 'Jokić: triple-double', detail: '29 PTS · 12 REB · 10 AST · vs SAS.', category: 'standout', score: 80, statLabel: 'assists', statValue: '10', sourceUrl: '' },
      ],
      leaders: [
        { category: 'Points', value: 38, playerIds: ['4278073'], names: ['Shai Gilgeous-Alexander'] },
        { category: 'Rebounds', value: 16, playerIds: ['5104157'], names: ['Victor Wembanyama'] },
        { category: 'Assists', value: 11, playerIds: ['1966'], names: ['LeBron James'] },
        { category: 'Blocks', value: 7, playerIds: ['5104157'], names: ['Victor Wembanyama'] },
      ],
      headline: 'Wembanyama: 7 blocks',
      summary: '3 of 4 games final · 1 in progress.',
      source: 'demo', partial: false, warnings: []
    }, preferences,
    archive: [
      { date: '2026-10-09', headline: 'Wembanyama: 7 blocks', edition: 'bedtime' },
      { date: '2026-10-08', headline: 'Sample recap — October 8', edition: 'final' },
      { date: '2026-10-07', headline: 'Sample recap — October 7', edition: 'final' },
    ],
    trackers: players.slice(0, 4).map((p) => ({ playerId: p.id, name: p.name, games: 3, points: +(p.points * .87).toFixed(1), rebounds: +(p.rebounds * .9).toFixed(1), assists: +(p.assists * .9).toFixed(1), blocks: +(p.blocks * .8).toFixed(1), pointsHigh: p.points, lastFive: [Math.round(p.points * .8), Math.round(p.points * .81), p.points], scope: 'Fictional sample · 3 games · Oct 7–9, 2026 · preseason' })),
    capabilities: { liveData: false, persistent: false, push: false, ai: false },
    budget: { used: 0, limit: 3, month: '2026-10' }
  };
}
