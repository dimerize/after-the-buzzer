import type { WatchPlayer } from '../src/shared/types';

const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
export async function searchPlayers(db:D1Database, query:string):Promise<WatchPlayer[]> {
  let cached=await db.prepare('SELECT payload,updated_at FROM roster_cache WHERE id=?').bind('all').first<{payload:string;updated_at:number}>();
  if (!cached || Date.now()-cached.updated_at>24*60*60*1000) {
    const res=await fetch(`${BASE}/teams?limit=40`,{signal:AbortSignal.timeout(10000)});
    if(!res.ok) throw new Error('Player search is unavailable.');
    const data=await res.json() as {sports?:{leagues?:{teams?:{team:{id:string;abbreviation:string}}[]}[]}[]};
    const teams=data.sports?.[0]?.leagues?.[0]?.teams??[];
    if(!teams.length) throw new Error('Player search is unavailable.');
    const players:WatchPlayer[]=[];
    // Bound fanout and stay below the Workers free-plan subrequest allowance.
    let failures=0;
    for(let i=0;i<teams.length;i+=5) {
      const group=await Promise.allSettled(teams.slice(i,i+5).map(async ({team})=>{
        const r=await fetch(`${BASE}/teams/${team.id}/roster`,{signal:AbortSignal.timeout(8000)});
        if(!r.ok) throw new Error('roster');
        const d=await r.json() as {athletes?:{id:string;displayName:string}[]};
        if(!Array.isArray(d.athletes)) throw new Error('roster');
        return d.athletes.filter(p=>/^\d+$/.test(p.id)&&typeof p.displayName==='string').map(p=>({id:p.id,name:p.displayName,team:team.abbreviation,tier:'interest' as const,alerts:false}));
      }));
      for(const result of group) { if(result.status==='fulfilled') players.push(...result.value); else failures++; }
    }
    if(failures) {
      if(!cached) throw new Error('Some team rosters could not be loaded. Try player search again shortly.');
    } else {
      cached={payload:JSON.stringify(players),updated_at:Date.now()};
      await db.prepare('INSERT INTO roster_cache(id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind('all',cached.payload,cached.updated_at).run();
    }
  }
  const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return (JSON.parse(cached.payload) as WatchPlayer[]).filter(p=>normalize(p.name).includes(normalize(query))).slice(0,30);
}
