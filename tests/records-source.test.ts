import { describe, expect, it } from 'vitest';
// @ts-expect-error The build helpers are plain ES modules.
import { franchiseCode, isoDate, parseReferenceSeason, parseTables, parseWikipediaGames, plain } from '../scripts/history/sources.mjs';

const seasonRow = (id = 'chambwi01', team = 'PHW', games = '80', points = '4029') => `<tr><td data-stat="name_display"><a href="/players/c/${id}.html">Wilt Chamberlain</a>*</td><td data-stat="team_name_abbr">${team}</td><td data-stat="games">${games}</td><td data-stat="pts">${points}</td><td data-stat="trb">2052</td><td data-stat="ast">192</td></tr>`;
const seasonPage = (rows = seasonRow(), year = 1962) => `<title>${year - 1}-${String(year).slice(-2)} NBA Player Stats: Totals | Basketball-Reference.com</title><table id="totals_stats"><tbody>${rows}</tbody></table><table id="totals_stats_post"><tbody>${seasonRow('other01', 'PHW', '1', '9999')}</tbody></table>`;

describe('Basketball-Reference season totals', () => {
  it('reads exact regular-season totals and keeps unrecorded statistics null', () => {
    const season = parseReferenceSeason(seasonPage(), 1962, '2026-10-13T12:00:00Z');
    expect(season.rows).toHaveLength(1);
    expect(season.rows[0]).toMatchObject({ season: 1962, games: 80, team: 'PHW', stats: { points: 4029, rebounds: 2052, assists: 192, blocks: null, steals: null, threes: null }, player: { id: 'chambwi01', name: 'Wilt Chamberlain' } });
  });
  it('counts a traded player once using the combined row, whatever the order', () => {
    const season = parseReferenceSeason(seasonPage(seasonRow('chambwi01', 'PHW', '40', '2000') + seasonRow('chambwi01', '2TM') + seasonRow('chambwi01', 'SFW', '40', '2029')), 1962, '2026-10-13T12:00:00Z');
    expect(season.rows).toHaveLength(1);
    expect(season.rows[0]).toMatchObject({ team: '2TM', stats: { points: 4029 } });
  });
  it('rejects the wrong season, malformed totals and unresolved team splits', () => {
    expect(() => parseReferenceSeason(seasonPage(), 1963, '2026-10-13T12:00:00Z')).toThrow();
    for (const rows of [seasonRow('chambwi01', 'PHW', '80', '-1'), seasonRow('chambwi01', 'PHW', '80', 'NaN'), seasonRow() + seasonRow('chambwi01', 'SFW')]) expect(() => parseReferenceSeason(seasonPage(rows), 1962, '2026-10-13T12:00:00Z')).toThrow();
  });
});

const wiki = (rows: string) => `<table class="wikitable sortable"><tbody><tr><th>Rebounds</th><th>Player</th><th>Team</th><th>Date</th><th>Opponent</th><th>Notes</th></tr>${rows}</tbody></table>`;
describe('Wikipedia single-game record tables', () => {
  it('expands rowspans for tied values and keeps the player link for identity', () => {
    const html = wiki('<tr><td align="center" rowspan="2">49</td><td bgcolor="#FFFF99"><a href="/wiki/Bill_Russell">Bill Russell</a>* (2)</td><td>Boston Celtics</td><td><span class="sortkey">x</span>November 16, 1957</td><td>Philadelphia Warriors</td><td></td></tr><tr><td><a href="/wiki/Bill_Russell">Bill Russell</a>* (3)</td><td>Boston Celtics</td><td>March 11, 1965</td><td>Detroit Pistons</td><td></td></tr>');
    expect(parseWikipediaGames(html, 'Rebounds')).toEqual([
      { value: 49, date: '1957-11-16', season: 1958, title: 'Bill Russell', name: 'Bill Russell', team: 'BOS', opponent: 'PHW', score: null },
      { value: 49, date: '1965-03-11', season: 1965, title: 'Bill Russell', name: 'Bill Russell', team: 'BOS', opponent: 'DET', score: null },
    ]);
  });
  it('drops playoff games marked with the key colour', () => {
    const html = wiki('<tr><td>55</td><td><a href="/wiki/Wilt_Chamberlain">Wilt Chamberlain</a></td><td>Philadelphia Warriors</td><td>November 24, 1960</td><td>Boston Celtics</td><td></td></tr><tr><td>41</td><td bgcolor="#AFE6BA"><a href="/wiki/Wilt_Chamberlain">Wilt Chamberlain</a> (12)</td><td>Philadelphia 76ers</td><td>April 5, 1967</td><td>Boston Celtics</td><td>Game 3</td></tr>');
    expect(parseWikipediaGames(html, 'Rebounds').map((row: { value: number }) => row.value)).toEqual([55]);
  });
  it('maps historical franchise names by era and parses dates strictly', () => {
    expect(franchiseCode('Charlotte Hornets', 1999)).toBe('CHH');
    expect(franchiseCode('Charlotte Hornets', 2020)).toBe('CHO');
    expect(franchiseCode('San Francisco Warriors', 1963)).toBe('SFW');
    expect(isoDate('Played March 2, 1962[4]')).toBe('1962-03-02');
    expect(isoDate('February 30, 1962')).toBeNull();
    expect(plain('<b>Wilt</b>&nbsp;Chamberlain<sup class="reference">[1]</sup>')).toBe('Wilt Chamberlain');
    expect(parseTables('<table class="wikitable"><tr><td colspan="2">A</td></tr><tr><td>B</td><td>C</td></tr></table>')[0][0].cells).toHaveLength(2);
  });
});
