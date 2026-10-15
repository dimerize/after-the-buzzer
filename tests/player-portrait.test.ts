import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerRow } from '../src/App';
import type { WatchPlayer } from '../src/shared/types';

function renderPlayer(id: string, name = 'Victor Wembanyama') {
  const player: WatchPlayer = { id, name, team: 'SAS', tier: 'favorite', alerts: false };
  return renderToStaticMarkup(createElement(PlayerRow, { player, expanded: false, onExpand: () => {} }));
}

describe('box-score row portraits', () => {
  it.each([
    ['5104157', 'Victor Wembanyama'],
    ['1966', 'LeBron James'],
    ['5254165', 'Keaton Wagler'],
    ['5037871', 'Dylan Harper'],
    ['4845367', 'Stephon Castle'],
  ])('uses the actual ESPN identity for %s while keeping the player name accessible', (id, name) => {
    const html = renderPlayer(id, name);
    expect(html).toContain(`<img src="https://a.espncdn.com/i/headshots/nba/players/full/${id}.png" alt=""`);
    expect(html).toContain(`aria-label="${name}, favorite, No game data for this night"`);
    expect(html).toContain(`${name}</strong>`);
    expect(html).toContain('tier-mark-favorite');
  });

  it.each(['pending:unknown', 'sample-player', 'demo-1', ''])('renders a neutral fallback instead of inventing a headshot for %j', (id) => {
    const html = renderPlayer(id);
    const avatar = html.match(/<span class="player-avatar[^\"]*"[^>]*>(.*?)<\/span>/)?.[1];
    expect(avatar).toBeDefined();
    expect(avatar).not.toContain('<img');
    expect(html).not.toContain('espncdn.com');
    expect(avatar).toContain('<svg viewBox="0 0 100 100" aria-hidden="true">');
  });
});
