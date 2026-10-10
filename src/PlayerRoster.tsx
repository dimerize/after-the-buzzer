import { useState } from 'react';
import type { Game, PlayerLine, WatchPlayer } from './shared/types';
import TeamLabel from './TeamLabel';
import './player-roster.css';

export interface PlayerRosterProps {
  players: WatchPlayer[];
  lines: PlayerLine[];
  games: Game[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  demo?: boolean;
}

const columns = [['points', 'PTS'], ['rebounds', 'REB'], ['assists', 'AST'], ['blocks', 'BLK']] as const;
const numericId = (id: string) => /^[1-9]\d{0,11}$/.test(id);

function RosterPortrait({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="player-roster-photo" aria-hidden="true">{numericId(id) && !failed
    ? <img src={`https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`} alt="" onError={() => setFailed(true)} />
    : <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /><path d="M10 50h80M50 10v80M22 22c35 4 52 21 56 56M22 78c4-35 21-52 56-56" /></svg>}</span>;
}

export default function PlayerRoster({ players, lines, games, selectedId, onSelect, demo = false }: PlayerRosterProps) {
  const favorites = players.filter(player => player.tier === 'favorite');
  const selectedLine = lines.find(line => line.id === selectedId && numericId(line.id));
  const displayed = selectedLine && !favorites.some(player => player.id === selectedLine.id)
    ? [...favorites, { id: selectedLine.id, name: selectedLine.name, team: selectedLine.team, tier: 'league' as const, alerts: false }]
    : favorites;
  const final = games.filter(game => game.status === 'final').length;
  const live = games.filter(game => game.status === 'live').length;
  return <section className="player-roster panel" aria-label="Favorite player roster">
    <div className="panel-title"><h2>Player Roster</h2>{demo && <span className="panel-meta">Sample stats</span>}</div>
    <div className="player-roster-head" aria-hidden="true"><span>Player</span>{columns.map(([, label]) => <span key={label}>{label}</span>)}</div>
    <div className="player-roster-rows">{displayed.map(player => {
      const line = lines.find(value => value.id === player.id);
      const available = numericId(player.id) && line && !line.didNotPlay && Number.isFinite(line.minutes) && line.minutes > 0 && (line.status === 'final' || line.status === 'live');
      const values = columns.map(([key]) => available && Number.isFinite(line[key]) && line[key] >= 0 ? line[key] : '—');
      const status = !numericId(player.id) ? 'Unverified' : line?.didNotPlay ? 'DNP' : !available ? 'No data' : line.status === 'live' ? 'Live' : 'Final';
      const team = line?.team || player.team;
      return <button type="button" className={'player-roster-row' + (selectedId === player.id ? ' selected' : '')} data-player-id={player.id} key={player.id} aria-pressed={selectedId === player.id}
        aria-label={`${player.name}, ${team}, ${status}, ${values.map((value, index) => `${columns[index][1]} ${value === '—' ? 'unavailable' : value}`).join(', ')}`} onClick={() => onSelect(player.id)}>
        <span className="player-roster-identity"><RosterPortrait key={player.id} id={player.id} /><span className="player-roster-name"><strong>{player.name}</strong><small><TeamLabel team={team} /> · {status}</small></span></span>
        {values.map((value, index) => <span className="player-roster-stat" key={columns[index][0]}>{value}</span>)}
      </button>;
    })}{!displayed.length && <p className="player-roster-empty">No favorites selected.</p>}</div>
    <div className="player-roster-status"><span>Night status</span><strong>{games.length ? `${final}/${games.length} games final` : 'No games reported'}</strong>{live > 0 && <span>{live} live</span>}</div>
  </section>;
}
