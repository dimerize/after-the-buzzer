import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HistorySource } from '../src/History';
import { formatHistoryUpdatedAt, historyForPlayer, historyRequestKey, visibleHistoryRequest } from '../src/history-request';

describe('historical request identity', () => {
  const oldCareer = { playerId: '1966', availableSeasons: [2026, 2025, 2024, 2013] };
  const oldKey = historyRequestKey('/api/history/career?id=1966', 0);
  const settled = { key: oldKey, data: oldCareer, loading: false, error: '' };

  it('hides the previous player immediately, before request effects clear stored state', () => {
    const visible = visibleHistoryRequest(settled, historyRequestKey('/api/history/career?id=5104157', 0));
    expect(visible).toMatchObject({ data: null, loading: true, error: '' });
    // The new player cannot inherit the old player's season when deriving a log request.
    expect(visible.data?.availableSeasons[0]).toBeUndefined();
  });

  it('hides previous-season logs immediately on a season change', () => {
    const state = { key: historyRequestKey('/api/history/games?id=1966&season=2026', 0), data: { playerId: '1966', season: 2026, pointsHigh: 47 }, loading: false, error: '' };
    expect(visibleHistoryRequest(state, historyRequestKey('/api/history/games?id=1966&season=2013', 0))).toMatchObject({ data: null, loading: true });
    expect(visibleHistoryRequest(state, state.key).data).toEqual(state.data);
  });

  it('suppresses old errors and data during retry, disabled requests, and late old responses', () => {
    expect(visibleHistoryRequest({ ...settled, error: 'Previous failure' }, historyRequestKey('/api/history/career?id=1966', 1))).toMatchObject({ data: null, loading: true, error: '' });
    expect(visibleHistoryRequest(settled, null)).toEqual({ key: null, data: null, loading: false, error: '' });
    const currentKey = historyRequestKey('/api/history/career?id=5104157', 0);
    expect(visibleHistoryRequest({ ...settled, data: oldCareer }, currentKey).data).toBeNull();
  });

  it('also checks payload identity before deriving selected-player stats or years', () => {
    expect(historyForPlayer(oldCareer, '5104157')).toBeNull();
    expect(historyForPlayer(oldCareer, '1966')).toBe(oldCareer);
    const log = { playerId: '1966', season: 2026 };
    expect(historyForPlayer(log, '1966', 2013)).toBeNull();
    expect(historyForPlayer(log, '5104157', 2026)).toBeNull();
    expect(historyForPlayer(log, '1966', null)).toBeNull();
    expect(historyForPlayer(log, '1966', 2026)).toBe(log);
  });
});

describe('historical source timestamp', () => {
  it('renders the payload timestamp, including date and UTC, rather than the current night time', () => {
    const updatedAt = '2026-09-17T03:42:00.000Z';
    const html = renderToStaticMarkup(createElement(HistorySource, { url: 'https://www.espn.com/nba/stats', updatedAt }, 'Partial coverage'));
    expect(html).toContain('Partial coverage');
    expect(html).toMatch(/datetime="2026-09-17T03:42:00\.000Z"/i);
    expect(html).toContain('Updated Sep 17, 2026, 3:42 AM UTC');
    expect(html).toContain('href="https://www.espn.com/nba/stats"');
  });

  it('omits timestamps when the provider did not supply a valid value', () => {
    expect(formatHistoryUpdatedAt(undefined)).toBeNull();
    expect(formatHistoryUpdatedAt('invalid')).toBeNull();
    const html = renderToStaticMarkup(createElement(HistorySource, { updatedAt: 'invalid' }, 'No data'));
    expect(html).not.toContain('<time');
    expect(html).not.toContain('Updated');
  });
});
