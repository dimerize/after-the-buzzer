import type { Night } from '../src/shared/types';
import type { Env } from './env';
import { acquireLock, releaseLock } from './store';

// Reserve a conservative upper bound before every call. Failed/uncertain calls
// keep their reservation; this intentionally overcounts rather than overspends.
// Verified 2026-10-10: https://developers.openai.com/api/docs/models/gpt-6.1-sol
// $2/1M input, $10/1M output. Entire body <=12,000 UTF-8 bytes and output
// (including reasoning) <=600 tokens: < $0.030 even at one token per byte.
const RESERVATION = 0.04;
export function budgetLimit(env: Env): number {
  const configured = Number(env.AI_MONTHLY_LIMIT ?? '3');
  return Number.isFinite(configured) ? Math.max(0, Math.min(3, configured)) : 3;
}
export async function readBudget(env: Env) {
  const month = new Date().toISOString().slice(0,7);
  const row = await env.DB.prepare('SELECT reserved FROM budget WHERE month = ?').bind(month).first<{reserved:number}>();
  return { used: row?.reserved ?? 0, limit: budgetLimit(env), month };
}
export async function editNight(night: Night, env: Env): Promise<Night> {
  if (!env.OPENAI_API_KEY || night.highlights.length < 2 || night.partial || night.source !== 'espn') return night;
  // The bounded price calculation applies only to this verified model/rate.
  if (env.AI_MODEL && env.AI_MODEL !== 'gpt-6.1-sol') return night;
  if (!(await acquireLock(env.DB, 'ai-editor', 90))) return night;
  try {
    const key = `${night.date}:${night.edition}`;
    const prior=await env.DB.prepare('SELECT id,result FROM ai_editions WHERE id = ?').bind(key).first<{id:string;result:string|null}>();
    const applyOrder=(ids:string[]):Night=>{
      const order=[...new Set(ids)].filter(id=>night.highlights.some(h=>h.id===id));
      const highlights=[...order.map(id=>night.highlights.find(h=>h.id===id)!),...night.highlights.filter(h=>!order.includes(h.id))];
      return {...night,highlights,headline:highlights[0]?.title??night.headline};
    };
    if(prior) return prior.result?applyOrder(JSON.parse(prior.result)):night;
    const candidates = night.highlights.slice(0,12);
    const input = JSON.stringify(candidates.map(h => ({id:h.id,title:h.title,detail:h.detail,score:h.score})));
    const requestBody=JSON.stringify({model:'gpt-6.1-sol',max_output_tokens:600,reasoning:{effort:'low'},
      instructions:'You edit a personal NBA night recap. Order the supplied verified stories by interest, emphasizing exceptional performances. Select IDs only; never invent a fact. Return at most five unique IDs, in reading order.',
      input, text:{format:{type:'json_schema',name:'recap_order',strict:true,schema:{type:'object',properties:{ids:{type:'array',items:{type:'string',enum:candidates.map(h=>h.id)}}},required:['ids'],additionalProperties:false}}}});
    if (new TextEncoder().encode(requestBody).length > 12000) return night;
    const month = new Date().toISOString().slice(0,7);
    await env.DB.prepare('INSERT OR IGNORE INTO budget(month,reserved) VALUES (?,0)').bind(month).run();
    const reserved = await env.DB.prepare('UPDATE budget SET reserved=ROUND(reserved+?,4) WHERE month=? AND reserved+? <= ?').bind(RESERVATION,month,RESERVATION,budgetLimit(env)).run();
    if (!reserved.meta.changes) return night;
    await env.DB.prepare('INSERT INTO ai_editions(id,month,reserved,state) VALUES (?,?,?,?)').bind(key,month,RESERVATION,'reserved').run();
    const response = await fetch('https://api.openai.com/v1/responses', {
      method:'POST', headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(20000),
      body:requestBody
    });
    if (!response.ok) return night;
    const body = await response.json() as {output?:{content?:{type?:string;text?:string}[]}[]};
    const raw=body.output?.flatMap(o=>o.content??[]).find(c=>c.type==='output_text')?.text;
    if (!raw) return night;
    const ids = (JSON.parse(raw) as {ids?:unknown}).ids;
    if (!Array.isArray(ids) || ids.length>5 || ids.some(id=>typeof id!=='string'||!candidates.some(h=>h.id===id))) return night;
    const order=[...new Set(ids)] as string[];
    await env.DB.prepare('UPDATE ai_editions SET state=?,result=? WHERE id=?').bind('complete',JSON.stringify(order),key).run();
    return applyOrder(order);
  } catch { return night; }
  finally { await releaseLock(env.DB,'ai-editor'); }
}
