import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, ArrowDownToLine, ArrowUpRight, Bell, BellOff, CalendarDays, Check, ChevronDown, ChevronRight, Clock3, Eye, EyeOff, Flame, HelpCircle, LoaderCircle, LogOut, Moon, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Star, Trophy, Users, X, Zap } from 'lucide-react';
import { DEFAULT_PREFERENCES } from './shared/defaults';
import { demoDashboard, SAMPLE_PLAYERS } from './demo';
import type { Dashboard, Game, PlayerLine, Preferences, Tier, WatchPlayer } from './shared/types';
import { createPreferenceSaveQueue, type PreferenceSaveQueue, type PreferenceUpdate } from './preference-save-queue';
import { createNotificationNavigation, sendCurrentDeviceTest } from './notification-navigation';
import History from './History';
import Schedule from './Schedule';
import InjuryReport from './InjuryReport';
import PlayerRoster from './PlayerRoster';
import TeamLabel, { TeamText } from './TeamLabel';

type Page = 'tonight' | 'games' | 'players' | 'archive' | 'settings';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const navigation: { id: Page; title: string; icon: typeof Moon }[] = [
  { id: 'tonight', title: 'Recap', icon: Moon }, { id: 'games', title: 'Games', icon: CalendarDays }, { id: 'players', title: 'Watchlist', icon: Users },
  { id: 'archive', title: 'Archive', icon: Archive }, { id: 'settings', title: 'Settings', icon: Settings2 }
];
const tiers: { id: Tier; title: string; description: string }[] = [
  { id: 'favorite', title: 'Favorites', description: 'Always shown in the recap.' },
  { id: 'interest', title: 'Following', description: 'Higher priority in performance rankings.' },
  { id: 'league', title: 'League', description: 'Standard ranking priority.' }
];

