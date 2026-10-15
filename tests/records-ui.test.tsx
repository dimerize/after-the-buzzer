import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import dataset from '../src/data/records.json';
import { RecordsControls, RecordsResults } from '../src/Records';
import RecordPortrait, { directPhoto } from '../src/RecordPortrait';
import { removeWhiteBackground } from '../src/photo-cutout';
import { recordSeasons, seasonView, singleGameView } from '../src/records-model';
import type { RecordsData } from '../src/shared/records-types';

const data = dataset as unknown as RecordsData;
describe('Hall of Fame screens', () => {
  it('offers every season in a picker (the iPhone scroll wheel) with steppers, not a typed year', () => {
    const seasons = recordSeasons(data, [{ season: 2027, label: '2026–27', inProgress: true }]);
    const html = renderToStaticMarkup(<RecordsControls mode="season" season={2026} seasons={seasons} measure="per-game" onMode={() => {}} onSeason={() => {}} onMeasure={() => {}}/>);
    expect(html).toContain('<select');
    expect(html).not.toContain('type="number"');
    expect(html).toContain('2026–27 (live)');
    expect(html).toContain('>1946–47</option>');
    expect(html).toContain('aria-label="Previous season, 2024–25"');
    expect(html).toContain('aria-label="Next season, 2026–27"');
    for (const label of ['Season Leaders', 'Single Game', 'Single Season', 'Per game', 'Totals']) expect(html).toContain(label);
  });
  it('renders six single-line cards and a fitted ranking table with GP and exact values', () => {
    const html = renderToStaticMarkup(<RecordsResults view={seasonView(data, 2026, 'per-game')} stat="points" onSelect={() => {}}/>);
    expect(html.match(/class="chrome-bar record-card-title"/g)).toHaveLength(6);
    expect(html).toContain('>3-Pointers<');
    expect(html).toContain('>33.5<');
    expect(html).toContain('<th scope="col">GP</th>');
    expect(html).toContain('Per-game ranks need 20+ GP');
    expect(html).toContain('cdn.nba.com/headshots/nba/latest/1040x760/');
  });
  it('shows unrecorded eras honestly and dates single-game records', () => {
    const old = renderToStaticMarkup(<RecordsResults view={seasonView(data, 1962, 'per-game')} stat="blocks" onSelect={() => {}}/>);
    expect(old).toContain('Not recorded');
    expect(old).toContain('Since 1973–74');
    expect(old).toContain('NBA tracking began in 1973–74');
    const games = renderToStaticMarkup(<RecordsResults view={singleGameView(data)} stat="points" onSelect={() => {}}/>);
    expect(games).toContain('Mar 2, 1962');
    expect(games).not.toContain('<th scope="col">GP</th>');
  });
  it('chooses transparent sources first and falls back to a neutral silhouette', () => {
    expect(directPhoto({ key: 'x', name: 'X', nbaId: '76375', espnId: '4142', bbrefId: 'x' }, 'row')).toContain('cdn.nba.com/headshots/nba/latest/260x190/76375.png');
    expect(directPhoto({ key: 'x', name: 'X', nbaId: null, espnId: '4142', bbrefId: null }, 'card')).toContain('a.espncdn.com');
    const html = renderToStaticMarkup(<RecordPortrait player={{ key: 'wd:Q1', name: 'Old Player', nbaId: null, espnId: null, bbrefId: null }} size="card"/>);
    expect(html).not.toContain('<img');
    expect(html).toContain('Old Player: photo unavailable');
  });
});

describe('white background cutout', () => {
  it('clears white connected to the edges but keeps interior whites and the subject', () => {
    const width = 10, height = 10, pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    const paint = (x: number, y: number, value: number) => { const i = (y * width + x) * 4; pixels[i] = value; pixels[i + 1] = value - 10; pixels[i + 2] = value - 20; };
    for (let y = 3; y < 10; y++) for (let x = 3; x < 7; x++) paint(x, y, 120);
    const eye = (5 * width + 4) * 4; pixels[eye] = pixels[eye + 1] = pixels[eye + 2] = 255;
    const share = removeWhiteBackground(pixels, width, height);
    expect(pixels[3]).toBe(0);
    expect(pixels[(5 * width + 5) * 4 + 3]).toBe(255);
    expect(pixels[eye + 3]).toBe(255);
    expect(share).toBeGreaterThan(0.5);
  });
});
