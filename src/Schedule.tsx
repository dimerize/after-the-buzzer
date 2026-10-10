import { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Game, Preferences } from './shared/types';
import { fetchSchedule, formatScheduleDate, formatScheduleTipoff, nextScheduleDate, shiftScheduleDate, visibleScheduleRequest, type ScheduleRequestState } from './schedule-view';
import './schedule.css';

export function ScheduleTable({ games, date, timezone, hideScores }: { games: Game[]; date: string; timezone: string; hideScores: boolean }) {
  return <div className="schedule-table-wrap"><table className="schedule-table" aria-label={`NBA games for ${date}`}>
    <colgroup><col className="schedule-time-col"/><col/><col/><col className="schedule-score-col"/><col className="schedule-status-col"/><col className="schedule-link-col"/></colgroup>
    <thead><tr><th scope="col">Tipoff</th><th scope="col">Away</th><th scope="col">Home</th><th scope="col">Score</th><th scope="col">Status</th><th scope="col"><span className="schedule-sr-only">Source</span></th></tr></thead>
    <tbody>{games.map(game => {
      const tipoff = formatScheduleTipoff(game.startsAt, timezone, date);
      const score = game.status === 'scheduled' || game.status === 'postponed' ? '—' : hideScores ? '••' : `${game.awayScore ?? '—'} – ${game.homeScore ?? '—'}`;
      return <tr key={game.id} className={game.status === 'live' ? 'schedule-live' : ''}>
        <td><time dateTime={game.startsAt}>{tipoff.time}</time>{tipoff.date && <small>{tipoff.date}</small>}</td>
        <th scope="row">{game.away}</th><td className="schedule-team">{game.home}</td>
        <td className="schedule-score" aria-label={hideScores && ['live', 'final'].includes(game.status) ? 'Score hidden' : undefined}>{score}</td>
        <td className="schedule-game-status">{game.status === 'scheduled' ? 'Scheduled' : game.statusText || game.status}</td>
        <td>{game.sourceUrl && <a href={game.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${game.away} at ${game.home}: ESPN game details`}><ArrowUpRight size={15}/></a>}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export default function Schedule({ preferences, demo, onConnectLive, refreshKey = 0 }: { preferences: Pick<Preferences, 'timezone' | 'hideScores'>; demo: boolean; onConnectLive: () => void; refreshKey?: number }) {
  const [date, setDate] = useState(() => nextScheduleDate());
  const [attempt, setAttempt] = useState(0);
  const key = `${date}:${attempt}:${refreshKey}:${demo}`;
  const [state, setState] = useState<ScheduleRequestState>({ key: '', data: null, loading: true, error: '' });
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    let active = true;
    setState({ key, data: null, loading: true, error: '' });
    void fetchSchedule(date, controller.signal).then(data => {
      if (active) setState({ key, data, loading: false, error: '' });
    }).catch(error => {
      if (active && !controller.signal.aborted) setState({ key, data: null, loading: false, error: error instanceof Error ? error.message : 'The schedule could not be loaded.' });
    });
    return () => { active = false; controller.abort(); };
  }, [key, date, demo]);
  const visible = visibleScheduleRequest(state, key);
  const previous = shiftScheduleDate(date, -1);
  const next = shiftScheduleDate(date, 1);
  const updated = visible.data && new Date(visible.data.updatedAt);
  return <section className="schedule-view" aria-label="Game schedule">
    <div className="schedule-controls panel">
      <button aria-label="Previous schedule date" onClick={() => previous && setDate(previous)} disabled={!previous}><ChevronLeft size={19}/></button>
      <div className="schedule-date"><label htmlFor="schedule-date">{formatScheduleDate(date)}</label><input id="schedule-date" aria-label="Schedule date" type="date" value={date} min="2000-01-01" max="2099-12-31" onChange={event => { if (shiftScheduleDate(event.target.value, 0)) setDate(event.target.value); }}/></div>
      <button aria-label="Next schedule date" onClick={() => next && setDate(next)} disabled={!next}><ChevronRight size={19}/></button>
      <button className="schedule-next-slate" onClick={() => setDate(nextScheduleDate())}>Next slate</button>
    </div>
    <div className="schedule-context"><span>NBA slate: Eastern time</span><span>Tipoffs: {preferences.timezone.replaceAll('_', ' ')}</span></div>
    <section className="panel schedule-panel"><div className="panel-title"><h2>Games{!demo && visible.data ? ` (${visible.data.games.length})` : ''}</h2><button onClick={() => setAttempt(value => value + 1)} disabled={demo || visible.loading} aria-label="Refresh schedule"><RefreshCw size={14}/></button></div>
      {demo ? <div className="schedule-feedback" role="status"><span>Connect live data to view the schedule.</span><button className="small-button" onClick={onConnectLive}>Connect live data</button></div>
        : visible.loading ? <div className="schedule-feedback" role="status"><LoaderCircle className="spin" size={19}/><span>Loading schedule…</span></div>
          : visible.error ? <div className="schedule-feedback" role="alert"><span>{visible.error}</span><button className="small-button" onClick={() => setAttempt(value => value + 1)}>Retry</button>{visible.error.startsWith('Sign in') && <button className="small-button" onClick={onConnectLive}>Sign in</button>}</div>
            : visible.data && <>
              {visible.data.games.length ? <ScheduleTable games={visible.data.games} date={date} timezone={preferences.timezone} hideScores={preferences.hideScores}/> : <div className="schedule-feedback" role="status">No games reported for {formatScheduleDate(date)}.</div>}
              {!!visible.data.warnings?.length && <div className="schedule-notices" role="status">{visible.data.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
              <div className="schedule-source"><span>ESPN schedule</span>{updated && Number.isFinite(updated.getTime()) && <time dateTime={visible.data.updatedAt}>Updated {new Intl.DateTimeFormat('en-US', { timeZone: preferences.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(updated)}</time>}</div>
            </>}
    </section>
  </section>;
}