class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApiError(body.error || `Could not complete the request (${response.status}).`, response.status);
  return body as T;
}
function readSamplePreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('buzzer:sample-preferences') || 'null') as Preferences | null;
    if (value && Array.isArray(value.players) && value.bedtime && value.timezone) return { ...structuredClone(DEFAULT_PREFERENCES), ...value };
  } catch { /* Use defaults when device storage is unavailable. */ }
  return structuredClone(DEFAULT_PREFERENCES);
}
function saveLocal(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Private browsing may block storage. */ } }
function sampleSelected() { try { return localStorage.getItem('buzzer:mode') === 'sample'; } catch { return false; } }
function displayDate(date: string, long = false) { return new Intl.DateTimeFormat('en-US', { weekday: long ? 'long' : 'short', month: long ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)); }
function shortName(name: string) { const names = name.split(' '); return names.length > 1 ? `${names[0][0]}. ${names.slice(1).join(' ')}` : name; }
function timeLabel(time: string) { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; }
function Stat({ value, label }: { value: ReactNode; label: string }) { return <span className="stat"><strong>{value}</strong><small>{label}</small></span>; }
function Team({ team }: { team: string }) { return <TeamLabel team={team} className="team-name" />; }
function Toggle({ value, onChange, label, detail, disabled = false }: { value: boolean; onChange: (value: boolean) => void; label: string; detail?: string; disabled?: boolean }) {
  return <label className={`toggle-row ${disabled ? 'disabled' : ''}`}><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><input type="checkbox" role="switch" aria-label={label} checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" className="toggle-track" /></label>;
}
function Panel({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={'panel ' + className}><div className="panel-title"><h2>{title}</h2>{action}</div>{children}</section>;
}
function Logo() { return <span className="console-logo console-wordmark"><img src="/wordmark.svg" alt="After the Buzzer" /></span>; }
function PlayerPortrait({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return /^\d+$/.test(id) && !failed ? <img src={`https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`} alt="" onError={() => setFailed(true)} /> : <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="41" /><path d="M10 50h80M50 9v82M21 21c37 4 55 22 58 58M21 79c5-34 21-54 58-58" /></svg>;
}
function PlayerStats({ line }: { line: PlayerLine }) {
  const stats = [ ['Min', line.minutes], ['FG', `${line.fgMade}/${line.fgAttempted}`], ['3PM', line.threes], ['FT', `${line.ftMade}/${line.ftAttempted}`], ['STL', line.steals], ['BLK', line.blocks], ['TO', line.turnovers], ['+/−', line.plusMinus === null ? '—' : `${line.plusMinus > 0 ? '+' : ''}${line.plusMinus}`] ];
  return <div className="expanded-stats">{stats.map(([label, value]) => <Stat key={label} label={String(label)} value={value} />)}</div>;
}
export function PlayerRow({ player, line, expanded, onExpand }: { player: WatchPlayer; line?: PlayerLine; expanded: boolean; onExpand: () => void }) {
  const available = line && !line.didNotPlay && line.minutes > 0;
  const team = line?.team || player.team;
  const status = player.id.startsWith('pending:') ? 'Identity unverified' : line?.didNotPlay ? 'Did not play' : line && line.minutes === 0 ? 'No minutes recorded' : 'No game data for this night';
  return <div className={`player-row-wrap ${expanded ? 'expanded' : ''}`}><button className="player-row" onClick={onExpand} aria-expanded={expanded} aria-label={`${player.name}, ${available ? `${line.points} points, ${line.rebounds} rebounds, ${line.assists} assists. ${expanded ? 'Hide' : 'Show'} full stats` : status}`}>
    <span className={`player-avatar team-${team.toLowerCase()}`} aria-hidden="true"><PlayerPortrait key={player.id} id={player.id} /></span><span className="player-name"><strong>{player.name}</strong><small><Team team={team} />{line && <span>vs <TeamLabel team={line.opponent} /></span>}{line?.status === 'live' && <span className="live-label">Live</span>}</small></span>
    {available ? <span className="player-main-stats"><Stat value={line.points} label="PTS" /><Stat value={line.rebounds} label="REB" /><Stat value={line.assists} label="AST" /></span> : <span className="no-game">{player.id.startsWith('pending:') ? 'Unverified' : line?.didNotPlay ? 'DNP' : 'No game data'}</span>}
    <ChevronDown className="expand-icon" size={16} /></button>{expanded && (available ? <PlayerStats line={line} /> : <p className="player-status-detail">{status}.</p>)}</div>;
}
export function GameRow({ game, hideScores, onOpen }: { game: Game; hideScores: boolean; onOpen: () => void }) {
  const row = <><div className="game-teams"><span><Team team={game.away} /><strong>{hideScores ? '••' : game.awayScore ?? '—'}</strong></span><span><Team team={game.home} /><strong>{hideScores ? '••' : game.homeScore ?? '—'}</strong></span></div><span className={`game-status ${game.status === 'live' ? 'is-live' : ''}`}>{game.status === 'live' && <i />}{game.statusText}</span></>;
  return <div className="game-row"><button className="game-row-open" onClick={onOpen} aria-label={`Open injury report for ${game.away} at ${game.home}, ${game.statusText}`}>{row}</button>{game.sourceUrl && <a className="game-row-source" href={game.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${game.away} at ${game.home}: ESPN game details`}><ArrowUpRight size={16}/></a>}</div>;
}

export default function App() {
  const [notificationNavigation] = useState(() => createNotificationNavigation(typeof window === 'undefined' ? '' : window.location.search));
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [page, setPage] = useState<Page>('tonight');
  const [scheduleRefresh, setScheduleRefresh] = useState(0);
  const [selectedInjuryGame, setSelectedInjuryGame] = useState<{ game: Game; date: string } | null>(null);
  const [archiveView, setArchiveView] = useState<'recaps' | 'careers' | 'honors'>('careers');
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [connectionWarning, setConnectionWarning] = useState('');
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(notificationNavigation.playerId || '5104157');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<WatchPlayer[]>([]);
  const [searching, setSearching] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [pushStatus, setPushStatus] = useState('');
  const [testingPush, setTestingPush] = useState(false);
  const preferenceQueue = useRef<PreferenceSaveQueue | null>(null);
  const preferenceMode = useRef<'sample' | 'live' | null>(null);
  const preferenceRevision = useRef(0);
  const loadRevision = useRef(0);

  function setPreferenceSession(initial: Preferences, mode: 'sample' | 'live') {
    preferenceQueue.current?.dispose();
    preferenceMode.current = mode;
    preferenceRevision.current++;
    preferenceQueue.current = createPreferenceSaveQueue({
      initial,
      save: async (next) => {
        if (mode === 'sample') { saveLocal('buzzer:sample-preferences', JSON.stringify(next)); return; }
        await api('/api/preferences', { method: 'PUT', body: JSON.stringify(next) });
      },
      onChange: (next) => {
        preferenceRevision.current++;
        setDashboard((current) => current ? { ...current, preferences: next } : current);
      },
      onError: (error) => setMessage(error instanceof Error ? error.message : 'Preferences could not be saved.')
    });
  }
  function closePreferenceSession() {
    preferenceQueue.current?.dispose(); preferenceQueue.current = null; preferenceMode.current = null;
    preferenceRevision.current++;
  }
  function applyLiveDashboard(result: Dashboard, revision: number) {
    if (preferenceMode.current === 'live' && preferenceQueue.current && preferenceRevision.current !== revision) {
      result = { ...result, preferences: preferenceQueue.current.current() };
    } else setPreferenceSession(result.preferences, 'live');
    setDashboard(result); setDemo(false); setAuth(false); setConnectionWarning(''); saveLocal('buzzer:mode', 'live');
  }
  async function useSample(warning = '') {
    const request = ++loadRevision.current;
    await preferenceQueue.current?.whenIdle();
    if (request !== loadRevision.current) return;
    const preferences = readSamplePreferences();
    setPreferenceSession(preferences, 'sample');
    setDemo(true); setAuth(false); setDashboard(demoDashboard(preferences));
    setConnectionWarning(warning); saveLocal('buzzer:mode', 'sample'); setLoading(false);
  }
  async function loadLive(date?: string) {
    if (date !== undefined) notificationNavigation.selectDate(date);
    const path = notificationNavigation.dashboardPath();
    const requestedDate = notificationNavigation.date;
    const request = ++loadRevision.current;
    setLoading(true); setMessage('');
    try {
      await preferenceQueue.current?.whenIdle();
      if (request !== loadRevision.current) return;
      const revision = preferenceRevision.current;
      const result = await api<Dashboard>(path);
      if (request !== loadRevision.current) return;
      applyLiveDashboard(result, revision);
    } catch (error) {
      if (request !== loadRevision.current) return;
      if (error instanceof ApiError && error.status === 401) { closePreferenceSession(); setAuth(true); setDashboard(null); setDemo(false); }
      else if (requestedDate && dashboard && !demo) { setMessage(error instanceof Error ? error.message : 'Could not load this date.'); }
      else await useSample('Live data unavailable. Showing fictional sample data.');
    } finally { if (request === loadRevision.current) setLoading(false); }
  }
  useEffect(() => {
    if (!notificationNavigation.forceLive && sampleSelected()) void useSample(); else void loadLive();
    return () => { loadRevision.current++; closePreferenceSession(); };
  }, []);
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    let active = true;
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const found = demo ? SAMPLE_PLAYERS.filter((p) => `${p.name} ${p.team}`.toLowerCase().includes(search.toLowerCase())) : (await api<{ players: WatchPlayer[] }>(`/api/players?q=${encodeURIComponent(search)}`)).players;
        if (active) setSearchResults(found);
      } catch { if (active) { setSearchResults([]); setMessage('Player search unavailable.'); } }
      finally { if (active) setSearching(false); }
    }, 250);
    return () => { active = false; clearTimeout(timeout); };
  }, [search, demo]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 6500); return () => clearTimeout(timer); }, [message]);
  useEffect(() => {
    if (!showInstall) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowInstall(false); return; }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.install-dialog button'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', closeOnKey);
    return () => { document.removeEventListener('keydown', closeOnKey); previousFocus?.focus(); };
  }, [showInstall]);

  async function updatePreferences(next: PreferenceUpdate) {
    if (!dashboard) return false;
    if (!preferenceQueue.current) setPreferenceSession(dashboard.preferences, demo ? 'sample' : 'live');
    return preferenceQueue.current!.update(next);
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) }); setPassword(''); await loadLive(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (!dashboard) return;
    if (demo) { setMessage('Sample data cannot refresh. Connect to live data.'); return; }
    const request = ++loadRevision.current;
    setBusy(true);
    try {
      await preferenceQueue.current?.whenIdle();
      if (request !== loadRevision.current) return;
      const revision = preferenceRevision.current;
      const result = await api<Dashboard>('/api/refresh', { method: 'POST', body: JSON.stringify({ date: dashboard.night.date }) });
      if (request !== loadRevision.current) return;
      applyLiveDashboard(result, revision); setMessage('Updated.');
    }
    catch (error) { if (request === loadRevision.current) setMessage(error instanceof Error ? error.message : 'Refresh failed. Previous data retained.'); }
    finally { setBusy(false); }
  }
  function selectNight(date: string) {
    notificationNavigation.selectDate(date);
    if (demo && dashboard) setDashboard(demoDashboard(preferenceQueue.current?.current() ?? dashboard.preferences, date)); else void loadLive(date);
    setPage('tonight'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openLatest() { notificationNavigation.openLatest(); window.history.replaceState(null, '', '/?latest=1'); setPage('tonight'); if (demo) void useSample(); else void loadLive(); window.scrollTo({ top: 0 }); }
  async function install() {
    if (installPrompt) { await installPrompt.prompt(); const result = await installPrompt.userChoice; if (result.outcome === 'accepted') setMessage('App installed.'); setInstallPrompt(null); }
    else setShowInstall(true);
  }
  async function enablePush(enableLiveAlerts = false) {
    if (!dashboard) return;
    if (demo) { setPushStatus('Notifications require live mode.'); return; }
    if (!dashboard.capabilities.push) { setPushStatus('Push notifications are not configured.'); return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { setPushStatus('Push is unavailable in this browser. On iPhone, open the installed home-screen app.'); return; }
    const activeQueue = preferenceQueue.current;
    setBusy(true);
    try {
      const permissionRequest = Notification.requestPermission();
      const [{ publicKey }, permission] = await Promise.all([api<{ publicKey: string }>('/api/push/key'), permissionRequest]);
      if (activeQueue !== preferenceQueue.current || preferenceMode.current !== 'live') return;
      if (!publicKey) throw new Error('Push notifications are not configured.');
      if (permission !== 'granted') { setPushStatus('Notifications blocked. Change permission in browser settings.'); return; }
      const registration = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(publicKey.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
      if (activeQueue !== preferenceQueue.current || preferenceMode.current !== 'live') return;
      if (enableLiveAlerts && !await updatePreferences((current) => ({ ...current, liveAlerts: true }))) {
        setPushStatus('Bedtime notifications enabled. Live alerts could not be saved.'); return;
      }
      setPushStatus(`Bedtime notifications enabled.${enableLiveAlerts ? ' Live player alerts enabled.' : ''} Quiet hours apply.`);
    } catch (error) { if (activeQueue === preferenceQueue.current) setPushStatus(error instanceof Error ? error.message : 'Notifications could not be enabled.'); }
    finally { setBusy(false); }
  }
  async function testPush() {
    if (!dashboard || demo) { setPushStatus('Notifications require live mode.'); return; }
    if (!dashboard.capabilities.push) { setPushStatus('Push notifications are not configured.'); return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { setPushStatus('On iPhone, add this HTTPS site to your home screen, open it there, then enable notifications.'); return; }
    const activeQueue = preferenceQueue.current;
    setBusy(true); setTestingPush(true); setPushStatus('');
    try {
      await sendCurrentDeviceTest(Notification.permission, async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration ? registration.pushManager.getSubscription() : null;
      }, async endpoint => {
        if (activeQueue !== preferenceQueue.current || preferenceMode.current !== 'live') return;
        await api('/api/push/test', { method: 'POST', body: JSON.stringify({ endpoint }) });
      });
      if (activeQueue === preferenceQueue.current && preferenceMode.current === 'live') setPushStatus('Test submitted. Check this device’s notifications.');
    } catch (error) { if (activeQueue === preferenceQueue.current) setPushStatus(error instanceof Error ? error.message : 'Test notification failed.'); }
    finally { setBusy(false); setTestingPush(false); }
  }
  function changePlayer(id: string, patch: Partial<WatchPlayer>) { void updatePreferences((current) => ({ ...current, players: current.players.map((p) => p.id === id ? { ...p, ...patch } : p) })); }
  function addPlayer(player: WatchPlayer) { void updatePreferences((current) => current.players.some((p) => p.id === player.id) ? current : ({ ...current, players: [...current.players, { ...player, tier: 'interest', alerts: false }] })); }
  async function logout() {
    setBusy(true);
    try { await preferenceQueue.current?.whenIdle(); await api('/api/logout', { method: 'POST' }); loadRevision.current++; closePreferenceSession(); setDashboard(null); setAuth(true); setDemo(false); setLoading(false); }
    catch { setMessage('Sign-out failed.'); }
    finally { setBusy(false); }
  }
  function goTo(next: Page) { setPage(next); window.scrollTo({ top: 0 }); }

  if (loading && !dashboard) return <main className="loading-screen"><Logo /><section className="panel loading-panel"><h1 className="chrome-bar">Loading</h1><LoaderCircle className="spin" size={28} /><div className="loading-progress"><i /></div></section></main>;
  if (auth) return <main className="auth-screen"><header className="console-header"><Logo /><h1>Sign In</h1></header><section className="panel auth-panel"><div className="panel-title"><h2>Account</h2><ShieldCheck size={17} /></div><div className="auth-content"><form onSubmit={login}><label htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required placeholder="Enter your password" /><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <span className="control-glyph green"><Check size={13} /></span>}Sign in</button>{message && <p role="alert" className="form-error">{message}</p>}<button className="text-button auth-demo" type="button" onClick={() => useSample()}><span className="control-glyph blue"><Eye size={13} /></span>View sample</button><p className="auth-fine">Sample data is fictional.</p></form></div></section></main>;
  if (!dashboard) return null;
  const { night, preferences } = dashboard;
  const favorites = preferences.players.filter((player) => player.tier === 'favorite');
  const finished = night.games.filter((game) => game.status === 'final').length;
  const stillPlaying = night.games.filter((game) => game.status === 'live').length;
  const shownHighlights = night.highlights.slice(0, preferences.length === 'quick' ? 2 : preferences.length === 'nerd' ? 8 : 3);
  const dateParts = displayDate(night.date, true);
  const updateTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: preferences.timezone }).format(new Date(night.updatedAt));
  const pageTitle = page === 'tonight' ? 'Nightly Recap' : page === 'games' ? 'Game Schedule' : page === 'players' ? 'Watchlist' : page === 'archive' ? 'Archive' : 'Settings';

  return <div className="app-shell">
    <header className="console-header"><button className="logo-button" onClick={openLatest} aria-label="Open latest recap"><Logo /></button><h1>{pageTitle}</h1></header>
    <main className="main-content" id="main-content">
      <nav className="game-tabs schedule-tabs" aria-label="Main navigation">{navigation.map(({id,title,icon:Icon}) => <button key={id} className={page === id ? 'selected' : ''} onClick={() => goTo(id)} aria-current={page === id ? 'page' : undefined}><Icon size={16}/><span>{title}</span>{id === 'players' && <small>{preferences.players.length}</small>}</button>)}</nav>
      {page !== 'settings' && page !== 'games' && <div className="edition-strip"><button onClick={openLatest} disabled={loading}>Latest</button><span><Clock3 size={13}/>{dateParts}</span><span>{night.season} {night.seasonType}</span><strong className={demo ? 'sample-label' : ''}>{demo ? 'Sample edition' : night.edition + ' edition'}</strong></div>}
      {demo && page !== 'games' && <div className="sample-notice"><span><Sparkles size={13}/>{connectionWarning || 'Sample data is fictional.'}</span><button onClick={() => void loadLive()}>Connect live data <ArrowUpRight size={13}/></button></div>}
      {page !== 'settings' && page !== 'games' && night.partial && <div className="warning-notice" role="status"><Radio size={16}/><span>Incomplete data. Some box scores are missing or delayed.</span><button onClick={() => void refresh()}>Retry</button></div>}
      {page !== 'settings' && page !== 'games' && night.warnings.length > 0 && <details className="data-warnings"><summary>{night.warnings.length} data {night.warnings.length === 1 ? 'notice' : 'notices'}</summary>{night.warnings.map((warning,i) => <p key={i}>{warning}</p>)}</details>}

      {page === 'games' && <Schedule preferences={preferences} demo={demo} onConnectLive={() => void loadLive()} onOpenGame={(game, date) => setSelectedInjuryGame({ game, date })} refreshKey={scheduleRefresh}/>}

      {(page === 'tonight' || page === 'players') && <PlayerRoster players={preferences.players} lines={night.players} games={night.games} selectedId={expandedPlayer} onSelect={setExpandedPlayer} demo={demo}/>}
      {page === 'tonight' && <div className="recap-layout"><div className="primary-rail">
        <Panel title="Game Report" className="report-panel">
          <div className="report-summary"><p><TeamText text={night.summary} /></p></div>
          {shownHighlights.length ? <div className="highlights">{shownHighlights.map((highlight,index) => <article className="highlight" key={highlight.id}><span className="highlight-rank">{index+1}</span><div><h3><span><TeamText text={highlight.title} /></span>{highlight.category === 'favorite' && <Star size={12} fill="currentColor"/>}</h3><p><TeamText text={highlight.detail} /></p>{highlight.sourceUrl && <a className="source-link" target="_blank" rel="noreferrer" href={highlight.sourceUrl}>View box score <ArrowUpRight size={12}/></a>}</div><div className="highlight-stat"><strong>{highlight.statValue}</strong><small>{highlight.statLabel}</small></div></article>)}</div> : <div className="empty-state"><Moon size={26}/><h3>{night.games.length ? 'Waiting for game statistics' : 'No games reported'}</h3>{!night.games.length && <p>Select a date in Archive.</p>}</div>}
        </Panel>
        <Panel title="Favorites • Box Scores" action={<button onClick={() => goTo('players')}>Manage <ChevronRight size={13}/></button>} className="roster-panel">
          <div className="roster-head"><span>Player</span><span>PTS</span><span>REB</span><span>AST</span><span/></div>
          <div className="favorites-list">{favorites.length ? favorites.map((player) => <PlayerRow key={player.id} player={player} line={night.players.find((line) => line.id === player.id)} expanded={expandedPlayer === player.id} onExpand={() => setExpandedPlayer(expandedPlayer === player.id ? null : player.id)}/>) : <div className="empty-state"><p>No favorites selected.</p><button className="small-button" onClick={() => goTo('players')}>Add players</button></div>}</div><div className="panel-footnote">Select a player for full statistics. {demo ? 'Fictional sample stats.' : 'ESPN box scores.'}</div>
        </Panel>
        {preferences.length === 'nerd' && <Panel title="Around the League" className="roster-panel"><div className="roster-head"><span>Player</span><span>PTS</span><span>REB</span><span>AST</span><span/></div><div className="favorites-list">{night.players.filter((line) => !favorites.some((player) => player.id === line.id)).slice(0,12).map((line) => <PlayerRow key={line.id} player={{...line,tier:'league',alerts:false}} line={line} expanded={expandedPlayer === line.id} onExpand={() => setExpandedPlayer(expandedPlayer === line.id ? null : line.id)}/>)}</div></Panel>}
      </div><aside className="secondary-rail">
        <Panel title="Scoreboard" action={<span className="panel-meta">{night.games.length} games</span>} className="scoreboard"><div className="scoreboard-games">{night.games.length ? night.games.map((game) => <GameRow key={game.id} game={game} hideScores={preferences.hideScores} onOpen={() => setSelectedInjuryGame({ game, date: night.date })}/>) : <p className="sidebar-empty">No games for this date.</p>}</div><button className="scores-toggle" onClick={() => void updatePreferences((current) => ({...current,hideScores:!current.hideScores}))}>{preferences.hideScores ? <Eye size={14}/> : <EyeOff size={14}/>} {preferences.hideScores ? 'Show scores' : 'Hide scores'}</button></Panel>
        <Panel title="Night Leaders" className="leaders">{night.leaders.length ? night.leaders.map((leader) => <div className="leader-row" key={leader.category}><div><small>{leader.category}</small><strong title={leader.names.join(', ')}>{leader.names.map(shortName).join(' / ')}</strong></div><span>{leader.value}</span></div>) : <p className="sidebar-empty">Awaiting game stats.</p>}<p className="panel-footnote">{demo ? 'Fictional sample performances.' : 'Among available box scores.'}{night.partial && ' Incomplete coverage.'}</p></Panel>
        {stillPlaying > 0 && <div className="night-status-bar"><span className="live-dot"/><strong>{stillPlaying} games in progress</strong></div>}
      </aside></div>}

      {page === 'players' && <section className="roster-page"><Panel title="Player Search" className="search-panel"><div className="player-search"><Search size={18}/><input aria-label="Search NBA players" placeholder="Search name or team" value={search} onChange={(event) => setSearch(event.target.value)}/>{search && <button className="icon-button" aria-label="Clear player search" onClick={() => setSearch('')}><X size={16}/></button>}</div>{search && <div className="search-results" aria-live="polite">{searching ? <p><LoaderCircle className="spin" size={16}/>Searching…</p> : searchResults.length ? searchResults.map((player) => <div className="search-result" key={player.id}><TeamLabel team={player.team} className="roster-team" /><strong>{player.name}</strong><button className="small-button" disabled={preferences.players.some((p) => p.id === player.id)} onClick={() => addPlayer(player)}>{preferences.players.some((p) => p.id === player.id) ? <><Check size={14}/>Added</> : <><Plus size={14}/>Add</>}</button></div>) : <p>No matching players.{demo && ' Sample search is limited.'}</p>}</div>}</Panel>
        {tiers.map((tier) => <Panel key={tier.id} title={tier.title} action={<span className="panel-meta">{preferences.players.filter((p) => p.tier === tier.id).length} players</span>} className="watchlist-panel"><p className="tier-description">{tier.description}</p><div className="watchlist-head"><span>Player</span><span>Recap tier</span><span>Alerts</span><span/></div><div className="watchlist">{preferences.players.filter((p) => p.tier === tier.id).map((player) => <div className={'watchlist-row '+(expandedPlayer === player.id ? 'selected' : '')} key={player.id}><button className="watchlist-player" onClick={() => setExpandedPlayer(player.id)}><TeamLabel team={player.team} className="roster-team" /><span><strong>{player.name}</strong>{player.id.startsWith('pending:') && <small>Identity pending</small>}</span></button><select aria-label={'Recap tier for '+player.name} value={player.tier} onChange={(event) => changePlayer(player.id,{tier:event.target.value as Tier})}>{tiers.map((option) => <option value={option.id} key={option.id}>{option.title}</option>)}</select><button className={'icon-button '+(player.alerts ? 'alerts-on' : '')} aria-label={(player.alerts ? 'Disable' : 'Enable')+' alerts for '+player.name} title={(player.alerts ? 'Disable' : 'Enable')+' alerts'} onClick={() => changePlayer(player.id,{alerts:!player.alerts})}>{player.alerts ? <Bell size={17}/> : <BellOff size={17}/>}</button><button className="icon-button remove-player" aria-label={'Remove '+player.name+' from watchlist'} onClick={() => void updatePreferences((current) => ({...current,players:current.players.filter((p) => p.id !== player.id)}))}><X size={17}/></button></div>)}{!preferences.players.some((p) => p.tier === tier.id) && <p className="empty-tier">No players.</p>}</div></Panel>)}
        <div className="info-bar"><Bell size={14}/><span>Player alerts require live alerts in Settings. {demo && 'Sample preferences are device-only.'}</span></div>
      </section>}

      {page === 'archive' && <><nav className="history-navigation" aria-label="Archive sections">{([{id:'recaps',label:'Recaps'},{id:'careers',label:'Careers'},{id:'honors',label:'Hall of Fame'}] as const).map((item) => <button key={item.id} className={archiveView === item.id ? 'selected' : ''} aria-pressed={archiveView === item.id} onClick={() => setArchiveView(item.id)}>{item.label}</button>)}</nav>{archiveView !== 'recaps' && <History view={archiveView} players={preferences.players} demo={demo} onConnectLive={() => void loadLive()}/>}</>}
      {page === 'archive' && archiveView === 'recaps' && <div className="archive-layout"><div><Panel title="Saved Editions" action={<span className="panel-meta">{dashboard.archive.length} saved</span>} className="archive-panel"><div className="archive-table-head"><span>Date</span><span>Edition</span><span/></div>{dashboard.archive.length ? dashboard.archive.map((edition) => <button className={'archive-entry '+(edition.date === night.date ? 'selected' : '')} key={edition.date} onClick={() => selectNight(edition.date)}><span className="archive-calendar"><strong>{Number(edition.date.split('-')[2])}</strong><small>{new Intl.DateTimeFormat('en-US',{month:'short',timeZone:'UTC'}).format(new Date(edition.date+'T12:00:00Z'))}</small></span><span><strong>{edition.headline}</strong><small>{demo ? 'Fictional sample' : edition.edition+' edition'}</small></span><ChevronRight size={18}/></button>) : <div className="empty-state"><Archive size={28}/><h3>No saved editions</h3></div>}<form className="date-picker" onSubmit={(event) => {event.preventDefault();const date=new FormData(event.currentTarget).get('date') as string;if(date)selectNight(date);}}><label htmlFor="archive-date">Basketball date</label><div><input id="archive-date" type="date" name="date" required defaultValue={night.date}/><button className="small-button" type="submit">Load date <ChevronRight size={15}/></button></div></form></Panel></div>
        <div className="tracker-section"><Panel title="Tracked Player Averages"><p className="tier-description">Averages cover saved games only; date ranges appear below.</p>{dashboard.trackers.length ? dashboard.trackers.map((tracker) => <article className="tracker-card" key={tracker.playerId}><div className="tracker-title"><strong>{tracker.name}</strong><span>{tracker.games} GP</span></div><div className="tracker-stats"><Stat label="PTS" value={tracker.games ? tracker.points : '—'}/><Stat label="REB" value={tracker.games ? tracker.rebounds : '—'}/><Stat label="AST" value={tracker.games ? tracker.assists : '—'}/><Stat label="BLK" value={tracker.games ? tracker.blocks : '—'}/></div><div className="tracker-recent">{tracker.lastFive.length > 0 && <><span>Recent points</span><div>{tracker.lastFive.map((value,index) => <b key={index}>{value}</b>)}</div></>}<span>High <strong>{tracker.games ? tracker.pointsHigh : '—'}</strong></span></div><p>{tracker.scope}</p></article>) : <div className="empty-state"><p>No saved player statistics.</p></div>}</Panel><div className="info-bar"><HelpCircle size={17}/><span>Not full-season averages. {demo && 'Sample statistics are excluded from real archives.'}</span></div></div></div>}

      {page === 'settings' && <div className="settings-layout"><div><Panel title="Edition Schedule" className="settings-panel"><p className="setting-description">Publishes at bedtime. Late games update the same date.</p><div className="form-grid"><label>Bedtime<input type="time" value={preferences.bedtime} onChange={(event) => event.target.value && void updatePreferences((current) => ({...current,bedtime:event.target.value}))}/></label><label>Time zone<select value={preferences.timezone} onChange={(event) => void updatePreferences((current) => ({...current,timezone:event.target.value}))}>{Array.from(new Set([preferences.timezone,'America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Toronto','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney','UTC'])).map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_',' ')}</option>)}</select></label></div></Panel>
        <Panel title="Recap Options" className="settings-panel"><div className="length-options">{([{id:'quick',title:'Quick',description:'Up to 2 stories and favorite players.'},{id:'normal',title:'Standard',description:'Up to 3 stories and favorite players.'},{id:'nerd',title:'Full Detail',description:'Up to 8 stories and additional player statistics.'}] as const).map((option) => <button key={option.id} className={'length-option '+(preferences.length === option.id ? 'selected' : '')} aria-pressed={preferences.length === option.id} onClick={() => void updatePreferences((current) => ({...current,length:option.id}))}><span className="radio-circle">{preferences.length === option.id && <Check size={12}/>}</span><span><strong>{option.title}</strong><small>{option.description}</small></span></button>)}</div><Toggle label="Hide game scores" detail="Player stats and recap stories remain visible." value={preferences.hideScores} onChange={(value) => void updatePreferences((current) => ({...current,hideScores:value}))}/></Panel>
        <Panel title="Notifications" className="settings-panel"><Toggle label="Live player alerts" detail="For players with alerts enabled." value={preferences.liveAlerts} onChange={(value) => value ? void enablePush(true) : void updatePreferences((current) => ({...current,liveAlerts:false}))}/><div className="form-grid quiet-hours"><label>Quiet hours start<input type="time" value={preferences.quietStart} onChange={(event) => event.target.value && void updatePreferences((current) => ({...current,quietStart:event.target.value}))}/></label><label>Quiet hours end<input type="time" value={preferences.quietEnd} onChange={(event) => event.target.value && void updatePreferences((current) => ({...current,quietEnd:event.target.value}))}/></label></div><div className="notification-actions"><button className="primary-button" onClick={() => void enablePush()} disabled={busy}><span className="control-glyph green"><Bell size={13}/></span>{busy && !testingPush ? 'Connecting…' : 'Enable bedtime notifications'}</button><button className="small-button" onClick={() => void testPush()} disabled={busy}><Bell size={14}/>{testingPush ? 'Sending…' : 'Test notification'}</button></div><p className="settings-note">iPhone: open this HTTPS site in Safari → Share → Add to Home Screen. Open the installed app, enable notifications, and allow permission. Requires iOS 16.4 or later.</p>{pushStatus && <p className="push-message" role="status">{pushStatus}</p>}</Panel></div>
        <div><Panel title="Install" className="settings-panel install-panel"><ArrowDownToLine size={38}/><button className="primary-button" onClick={() => void install()}><span className="control-glyph blue"><Plus size={14}/></span>Add to home screen</button></Panel>
        <Panel title="Connection" className="settings-panel"><div className="connection-line"><span>Data source</span><strong>{demo ? 'Fictional sample' : 'ESPN'}</strong></div><div className="connection-line"><span>Preferences</span><strong>{demo ? 'Device only' : dashboard.capabilities.persistent ? 'Server storage' : 'Storage unavailable'}</strong></div><div className="connection-line"><span>Summary</span><strong>{dashboard.capabilities.ai ? 'AI assisted' : 'Stat templates'}</strong></div><div className="budget-display"><span>AI budget reserved<strong>{'$'+dashboard.budget.used.toFixed(2)+' / $'+dashboard.budget.limit.toFixed(2)}</strong></span><div><i style={{width:Math.min(100,dashboard.budget.limit ? dashboard.budget.used/dashboard.budget.limit*100 : 0)+'%'}}/></div><small>{dashboard.budget.month}. Reserved limit, not billed cost. Sample mode has no AI charges.</small></div>{demo ? <button className="primary-button" onClick={() => void loadLive()}><span className="control-glyph green"><Radio size={13}/></span>Connect live data</button> : <div className="account-actions"><button className="small-button" onClick={() => useSample()}>Sample mode</button><button className="small-button" onClick={() => void logout()} disabled={busy}><LogOut size={14}/>Sign out</button></div>}</Panel><div className="info-bar"><Check size={16}/><span>Changes save automatically.{demo && ' Sample settings are device-only.'}</span></div></div></div>}
      {page !== 'settings' && page !== 'games' && <div className="session-bar"><span>{demo ? 'SAMPLE DATA' : 'ESPN GAME DATA'}</span><span>Bedtime: {timeLabel(preferences.bedtime)}</span><span>{night.partial ? 'PARTIAL EDITION' : 'Updated '+updateTime}</span></div>}
    </main>
    <footer className="controller-footer"><div><button onClick={() => page === 'games' ? setScheduleRefresh(value => value + 1) : void refresh()} disabled={busy || loading}><span className="control-glyph green"><RefreshCw size={13} className={busy || loading ? 'spin' : ''}/></span><span>Refresh</span></button><button onClick={() => void updatePreferences((current) => ({...current,hideScores:!current.hideScores}))}><span className="control-glyph red">{preferences.hideScores ? <Eye size={14}/> : <EyeOff size={14}/>}</span><span>{preferences.hideScores ? 'Show scores' : 'Hide scores'}</span></button><button onClick={() => goTo('players')}><span className="control-glyph blue"><Users size={14}/></span><span>Watchlist</span></button><button onClick={() => void install()}><span className="control-glyph yellow"><ArrowDownToLine size={14}/></span><span>Install</span></button></div></footer>
    {message && <div className="toast panel" role="status"><span>{message}</span><button aria-label="Dismiss notification" onClick={() => setMessage('')}><X size={18}/></button></div>}
    {showInstall && <div className="modal-backdrop" onClick={() => setShowInstall(false)}><section className="install-dialog panel" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}><div className="panel-title"><h2 id="install-title">Install</h2><button className="icon-button" autoFocus aria-label="Close installation instructions" onClick={() => setShowInstall(false)}><X size={18}/></button></div><div className="dialog-content"><p><strong>iPhone / iPad</strong>Open the hosted address in Safari. Share → Add to Home Screen → turn on Open as Web App → Add.</p><p><strong>Android / Desktop Chrome</strong>Open the hosted address in Chrome. Menu → Install and create shortcut → Install (or Install app / Add to Home screen).</p><p className="settings-note">Phone installation requires the deployed HTTPS address. Localhost works only on this computer.</p><button className="primary-button" onClick={() => setShowInstall(false)}><span className="control-glyph green"><Check size={14}/></span>Close</button></div></section></div>}
    {selectedInjuryGame && <InjuryReport key={`${selectedInjuryGame.date}:${selectedInjuryGame.game.id}`} game={selectedInjuryGame.game} date={selectedInjuryGame.date} timezone={preferences.timezone} demo={demo} onClose={() => setSelectedInjuryGame(null)} onConnectLive={() => void loadLive()}/>}
  </div>;
}
