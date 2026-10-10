import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Plus } from 'lucide-react';
import type { BoxScorePlayer, BoxScoreTeam, GameBoxScore } from './shared/boxscore-types';
import type { Game, WatchPlayer } from './shared/types';
import TeamLabel from './TeamLabel';
import { beginBoxScoreRefresh, boxScoreRequestKey, completeBoxScoreRefresh, failBoxScoreRefresh, fetchGameBoxScore, sortBoxScorePlayers, visibleBoxScoreRequest, watchPlayerFromBoxScore, type BoxScoreRequestState, type BoxScoreSortKey, type SortDirection } from './boxscore-view';
import './boxscore.css';

interface BodyProps {
  game: Game; report: GameBoxScore | null; timezone: string; loading: boolean; error: string; demo: boolean;
  hideScores: boolean; watchedIds: string[]; revealed?: boolean; sortKey?: BoxScoreSortKey; sortDirection?: SortDirection;
  onWatch: (player: WatchPlayer) => void; onRetry: () => void; onConnectLive: () => void; onReveal?: () => void;
  onSort?: (key: BoxScoreSortKey) => void;
}
interface Props extends Pick<BodyProps, 'game' | 'timezone' | 'demo' | 'hideScores' | 'watchedIds' | 'onWatch' | 'onConnectLive'> { date: string; active: boolean }

const columns: { key: BoxScoreSortKey; label: string }[] = [
  { key: 'minutes', label: 'MIN' }, { key: 'points', label: 'PTS' }, { key: 'rebounds', label: 'REB' },
  { key: 'assists', label: 'AST' }, { key: 'steals', label: 'STL' }, { key: 'blocks', label: 'BLK' },
  { key: 'fgMade', label: 'FG' }, { key: 'threes', label: '3PT' }, { key: 'ftMade', label: 'FT' },
  { key: 'offensiveRebounds', label: 'ORB' }, { key: 'defensiveRebounds', label: 'DRB' },
  { key: 'turnovers', label: 'TO' }, { key: 'fouls', label: 'PF' }, { key: 'plusMinus', label: '+/-' },
];

function safeSource(value: string): string | null {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}

function checkedAt(value: string | null, timezone: string): string {
  if (!value) return 'not supplied';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'not supplied';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date); }
  catch { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date); }
}

function stat(player: BoxScorePlayer, key: BoxScoreSortKey): string {
  if (player.didNotPlay) return '—';
  if (key === 'fgMade') return `${player.fgMade}-${player.fgAttempted}`;
  if (key === 'threes') return player.threesAttempted === null ? '—' : `${player.threes}-${player.threesAttempted}`;
  if (key === 'ftMade') return `${player.ftMade}-${player.ftAttempted}`;
  const value = player[key];
  if (value === null || !Number.isFinite(value)) return '—';
  if (key === 'plusMinus') return value > 0 ? `+${value}` : String(value);
  return String(value);
}

function groupPlayers(team: BoxScoreTeam): { label: string; players: BoxScorePlayer[] }[] {
  return [
    { label: 'Starters', players: team.players.filter(player => !player.didNotPlay && player.starterKnown && player.starter) },
    { label: 'Bench', players: team.players.filter(player => !player.didNotPlay && player.starterKnown && !player.starter) },
    { label: 'Starter unknown', players: team.players.filter(player => !player.didNotPlay && !player.starterKnown) },
    { label: 'Did not play', players: team.players.filter(player => player.didNotPlay) },
  ].filter(group => group.players.length);
}

function TeamTable({ team, sortKey, sortDirection, watchedIds, onWatch, onSort }: {
  team: BoxScoreTeam; sortKey: BoxScoreSortKey; sortDirection: SortDirection; watchedIds: string[];
  onWatch: BodyProps['onWatch']; onSort?: BodyProps['onSort'];
}) {
  return <section className="boxscore-team" aria-label={`${team.team} box score`}>
    <h3><TeamLabel team={team.team}/><span>{team.players.length} players</span></h3>
    {team.players.length ? <div className="boxscore-scroll" role="region" tabIndex={0} aria-label={`${team.team} statistics, scroll horizontally for more`}>
      <table className="boxscore-table"><thead><tr><th scope="col" className="boxscore-player-cell">Player</th>{columns.map(({ key, label }) => <th scope="col" aria-sort={sortKey === key ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} key={key}><button type="button" onClick={() => onSort?.(key)} aria-label={`Sort by ${label}`}>{label}{sortKey === key && <span aria-hidden="true">{sortDirection === 'asc' ? '↑' : '↓'}</span>}</button></th>)}</tr></thead>
        <tbody>{groupPlayers(team).map(group => <FragmentGroup key={group.label} label={group.label} players={sortBoxScorePlayers(group.players, sortKey, sortDirection)} watchedIds={watchedIds} onWatch={onWatch}/>)}</tbody>
      </table>
    </div> : <p className="boxscore-empty-team">Player lines have not been supplied for this team.</p>}
  </section>;
}

