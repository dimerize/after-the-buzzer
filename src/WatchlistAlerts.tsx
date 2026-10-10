import { Bell, BellOff, HeartPulse } from 'lucide-react';
import type { WatchPlayer } from './shared/types';
import './watchlist-alerts.css';

export default function WatchlistAlerts({ player, onChange }: { player: WatchPlayer; onChange: (patch: Partial<WatchPlayer>) => void }) {
  return <div className="watchlist-alert-controls">
    <button className={'icon-button '+(player.alerts ? 'alerts-on' : '')} aria-label={`${player.alerts ? 'Disable' : 'Enable'} live alerts for ${player.name}`} aria-pressed={player.alerts} onClick={() => onChange({ alerts: !player.alerts })}>{player.alerts ? <Bell size={14}/> : <BellOff size={14}/>}<span>Live</span></button>
    <button className={'icon-button '+(player.injuryAlerts ? 'alerts-on' : '')} disabled={player.tier === 'league'} aria-label={`${player.injuryAlerts ? 'Disable' : 'Enable'} injury alerts for ${player.name}`} aria-pressed={!!player.injuryAlerts} title={player.tier === 'league' ? 'Move to Favorites or Following for injury alerts' : 'Pregame injury status changes'} onClick={() => onChange({ injuryAlerts: !player.injuryAlerts })}><HeartPulse size={14}/><span>Injury</span></button>
  </div>;
}
