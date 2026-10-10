import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RefreshCw, X } from 'lucide-react';
import type { GameInjuryReport, InjuryTeam } from './shared/injury-types';
import type { Game } from './shared/types';
import TeamLabel from './TeamLabel';
import { beginInjuryRefresh, completeInjuryRefresh, displayInjuryReport, fetchGameInjuries, formatInjuryTime, injuryRequestKey, isInjuryReportStale, visibleInjuryRequest, type InjuryRequestState } from './injury-view';
import './injury-report.css';

interface BodyProps { game: Game; report: GameInjuryReport | null; timezone: string; loading: boolean; error: string; demo: boolean; now?: Date; onRetry: () => void; onConnectLive: () => void }
interface Props { game: Game; date: string; timezone: string; demo: boolean; onClose: () => void; onConnectLive: () => void }

function safeSource(url: string): string | null {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : null; }
  catch { return null; }
}

function SourceTime({ label, value, timezone }: { label: string; value: string | null; timezone: string }) {
  const formatted = formatInjuryTime(value, timezone);
  return <span>{label} {formatted && value ? <time dateTime={value}>{formatted}</time> : 'not supplied'}</span>;
}

function InjuryTeamTable({ team, timezone }: { team: InjuryTeam; timezone: string }) {
  return <section className="injury-team" aria-label={`${team.displayName} injuries`}>
    <h3><TeamLabel team={team.team} /><span>{team.displayName}</span><small>{team.coverage === 'reported' ? `${team.players.length} listed` : team.coverage === 'not-listed' ? 'No ESPN entries listed' : 'Coverage unavailable'}</small></h3>
    {team.coverage === 'reported' && team.players.length > 0 ? <table className="injury-table"><colgroup><col className="injury-player-col"/><col className="injury-status-col"/><col/></colgroup><thead><tr><th scope="col">Player</th><th scope="col">Status</th><th scope="col">Reason / update</th></tr></thead>
      <tbody>{team.players.map(player => <tr key={player.id}><th scope="row"><span className="injury-person"><span className="injury-portrait">{/^\d+$/.test(player.id) && <img src={`https://a.espncdn.com/i/headshots/nba/players/full/${player.id}.png`} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />}</span><span>{player.name}</span></span></th><td><span className="injury-status">{player.status}</span></td><td><span className="injury-reason">{player.reason || 'Reason not supplied'}</span><small><SourceTime label="Entry updated" value={player.updatedAt} timezone={timezone} />{player.estimatedReturn && <span>Estimated return: {player.estimatedReturn}</span>}</small></td></tr>)}</tbody></table>
      : <p className="injury-team-empty">{team.coverage === 'unavailable' ? 'ESPN coverage for this team is unavailable.' : 'No ESPN entries listed for this team.'}</p>}
  </section>;
}

