import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WatchlistAlerts from '../src/WatchlistAlerts';

describe('separate player alert controls', () => {
  it('keeps injury opt-in off independently of an existing live alert opt-in', () => {
    const html = renderToStaticMarkup(<WatchlistAlerts player={{ id: '1', name: 'Player One', team: 'SAS', tier: 'favorite', alerts: true }} onChange={() => {}}/>);
    expect(html).toContain('aria-label="Disable live alerts for Player One" aria-pressed="true"');
    expect(html).toContain('aria-label="Enable injury alerts for Player One" aria-pressed="false"');
  });
  it('prevents opting league-only players into watched-player injury alerts', () => {
    const html = renderToStaticMarkup(<WatchlistAlerts player={{ id: '1', name: 'Player One', team: 'SAS', tier: 'league', alerts: false }} onChange={() => {}}/>);
    expect(html).toMatch(/disabled=""[^>]*aria-label="Enable injury alerts/);
  });
});
