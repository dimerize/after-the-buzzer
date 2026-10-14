import type { Game } from './shared/types';

export interface ScheduleData { date: string; games: Game[]; source: 'espn'; updatedAt: string; warnings?: string[]; }
export interface ScheduleRequestState { key: string; data: ScheduleData | null; loading: boolean; error: string; }
/** Games opens on today's Eastern calendar date, independently of recap rollover. */
export function currentScheduleDate(now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const nextScheduleDate = currentScheduleDate;
export function resolveScheduleDate(selected: string | null, now = new Date()): string { return selected ?? currentScheduleDate(now); }

export function shiftScheduleDate(date: string, days: number): string | null {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days)) return null;
  const value = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return null;
  value.setUTCDate(value.getUTCDate() + days);
  const result = value.toISOString().slice(0, 10);
  return result.startsWith('20') ? result : null;
}

export function formatScheduleDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
}

export function formatScheduleTipoff(startsAt: string, timezone: string, slateDate: string): { time: string; date: string | null } {
  const tipoff = new Date(startsAt);
  if (!Number.isFinite(tipoff.getTime())) return { time: 'TBD', date: null };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(tipoff).map(({ type, value }) => [type, value]));
  return {
    time: new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(tipoff),
    date: `${parts.year}-${parts.month}-${parts.day}` === slateDate ? null : new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric' }).format(tipoff),
  };
}

/** Prevents a render with the new date and the previous date's games before effects run. */
export function visibleScheduleRequest(state: ScheduleRequestState, key: string): ScheduleRequestState {
  return state.key === key ? state : { key, data: null, loading: true, error: '' };
}

export async function fetchSchedule(date: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<ScheduleData> {
  const response = await request(`/api/schedule?date=${encodeURIComponent(date)}`, { credentials: 'same-origin', signal });
  const data = await response.json().catch(() => null) as (Partial<ScheduleData> & { error?: string }) | null;
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to load the schedule.' : data?.error || 'The schedule could not be loaded.');
  if (!data || data.date !== date || data.source !== 'espn' || !Array.isArray(data.games) || typeof data.updatedAt !== 'string') throw new Error('Schedule data could not be verified.');
  return data as ScheduleData;
}
