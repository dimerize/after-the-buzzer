import type { Preferences } from './types';
export const DEFAULT_PREFERENCES: Preferences = {
  players: [
    { id: '5104157', name: 'Victor Wembanyama', team: 'SAS', tier: 'favorite', alerts: true, injuryAlerts: false },
    { id: '1966', name: 'LeBron James', team: 'PHI', tier: 'favorite', alerts: true, injuryAlerts: false },
    { id: '5254165', name: 'Keaton Wagler', team: 'LAC', tier: 'favorite', alerts: false, injuryAlerts: false },
    { id: '5037871', name: 'Dylan Harper', team: 'SAS', tier: 'favorite', alerts: true, injuryAlerts: false },
    { id: '4845367', name: 'Stephon Castle', team: 'SAS', tier: 'favorite', alerts: true, injuryAlerts: false }
  ],
  bedtime: '23:30', timezone: 'America/New_York', length: 'nerd', hideScores: false,
  liveAlerts: false, injuryAlerts: false, quietStart: '00:00', quietEnd: '09:00', tvMarket: 'NY'
};
