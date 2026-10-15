// Builds src/data/records.json: every regular season since 1946–47, all-time
// single-season and single-game top tens, and verified player photo sources.
// Run from the repository root: node scripts/history/build-records.mjs
// Season totals are read from the ignored verified cache in .superpowers/history-ingest
// (fetched from Basketball-Reference below 20 requests/minute when a season is missing).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseReferenceSeason, parseWikipediaGames, seasonSourceUrl, STATS } from './sources.mjs';
import { byAverage, byTotal, rankTop } from '../../src/shared/records-rank.ts';

const MIN_GAMES = 20;
const root = new URL('../../', import.meta.url);
const cacheDir = new URL('.superpowers/history-ingest/', root);
const photoCacheFile = new URL('.superpowers/photo-check.json', root);
const agent = { 'User-Agent': 'AfterTheBuzzer/1.0 (private personal NBA reader; records build)' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lastCompleted = (() => { const now = new Date(); return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; })();

async function getJson(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { ...init, headers: { ...agent, ...init.headers }, signal: AbortSignal.timeout(30_000) });
    if (response.ok) return response.json();
    if (attempt >= 3 || response.status < 500 && response.status !== 429) throw new Error(`${url}: HTTP ${response.status}`);
    await sleep(2000 * attempt);
  }
}

