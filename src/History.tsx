import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import type { WatchPlayer } from './shared/types';
import type { CareerHistorySection, HistoricalAggregate, HistoricalPerformance, HistoricalSeason, HistoricalStats, HistorySeasonType, PlayerCareerHistory, PlayerSeasonLog } from './shared/history-types';
import Records from './Records';
import { formatHistoryUpdatedAt, historyForPlayer, historyRequestKey, visibleHistoryRequest, type HistoryRequestState } from './history-request';
import TeamLabel from './TeamLabel';
import './history.css';

export type HistoryView = 'careers' | 'honors';
interface HistoryProps { view: HistoryView; players: WatchPlayer[]; demo: boolean; onConnectLive?: () => void; }
type Resource<T> = { data: T | null; loading: boolean; error: string; retry: () => void };

function useHistoryResource<T>(url: string | null): Resource<T> {
  const [state, setState] = useState<HistoryRequestState<T>>({ key: null, data: null, loading: false, error: '' });
  const [attempt, setAttempt] = useState(0);
  const key = historyRequestKey(url, attempt);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ key, data: null, loading: Boolean(url), error: '' });
    if (url) void (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
        const result = await response.json().catch(() => ({})) as T & { error?: string };
        if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to load historical stats.' : result.error || 'Historical stats could not be loaded.');
        if (active) setState({ key, data: result, loading: false, error: '' });
      } catch (failure) {
        if (active && !controller.signal.aborted) setState({ key, data: null, loading: false, error: failure instanceof Error ? failure.message : 'Historical stats could not be loaded.' });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [url, key]);
  const visible = visibleHistoryRequest(state, key);
  return { data: visible.data, loading: visible.loading, error: visible.error, retry: () => setAttempt((value) => value + 1) };
}
function number(value: number | null | undefined, digits = 1) { return value === null || value === undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value); }
function seasonLabel(year: number) { return `${year - 1}–${String(year).slice(-2)}`; }
function shortDate(value: string) { const date = new Date(value.includes('T') ? value : `${value}T12:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date); }
function Panel({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) { return <section className={'panel ' + className}><div className="panel-title"><h2>{title}</h2>{action}</div>{children}</section>; }
function Portrait({ id, name, team, className = '' }: { id: string; name: string; team?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const valid = /^\d+$/.test(id);
  return <div className={'history-portrait ' + className}>{valid && !failed ? <img src={`https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`} alt={name} loading="lazy" onError={() => setFailed(true)} /> : <strong>{team || name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</strong>}{team && <small><TeamLabel team={team} className="team-inline" /></small>}</div>;
}
function Status({ loading, error, retry, empty }: { loading?: boolean; error?: string; retry?: () => void; empty?: string }) {
  if (!loading && !error && !empty) return null;
  return <div className="history-status" role="status">{loading ? <><LoaderCircle className="spin" size={18} /><span>Loading stats…</span></> : error ? <><span>{error}</span>{retry && <button className="small-button" onClick={retry}><RefreshCw size={13} />Retry</button>}</> : <span>{empty}</span>}</div>;
}
function Notices({ warnings }: { warnings: string[] }) { return warnings.length ? <details className="history-notices"><summary>{warnings.length} data {warnings.length === 1 ? 'notice' : 'notices'}</summary>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details> : null; }
function Competition({ value, onChange }: { value: HistorySeasonType; onChange: (value: HistorySeasonType) => void }) { return <div className="history-segment" aria-label="Competition"><button aria-pressed={value === 'regular'} className={value === 'regular' ? 'selected' : ''} onClick={() => onChange('regular')}>Regular season</button><button aria-pressed={value === 'postseason'} className={value === 'postseason' ? 'selected' : ''} onClick={() => onChange('postseason')}>Playoffs</button></div>; }
export function HistorySource({ url, updatedAt, children }: { url?: string; updatedAt?: string; children?: ReactNode }) {
  const updated = formatHistoryUpdatedAt(updatedAt);
  return <div className="history-source"><span>{children || 'ESPN statistics'}{updated && <><br /><time dateTime={updatedAt}>Updated {updated}</time></>}</span>{url && <a href={url} target="_blank" rel="noreferrer">Source <ArrowUpRight size={11} /></a>}</div>;
}

const seasonColumns: { key: keyof HistoricalStats; label: string; percentage?: boolean }[] = [
  { key: 'points', label: 'PTS' }, { key: 'rebounds', label: 'REB' }, { key: 'assists', label: 'AST' },
  { key: 'steals', label: 'STL' }, { key: 'blocks', label: 'BLK' }, { key: 'threes', label: '3PM' },
  { key: 'fgPct', label: 'FG%', percentage: true }, { key: 'threePct', label: '3P%', percentage: true },
  { key: 'ftPct', label: 'FT%', percentage: true }, { key: 'turnovers', label: 'TO' }, { key: 'minutes', label: 'MIN' }
];
function SeasonCells({ item, totals }: { item: HistoricalAggregate; totals: boolean }) {
  const stats = totals ? item.totals : item.averages;
  return <><td>{number(item.games, 0)}</td>{seasonColumns.map(({ key, percentage }) => <td key={key}>{number(percentage ? item.averages[key] : stats[key], totals && !percentage ? 0 : 1)}</td>)}</>;
}
export function SeasonsTable({ section, selected, onSelect, totals }: { section: CareerHistorySection; selected: number | null; onSelect: (year: number) => void; totals: boolean }) {
  return <div className="history-table-scroll" tabIndex={0} aria-label="Career season statistics; scroll horizontally for more columns"><table className="history-table season-table"><thead><tr><th>Season</th><th>Team</th><th>GP</th>{seasonColumns.map(({ key, label }) => <th key={key}>{label}</th>)}</tr></thead><tbody>{section.seasons.map((season: HistoricalSeason) => <tr key={season.season} className={selected === season.season ? 'selected' : ''}><th><button onClick={() => onSelect(season.season)} aria-label={'Load ' + season.label + ' game log'} aria-pressed={selected === season.season}>{season.label}<ChevronRight size={11} /></button></th><td><span className="history-team-list">{season.teams.length ? season.teams.map((team, index) => <Fragment key={`${team}:${index}`}>{index > 0 && '/'}<TeamLabel team={team} /></Fragment>) : '—'}</span></td><SeasonCells item={season} totals={totals} /></tr>)}</tbody>{section.career && <tfoot><tr><th>Career</th><td>NBA</td><SeasonCells item={section.career} totals={totals} /></tr></tfoot>}</table></div>;
}
function PerformanceTable({ games }: { games: HistoricalPerformance[] }) {
  return <div className="history-table-scroll" tabIndex={0} aria-label="Game statistics; scroll horizontally for more columns"><table className="history-table game-log-table"><thead><tr><th>Date</th><th>Opponent</th><th>W/L</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>FG%</th><th>Milestones</th></tr></thead><tbody>{games.map((game) => <tr key={game.gameId}><th>{game.sourceUrl ? <a href={game.sourceUrl} target="_blank" rel="noreferrer">{shortDate(game.date)}<ArrowUpRight size={10} /></a> : shortDate(game.date)}</th><td>{game.home === true ? 'vs ' : game.home === false ? '@ ' : ''}<TeamLabel team={game.opponent} /></td><td className={game.result === 'W' ? 'history-win' : ''}>{game.result || '—'}</td><td>{number(game.stats.points, 0)}</td><td>{number(game.stats.rebounds, 0)}</td><td>{number(game.stats.assists, 0)}</td><td>{number(game.stats.steals, 0)}</td><td>{number(game.stats.blocks, 0)}</td><td>{number(game.stats.threes, 0)}</td><td>{number(game.stats.fgPct)}</td><td className="milestone-cell">{game.milestones.length ? game.milestones.join(', ') : '—'}</td></tr>)}</tbody></table></div>;
}

function CareerViewer({ players }: { players: WatchPlayer[] }) {
  const [playerId, setPlayerId] = useState(players.find((player) => player.tier === 'favorite')?.id || players[0]?.id || '');
  const [competition, setCompetition] = useState<HistorySeasonType>('regular');
  const [totals, setTotals] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [logMode, setLogMode] = useState<'all' | 'top' | 'milestones'>('top');
  const player = players.find((item) => item.id === playerId) || players[0];
  const chosenId = player?.id || '';
  const career = useHistoryResource<PlayerCareerHistory>(/^\d+$/.test(chosenId) ? `/api/history/career?id=${encodeURIComponent(chosenId)}` : null);
  const careerData = historyForPlayer(career.data, chosenId);
  const section = careerData?.[competition];
  const sectionYears = section?.seasons.map((item) => item.season) || [];
  const today = new Date();
  const completedYear = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const selectedSeason = season !== null && careerData?.availableSeasons.includes(season) ? season : careerData?.availableSeasons.includes(completedYear) ? completedYear : careerData?.availableSeasons[0] ?? null;
  const log = useHistoryResource<PlayerSeasonLog>(chosenId && selectedSeason ? `/api/history/games?id=${encodeURIComponent(chosenId)}&season=${selectedSeason}` : null);
  const logData = historyForPlayer(log.data, chosenId, selectedSeason);
  const logSection = logData?.[competition];
  const games = logSection ? logMode === 'top' ? logSection.topPerformances : logMode === 'milestones' ? logSection.games.filter((game) => game.milestones.length) : logSection.games : [];
  const summary = section?.career;
  const milestoneGames = logSection?.games.filter((game) => game.milestones.length) || [];
  const bestGame = logSection?.topPerformances[0];
  const empty = !player ? 'Add a player to your watchlist to view career stats.' : !/^\d+$/.test(chosenId) ? 'Player identity awaiting verification.' : section && !section.seasons.length ? 'No NBA ' + (competition === 'regular' ? 'regular-season' : 'playoff') + ' statistics available.' : '';

  return <div className="history-view career-view"><section className="panel history-controls"><div className="history-player-select"><label htmlFor="career-player">Player</label><select id="career-player" value={chosenId} onChange={(event) => { setPlayerId(event.target.value); setSeason(null); }}>{players.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><Competition value={competition} onChange={setCompetition} /></section>
    {player && <section className="panel history-summary"><Portrait key={chosenId} id={chosenId} name={player.name} team={player.team} /><div className="history-summary-data"><h2 className="chrome-bar">{player.name}</h2><div className="history-summary-cells">{[['GP', summary?.games], ['PPG', summary?.averages.points], ['RPG', summary?.averages.rebounds], ['APG', summary?.averages.assists], ['BPG', summary?.averages.blocks]].map(([label, value]) => <div className="silver-stat" key={label}><span className="chrome-bar">{label}</span><strong>{number(value as number | null | undefined)}</strong></div>)}</div><div className="history-summary-scope"><span>{competition === 'regular' ? 'Regular season' : 'Playoffs'}</span><span>{section?.seasons.length ? `${section.seasons.at(-1)?.label} – ${section.seasons[0]?.label}` : 'Career statistics'}</span></div></div></section>}
    <div className="history-main-grid"><div className="history-data-rail"><Panel title="Career Statistics" action={<div className="history-mini-segment"><button className={!totals ? 'selected' : ''} aria-pressed={!totals} onClick={() => setTotals(false)}>Avg</button><button className={totals ? 'selected' : ''} aria-pressed={totals} onClick={() => setTotals(true)}>Total</button></div>}><Status loading={career.loading} error={career.error} retry={career.retry} empty={!career.loading && !career.error ? empty : ''} />{section && section.seasons.length > 0 && <SeasonsTable section={section} selected={selectedSeason} onSelect={setSeason} totals={totals} />}<HistorySource url={section?.sourceUrl} updatedAt={careerData?.updatedAt}>{section?.coverage === 'partial' ? 'Partial career coverage' : totals ? 'Season totals' : 'Per-game averages'} · % columns remain percentages</HistorySource>{section && <Notices warnings={section.warnings} />}</Panel>
      <Panel title="Season Game Log" action={<label className="history-season-select"><span className="sr-only">Season</span><select aria-label="Game log season" value={selectedSeason || ''} onChange={(event) => setSeason(Number(event.target.value))} disabled={!careerData?.availableSeasons.length}>{careerData?.availableSeasons.map((year) => <option key={year} value={year}>{seasonLabel(year)}</option>)}{!careerData?.availableSeasons.length && <option value="">No seasons</option>}</select></label>}><div className="history-log-tabs">{[{ id: 'top', label: 'Top games' }, { id: 'all', label: 'All games' }, { id: 'milestones', label: 'Milestones' }].map((mode) => <button key={mode.id} className={logMode === mode.id ? 'selected' : ''} aria-pressed={logMode === mode.id} onClick={() => setLogMode(mode.id as typeof logMode)}>{mode.label}</button>)}</div><Status loading={log.loading} error={log.error} retry={log.retry} empty={!log.loading && !log.error && !games.length ? logSection?.coverage === 'unavailable' ? 'Game log unavailable.' : selectedSeason ? 'No matching games for this season.' : 'Select an available season.' : ''} />{games.length > 0 && <PerformanceTable games={games} />}<HistorySource url={logData?.sourceUrl} updatedAt={logData?.updatedAt}>{logMode === 'top' ? 'Top 10 by points; ties use rebounds and assists.' : `${games.length} games`} {logSection?.coverage === 'partial' ? '· Partial coverage' : ''}</HistorySource>{logSection && <Notices warnings={[...logSection.warnings, ...(logSection.excludedGames ? [`${logSection.excludedGames} non-counting or unavailable games excluded.`] : [])]} />}</Panel></div>
      <aside className="history-context-rail"><Panel title="Season Summary"><div className="history-context-season">{selectedSeason ? seasonLabel(selectedSeason) : '—'}</div><div className="history-context-row"><span>Competition</span><strong>{competition === 'regular' ? 'Regular' : 'Playoffs'}</strong></div><div className="history-context-row"><span>Games loaded</span><strong>{logSection ? logSection.games.length : '—'}</strong></div><div className="history-context-row"><span>Career seasons</span><strong>{careerData ? sectionYears.length : '—'}</strong></div><div className="history-context-row"><span>Log coverage</span><strong>{logSection?.coverage.replace('-', ' ') || '—'}</strong></div></Panel>
        <Panel title={logSection?.coverage === 'complete' ? 'Season High' : 'Loaded High'}><div className="history-big-stat"><strong>{number(bestGame?.stats.points, 0)}</strong><span>Points</span></div>{bestGame && <><div className="history-best-game">{shortDate(bestGame.date)} <strong><TeamLabel team={bestGame.team} className="team-inline" /> {bestGame.home === true ? 'vs' : bestGame.home === false ? '@' : ''} <TeamLabel team={bestGame.opponent} className="team-inline" /></strong></div><div className="history-context-row"><span>Rebounds</span><strong>{number(bestGame.stats.rebounds, 0)}</strong></div><div className="history-context-row"><span>Assists</span><strong>{number(bestGame.stats.assists, 0)}</strong></div></>}<HistorySource>Among loaded game logs</HistorySource></Panel>
        <Panel title="Milestone Games"><div className="history-big-stat"><strong>{logSection ? milestoneGames.length : '—'}</strong><span>{selectedSeason ? seasonLabel(selectedSeason) : 'Selected season'}</span></div><p className="history-note">Box-score thresholds from loaded games. Not official awards.</p><button className="history-panel-action" onClick={() => setLogMode('milestones')}>View games <ChevronRight size={12} /></button></Panel>
      </aside></div></div>;
}

export default function History({ view, players, demo, onConnectLive }: HistoryProps) {
  if (demo && view === 'careers') return <Panel title="Career Statistics" className="history-view"><div className="history-status"><span>Historical statistics require the live reader.</span>{onConnectLive && <button className="small-button" onClick={onConnectLive}>Connect live reader <ArrowUpRight size={13} /></button>}</div></Panel>;
  return view === 'careers' ? <CareerViewer players={players} /> : <Records />;
}
