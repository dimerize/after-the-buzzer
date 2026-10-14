import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PlayerRoster from '../src/PlayerRoster';
import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import { game, line } from './notification-fixtures';
import type { PlayerLine, WatchPlayer } from '../src/shared/types';

const favorites = DEFAULT_PREFERENCES.players;
function render(lines: PlayerLine[] = [], selectedId = '5104157', players: WatchPlayer[] = favorites, demo = false) {
  return renderToStaticMarkup(<PlayerRoster players={players} lines={lines} games={[game()]} selectedId={selectedId} onSelect={() => {}} demo={demo} />);
}
function rows(html: string) { return html.match(/<button\b[^>]*data-player-id[^>]*>[\s\S]*?<\/button>/g) || []; }

describe('multi-player favorite roster', () => {
  it('shows all five favorite players simultaneously with a small actual portrait per row', () => {
    const html = render([line()]);
    expect(rows(html)).toHaveLength(5);
    for (const player of favorites) {
      expect(html).toContain(`<strong>${player.name}</strong>`);
      expect(html).toContain(`https://a.espncdn.com/i/headshots/nba/players/full/${player.id}.png`);
    }
    for (const heading of ['Player', 'PTS', 'REB', 'AST', 'BLK']) expect(html).toContain(`>${heading}</span>`);
    expect(html.match(/1\/1 games final/g)).toHaveLength(1);
  });

  it('keeps four silver stat cells for every row and distinguishes missing data from actual zero', () => {
    const html = render([line({ points: 0, rebounds: 0, assists: 0, blocks: 0 })]);
    const rendered = rows(html);
    expect(rendered).toHaveLength(5);
    for (const row of rendered) expect(row.match(/class="player-roster-stat"/g)).toHaveLength(4);
    expect((rendered[0] || '').match(/>0<\/span>/g)).toHaveLength(4);
    for (const row of rendered.slice(1)) expect(row.match(/>—<\/span>/g)).toHaveLength(4);
  });

  it.each([line({ didNotPlay: true }), line({ minutes: 0 }), line({ status: 'scheduled' })])('does not show an unplayed line as real stats: %j', value => {
    const first = rows(render([value]))[0] || '';
    expect(first.match(/>—<\/span>/g)).toHaveLength(4);
    expect(first).not.toContain('>34</span>');
  });

  it('marks only the selected row and keeps its full name accessible even when visually truncated', () => {
    const html = render([line()], '1966');
    expect(rows(html).filter(row => row.includes('aria-pressed="true"'))).toHaveLength(1);
    expect(rows(html).find(row => row.includes('aria-pressed="true"'))).toContain('aria-label="LeBron James,');
    expect(rows(html).every(row => row.includes('type="button"'))).toBe(true);
  });

  it('appends a real notified nonfavorite player without dropping any favorites', () => {
    const extra = line({ id: '203999', name: 'Nikola Jokic', team: 'DEN', opponent: 'SAS', points: 42 });
    const html = render([line(), extra], '203999');
    expect(rows(html)).toHaveLength(6);
    for (const player of favorites) expect(html).toContain(`<strong>${player.name}</strong>`);
    expect(rows(html)[5]).toContain('Nikola Jokic');
    expect(rows(html)[5]).toContain('aria-pressed="true"');
    expect(rows(html)[5]).toContain('>42</span>');
  });

  it('does not invent a selected-player row or portrait from an unknown or pending identity', () => {
    expect(rows(render([], '9999999'))).toHaveLength(5);
    const html = render([line({ id: 'pending:player', name: 'Unknown Player' })], 'pending:player');
    expect(rows(html)).toHaveLength(5);
    expect(html).not.toContain('Unknown Player');
    const pending = { id: 'pending:player', name: 'Unknown Player', team: 'TBD', tier: 'favorite', alerts: false } as const;
    expect(render([], pending.id, [pending])).not.toContain('espncdn.com');
  });

  it('shows historical line team truth and labels fictional sample statistics', () => {
    const html = render([line({ id: '1966', name: 'LeBron James', team: 'LAL' })], '1966', favorites, true);
    const lebron = rows(html).find(row => row.includes('LeBron James'))!;
    expect(lebron).toContain('LAL');
    expect(lebron).not.toContain('PHI');
    expect(html).toContain('Sample stats');
  });

  it('handles an empty watchlist without creating a spotlight player', () => {
    const html = render([], '5104157', []);
    expect(rows(html)).toHaveLength(0);
    expect(html).toContain('No favorites selected.');
  });
});
