import { useEffect, useState } from 'react';
import { MonitorPlay, Tv } from 'lucide-react';
import type { Game } from './shared/types';
import { tvMarket, watchGuide, type WatchGuide } from './shared/watch-guide';
import './watch-guide.css';

const verdict: Record<WatchGuide['status'], string> = { available: 'On League Pass', national: 'National TV', local: 'Local blackout', 'listings-pending': 'Listings pending' };

/** Compact network chip for schedule rows and the scoreboard. */
export function WatchChip({ game, market }: { game: Game; market?: string }) {
  if (game.status === 'final') return null;
  const guide = watchGuide(game, market);
  return <span className={`watch-chip watch-chip-${guide.status}`} title={`${guide.headline}. ${guide.reason}`}><Tv size={10} aria-hidden="true"/>{guide.chip}</span>;
}

export function WatchPanelBody({ game, market }: { game: Game; market?: string }) {
  const guide = watchGuide(game, market);
  return <section className="watch-panel" aria-label="Where to watch">
    <h3 className="chrome-bar watch-title"><MonitorPlay size={15} aria-hidden="true"/>Where to watch<small>{tvMarket(market).label}</small></h3>
    <div className={`watch-verdict watch-verdict-${guide.status}`}><span className="watch-led" aria-hidden="true"/><div><strong>{guide.headline}</strong><small>{verdict[guide.status]}</small><p>{guide.reason}</p></div></div>
    {guide.lines.length > 0 && <table className="watch-lines"><thead><tr><th scope="col">Feed</th><th scope="col">Network</th><th scope="col">How to stream</th></tr></thead>
      <tbody>{guide.lines.map(line => <tr key={`${line.scope}:${line.network}`}><td>{line.scope}</td><th scope="row">{line.network}</th><td>{line.detail}</td></tr>)}</tbody></table>}
    <p className="watch-note">ESPN listings; networks can change before tipoff. League Pass blackouts follow your TV market (Settings).</p>
  </section>;
}

/** One-line verdict under the game report tabs, so live games (opened on Box score) show it too. */
export function WatchStrip({ game, market }: { game: Game; market?: string }) {
  if (game.status === 'final') return null;
  const guide = watchGuide(game, market);
  return <p className={`watch-strip watch-strip-${guide.status}`}><span className="watch-led" aria-hidden="true"/><strong>{guide.chip}</strong><span>{guide.headline}</span></p>;
}

/** Saved recap games from before listings existed: fetch the schedule copy of the game once. */
export function useListedGame(game: Game, date: string, demo: boolean): Game {
  const [fresh, setFresh] = useState<Game | null>(null);
  useEffect(() => {
    if (demo || game.broadcasts || game.status === 'final') return;
    const controller = new AbortController();
    void fetch(`/api/schedule?date=${encodeURIComponent(date)}`, { credentials: 'same-origin', signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<{ date?: string; games?: Game[] }> : null)
      .then(schedule => { const match = schedule?.date === date ? schedule.games?.find(item => item.id === game.id && item.home === game.home && item.away === game.away) : undefined; if (match) setFresh(match); })
      .catch(() => {});
    return () => controller.abort();
  }, [date, demo, game.away, game.broadcasts, game.home, game.id, game.status]);
  return fresh ?? game;
}

export default function WatchPanel({ game, market, demo }: { game: Game; market?: string; demo: boolean }) {
  if (demo || game.status === 'final') return null;
  return <WatchPanelBody game={game} market={market}/>;
}
