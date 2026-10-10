import type { Preferences, Tier } from '../src/shared/types';

export function validDate(value: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const v = value as Record<string, unknown>;
  const time = (key: string) => {
    if (typeof v[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v[key] as string)) throw new Error(`Invalid ${key}.`);
    return v[key] as string;
  };
  if (typeof v.timezone !== 'string' || v.timezone.length > 80) throw new Error('Invalid timezone.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: v.timezone }).format(); } catch { throw new Error('Invalid timezone.'); }
  if (typeof v.length !== 'string' || !['quick', 'normal', 'nerd'].includes(v.length)) throw new Error('Invalid recap length.');
  if (typeof v.hideScores !== 'boolean' || typeof v.liveAlerts !== 'boolean') throw new Error('Invalid notification settings.');
  if (!Array.isArray(v.players) || v.players.length > 60) throw new Error('Choose up to 60 players.');
  const ids = new Set<string>();
  const players = v.players.map((p: unknown) => {
    if (!p || typeof p !== 'object') throw new Error('Invalid player.');
    const x = p as Record<string, unknown>;
    if (typeof x.id !== 'string' || !/^\d{1,12}$/.test(x.id) || ids.has(x.id)) throw new Error('Invalid or duplicate player ID.');
    ids.add(x.id);
    if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 100 || typeof x.team !== 'string' || x.team.length > 10) throw new Error('Invalid player name or team.');
    if (typeof x.tier !== 'string' || !['favorite', 'interest', 'league'].includes(x.tier) || typeof x.alerts !== 'boolean') throw new Error('Invalid player tier.');
    return { id: x.id, name: x.name.trim(), team: x.team, tier: x.tier as Tier, alerts: x.alerts };
  });
  return { players, bedtime: time('bedtime'), timezone: v.timezone, length: v.length as Preferences['length'], hideScores: v.hideScores, liveAlerts: v.liveAlerts, quietStart: time('quietStart'), quietEnd: time('quietEnd') };
}

export function validSubscriptionKeys(p256dh:string, auth:string):boolean {
  const decode=(value:string)=>{
    if(!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('encoding');
    return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  };
  try {
    const key=decode(p256dh), secret=decode(auth);
    return key.length===65&&key[0]===4&&secret.length===16;
  } catch { return false; }
}