function FragmentGroup({ label, players, watchedIds, onWatch }: { label: string; players: BoxScorePlayer[]; watchedIds: string[]; onWatch: BodyProps['onWatch'] }) {
  return <>
    <tr className="boxscore-group"><th colSpan={columns.length + 1} scope="rowgroup">{label}</th></tr>
    {players.map(player => <tr key={player.id} className={player.didNotPlay ? 'boxscore-dnp' : undefined}>
      <th scope="row" className="boxscore-player-cell"><span className="boxscore-person"><span className="boxscore-portrait">{/^\d+$/.test(player.id) && <img src={`https://a.espncdn.com/i/headshots/nba/players/full/${player.id}.png`} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }}/>}</span><span className="boxscore-person-name"><strong>{player.name}</strong>{player.didNotPlay && <small>{player.didNotPlayReason || 'Reason not supplied'}</small>}</span><button className="boxscore-watch" type="button" aria-label={watchedIds.includes(player.id) ? `Already on Watchlist: ${player.name}` : `Add ${player.name} to Watchlist`} title={watchedIds.includes(player.id) ? 'Already on Watchlist' : 'Add to Watchlist'} disabled={watchedIds.includes(player.id)} onClick={() => onWatch(watchPlayerFromBoxScore(player))}>{watchedIds.includes(player.id) ? <Check size={13}/> : <Plus size={13}/>}</button></span></th>
      {columns.map(column => <td key={column.key}>{stat(player, column.key)}</td>)}
    </tr>)}
  </>;
}

export function BoxScoreBody({ game, report, timezone, loading, error, demo, hideScores, watchedIds, revealed = false, sortKey = 'points', sortDirection = 'desc', onWatch, onRetry, onConnectLive, onReveal, onSort }: BodyProps) {
  if (demo) return <div className="boxscore-feedback" role="status"><p>Sample mode has no live box score.</p><button className="small-button" type="button" onClick={onConnectLive}>Connect live data</button></div>;
  if (hideScores && !revealed) return <div className="boxscore-reveal" role="status"><p>Scores are hidden in your settings. Reveal this game’s box score when you’re ready.</p><button className="small-button" type="button" onClick={onReveal}>Reveal box score</button></div>;
  return <div className="boxscore-body">
    {loading && !report && <div className="boxscore-feedback" role="status">Loading ESPN box score…</div>}
    {error && <div className="boxscore-alert" role="alert"><span>{report ? 'Previously checked data. Refresh failed: ' : ''}{error}</span><button className="small-button" type="button" onClick={error.startsWith('Sign in') ? onConnectLive : onRetry}>{error.startsWith('Sign in') ? 'Sign in' : 'Retry'}</button></div>}
    {report && <>
      <div className="boxscore-matchup"><span><TeamLabel team={game.away}/><strong>{report.game.awayScore ?? '—'}</strong></span><span className="boxscore-matchup-status">{report.game.statusText}</span><span><TeamLabel team={game.home}/><strong>{report.game.homeScore ?? '—'}</strong></span></div>
      {report.availability === 'not-started' ? <div className="boxscore-feedback" role="status">This game has not started. Player stats will appear after tipoff.</div>
        : report.availability === 'unavailable' ? <div className="boxscore-feedback" role="status">Box score unavailable for this game.</div>
          : <div className="boxscore-teams">{report.teams.map(team => <TeamTable key={team.team} team={team} sortKey={sortKey} sortDirection={sortDirection} watchedIds={watchedIds} onWatch={onWatch} onSort={onSort}/>)}</div>}
      {!!report.warnings.length && <div className="boxscore-warnings" role="status">{report.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      <div className="boxscore-provenance"><span>ESPN checked <time dateTime={report.fetchedAt || undefined}>{checkedAt(report.fetchedAt, timezone)}</time>{(report.stale || !!error) && <strong>Saved report may be outdated</strong>}</span>{safeSource(report.sourceUrl) && <a href={safeSource(report.sourceUrl)!} target="_blank" rel="noreferrer">ESPN game <ArrowUpRight size={13}/></a>}</div>
    </>}
    {!report && !loading && !error && <div className="boxscore-feedback" role="status">Box score unavailable. <button className="small-button" type="button" onClick={onRetry}>Retry</button></div>}
  </div>;
}

export default function BoxScore({ game, date, timezone, demo, hideScores, watchedIds, active, onWatch, onConnectLive }: Props) {
  const key = boxScoreRequestKey(game, date);
  const [state, setState] = useState<BoxScoreRequestState>({ key, data: null, loading: !demo, error: '' });
  const [sort, setSort] = useState<{ key: BoxScoreSortKey; direction: SortDirection }>({ key: 'points', direction: 'desc' });
  const [reveal, setReveal] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (demo) { setState({ key, data: null, loading: false, error: '' }); return; }
    if (!active) return;
    let current = true;
    let inFlight: AbortController | null = null;
    const refresh = () => {
      if (!current || document.visibilityState === 'hidden') return;
      if (inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      setState(previous => beginBoxScoreRefresh(previous, key));
      void fetchGameBoxScore(game, date, controller.signal).then(data => {
        if (current && !controller.signal.aborted) setState(previous => completeBoxScoreRefresh(previous, key, data));
      }).catch(error => {
        if (current && !controller.signal.aborted) setState(previous => failBoxScoreRefresh(previous, key, error instanceof Error ? error.message : 'Box score unavailable.'));
      }).finally(() => { if (inFlight === controller) inFlight = null; });
    };
    refreshRef.current = refresh;
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('pageshow', refresh);
    return () => { current = false; inFlight?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); window.removeEventListener('pageshow', refresh); };
  }, [key, game.id, game.away, game.home, game.status, date, demo, active]);
  const visible = visibleBoxScoreRequest(state, key);
  return <BoxScoreBody game={game} report={visible.data} timezone={timezone} loading={visible.loading} error={visible.error} demo={demo} hideScores={hideScores} watchedIds={watchedIds} revealed={reveal === key} onReveal={() => setReveal(key)} onWatch={onWatch} onRetry={() => refreshRef.current()} onConnectLive={onConnectLive} sortKey={sort.key} sortDirection={sort.direction} onSort={next => setSort(current => ({ key: next, direction: current.key === next && current.direction === 'desc' ? 'asc' : 'desc' }))}/>;
}
