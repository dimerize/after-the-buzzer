import { useState } from 'react';
import type { Tier, WatchPlayer } from './shared/types';
import './watch-marks.css';

export const tierName = (tier: Tier) => tier === 'favorite' ? 'Favorite' : 'Following';
/** Gold star for Favorites, ice-blue diamond for Following. */
export function TierMark({ tier, label = false }: { tier: Tier; label?: boolean }) {
  return <span className={`tier-mark tier-mark-${tier === 'favorite' ? 'favorite' : 'interest'}`} title={tierName(tier)} aria-label={tierName(tier)}>
    <span aria-hidden="true">{tier === 'favorite' ? '★' : '◆'}</span>{label && <small>{tier === 'favorite' ? 'FAV' : 'FOLLOW'}</small>}
  </span>;
}

const shortName = (name: string) => { const parts = name.split(' '); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name; };
export function WatchedChip({ player }: { player: WatchPlayer }) {
  const [failed, setFailed] = useState(false);
  const tier = player.tier === 'favorite' ? 'favorite' : 'interest';
  return <span className={`watched-chip watched-chip-${tier}`} title={`${tierName(player.tier)}: ${player.name}. Team plays; participation not confirmed.`}>
    <span className="watched-chip-photo" aria-hidden="true">{/^\d+$/.test(player.id) && !failed && <img src={`https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${player.id}.png&w=96&h=70&scale=crop&cquality=80&location=origin`} alt="" loading="lazy" onError={() => setFailed(true)}/>}</span>
    <span aria-hidden="true">{tier === 'favorite' ? '★' : '◆'}</span><span>{shortName(player.name)}</span>
  </span>;
}

export function MarqueeBadge() {
  return <span className="marquee-badge"><span aria-hidden="true">★</span>Marquee matchup<span aria-hidden="true">★</span></span>;
}
