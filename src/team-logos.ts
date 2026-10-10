export interface HistoricalTeamLogo { src: string; label: string; era: string }

// Primary marks from the exact 2007–08 season, not today's NBA identities.
// Image provenance and trademark/attribution notes: docs/team-logo-sources.md.
const teams: Record<string, string> = {
  ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', CHA: 'Charlotte Bobcats', CHI: 'Chicago Bulls',
  CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons',
  GSW: 'Golden State Warriors', HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'Los Angeles Clippers',
  LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies', MIA: 'Miami Heat', MIL: 'Milwaukee Bucks',
  MIN: 'Minnesota Timberwolves', NJN: 'New Jersey Nets', NOH: 'New Orleans Hornets', NYK: 'New York Knicks',
  ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers',
  SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs', SEA: 'Seattle SuperSonics', TOR: 'Toronto Raptors',
  UTA: 'Utah Jazz', WAS: 'Washington Wizards',
};
const aliases: Record<string, string> = {
  BKN: 'NJN', BRK: 'NJN', NJ: 'NJN', OKC: 'SEA', NOP: 'NOH', NO: 'NOH', NOK: 'NOH',
  CHO: 'CHA', SA: 'SAS', GS: 'GSW', NY: 'NYK', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX',
};

export function getTeamLogo(team: string): HistoricalTeamLogo | undefined {
  const normalized = team.trim().toUpperCase();
  const key = aliases[normalized] ?? normalized;
  const label = teams[key];
  return label ? { src: `/team-logos/${key.toLowerCase()}.png`, label, era: '2007–08' } : undefined;
}
