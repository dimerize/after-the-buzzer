import { useEffect, useState } from 'react';
import type { RecordPlayer } from './shared/records-types';
import { cutoutPhoto } from './photo-cutout';
import TeamLabel from './TeamLabel';

type Size = 'card' | 'row';
/** Transparent headshots first (NBA.com, then ESPN); Basketball-Reference white cutouts are cleared in the browser. */
export function directPhoto(player: RecordPlayer, size: Size): string | null {
  if (player.nbaId) return `https://cdn.nba.com/headshots/nba/latest/${size === 'card' ? '1040x760' : '260x190'}/${player.nbaId}.png`;
  if (player.espnId) return size === 'card' ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${player.espnId}.png&w=350&h=254&scale=crop&cquality=80&location=origin` : `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${player.espnId}.png&w=96&h=70&scale=crop&cquality=80&location=origin`;
  return null;
}
export const referencePhoto = (id: string) => `https://www.basketball-reference.com/req/202106291/images/headshots/${id}.jpg`;

function Silhouette() {
  return <svg className="record-silhouette" viewBox="0 0 60 70" aria-hidden="true"><circle cx="30" cy="21" r="13"/><path d="M6 70V58c0-27 48-27 48 0v12"/></svg>;
}

export default function RecordPortrait({ player, size, team }: { player: RecordPlayer; size: Size; team?: string }) {
  const direct = directPhoto(player, size);
  const [cutout, setCutout] = useState<{ key: string; url: string | null; framed: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (direct || !player.bbrefId) return;
    let active = true;
    cutoutPhoto(referencePhoto(player.bbrefId)).then(result => { if (active) setCutout({ key: player.key, url: result.url, framed: !result.cutout }); }, () => { if (active) setCutout({ key: player.key, url: null, framed: false }); });
    return () => { active = false; };
  }, [direct, player.bbrefId, player.key]);
  const own = cutout?.key === player.key ? cutout : null;
  const src = direct ?? own?.url ?? null;
  // Older photos keep their real background; a vignette blends it into the gradient.
  return <span className={`record-portrait record-portrait-${size}${!direct && own?.framed ? ' record-portrait-photo' : ''}`} role="img" aria-label={src && failed !== src ? player.name : `${player.name}: photo unavailable`}>
    {src && failed !== src ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)}/> : <Silhouette/>}
    {team && <small><TeamLabel team={team}/></small>}
  </span>;
}
