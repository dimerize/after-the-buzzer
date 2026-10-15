import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Trophy } from 'lucide-react';
import type { LiveSeason, RecordCategory, RecordLeader, RecordMeasure, RecordMode, RecordSeason, RecordStat, RecordsData, RecordsView } from './shared/records-types';
import { availableLiveSeasons, fetchLiveSeason, liveSeasonView, loadRecordsData, recordSeasons, seasonLabel, seasonView, sinceLabel, singleGameView, singleSeasonView } from './records-model';
import RecordPortrait from './RecordPortrait';
import TeamLabel from './TeamLabel';
import './records.css';

const MODES: [RecordMode, string][] = [['season', 'Season Leaders'], ['game', 'Single Game'], ['single-season', 'Single Season']];
const shortDate = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const verified = (value: string) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : '—'; };

function Team({ team }: { team: string }) {
  const traded = /^(\d)TM$/.exec(team);
  return traded ? <span className="record-traded">{traded[1]} teams</span> : team === 'TOT' ? <span className="record-traded">Multiple</span> : <TeamLabel team={team}/>;
}
function context(view: RecordsView, row: RecordLeader) {
  if (view.mode === 'game') return <>{row.date ? shortDate(row.date) : ''} · <Team team={row.team}/> vs <Team team={row.opponent || ''}/></>;
  if (view.mode === 'single-season') return <>{seasonLabel(row.season)} · <Team team={row.team}/></>;
  return <Team team={row.team}/>;
}

export function RecordsControls({ mode, season, seasons, measure, onMode, onSeason, onMeasure }: { mode: RecordMode; season: number | null; seasons: RecordSeason[]; measure: RecordMeasure; onMode: (mode: RecordMode) => void; onSeason: (season: number) => void; onMeasure: (measure: RecordMeasure) => void }) {
  const index = seasons.findIndex(item => item.season === season);
  const newer = index > 0 ? seasons[index - 1] : null, older = index >= 0 && index < seasons.length - 1 ? seasons[index + 1] : null;
  return <>
    <nav className="history-navigation records-tabs" aria-label="Hall of Fame views">{MODES.map(([id, label]) => <button key={id} type="button" className={mode === id ? 'selected' : ''} aria-pressed={mode === id} onClick={() => onMode(id)}>{label}</button>)}</nav>
    <section className="panel records-toolbar">
      <div className="records-toolbar-title"><Trophy size={17}/><strong>{MODES.find(([id]) => id === mode)![1]}</strong><span>Regular season{mode === 'game' ? ' · all-time' : ''}</span></div>
      <div className="records-toolbar-controls">
        {mode === 'season' && <div className="records-season-picker">
          <button type="button" aria-label={older ? `Previous season, ${older.label}` : 'No older season'} disabled={!older} onClick={() => older && onSeason(older.season)}><ChevronLeft size={18}/></button>
          <label><span className="sr-only">Season</span><select aria-label="Season" value={season ?? ''} onChange={event => onSeason(Number(event.target.value))}>{seasons.map(item => <option key={item.season} value={item.season}>{item.label}{item.inProgress ? ' (live)' : ''}</option>)}</select></label>
          <button type="button" aria-label={newer ? `Next season, ${newer.label}` : 'No newer season'} disabled={!newer} onClick={() => newer && onSeason(newer.season)}><ChevronRight size={18}/></button>
        </div>}
        {mode !== 'game' && <div className="history-mini-segment records-measure" role="group" aria-label="Ranking measure"><button type="button" className={measure === 'per-game' ? 'selected' : ''} aria-pressed={measure === 'per-game'} onClick={() => onMeasure('per-game')}>Per game</button><button type="button" className={measure === 'totals' ? 'selected' : ''} aria-pressed={measure === 'totals'} onClick={() => onMeasure('totals')}>Totals</button></div>}
      </div>
    </section>
  </>;
}

