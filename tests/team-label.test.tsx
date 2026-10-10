import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TeamLabel, { TeamText } from '../src/TeamLabel';

describe('historical team label', () => {
  it('adds the catalog logo and era while preserving the actual visible abbreviation', () => {
    const html = renderToStaticMarkup(<TeamLabel team="SAS" className="team-name" />);
    expect(html).toContain('src="/team-logos/sas.png"');
    expect(html).toContain('alt="San Antonio Spurs, 2007–08 logo"');
    expect(html).toContain('title="San Antonio Spurs, 2007–08 logo"');
    expect(html).toContain('team-name');
    expect(html).toContain('>SAS</span>');
  });

  it.each(['OKC', 'SEA'])('does not call the 2007–08 Seattle logo an Oklahoma City logo for %s', team => {
    const html = renderToStaticMarkup(<TeamLabel team={team} />);
    expect(html).toContain('alt="Seattle SuperSonics, 2007–08 logo"');
    expect(html).toContain('src="/team-logos/sea.png"');
    expect(html).toContain(`>${team}</span>`);
    expect(html).not.toContain('Oklahoma City');
  });

  it.each(['BKN', 'BRK', 'NJ', 'NJN'])('honors a catalog alias without changing the visible abbreviation: %s', team => {
    const html = renderToStaticMarkup(<TeamLabel team={team} />);
    expect(html).toContain('src="/team-logos/njn.png"');
    expect(html).toContain('alt="New Jersey Nets, 2007–08 logo"');
    expect(html).toContain(`>${team}</span>`);
  });

  it.each(['NBA', 'TBD', 'TOT', 'UNKNOWN', ''])('keeps %j text-only when no verified asset exists', team => {
    const html = renderToStaticMarkup(<TeamLabel team={team} />);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('2007');
    expect(html).toContain(`>${team}</span>`);
  });

  it('decorates only whole known team codes in prose, not stat abbreviations or substrings', () => {
    const html = renderToStaticMarkup(<TeamText text="34 PTS vs SAS, 10 REB against OKC, 4 AST. SASQUATCH stays text." />);
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('34 PTS vs');
    expect(html).toContain('10 REB against');
    expect(html).toContain('4 AST. SASQUATCH stays text.');
  });

  it('leaves minutes and unqualified abbreviations plain in actual recap prose', () => {
    const html = renderToStaticMarkup(<TeamText text="34 PTS · 16 REB · 5 AST · 35 MIN · vs SAS. MIN is not a matchup here." />);
    expect(html).toContain('35 MIN');
    expect(html).toContain('MIN is not a matchup here.');
    expect(html).not.toContain('/team-logos/min.png');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('/team-logos/sas.png');
  });

  it.each(['against MIN', 'vs MIN', 'vs. MIN', '@ MIN'])('recognizes Minnesota in an explicit matchup: %s', phrase => {
    const html = renderToStaticMarkup(<TeamText text={`34 MIN ${phrase}.`} />);
    expect(html).toContain('34 MIN');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('alt="Minnesota Timberwolves, 2007–08 logo"');
  });

  it('retains Minnesota logos for a structured team value without a prose prefix', () => {
    const html = renderToStaticMarkup(<TeamLabel team="MIN" />);
    expect(html).toContain('src="/team-logos/min.png"');
    expect(html).toContain('>MIN</span>');
  });
});
