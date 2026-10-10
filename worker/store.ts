import { DEFAULT_PREFERENCES } from '../src/shared/defaults';
import type { Night, Preferences, Tracker } from '../src/shared/types';

export async function getPreferences(db: D1Database): Promise<Preferences> {
  const row = await db.prepare('SELECT value FROM preferences WHERE id = ?').bind('owner').first<{value: string}>();
  return row ? JSON.parse(row.value) : structuredClone(DEFAULT_PREFERENCES);
}
export async function savePreferences(db: D1Database, value: Preferences): Promise<void> {
  await db.prepare('INSERT INTO preferences (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').bind('owner', JSON.stringify(value)).run();
}
export async function getNight(db: D1Database, date: string): Promise<Night | null> {
  const row = await db.prepare('SELECT payload FROM editions WHERE date = ?').bind(date).first<{payload: string}>();
  return row ? JSON.parse(row.payload) : null;
}
export async function saveNight(db: D1Database, night: Night): Promise<void> {
  if (night.source !== 'espn') throw new Error('Only verified provider data may enter the archive.');
  await db.prepare('INSERT INTO editions (date, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at').bind(night.date, JSON.stringify(night), night.updatedAt).run();
}
export async function archive(db: D1Database): Promise<Night[]> {
  const rows = await db.prepare('SELECT payload FROM editions ORDER BY date DESC LIMIT 200').all<{payload: string}>();
  return rows.results.map(row => JSON.parse(row.payload));
}
export async function acquireLock(db: D1Database, id: string, seconds = 90): Promise<boolean> {
  const now = Date.now();
  const result = await db.prepare('INSERT INTO locks(id, expires_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at WHERE locks.expires_at < ?').bind(id, now + seconds * 1000, now).run();
  return result.meta.changes > 0;
}
export async function releaseLock(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM locks WHERE id = ?').bind(id).run();
}
export function buildTrackers(nights: Night[], preferences: Preferences, current: Night): Tracker[] {
  const eligible = nights.filter(n => n.source === 'espn' && n.season === current.season && n.seasonType === current.seasonType).sort((a,b) => a.date.localeCompare(b.date));
  return preferences.players.filter(p => p.tier !== 'league').map(player => {
    const lines = eligible.flatMap(n => n.players.filter(p => p.id === player.id && p.status === 'final' && !p.didNotPlay && p.minutes > 0));
    const mean = (key: 'points'|'rebounds'|'assists'|'blocks') => lines.length ? Math.round(lines.reduce((sum,p)=>sum+p[key],0)/lines.length*10)/10 : 0;
    return { playerId: player.id, name: player.name, games: lines.length, points: mean('points'), rebounds: mean('rebounds'), assists: mean('assists'), blocks: mean('blocks'), pointsHigh: Math.max(0,...lines.map(p=>p.points)), lastFive: lines.slice(-5).map(p=>p.points), scope: lines.length ? `${current.seasonType} games collected since ${eligible[0].date}; not full-season totals` : `No completed ${current.seasonType} games collected yet` };
  });
}
