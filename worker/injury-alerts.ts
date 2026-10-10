import type { Game, Preferences, WatchPlayer } from '../src/shared/types';
import type { Env } from './env';
import { fetchSchedule } from './espn';
import { loadAlertInjuryFeed } from './injuries';
import { isQuietHour } from './schedule';
import { getPreferences } from './store';

type Payload = { title: string; body: string; url: string; tag: string };
type Notify = (id: string, payload: Payload) => Promise<boolean>;
interface StateRow { status: string; feed_updated_at: string }
interface PendingRow { fingerprint: string; changes: string }
interface GenerationRow { revision: number }
interface Change { player: WatchPlayer; from: string; to: string; game: Game; date: string; sourceAt: string }
const WINDOW = 3 * 60 * 60_000;
const LOCK = 'injury-alert-poll';
const EXPLICIT = new Map([
  ['out', 'Out'], ['doubtful', 'Doubtful'], ['questionable', 'Questionable'],
  ['probable', 'Probable'], ['available', 'Available'], ['day-to-day', 'Day-to-day'],
  ['game-time decision', 'Game-time decision'],
]);

function status(value: string): string | null {
  return EXPLICIT.get(value.trim().replace(/\s+/g, ' ').toLowerCase()) ?? null;
}

function easternDate(now: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dates(now: Date): [string, string] {
  const today = easternDate(now);
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return [today, next.toISOString().slice(0, 10)];
}

function selected(preferences: Preferences): WatchPlayer[] {
  return preferences.injuryAlerts === true ? preferences.players.filter(player => player.tier !== 'league' && player.injuryAlerts === true) : [];
}

async function acquire(db: D1Database, owner: string, now: number): Promise<boolean> {
  const result = await db.prepare('INSERT INTO injury_alert_lock (id,owner,expires_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE injury_alert_lock.expires_at < ?')
    .bind(LOCK, owner, now + 90_000, now).run();
  return result.meta.changes > 0;
}

async function generation(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT revision FROM injury_alert_generation WHERE id='owner'").bind().first<GenerationRow>();
  return row?.revision ?? 0;
}

function payload(changes: Change[]): Payload {
  const first = changes[0];
  const title = changes.length === 1 ? 'Injury status update' : `Injury updates: ${changes.length} players`;
  const fragments = changes.map(change => `${change.player.name}: ${change.from} → ${change.to}`);
  let body = '';
  for (let count = fragments.length; count >= 1; count--) {
    const extra = fragments.length - count;
    const candidate = `${fragments.slice(0, count).join('; ')}${extra ? `; +${extra} more` : ''}. ESPN injuries.`;
    if (candidate.length <= 200) { body = candidate; break; }
  }
  if (!body) body = `${changes.length} watched player injury status updates. ESPN injuries.`;
  return { title: title.slice(0, 100), body, url: `/?date=${first.date}&game=${first.game.id}&view=injuries`, tag: 'injury-status' };
}

async function notificationId(fingerprint: string, date: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  return `injury:${date}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Clear a disabled or newly enabled selection so re-enabling starts from a silent baseline. */
export async function resetInjuryAlertBaselines(db: D1Database, previous: Preferences, next: Preferences): Promise<void> {
  await db.prepare("UPDATE injury_alert_generation SET revision=revision+1 WHERE id='owner'").bind().run();
  if (next.injuryAlerts !== true) {
    await db.prepare('DELETE FROM injury_alert_state').bind().run();
    await db.prepare('DELETE FROM injury_alert_pending').bind().run();
    return;
  }
  const before = new Map(selected(previous).map(player => [player.id, player]));
  const after = new Map(selected(next).map(player => [player.id, player]));
  let selectionChanged = false;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id), current = after.get(id);
    if (!old || !current || old.team !== current.team) {
      selectionChanged = true;
      await db.prepare('DELETE FROM injury_alert_state WHERE player_id=?').bind(id).run();
    }
  }
  if (selectionChanged) await db.prepare('DELETE FROM injury_alert_pending').bind().run();
}

/** One owner poll, with a separate lease and durable state from recap delivery. */
export async function runInjuryAlerts(env: Env, preferences: Preferences, now: Date, notify: Notify): Promise<void> {
  const owner = crypto.randomUUID();
  const db = env.DB;
  const nowMs = now.getTime();
  if (!await acquire(db, owner, nowMs)) return;
  let startingGeneration: number | null = null;
  try {
    startingGeneration = await generation(db);
    const players = selected(preferences);
    if (!players.length) {
      await db.prepare('DELETE FROM injury_alert_state').bind().run();
      await db.prepare('DELETE FROM injury_alert_pending').bind().run();
      return;
    }
    const quiet = isQuietHour(now, preferences);
    if (quiet) await db.prepare('DELETE FROM injury_alert_pending').bind().run();
    // Old games and disabled players cannot seed a later opt-in or generate backlogged changes.
    await db.prepare('DELETE FROM injury_alert_state WHERE game_date < ?').bind(dates(now)[0]).run();
    const rows = await db.prepare('SELECT DISTINCT player_id FROM injury_alert_state').bind().all<{ player_id: string }>();
    const allowed = new Set(players.map(player => player.id));
    for (const row of rows.results) if (!allowed.has(row.player_id)) await db.prepare('DELETE FROM injury_alert_state WHERE player_id=?').bind(row.player_id).run();

    const schedules = await Promise.allSettled(dates(now).map(date => fetchSchedule(date)));
    const upcoming = schedules.flatMap((result, index) => result.status === 'fulfilled'
      ? result.value.games.filter(game => game.status === 'scheduled' && Date.parse(game.startsAt) - nowMs > 0 && Date.parse(game.startsAt) - nowMs <= WINDOW)
        .map(game => ({ game, date: dates(now)[index] })) : []);
    if (!upcoming.length) {
      await db.prepare('DELETE FROM injury_alert_pending').bind().run();
      return;
    }
    const loaded = await loadAlertInjuryFeed(db, now);
    if (!loaded) return;
    const changes: Change[] = [];
    for (const { game, date } of upcoming) {
      for (const player of players) {
        if (player.team !== game.away && player.team !== game.home) continue;
        const team = loaded.teams.find(candidate => candidate.team === player.team);
        if (!team || team.coverage !== 'reported' || loaded.warnings.some(warning => warning.startsWith(`${team.team}:`)) || !loaded.verifiedPlayerKeys?.includes(`${team.team}:${player.id}`)) continue;
        const match = team.players.find(candidate => candidate.id === player.id);
        const current = match && status(match.status);
        if (!current) continue; // Absence and unrecognized labels never imply availability.
        const old = await db.prepare('SELECT status,feed_updated_at FROM injury_alert_state WHERE game_id=? AND player_id=?').bind(game.id, player.id).first<StateRow>();
        // A source replay cannot replace a newer status, or invent a transition
        // under the same provider observation identity.
        if (old && loaded.feedUpdatedAt <= old.feed_updated_at) continue;
        await db.prepare('INSERT INTO injury_alert_state (game_id,player_id,game_date,status,feed_updated_at,checked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(game_id,player_id) DO UPDATE SET game_date=excluded.game_date,status=excluded.status,feed_updated_at=excluded.feed_updated_at,checked_at=excluded.checked_at')
          .bind(game.id, player.id, date, current, loaded.feedUpdatedAt, nowMs).run();
        if (!old || old.status === current) continue;
        const event = await db.prepare('INSERT OR IGNORE INTO injury_alert_events (game_id,player_id,from_status,to_status,feed_updated_at,observed_at) VALUES (?,?,?,?,?,?)')
          .bind(game.id, player.id, old.status, current, loaded.feedUpdatedAt, nowMs).run();
        if (event.meta.changes) changes.push({ player, from: old.status, to: current, game, date, sourceAt: loaded.feedUpdatedAt });
      }
    }
    const saved = await db.prepare("SELECT fingerprint,changes FROM injury_alert_pending WHERE id='owner'").bind().first<PendingRow>();
    let pending: Change[] = [];
    if (saved) try {
      const parsed = JSON.parse(saved.changes) as Change[];
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.length <= 60 && /^20\d\d-\d\d-\d\d$/.test(parsed[0]?.date)) {
        const priorId = await notificationId(saved.fingerprint, parsed[0].date);
        const claimed = await db.prepare('SELECT id FROM notifications WHERE id=?').bind(priorId).first<{ id: string }>();
        if (!claimed) pending = parsed.filter(change =>
          change && typeof change.to === 'string' && typeof change.sourceAt === 'string' &&
          change.sourceAt <= loaded.feedUpdatedAt &&
          players.some(player => player.id === change.player?.id && player.team === change.player?.team) &&
          upcoming.some(entry => entry.game.id === change.game?.id && entry.date === change.date) &&
          loaded.verifiedPlayerKeys?.includes(`${change.player.team}:${change.player.id}`) &&
          loaded.teams.find(team => team.team === change.player.team)?.players.some(player => player.id === change.player.id && status(player.status) === change.to)
        );
      }
    } catch { /* Invalid saved work is discarded. */ }
    if (quiet) {
      await db.prepare('DELETE FROM injury_alert_pending').bind().run();
    } else if (pending.length || changes.length) {
      const combined = [...pending, ...changes];
      const fingerprint = combined.map(change => `${change.game.id}:${change.player.id}:${change.from}:${change.to}:${change.sourceAt}`).join('|');
      const id = await notificationId(fingerprint, combined[0].date);
      await db.prepare("INSERT INTO injury_alert_pending (id,fingerprint,changes) VALUES ('owner',?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,changes=excluded.changes")
        .bind(fingerprint, JSON.stringify(combined)).run();
      const latest = await getPreferences(db);
      const latestPlayers = selected(latest);
      const latestGeneration = await generation(db);
      const dispatchNow = new Date();
      const stillCurrent = latestGeneration === startingGeneration &&
        !isQuietHour(dispatchNow, latest) &&
        dispatchNow.getTime() - Date.parse(loaded.feedUpdatedAt) <= 15 * 60_000 &&
        combined.every(change => Date.parse(change.game.startsAt) > dispatchNow.getTime() &&
          latestPlayers.some(player => player.id === change.player.id && player.team === change.player.team));
      if (!stillCurrent) await db.prepare('DELETE FROM injury_alert_pending WHERE id=? AND fingerprint=?').bind('owner', fingerprint).run();
      else if (await notify(id, payload(combined))) await db.prepare('DELETE FROM injury_alert_pending WHERE id=? AND fingerprint=?').bind('owner', fingerprint).run();
    } else if (saved) {
      await db.prepare('DELETE FROM injury_alert_pending').bind().run();
    }
    await db.prepare('DELETE FROM injury_alert_events WHERE observed_at < ?').bind(nowMs - 14 * 86400000).run();
  } finally {
    try {
      // A preference save may have reset baselines while this poll was still
      // processing a downloaded feed. Discard every write from that old poll.
      if (startingGeneration !== null && await generation(db) !== startingGeneration) {
        await db.prepare('DELETE FROM injury_alert_state').bind().run();
        await db.prepare('DELETE FROM injury_alert_pending').bind().run();
      }
    } finally {
      await db.prepare('DELETE FROM injury_alert_lock WHERE id=? AND owner=?').bind(LOCK, owner).run();
    }
  }
}
