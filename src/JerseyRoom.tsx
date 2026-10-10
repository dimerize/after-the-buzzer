import { useId, useState, type CSSProperties } from 'react';
import { Check, ChevronLeft, ChevronRight, RotateCw, Star } from 'lucide-react';
import type { WatchPlayer } from './shared/types';
import { jerseyForPlayer, readJerseyChoice, type JerseyDesign, type UniformSide } from './jerseys';
import './jersey-room.css';

function Uniform({ design, side, name, back }: { design: JerseyDesign; side: UniformSide; name: string; back: boolean }) {
  const id = useId().replaceAll(':', '');
  const colors = design[side];
  const silhouette = `M70 18 94 26 Q120 ${back ? '45' : '75'} 146 26 L170 18 214 53 Q188 83 203 116 L198 297 Q120 313 42 297 L37 116 Q52 83 26 53Z`;
  const surname = name.split(' ').slice(1).join(' ') || name;
  return <svg className="jersey-garment" viewBox="0 0 240 320" role="img" aria-label={`${name}, ${design.city} ${side} jersey${design.number ? ', number ' + design.number : ''}, ${back ? 'back' : 'front'}`}>
    <defs>
      <linearGradient id={id + 'cloth'}><stop stopColor="#fff" stopOpacity=".14"/><stop offset=".18" stopColor="#000" stopOpacity=".22"/><stop offset=".39" stopColor="#fff" stopOpacity=".13"/><stop offset=".53" stopColor="#000" stopOpacity=".07"/><stop offset=".77" stopColor="#fff" stopOpacity=".12"/><stop offset="1" stopColor="#000" stopOpacity=".4"/></linearGradient>
      <linearGradient id={id + 'hem'} x2="0" y2="1"><stop stopColor="#000" stopOpacity="0"/><stop offset="1" stopColor="#000" stopOpacity=".35"/></linearGradient>
      <pattern id={id + 'mesh'} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".6" fill="#000" opacity=".17"/><circle cx="2" cy="3" r=".5" fill="#fff" opacity=".13"/></pattern>
      <clipPath id={id + 'cut'}><path d={silhouette}/></clipPath>
      <path id={id + 'arc'} d="M53 105 Q120 82 187 105"/>
    </defs>
    <path d={silhouette} fill="#06090f" stroke="#06090f" strokeWidth="7" transform="translate(5 4)"/>
    <path d={silhouette} fill={colors.color} stroke={colors.trim} strokeWidth="2"/>
    <g clipPath={`url(#${id}cut)`}>
      <path d="M38 102 63 113 61 302 39 302ZM202 102 177 113 179 302 201 302Z" fill={colors.accent}/>
      <path d="M54 111 53 300M186 111 187 300" fill="none" stroke={colors.trim} strokeWidth="6"/>
      <path d={`M68 17 94 26 Q120 ${back ? '45' : '75'} 146 26 L172 17M24 50Q51 83 37 117M216 50Q189 83 203 117`} fill="none" stroke={colors.trim} strokeWidth="14"/>
      <path d={`M68 17 94 26 Q120 ${back ? '45' : '75'} 146 26 L172 17M24 50Q51 83 37 117M216 50Q189 83 203 117`} fill="none" stroke={colors.accent} strokeWidth="6"/>
      <path d="M44 286Q120 300 196 286" fill="none" stroke={colors.ink} strokeOpacity=".28" strokeDasharray="2 2"/>
      {back ? <text fill={colors.ink} fontSize={surname.length > 10 ? 17 : 21} fontWeight="700" letterSpacing="1" textAnchor="middle"><textPath href={'#' + id + 'arc'} startOffset="50%">{surname.toUpperCase()}</textPath></text> : <text x="120" y="118" textAnchor="middle" textLength={design.wordmark.length > 6 ? 159 : 146} lengthAdjust="spacingAndGlyphs" fill={colors.ink} stroke={colors.trim} strokeWidth="1.4" paintOrder="stroke" fontWeight="800" fontSize={design.team === 'LAC' ? 36 : 35} fontStyle="italic" fontFamily={design.team === 'LAC' ? 'Georgia, serif' : 'Barlow Condensed, sans-serif'}>{side === 'away' && design.team === 'CLE' ? 'CLEVELAND' : design.wordmark}</text>}
      <text x="120" y="224" textAnchor="middle" fill={colors.ink} stroke={colors.trim} strokeWidth="4" paintOrder="stroke" fontFamily="Impact, Barlow Condensed, sans-serif" fontSize="105" fontWeight="700">{design.number}</text>
      {!back && <g transform="translate(64 261)"><rect width="26" height="15" fill="#d7d7ce" stroke="#171b25" strokeWidth="1"/><path d="M3 5H23M3 8H17M3 11H23" stroke="#363b44" strokeWidth="1"/></g>}
      <path d={silhouette} fill={`url(#${id}mesh)`}/><path d={silhouette} fill={`url(#${id}cloth)`}/><path d="M40 220H200V315H40Z" fill={`url(#${id}hem)`}/>
    </g>
  </svg>;
}