// 1. Season totals ----------------------------------------------------------
const seasons = [];
for (let season = 1947; season <= lastCompleted; season++) {
  const file = new URL(`${season}.json`, cacheDir);
  let snapshot;
  try { snapshot = JSON.parse(await readFile(file, 'utf8')); } catch { /* fetch below */ }
  if (!snapshot) {
    const response = await fetch(seasonSourceUrl(season), { headers: agent, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${season}: Basketball-Reference HTTP ${response.status}; not publishing partial history.`);
    snapshot = parseReferenceSeason(await response.text(), season, new Date().toISOString());
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(snapshot));
    await sleep(3500);
  }
  if (snapshot.season !== season || snapshot.playerCount !== snapshot.rows.length || !snapshot.rows.length) throw new Error(`${season}: invalid cached snapshot.`);
  for (const row of snapshot.rows) {
    for (const [stat, , since] of STATS) {
      const value = row.stats[stat];
      if (season < since ? value !== null : !Number.isInteger(value) || value < 0) throw new Error(`${season}: invalid ${stat} for ${row.player.id}.`);
    }
    if (!Number.isInteger(row.games) || row.games < 1) throw new Error(`${season}: invalid games for ${row.player.id}.`);
  }
  seasons.push(snapshot);
}
console.log(`Seasons ${seasons[0].season}–${seasons.at(-1).season}: ${seasons.reduce((sum, s) => sum + s.rows.length, 0)} player seasons.`);

function leaders(rows, stat, measure) {
  const eligible = rows.filter(row => row.stats[stat] !== null && (measure === 'totals' || row.games >= MIN_GAMES)).map(row => ({ ...row, key: row.id, total: row.stats[stat] }));
  return rankTop(eligible, measure === 'totals' ? byTotal : byAverage);
}

// 2. Single-game records ---------------------------------------------------------
const PAGES = { points: ['List_of_NBA_single-game_scoring_leaders', 'Points'], rebounds: ['List_of_NBA_single-game_rebounding_leaders', 'Rebounds'], assists: ['List_of_NBA_single-game_assists_leaders', 'Assists'], blocks: ['List_of_NBA_single-game_blocks_leaders', 'Blocks'], steals: ['List_of_NBA_single-game_steals_leaders', 'Steals'], threes: ['List_of_NBA_single-game_3-point_scoring_leaders', '3PM'] };
const games = {}, revisions = {};
for (const [stat, [page, header]] of Object.entries(PAGES)) {
  const data = await getJson(`https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=text|revid&format=json&formatversion=2`);
  revisions[stat] = { page, revision: data.parse.revid, url: `https://en.wikipedia.org/w/index.php?title=${page}&oldid=${data.parse.revid}` };
  const rows = parseWikipediaGames(data.parse.text, header).map(row => ({ ...row, key: `${row.date}:${row.title}` }));
  games[stat] = rankTop(rows.map(row => ({ ...row, total: row.value })), byTotal);
  await sleep(500);
}

// 3. Identities: Wikipedia title → Wikidata item → Basketball-Reference / NBA.com / ESPN IDs
const titles = [...new Set(Object.values(games).flat().map(row => row.title))];
const titleItem = new Map();
for (let index = 0; index < titles.length; index += 50) {
  const batch = titles.slice(index, index + 50);
  const data = await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`);
  const renamed = new Map([...(data.query.normalized ?? []), ...(data.query.redirects ?? [])].map(item => [item.from, item.to]));
  for (const title of batch) {
    let resolved = title; for (let hop = 0; hop < 3 && renamed.has(resolved); hop++) resolved = renamed.get(resolved);
    const item = data.query.pages.find(page => page.title === resolved)?.pageprops?.wikibase_item;
    if (!item) throw new Error(`No Wikidata item for ${title}.`);
    titleItem.set(title, item);
  }
}
const sparql = 'SELECT ?p ?bbref ?nba ?espn WHERE { { ?p wdt:P2685 ?bbref } UNION { ?p wdt:P3647 ?nba } OPTIONAL { ?p wdt:P2685 ?bbref } OPTIONAL { ?p wdt:P3647 ?nba } OPTIONAL { ?p wdt:P3685 ?espn } }';
const crosswalk = await getJson(`https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}`, { headers: { Accept: 'application/sparql-results+json' } });
const byItem = new Map(), byReference = new Map();
for (const binding of crosswalk.results.bindings) {
  const item = binding.p.value.split('/').at(-1);
  const ids = byItem.get(item) ?? { item, bbref: null, nba: null, espn: null };
  const bbref = binding.bbref?.value.split('/').at(-1) ?? null;
  for (const [key, value] of [['bbref', bbref], ['nba', binding.nba?.value ?? null], ['espn', binding.espn?.value ?? null]]) {
    if (value && !/^[a-z0-9.'-]+$/i.test(value)) continue;
    if (value && !ids[key]) ids[key] = value;
  }
  byItem.set(item, ids);
}
for (const ids of byItem.values()) if (ids.bbref) byReference.set(ids.bbref, ids);
console.log(`Wikidata crosswalk: ${byItem.size} people, ${byReference.size} with Basketball-Reference IDs.`);

// 4. Rankings with compact rows --------------------------------------------------
const players = new Map();
function seasonPlayer(row) {
  const ids = byReference.get(row.player.id);
  if (!players.has(row.player.id)) players.set(row.player.id, { name: row.player.name, nba: ids?.nba ?? null, espn: ids?.espn ?? null });
  return row.player.id;
}
function gamePlayer(row) {
  const ids = byItem.get(titleItem.get(row.title)) ?? { item: titleItem.get(row.title), bbref: null, nba: null, espn: null };
  const key = ids.bbref ?? `wd:${ids.item}`;
  if (!players.has(key)) players.set(key, { name: row.name, nba: ids.nba, espn: ids.espn });
  return key;
}
const out = { version: 2, builtAt: new Date().toISOString(), minGames: MIN_GAMES, stats: STATS.map(([id, , since]) => ({ id, since })), seasons: {}, singleSeason: { 'per-game': {}, totals: {} }, singleGame: {}, players: {}, sources: {} };
for (const snapshot of seasons) {
  const entry = { players: snapshot.playerCount, verifiedAt: snapshot.verifiedAt, 'per-game': {}, totals: {} };
  for (const [stat, , since] of STATS) for (const measure of ['per-game', 'totals']) {
    if (snapshot.season < since) continue;
    entry[measure][stat] = leaders(snapshot.rows, stat, measure).map(row => [seasonPlayer(row), row.team, row.games, row.stats[stat]]);
  }
  out.seasons[snapshot.season] = entry;
}
const everySeason = seasons.flatMap(snapshot => snapshot.rows);
for (const [stat] of STATS) for (const measure of ['per-game', 'totals']) {
  out.singleSeason[measure][stat] = leaders(everySeason, stat, measure).map(row => [seasonPlayer(row), row.season, row.team, row.games, row.stats[stat]]);
}
for (const [stat] of STATS) out.singleGame[stat] = games[stat].map(row => [gamePlayer(row), row.value, row.date, row.team, row.opponent, row.score]);

// 5. Verify the records everyone knows before publishing anything.
const lead = (list, index = 0) => ({ name: players.get(list[index][0]).name, row: list[index] });
const expect = (label, condition) => { if (!condition) throw new Error(`Verification failed: ${label}`); };
expect('Chamberlain 100 points', lead(out.singleGame.points).name === 'Wilt Chamberlain' && out.singleGame.points[0][1] === 100);
expect('Chamberlain 55 rebounds', lead(out.singleGame.rebounds).name === 'Wilt Chamberlain' && out.singleGame.rebounds[0][1] === 55);
expect('Skiles 30 assists', lead(out.singleGame.assists).name === 'Scott Skiles' && out.singleGame.assists[0][1] === 30);
expect('Elmore Smith 17 blocks', lead(out.singleGame.blocks).name === 'Elmore Smith' && out.singleGame.blocks[0][1] === 17);
expect('Kenon and Gill 11 steals', out.singleGame.steals.filter(row => row[1] === 11).map(row => players.get(row[0]).name).sort().join() === 'Kendall Gill,Larry Kenon');
expect('Thompson 14 threes', lead(out.singleGame.threes).name === 'Klay Thompson' && out.singleGame.threes[0][1] === 14);
expect('1961–62 scoring 50.4', lead(out.seasons[1962]['per-game'].points).name === 'Wilt Chamberlain' && (out.seasons[1962]['per-game'].points[0][3] / out.seasons[1962]['per-game'].points[0][2]).toFixed(1) === '50.4');
expect('all-time season points 4,029', out.singleSeason.totals.points[0][4] === 4029);
expect('2024–25 blocks leader with 20 GP', lead(out.seasons[2025]['per-game'].blocks).name === 'Victor Wembanyama' && lead(out.seasons[2025].totals.blocks).name === 'Victor Wembanyama');
expect('blocks not recorded before 1973–74', !out.seasons[1973]['per-game'].blocks && out.seasons[1974]['per-game'].blocks.length >= 10);

// 6. Photos: NBA.com transparent headshots unless only the generic silhouette exists; ESPN second.
let photoCache = {};
try { photoCache = JSON.parse(await readFile(photoCacheFile, 'utf8')); } catch { /* first build */ }
const digest = buffer => createHash('sha256').update(Buffer.from(buffer)).digest('hex');
const fallback = digest(await (await fetch('https://cdn.nba.com/headshots/nba/latest/260x190/fallback.png', { headers: agent })).arrayBuffer());
async function photoFor(player) {
  const cacheKey = `${player.nba}|${player.espn}`;
  if (photoCache[cacheKey] !== undefined) return photoCache[cacheKey];
  let result = null;
  if (player.nba) {
    const response = await fetch(`https://cdn.nba.com/headshots/nba/latest/260x190/${player.nba}.png`, { headers: agent, signal: AbortSignal.timeout(20_000) });
    if (response.ok && digest(await response.arrayBuffer()) !== fallback) result = 'nba';
  }
  if (!result && player.espn) {
    const response = await fetch(`https://a.espncdn.com/i/headshots/nba/players/full/${player.espn}.png`, { method: 'HEAD', headers: agent, signal: AbortSignal.timeout(20_000) });
    if (response.ok) result = 'espn';
  }
  photoCache[cacheKey] = result;
  return result;
}
const entries = [...players.entries()].sort(([a], [b]) => a.localeCompare(b));
for (let index = 0; index < entries.length; index += 8) {
  await Promise.all(entries.slice(index, index + 8).map(async ([key, player]) => {
    const photo = await photoFor(player);
    out.players[key] = [player.name, photo === 'nba' ? player.nba : null, photo === 'espn' ? player.espn : null];
  }));
}
await writeFile(photoCacheFile, JSON.stringify(photoCache));
const withPhoto = Object.values(out.players).filter(([, nba, espn]) => nba || espn).length;
console.log(`Players ${entries.length}; photos ${withPhoto} (${Math.round(withPhoto / entries.length * 100)}%).`);

out.sources = {
  seasons: { label: 'Basketball-Reference', url: 'https://www.basketball-reference.com/leagues/', verifiedAt: seasons.map(s => s.verifiedAt).sort()[0] },
  games: { label: 'NBA record book via Wikipedia', revisions, verifiedAt: out.builtAt },
  identities: { label: 'Wikidata', url: 'https://www.wikidata.org/wiki/Property:P3647' },
};
out.players = Object.fromEntries(Object.entries(out.players).sort(([a], [b]) => a.localeCompare(b)));
await mkdir(new URL('src/data/', root), { recursive: true });
await writeFile(new URL('src/data/records.json', root), JSON.stringify(out));
console.log(`Wrote src/data/records.json (${Object.keys(out.seasons).length} seasons).`);
