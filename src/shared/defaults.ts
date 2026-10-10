import type { Preferences } from './types';
export const DEFAULT_PREFERENCES: Preferences = {
  players: [
    { id: '5104157', name: 'Victor Wembanyama', team: 'SAS', tier: 'favorite', alerts: true },
    { id: '1966', name: 'LeBron James', team: 'PHI', tier: 'favorite', alerts: true },
    { id: '5254165', name: 'Keaton Wagler', team: 'LAC', tier: 'favorite', alerts: false },
    { id: '5037871', name: 'Dylan Harper', team: 'SAS', tier: 'favorite', alerts: true },
    { id: '4845367', name: 'Stephon Castle', team: 'SAS', tier: 'favorite', alerts: true }
  ],
  bedtime: '23:30', timezone: 'America/New_York', length: 'normal', hideScores: false,
  liveAlerts: false, quietStart: '00:00', quietEnd: '09:00'
};
