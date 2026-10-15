import type { Preferences } from './types';
import { DEFAULT_TV_MARKET, TV_MARKETS } from './watch-guide';
/** Compatibility for saved settings and installed clients from before Full Detail-only and TV markets. */
export function normalizePreferences(preferences: Preferences): Preferences {
  return {...preferences, length:'nerd', tvMarket: TV_MARKETS.some(market => market.id === preferences.tvMarket) ? preferences.tvMarket : DEFAULT_TV_MARKET,
    players:preferences.players.map(player => player.tier === 'league' ? {...player,tier:'interest'} : {...player})};
}
