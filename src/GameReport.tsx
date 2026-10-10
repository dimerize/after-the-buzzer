import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Game, WatchPlayer } from './shared/types';
import BoxScore from './BoxScore';
import { InjuryReportContent } from './InjuryReport';
import './injury-report.css';
import './boxscore.css';

export interface GameReportProps {
  game: Game; date: string; timezone: string; demo: boolean; hideScores: boolean; watchedIds: string[];
  initialTab: 'injuries' | 'boxscore'; onWatch: (player: WatchPlayer) => void; onClose: () => void; onConnectLive: () => void;
}

export default function GameReport({ game, date, timezone, demo, hideScores, watchedIds, initialTab, onWatch, onClose, onConnectLive }: GameReportProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const gameKey = `${date}:${game.id}`;
  const [tabState, setTabState] = useState({ key: gameKey, tab: initialTab });
  const tab = tabState.key === gameKey ? tabState.tab : initialTab;

  useEffect(() => { setTabState({ key: gameKey, tab: initialTab }); }, [gameKey, initialTab]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (document.activeElement instanceof HTMLElement && !element.contains(document.activeElement)) opener.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!element.open) element.showModal();
    element.querySelector<HTMLButtonElement>('.injury-close')?.focus();
    return () => { element.close(); document.body.style.overflow = previousOverflow; opener.current?.focus(); };
  }, []);

  return <dialog ref={dialog} className="injury-dialog game-report-dialog" aria-labelledby="game-report-title" onCancel={event => { event.preventDefault(); closeRef.current(); }} onClick={event => { if (event.target === dialog.current) closeRef.current(); }}>
    <div className="injury-dialog-frame"><header className="injury-header"><h2 id="game-report-title">Game report <span>{game.away} at {game.home}</span></h2><div><button className="injury-close" type="button" aria-label="Close game report" onClick={onClose}><X size={20}/></button></div></header>
      <div className="game-report-tabs" role="tablist" aria-label="Game report views"><button id="game-report-injuries-tab" type="button" role="tab" aria-selected={tab === 'injuries'} aria-controls="game-report-panel" onClick={() => setTabState({ key: gameKey, tab: 'injuries' })}>Injuries</button><button id="game-report-boxscore-tab" type="button" role="tab" aria-selected={tab === 'boxscore'} aria-controls="game-report-panel" onClick={() => setTabState({ key: gameKey, tab: 'boxscore' })}>Box score</button></div>
      <div id="game-report-panel" className="game-report-panel" role="tabpanel" aria-labelledby={tab === 'injuries' ? 'game-report-injuries-tab' : 'game-report-boxscore-tab'}>{tab === 'injuries'
        ? <InjuryReportContent key={gameKey} game={game} date={date} timezone={timezone} demo={demo} onConnectLive={onConnectLive}/>
        : <BoxScore key={gameKey} game={game} date={date} timezone={timezone} demo={demo} hideScores={hideScores} watchedIds={watchedIds} active onWatch={onWatch} onConnectLive={onConnectLive}/>}</div>
    </div>
  </dialog>;
}
