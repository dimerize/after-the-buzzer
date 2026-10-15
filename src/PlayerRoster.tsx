import { useState } from 'react';
import type { Game, PlayerInjury, PlayerLine, WatchPlayer } from './shared/types';
import TeamLabel from './TeamLabel';
import './player-roster.css';
import { rosterPlayers, rosterStatus, type RosterScope } from './roster-view';
import { currentScheduleDate, currentSlateDate } from './schedule-view';
import { TierMark } from './WatchMarks';

export interface PlayerRosterProps {
  players: WatchPlayer[];
  lines: PlayerLine[];
  games: Game[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  demo?: boolean;
  date?: string;
  timezone?: string;
  scheduleVerified?: boolean;
  /** Today's ESPN injury listings for watched players. */
  injuries?: Record<string, PlayerInjury>;
}

const columns = [['points', 'PTS'], ['rebounds', 'REB'], ['assists', 'AST'], ['blocks', 'BLK']] as const;
const numericId = (id: string) => /^[1-9]\d{0,11}$/.test(id);

function RosterPortrait({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="player-roster-photo" aria-hidden="true">{numericId(id) && !failed
    ? <img src={`https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`} alt="" onError={() => setFailed(true)} />
    : <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /><path d="M10 50h80M50 10v80M22 22c35 4 52 21 56 56M22 78c4-35 21-52 56-56" /></svg>}</span>;
}

export default function PlayerRoster({ players, lines, games, selectedId, onSelect, demo = false, date, timezone = 'America/New_York', scheduleVerified = false, injuries }: PlayerRosterProps) {
  const [scope, setScope] = useState<RosterScope>('favorite');
  const favorites = rosterPlayers(players, scope);
  const selectedLine = lines.find(line => line.id === selectedId && numericId(line.id));
  const displayed = selectedLine && !favorites.some(player => player.id === selectedLine.id)
    ? [...favorites, { id: selectedLine.id, name: selectedLine.name, team: selectedLine.team, tier: 'league' as const, alerts: false }]
    : favorites;
  const final = games.filter(game => game.status === 'final').length;
  const live = games.filter(game => game.status === 'live').length;
  const today = !date || date === currentSlateDate() || date === currentScheduleDate();
  return <section className="player-roster panel" aria-label="Watched player roster">
    <div className="panel-title"><h2>Player Roster</h2>{demo && <span className="panel-meta">Sample stats</span>}</div>
    <nav className="roster-scope" aria-label="Roster view">{([['favorite','Favorites'],['interest','Following'],['all','All']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={scope === value} className={scope === value ? 'selected' : ''} onClick={() => setScope(value)}>{label}<small>{rosterPlayers(players,value).length}</small></button>)}</nav>
    <div className="player-roster-head" aria-hidden="true"><span>Player</span>{columns.map(([, label]) => <span key={label}>{label}</span>)}</div>
    <div className="player-roster-rows">{displayed.map(player => {
      const line = lines.find(value => value.id === player.id);
      const status = rosterStatus(player, line, games, scheduleVerified, timezone, today ? injuries?.[player.id] : undefined, today);
      const available = status.tone === 'stats' && !!line && Number.isFinite(line.minutes) && line.minutes > 0;
      const values = columns.map(([key]) => available && Number.isFinite(line[key]) && line[key] >= 0 ? line[key] : '—');
      const team = line?.team || player.team;
      const watched = player.tier === 'favorite' || player.tier === 'interest';
      const statText = available ? values.map((value, index) => `${columns[index][1]} ${value === '—' ? 'unavailable' : value}`).join(', ') : `${status.label}${status.detail ? `, ${status.detail}` : ''}`;
      return <button type="button" className={'player-roster-row' + (selectedId === player.id ? ' selected' : '') + (status.ruledOut ? ' ruled-out' : '')} data-player-id={player.id} key={player.id} aria-pressed={selectedId === player.id}
        aria-label={`${player.name}, ${team}${status.matchup ? ` ${status.matchup}` : ''}, ${status.ruledOut ? 'ruled out, ' : ''}${statText}`} onClick={() => onSelect(player.id)}>
        <span className="player-roster-identity"><RosterPortrait key={player.id} id={player.id} /><span className="player-roster-name"><strong>{scope === 'all' && watched && <TierMark tier={player.tier}/>}{player.name}</strong><small><TeamLabel team={team} />{status.matchup && <span> · {status.matchup}</span>}{available && <span className={status.label === 'Live' ? 'roster-live' : ''}> · {status.label}</span>}{status.ruledOut && <span className="roster-ruled-out">Out</span>}</small></span></span>
        {available ? values.map((value, index) => <span className="player-roster-stat" key={columns[index][0]}>{value}</span>)
          : <span className={`player-roster-plate plate-${status.tone}`}><strong>{status.label}</strong>{status.detail && <small>{status.detail}</small>}</span>}
      </button>;
    })}{!displayed.length && <p className="player-roster-empty">{scope === 'favorite' ? 'No favorites selected.' : scope === 'interest' ? 'No players followed.' : 'No players selected.'}</p>}</div>
    <div className="player-roster-status"><span>Night status</span><strong>{games.length ? `${final}/${games.length} games final` : 'No games reported'}</strong>{live > 0 && <span>{live} live</span>}</div>
  </section>;
}