function initialChoice(id: string): UniformSide { try { return readJerseyChoice(localStorage.getItem('buzzer:jersey:' + id)); } catch { return 'home'; } }
interface Props { players: WatchPlayer[]; selectedId: string | null; onSelect: (id: string) => void; onFavorite: (id: string) => void; onManage: () => void; }
export default function JerseyRoom({ players, selectedId, onSelect, onFavorite, onManage }: Props) {
  const player = players.find(item => item.id === selectedId) || players.find(item => item.tier === 'favorite') || players[0];
  const [choices, setChoices] = useState<Record<string, UniformSide>>({});
  const [back, setBack] = useState(false);
  if (!player) return <section className="panel jersey-empty"><div className="panel-title"><h2>Jersey Select</h2></div><button className="primary-button" onClick={onManage}>Add a player</button></section>;
  const design = jerseyForPlayer(player);
  const choice = choices[player.id] || initialChoice(player.id);
  const index = players.findIndex(item => item.id === player.id);
  function select(side: UniformSide) { setChoices(current => ({ ...current, [player!.id]: side })); try { localStorage.setItem('buzzer:jersey:' + player!.id, side); } catch { /* Device storage can be disabled. */ } }
  function step(delta: number) { onSelect(players[(index + delta + players.length) % players.length].id); }
  return <section className="jersey-room panel" aria-label="Jersey selection">
    <div className="panel-title"><h2>Jersey Select</h2><span className="panel-meta">{design.era === 'Custom' ? 'Custom uniform' : '2006–07 style'}</span></div>
    <div className="jersey-player-bar"><button aria-label="Previous player" onClick={() => step(-1)} disabled={players.length < 2}><ChevronLeft size={20}/></button><label><span className="sr-only">Jersey player</span><select aria-label="Jersey player" value={player.id} onChange={event => onSelect(event.target.value)}>{players.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button aria-label="Next player" onClick={() => step(1)} disabled={players.length < 2}><ChevronRight size={20}/></button></div>
    <div className={'jersey-city ' + (back ? 'show-back' : '')} style={{ '--uniform-accent': design.away.color } as CSSProperties}>
      <div className="jersey-street" aria-hidden="true"/><div className="jersey-searchlight left" aria-hidden="true"/><div className="jersey-searchlight right" aria-hidden="true"/>
      {(['away', 'home'] as const).map(side => <button key={side} className={`uniform-tower ${side} ${choice === side ? 'selected' : ''}`} aria-label={`Select ${side} jersey for ${player.name}`} aria-pressed={choice === side} onClick={() => select(side)}>
        <span className="tower-sign">{side}</span><span className="tower-roof" aria-hidden="true"/><span className="tower-wall" aria-hidden="true"><span>{design.team}</span><i/><i/><i/></span><span className="tower-front"><span className="tower-team">{design.city}</span><Uniform design={design} side={side} name={player.name} back={back}/><span className="tower-name">{player.name.split(' ').slice(-1)[0]}</span></span><span className="tower-base"><span>{design.team}</span><strong>{choice === side ? <><Check size={13}/>Selected</> : 'Select'}</strong></span>
      </button>)}
      <div className="jersey-center-badge" aria-hidden="true"><span>NBA</span><strong>{design.number || '—'}</strong></div>
    </div>
    <div className="jersey-control-bar"><button onClick={() => setBack(value => !value)} aria-pressed={back}><span className="control-glyph yellow"><RotateCw size={13}/></span>{back ? 'View front' : 'View back'}</button><span>{design.team} / {choice} / {back ? 'Back' : 'Front'}</span><button onClick={() => onFavorite(player.id)} disabled={player.tier === 'favorite'}><span className="control-glyph green"><Star size={13}/></span>{player.tier === 'favorite' ? 'Favorite' : 'Set favorite'}</button></div>
    <div className="jersey-roster" aria-label="Select a player">{players.map(item => <button key={item.id} className={item.id === player.id ? 'selected' : ''} onClick={() => onSelect(item.id)} aria-pressed={item.id === player.id}><span>{jerseyForPlayer(item).number || item.team}</span><strong>{item.name}</strong></button>)}</div>
  </section>;
}
