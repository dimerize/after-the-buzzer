import type { Preferences } from './types';
/** Compatibility for saved settings and installed clients from before Full Detail-only. */
export function normalizePreferences(preferences: Preferences): Preferences {
  return {...preferences, length:'nerd', players:preferences.players.map(player => player.tier === 'league' ? {...player,tier:'interest'} : {...player})};
}
