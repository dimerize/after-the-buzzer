import { useState, type ReactNode } from 'react';
import { getTeamLogo } from './team-logos';
import './team-label.css';

export default function TeamLabel({ team, className = '' }: { team: string; className?: string }) {
  const logo = getTeamLogo(team);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const visible = logo && logo.src !== failedSource ? logo : undefined;
  const description = visible ? `${visible.label}, ${visible.era} logo` : undefined;
  return <span className={`team-label ${className}`} title={description}>
    {visible && <img src={visible.src} alt={description} loading="lazy" onError={() => setFailedSource(visible.src)} />}
    <span>{team}</span>
  </span>;
}

export function TeamText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(/(\b(?:vs\.?|against)\s+|@\s*)([A-Z]{2,4})\b/gi)) {
    const team = match[2];
    if (team !== team.toUpperCase() || !getTeamLogo(team)) continue;
    parts.push(text.slice(offset, match.index), match[1], <TeamLabel key={match.index} team={team} className="team-inline" />);
    offset = match.index + match[0].length;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