export function InjuryReportBody({ game, report, timezone, loading, error, demo, now = new Date(), onRetry, onConnectLive }: BodyProps) {
  const visible = report ? displayInjuryReport(report, game, report.date, now) : null;
  const saved = !!visible && visible.availability === 'current' && (isInjuryReportStale(visible, now) || !!error);
  return <div className="injury-dialog-body">
    {demo ? <div className="injury-feedback" role="status"><p>Sample mode has no live injury report.</p><button className="small-button" onClick={onConnectLive}>Connect live data</button></div>
      : <>
        {loading && !visible && <div className="injury-feedback" role="status">Loading ESPN injury listings…</div>}
        {error && <div className="injury-alert" role="alert"><span>{saved ? 'Previously checked data. Refresh failed: ' : ''}{error}</span><button className="small-button" onClick={error.startsWith('Sign in') ? onConnectLive : onRetry}>{error.startsWith('Sign in') ? 'Sign in' : 'Retry'}</button></div>}
        {visible && <>
          {visible.availability === 'historical-unavailable' ? <div className="injury-feedback" role="status"><strong>Historical injury report unavailable</strong><p>Current injury listings cannot describe this completed or past game.</p></div>
            : visible.availability === 'unavailable' ? <div className="injury-feedback" role="status"><strong>Injury data unavailable</strong><p>ESPN did not provide a verified injury list for this matchup.</p></div>
              : <div className="injury-teams">{visible.teams.map(team => <InjuryTeamTable key={team.team} team={team} timezone={timezone} />)}</div>}
          {!!visible.warnings.length && <div className="injury-warnings" role="status">{visible.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
          <div className="injury-provenance"><div><SourceTime label="Source updated" value={visible.feedUpdatedAt} timezone={timezone}/><SourceTime label="Checked" value={visible.fetchedAt} timezone={timezone}/>{saved && <strong>Saved report may be outdated</strong>}</div><div className="injury-sources">{safeSource(visible.sourceUrl) && <a href={safeSource(visible.sourceUrl)!} target="_blank" rel="noreferrer">ESPN injuries <ArrowUpRight size={13}/></a>}{safeSource(visible.officialSourceUrl) && <a href={safeSource(visible.officialSourceUrl)!} target="_blank" rel="noreferrer">NBA official injury report <ArrowUpRight size={13}/></a>}{game.sourceUrl && safeSource(game.sourceUrl) && <a href={game.sourceUrl} target="_blank" rel="noreferrer">ESPN game <ArrowUpRight size={13}/></a>}</div></div>
        </>}
        {!visible && !loading && !error && <div className="injury-feedback" role="status">Injury data unavailable. <button className="small-button" onClick={onRetry}>Retry</button></div>}
        <p className="injury-caveat">ESPN injury listings are not an official game availability report. No listing does not confirm a player is healthy or available.</p>
      </>}
  </div>;
}

export function useInjuryReport(game: Game, date: string, demo: boolean, active = true) {
  const requestRef = useRef<() => void>(() => {});
  const [clock, setClock] = useState(() => Date.now());
  const key = injuryRequestKey(game, date);
  const [state, setState] = useState<InjuryRequestState>({ key, data: null, loading: !demo, error: '' });
  useEffect(() => {
    if (demo) { setState({ key, data: null, loading: false, error: '' }); return; }
    if (!active) return;
    let current = true;
    let inFlight: AbortController | null = null;
    const refresh = () => {
      if (!current || document.visibilityState === 'hidden') return;
      setClock(Date.now());
      if (inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      setState(previous => beginInjuryRefresh(previous, key));
      void fetchGameInjuries(game, date, controller.signal).then(data => {
        if (current && !controller.signal.aborted) { setClock(Date.now()); setState(previous => completeInjuryRefresh(previous, key, data)); }
      }).catch(error => {
        if (current && !controller.signal.aborted) { setClock(Date.now()); setState(previous => previous.key === key ? { ...previous, loading: false, error: error instanceof Error ? error.message : 'Injury data unavailable.' } : previous); }
      }).finally(() => { if (inFlight === controller) inFlight = null; });
    };
    requestRef.current = refresh;
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('pageshow', refresh);
    return () => { current = false; inFlight?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh); window.removeEventListener('pageshow', refresh); };
  }, [key, game.id, game.away, game.home, game.status, date, demo, active]);
  return { visible: visibleInjuryRequest(state, key), clock, refresh: () => requestRef.current() };
}

export function InjuryReportContent({ game, date, timezone, demo, active = true, onConnectLive }: Omit<Props, 'onClose'> & { active?: boolean }) {
  const { visible, clock, refresh } = useInjuryReport(game, date, demo, active);
  return <InjuryReportBody game={game} report={visible.data} timezone={timezone} loading={visible.loading} error={visible.error} demo={demo} now={new Date(clock)} onRetry={refresh} onConnectLive={onConnectLive}/>;
}

export default function InjuryReport({ game, date, timezone, demo, onClose, onConnectLive }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { visible, clock, refresh } = useInjuryReport(game, date, demo);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!openerRef.current && document.activeElement instanceof HTMLElement && !element.contains(document.activeElement)) openerRef.current = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!element.open) element.showModal();
    element.querySelector<HTMLButtonElement>('.injury-close')?.focus();
    return () => { element.close(); document.body.style.overflow = originalOverflow; openerRef.current?.focus(); };
  }, []);
  return <dialog ref={dialog} className="injury-dialog" aria-labelledby="injury-dialog-title" onCancel={event => { event.preventDefault(); closeRef.current(); }} onClick={event => { if (event.target === dialog.current) closeRef.current(); }}>
    <div className="injury-dialog-frame"><header className="injury-header"><h2 id="injury-dialog-title">Injury report <span>{game.away} at {game.home}</span></h2><div><button className="injury-refresh" type="button" aria-label="Refresh injury report" disabled={demo || visible.loading} onClick={refresh}><RefreshCw size={17}/></button><button className="injury-close" type="button" aria-label="Close injury report" onClick={onClose}><X size={20}/></button></div></header>
      <InjuryReportBody game={game} report={visible.data} timezone={timezone} loading={visible.loading} error={visible.error} demo={demo} now={new Date(clock)} onRetry={refresh} onConnectLive={onConnectLive}/>
    </div>
  </dialog>;
}
