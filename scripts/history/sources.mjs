// Pure parsers for the historical records build. No network access here, so
// tests can exercise them with small fixtures.

/** [stat, Basketball-Reference column, first season the stat was recorded] */
export const STATS = [['points', 'pts', 1947], ['rebounds', 'trb', 1951], ['assists', 'ast', 1947], ['blocks', 'blk', 1974], ['steals', 'stl', 1974], ['threes', 'fg3', 1980]];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', minus: '−' };
export function decode(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}
/** Visible text of an HTML fragment: drops styles, sort keys, hidden spans and footnote markers. */
export function plain(html) {
  return decode(html
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<sup\b[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<span\b[^>]*(?:class="[^"]*sortkey[^"]*"|style="[^"]*display:\s*none[^"]*")[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ').trim();
}

export function seasonSourceUrl(season) { return `https://www.basketball-reference.com/leagues/${season < 1950 ? 'BAA' : 'NBA'}_${season}_totals.html`; }

/** One verified regular-season totals table; traded players count once via the combined row. */
export function parseReferenceSeason(html, season, verifiedAt) {
  const label = `${season - 1}-${String(season).slice(-2)}`;
  if (!Number.isInteger(season) || season < 1947 || !Number.isFinite(Date.parse(verifiedAt)) || !html.match(/<title>([^<]*)<\/title>/)?.[1].startsWith(`${label} ${season < 1950 ? 'BAA' : 'NBA'} Player Stats: Totals`)) throw new Error('Historical season identity could not be verified.');
  const body = html.match(/<table\b[^>]*\bid="totals_stats"[^>]*>([\s\S]*?)<\/table>/)?.[1]?.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  if (!body) throw new Error(`No regular-season totals table for ${season}.`);
  const sourceUrl = seasonSourceUrl(season);
  const groups = new Map();
  for (const match of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = Object.fromEntries([...match[1].matchAll(/<(?:td|th)\b[^>]*\bdata-stat="([^"]+)"[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map(cell => [cell[1], cell[2]]));
    if (!cells.name_display || plain(cells.name_display) === 'League Average') continue;
    const id = cells.name_display.match(/href="\/players\/[a-z]\/([a-z0-9]+)\.html"/)?.[1];
    if (!id) throw new Error(`Player identity missing in ${season}.`);
    const name = plain(cells.name_display).replace(/\*$/, '');
    const number = column => { const value = plain(cells[column] ?? '').replaceAll(',', ''); if (!/^\d+$/.test(value)) throw new Error(`Invalid ${column} for ${id} in ${season}.`); return Number(value); };
    const stats = Object.fromEntries(STATS.map(([key, column, since]) => [key, season >= since ? number(column) : null]));
    const games = number('games'), team = plain(cells.team_name_abbr ?? '');
    if (!name || !team || games < 1 || games > 100) throw new Error(`Invalid season row ${id}.`);
    groups.set(id, [...(groups.get(id) ?? []), { id: `bbr:${id}:${season}`, player: { source: 'basketball-reference', id, name }, season, team, games, stats, sourceUrl }]);
  }
  const rows = [];
  for (const [id, group] of groups) {
    const combined = group.filter(row => /^(TOT|\dTM)$/.test(row.team));
    if (group.length > 1 && combined.length !== 1) throw new Error(`Unresolved team splits for ${id} in ${season}.`);
    rows.push(combined[0] ?? group[0]);
  }
  if (!rows.length) throw new Error(`No verified players for ${season}.`);
  return { season, sourceUrl, verifiedAt, playerCount: rows.length, rows };
}

/** Wikipedia tables as grids with rowspan/colspan expanded. Each row keeps only its own cells for styling checks. */
export function parseTables(html) {
  const tables = [];
  for (const table of html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/g)) {
    if (!/wikitable/.test(table[1])) continue;
    const spans = [];
    const rows = [];
    for (const tr of table[2].matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
      const own = [...tr[2].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(cell => ({
        tag: cell[1], attrs: cell[2], html: cell[3],
        rowspan: Number(/rowspan="?(\d+)/.exec(cell[2])?.[1] ?? 1), colspan: Number(/colspan="?(\d+)/.exec(cell[2])?.[1] ?? 1),
      }));
      const line = [];
      let column = 0;
      const carry = () => { while (spans[column]?.left > 0) { line[column] = spans[column].cell; spans[column].left--; column++; } };
      for (const cell of own) {
        carry();
        for (let offset = 0; offset < cell.colspan; offset++) {
          line[column + offset] = cell;
          spans[column + offset] = cell.rowspan > 1 ? { cell, left: cell.rowspan - 1 } : undefined;
        }
        column += cell.colspan;
      }
      for (; column < spans.length; column++) if (spans[column]?.left > 0) { line[column] = spans[column].cell; spans[column].left--; }
      rows.push({ attrs: tr[1], own, cells: line });
    }
    tables.push(rows);
  }
  return tables;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function isoDate(text) {
  const match = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\b/.exec(text);
  if (!match) return null;
  const value = `${match[3]}-${String(MONTHS.indexOf(match[1]) + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
}
export function seasonOf(date) { const [year, month] = date.split('-').map(Number); return month >= 7 ? year + 1 : year; }

// Franchise names as printed in record tables → Basketball-Reference codes.
const FRANCHISES = {
  'Atlanta Hawks': 'ATL', 'St. Louis Hawks': 'STL', 'Milwaukee Hawks': 'MLH', 'Tri-Cities Blackhawks': 'TRI',
  'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BRK', 'New Jersey Nets': 'NJN', 'New York Nets': 'NYN',
  'Charlotte Bobcats': 'CHA', 'Chicago Bulls': 'CHI', 'Chicago Packers': 'CHP', 'Chicago Zephyrs': 'CHZ', 'Chicago Stags': 'CHS',
  'Cleveland Cavaliers': 'CLE', 'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET', 'Fort Wayne Pistons': 'FTW',
  'Golden State Warriors': 'GSW', 'San Francisco Warriors': 'SFW', 'Philadelphia Warriors': 'PHW',
  'Houston Rockets': 'HOU', 'San Diego Rockets': 'SDR', 'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC', 'San Diego Clippers': 'SDC', 'Buffalo Braves': 'BUF',
  'Los Angeles Lakers': 'LAL', 'Minneapolis Lakers': 'MNL', 'Memphis Grizzlies': 'MEM', 'Vancouver Grizzlies': 'VAN',
  'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP', 'New Orleans Hornets': 'NOH', 'New Orleans/Oklahoma City Hornets': 'NOK', 'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC', 'Seattle SuperSonics': 'SEA', 'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI', 'Syracuse Nationals': 'SYR', 'Phoenix Suns': 'PHO', 'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC', 'Kansas City Kings': 'KCK', 'Kansas City-Omaha Kings': 'KCO', 'Cincinnati Royals': 'CIN', 'Rochester Royals': 'ROC',
  'San Antonio Spurs': 'SAS', 'Toronto Raptors': 'TOR', 'Utah Jazz': 'UTA', 'New Orleans Jazz': 'NOJ',
  'Washington Wizards': 'WAS', 'Washington Bullets': 'WSB', 'Capital Bullets': 'CAP', 'Baltimore Bullets': 'BAL',
};
export function franchiseCode(name, season) {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean === 'Charlotte Hornets') return season <= 2002 ? 'CHH' : 'CHO';
  if (clean === 'Baltimore Bullets' && season <= 1954) return 'BLB';
  return FRANCHISES[clean] ?? null;
}

/** Regular-season single-game record rows from a Wikipedia leaders table. Playoff rows (key colour) are excluded. */
export function parseWikipediaGames(html, valueHeader) {
  const table = parseTables(html).find(rows => rows[0]?.cells.some(cell => plain(cell.html) === valueHeader) && rows[0].cells.some(cell => plain(cell.html) === 'Player'));
  if (!table) throw new Error(`No ${valueHeader} table.`);
  const header = table[0].cells.map(cell => plain(cell.html));
  const column = name => { const index = header.indexOf(name); if (index < 0) throw new Error(`Missing ${name} column.`); return index; };
  const [valueAt, playerAt, teamAt, dateAt, opponentAt] = [valueHeader, 'Player', 'Team', 'Date', 'Opponent'].map(column);
  const scoreAt = header.indexOf('Score');
  const rows = [];
  for (const row of table.slice(1)) {
    if (!row.own.length || row.own.every(cell => cell.tag === 'th' && !/scope="row"/.test(cell.attrs))) continue;
    if ([valueAt, playerAt, teamAt, dateAt, opponentAt].some(index => !row.cells[index])) throw new Error(`Incomplete ${valueHeader} record row.`);
    if ([row.attrs, ...row.own.map(cell => cell.attrs)].some(attrs => /afe6ba/i.test(attrs))) continue;
    const value = Number(plain(row.cells[valueAt].html));
    const date = isoDate(plain(row.cells[dateAt].html));
    const link = /<a\b[^>]*href="\/wiki\/([^"#?]+)"/.exec(row.cells[playerAt].html)?.[1];
    const name = plain(row.cells[playerAt].html).replace(/\s*\(\d+\)\s*$/, '').replace(/[*^§†‡#]+/g, '').trim();
    if (!Number.isInteger(value) || value <= 0 || !date || !link || !name) throw new Error(`Malformed ${valueHeader} record row: ${plain(row.cells.map(cell => cell.html).join(' | ')).slice(0, 120)}`);
    const season = seasonOf(date);
    const teamName = plain(row.cells[teamAt].html), opponentName = plain(row.cells[opponentAt].html);
    rows.push({ value, date, season, title: decodeURIComponent(link).replaceAll('_', ' '), name,
      team: franchiseCode(teamName, season) ?? teamName, opponent: franchiseCode(opponentName, season) ?? opponentName,
      score: scoreAt >= 0 ? plain(row.cells[scoreAt].html).replace(/\s+/g, '') || null : null });
  }
  if (!rows.length) throw new Error(`No ${valueHeader} records.`);
  return rows;
}
