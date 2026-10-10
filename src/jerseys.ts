import type { WatchPlayer } from './shared/types';

export type UniformSide = 'home' | 'away';
export interface UniformColors { color: string; ink: string; trim: string; accent: string; }
export interface JerseyDesign { team: string; city: string; wordmark: string; era: string; number: string; home: UniformColors; away: UniformColors; }
const designs: Record<string, Omit<JerseyDesign, 'number'>> = {
  SAS: { team: 'SAS', city: 'San Antonio', wordmark: 'SPURS', era: '2006–07', home: { color: '#eceeef', ink: '#171a1c', trim: '#999da2', accent: '#181b1f' }, away: { color: '#17191d', ink: '#e7e8e9', trim: '#adb1b6', accent: '#eeeeee' } },
  CLE: { team: 'CLE', city: 'Cleveland', wordmark: 'CAVALIERS', era: '2006–07', home: { color: '#f3eee3', ink: '#84233e', trim: '#c5a466', accent: '#142642' }, away: { color: '#84233e', ink: '#e6c487', trim: '#c5a466', accent: '#142642' } },
  LAC: { team: 'LAC', city: 'Los Angeles', wordmark: 'Clippers', era: '2006–07', home: { color: '#f0f0ed', ink: '#d62640', trim: '#c9293f', accent: '#254c92' }, away: { color: '#bc2036', ink: '#f4f2eb', trim: '#f1f0e8', accent: '#254c92' } }
};
const numbers: Record<string, string> = { '5104157': '1', '1966': '23', '5254165': '1', '5037871': '2', '4845367': '5' };
export function jerseyForPlayer(player: Pick<WatchPlayer, 'id' | 'name' | 'team'>): JerseyDesign {
  // Throwback artwork is independent of the current roster (James wore CLE in 2006–07).
  const team = player.id === '1966' ? 'CLE' : player.team;
  const design = designs[team] ?? { team, city: team, wordmark: team, era: 'Custom', home: { color: '#e9ecee', ink: '#183567', trim: '#8d98aa', accent: '#344f82' }, away: { color: '#183567', ink: '#eceff4', trim: '#8d98aa', accent: '#111a2c' } };
  return { ...design, number: numbers[player.id] || '' };
}
export function readJerseyChoice(value: string | null): UniformSide { return value === 'away' ? 'away' : 'home'; }
