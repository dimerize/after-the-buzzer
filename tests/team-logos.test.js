import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { getTeamLogo } from '../src/team-logos';

const currentTeams = ['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK','OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS'];

describe('2007–08 team-logo catalog', () => {
  it.each(currentTeams)('provides a real packaged PNG, not a remote or modern fallback, for %s', team => {
    const logo = getTeamLogo(team);
    expect(logo).toBeDefined();
    expect(logo.src).toMatch(/^\/team-logos\/[a-z]{3}\.png$/);
    const bytes = readFileSync(new URL(`../public${logo.src}`, import.meta.url));
    expect([...bytes.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10]);
    expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(100);
    expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(100);
  });

  it.each(currentTeams)('has transparent surroundings instead of an opaque image rectangle for %s', team => {
    const logo = getTeamLogo(team);
    const { width, height, data } = PNG.sync.read(readFileSync(new URL(`../public${logo.src}`, import.meta.url)));
    const corners = [0, width - 1, width * (height - 1), width * height - 1];
    // A diagonal mark can legitimately touch two corners of its own bounds.
    expect(corners.filter(pixel => data[pixel * 4 + 3] === 0).length).toBeGreaterThanOrEqual(2);
    let transparent = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] === 0) transparent++;
    expect(transparent / (width * height)).toBeGreaterThan(0.05);
  });

  it.each([
    ['OKC','Seattle SuperSonics','/team-logos/sea.png'],
    ['BKN','New Jersey Nets','/team-logos/njn.png'],
    ['NOP','New Orleans Hornets','/team-logos/noh.png'],
    ['CHA','Charlotte Bobcats','/team-logos/cha.png'],
  ])('labels the actual historical identity for %s', (team, label, src) => {
    expect(getTeamLogo(team)).toEqual({ src, label, era: '2007–08' });
  });

  it.each([['SA','SAS'],['GS','GSW'],['NY','NYK'],['UTAH','UTA'],['WSH','WAS'],['PHO','PHX'],['BRK','BKN'],['NJ','BKN'],['NJN','BKN'],['SEA','OKC'],['NO','NOP'],['NOH','NOP'],['NOK','NOP'],['CHO','CHA'],[' sas ','SAS']])('resolves provider alias %s consistently with %s', (alias, canonical) => {
    expect(getTeamLogo(alias)).toBeDefined();
    expect(getTeamLogo(alias)).toEqual(getTeamLogo(canonical));
  });

  it.each(['NBA','TBD','TOT','UNKNOWN','','../../sas','CHH'])('leaves unverified team %j without an invented logo', team => {
    expect(getTeamLogo(team)).toBeUndefined();
  });
});
