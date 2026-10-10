import { describe, expect, it } from 'vitest';
import { jerseyForPlayer, readJerseyChoice } from '../src/jerseys';

describe('throwback jersey selection', () => {
  it('uses LeBron’s 2006–07 Cleveland design without changing his current team', () => {
    const player = { id: '1966', name: 'LeBron James', team: 'PHI' };
    expect(jerseyForPlayer(player)).toMatchObject({ team: 'CLE', number: '23', era: '2006–07', home: { color: '#f3eee3' }, away: { color: '#84233e' } });
    expect(player.team).toBe('PHI');
  });
  it('uses verified numbers for the five favorites', () => {
    expect(['5104157', '1966', '5254165', '5037871', '4845367'].map(id => jerseyForPlayer({ id, name: '', team: id === '5254165' ? 'LAC' : 'SAS' }).number)).toEqual(['1', '23', '1', '2', '5']);
  });
  it('does not invent a jersey number or claim a 2007 design for unsupported teams', () => {
    expect(jerseyForPlayer({ id: '123', name: 'Another Player', team: 'ABC' })).toMatchObject({ team: 'ABC', number: '', era: 'Custom' });
  });
  it('accepts only valid persisted home/away choices', () => {
    expect(readJerseyChoice('away')).toBe('away');
    expect(readJerseyChoice('home')).toBe('home');
    expect(readJerseyChoice('broken')).toBe('home');
    expect(readJerseyChoice(null)).toBe('home');
  });
});