function Card({ view, category, selected, onSelect }: { view: RecordsView; category: RecordCategory; selected: boolean; onSelect: () => void }) {
  const top = category.leaders[0];
  const tied = top ? category.leaders.filter(row => row.rank === top.rank).length : 0;
  return <button type="button" className={`panel record-card${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
    <span className="chrome-bar record-card-title">{category.label}</span>
    {top ? <>
      <RecordPortrait key={top.player.key} player={top.player} size="card" team={view.mode === 'season' ? top.team : undefined}/>
      <span className="record-card-name">{top.player.name}</span>
      <span className="record-card-value"><strong>{top.display}</strong><small>{category.unit}</small></span>
      <span className="record-card-context">{view.mode === 'game' ? (top.date ? shortDate(top.date) : '') : view.mode === 'single-season' ? seasonLabel(top.season) : `${top.games ?? '—'} GP`}{tied > 1 ? ` · ${tied} tied` : ''}</span>
    </> : <>
      <span className="record-portrait record-portrait-card record-not-recorded">Not recorded</span>
      <span className="record-card-name">Since {sinceLabel(category.id)}</span>
      <span className="record-card-value"><strong>—</strong></span>
      <span className="record-card-context">&nbsp;</span>
    </>}
  </button>;
}

export function RecordsResults({ view, stat, onSelect }: { view: RecordsView; stat: RecordStat; onSelect: (stat: RecordStat) => void }) {
  const selected = view.categories.find(category => category.id === stat) ?? view.categories[0];
  const gp = view.mode !== 'game';
  return <>
    <div className="records-grid">{view.categories.map(category => <Card key={category.id} view={view} category={category} selected={category.id === selected.id} onSelect={() => onSelect(category.id)}/>)}</div>
    <section className="panel records-rankings" aria-label={`${selected.label} rankings`}>
      <div className="panel-title"><h2>{selected.label} Rankings</h2><span className="panel-meta">{view.season ? seasonLabel(view.season) : view.mode === 'game' ? 'Single game' : 'All-time'}</span></div>
      {selected.leaders.length ? <table className={`records-table records-table-${view.mode}`}>
        <colgroup><col className="records-rank-col"/><col/>{gp && <col className="records-gp-col"/>}<col className="records-value-col"/></colgroup>
        <thead><tr><th scope="col">#</th><th scope="col">Player</th>{gp && <th scope="col">GP</th>}<th scope="col">{selected.unit}</th></tr></thead>
        <tbody>{selected.leaders.map(row => <tr key={row.key}>
          <td className="records-rank">{row.rank}</td>
          <th scope="row"><span className="records-player"><RecordPortrait player={row.player} size="row"/><span><strong>{row.player.name}</strong><small>{context(view, row)}</small></span></span></th>
          {gp && <td>{row.games ?? '—'}</td>}
          <td className="records-value">{row.display}</td>
        </tr>)}</tbody>
      </table> : <p className="records-empty">{selected.label} were not recorded {view.season ? `in ${seasonLabel(view.season)}` : 'in this period'}. NBA tracking began in {sinceLabel(selected.id)}.</p>}
      <div className="records-footnote">
        <span>{view.scope}{view.minGames ? ` · Per-game ranks need ${view.minGames}+ GP` : view.mode === 'game' ? '' : ' · No games minimum'}</span>
        <span>Verified {verified(view.source.verifiedAt)} · <a href={view.source.url} target="_blank" rel="noreferrer">{view.source.label} <ArrowUpRight size={11}/></a></span>
        {view.notes.map(note => <span key={note}>{note}</span>)}
      </div>
    </section>
  </>;
}

export default function Records() {
  const [data, setData] = useState<RecordsData | null>(null);
  const [failure, setFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<RecordMode>('season');
  const [season, setSeason] = useState<number | null>(null);
  const [measure, setMeasure] = useState<RecordMeasure>('per-game');
  const [stat, setStat] = useState<RecordStat>('points');
  const [liveSeasons, setLiveSeasons] = useState<RecordSeason[]>([]);
  const [live, setLive] = useState<Record<number, LiveSeason | string>>({});

  useEffect(() => {
    let active = true;
    setFailure('');
    loadRecordsData().then(value => { if (active) setData(value); }, () => { if (active) setFailure('Historical records could not be loaded. Check your connection.'); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    if (!data) return;
    const controller = new AbortController();
    void availableLiveSeasons(data, new Date(), controller.signal).then(setLiveSeasons, () => {});
    return () => controller.abort();
  }, [data]);

  const seasons = useMemo(() => data ? recordSeasons(data, liveSeasons) : [], [data, liveSeasons]);
  const chosen = season ?? seasons[0]?.season ?? null;
  const isLive = (year: number | null) => year !== null && liveSeasons.some(item => item.season === year);
  // Newer seasons come from ESPN: the chosen live season, or completed ones for all-time rankings.
  const needed = useMemo(() => mode === 'season' ? (isLive(chosen) ? [chosen!] : []) : mode === 'single-season' ? liveSeasons.filter(item => !item.inProgress).map(item => item.season) : [], [mode, chosen, liveSeasons]);
  useEffect(() => {
    const missing = needed.filter(year => live[year] === undefined || (typeof live[year] === 'string' && attempt > 0));
    if (!missing.length) return;
    const controller = new AbortController();
    for (const year of missing) void fetchLiveSeason(year, controller.signal).then(value => setLive(current => ({ ...current, [year]: value })), error => { if (!controller.signal.aborted) setLive(current => ({ ...current, [year]: error instanceof Error ? error.message : 'ESPN season statistics are unavailable.' })); });
    return () => controller.abort();
  }, [needed.join(','), attempt]);

  let view: RecordsView | null = null, pending = false, liveError = '';
  if (data && chosen !== null) {
    if (mode === 'game') view = singleGameView(data);
    else if (mode === 'single-season') {
      const completed = needed.map(year => live[year]);
      if (completed.some(item => item === undefined)) pending = true;
      view = singleSeasonView(data, measure, completed.filter((item): item is LiveSeason => typeof item === 'object'));
    } else if (isLive(chosen)) {
      const item = live[chosen];
      if (item === undefined) pending = true; else if (typeof item === 'string') liveError = item; else view = liveSeasonView(item, measure);
    } else view = seasonView(data, chosen, measure);
  }

  return <div className="history-view records-view">
    <RecordsControls mode={mode} season={chosen} seasons={seasons} measure={measure} onMode={setMode} onSeason={setSeason} onMeasure={setMeasure}/>
    {failure ? <div className="history-status" role="alert"><span>{failure}</span><button className="small-button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={13}/>Retry</button></div>
      : !data || (pending && !view) ? <div className="history-status" role="status"><LoaderCircle className="spin" size={18}/><span>{data ? 'Loading ESPN season totals…' : 'Loading the record book…'}</span></div>
        : liveError ? <div className="history-status" role="alert"><span>{liveError}</span><button className="small-button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={13}/>Retry</button></div>
          : view && <RecordsResults view={view} stat={stat} onSelect={setStat}/>}
  </div>;
}
