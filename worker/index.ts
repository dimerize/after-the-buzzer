import type { Dashboard, Night, Preferences } from '../src/shared/types';
import type { Env } from './env';
import { createSession, verifySession, safeEqual } from './auth';
import { fetchNight, fetchSchedule } from './espn';
import { archive, buildTrackers, getNight, getPreferences, saveNight, savePreferences, acquireLock, releaseLock } from './store';
import { basketballDate, localTime, isBedtimeDue, isQuietHour } from './schedule';
import { validPushEndpoint, sendPush } from './push';
import { editNight, readBudget } from './ai';
import { searchPlayers } from './players';
import { validatePreferences, validDate, validSubscriptionKeys } from './validation';
import { loadCareerHistory, loadSeasonLog, loadSeasonHonors, validHistoryId, validHistorySeason } from './history-store';
import { bedtimeNotification, milestoneNotification } from './notifications';
import { loadGameInjuries } from './injuries';
import { loadGameBoxScore } from './boxscores';
import { resetInjuryAlertBaselines, runInjuryAlerts } from './injury-alerts';

const COOKIE='buzzer_session';
function local(request:Request,env:Env):boolean {
  return env.LOCAL_DEV==='true' && ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
}
function json(value:unknown,status=200,headers:Record<string,string>={}):Response {
  return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
async function body(request:Request):Promise<unknown> {
  if(Number(request.headers.get('Content-Length')??0)>30000) throw new Error('Request too large.');
  const reader=request.body?.getReader();
  const parts:Uint8Array[]=[];
  let bytes=0;
  if(reader) for(;;) {
    const {done,value}=await reader.read();
    if(done) break;
    bytes+=value.byteLength;
    if(bytes>30000) { await reader.cancel(); throw new Error('Request too large.'); }
    parts.push(value);
  }
  const joined=new Uint8Array(bytes);
  let offset=0; for(const part of parts) { joined.set(part,offset); offset+=part.byteLength; }
  const text=new TextDecoder().decode(joined);
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON.'); }
}
export async function refresh(env:Env,date:string,preferences:Preferences,edition?:Night['edition']):Promise<Night> {
  const cached=await getNight(env.DB,date);
  if(cached && Date.now()-Date.parse(cached.updatedAt)<60000) return cached;
  if(!(await acquireLock(env.DB,`refresh:${date}`))) {
    if(cached) return cached;
    throw new Error('The recap is updating. Try again in a few seconds.');
  }
  try {
    let night=await fetchNight(date,preferences);
    if(cached && ((cached.edition==='final'&&!cached.partial&&night.partial) || (cached.games.length>0&&night.games.length===0))) {
      return {...cached,warnings:[...cached.warnings,'The latest refresh was incomplete. Showing the previously saved edition with its original update time.']};
    }
    if(edition && night.edition!=='final') night={...night,edition};
    if(edition==='bedtime'||night.edition==='final') night=await editNight(night,env);
    await saveNight(env.DB,night);
    return night;
  } finally { await releaseLock(env.DB,`refresh:${date}`); }
}
async function dashboard(env:Env,date?:string,force=false):Promise<Dashboard> {
  const preferences=await getPreferences(env.DB);
  // ESPN's NBA date is Eastern; changing notification timezone must not select
  // tomorrow's slate while tonight's games are still running in the US.
  const selected=date??basketballDate(new Date(),'America/New_York');
  if(!validDate(selected)) throw new Error('Invalid date.');
  let night=force?null:await getNight(env.DB,selected);
  if(!night) night=await refresh(env,selected,preferences);
  const nights=await archive(env.DB);
  return { night,preferences,archive:nights.map(n=>({date:n.date,headline:n.headline,edition:n.edition})),trackers:buildTrackers(nights,preferences,night),
    capabilities:{liveData:true,persistent:true,push:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT),ai:!!env.OPENAI_API_KEY},budget:await readBudget(env)};
}
async function route(request:Request,env:Env):Promise<Response> {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  if(url.pathname==='/api/health') return json({ok:true});
  const isLocal=local(request,env);
  if(!env.APP_PASSWORD && !isLocal) return json({error:'The app needs an owner password before it can go live.'},503);
  const mutation=!['GET','HEAD','OPTIONS'].includes(request.method);
  const origin=request.headers.get('Origin');
  if(mutation && (!origin || (origin!==url.origin && !(isLocal&&/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))))) return json({error:'This request must come from your app.'},403);
  if(url.pathname==='/api/login' && request.method==='POST') {
    const ip=request.headers.get('CF-Connecting-IP')??'local';
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
    const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const attempts=await env.DB.prepare('SELECT attempts,expires_at FROM login_attempts WHERE id=?').bind(id).first<{attempts:number;expires_at:number}>();
    if(attempts&&attempts.expires_at>Date.now()&&attempts.attempts>=10) return json({error:'Too many attempts. Try again in 15 minutes.'},429);
    const input=await body(request) as {password?:unknown};
    if(typeof input?.password!=='string'||!env.APP_PASSWORD||!safeEqual(input.password,env.APP_PASSWORD)) {
      await env.DB.prepare('INSERT INTO login_attempts(id,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN login_attempts.expires_at<? THEN 1 ELSE login_attempts.attempts+1 END, expires_at=CASE WHEN login_attempts.expires_at<? THEN excluded.expires_at ELSE login_attempts.expires_at END').bind(id,Date.now()+900000,Date.now(),Date.now()).run();
      return json({error:'That password does not match.'},401);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE id=?').bind(id).run();
    const token=await createSession(env.APP_PASSWORD);
    return json({ok:true},200,{'Set-Cookie':`${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${isLocal?'':'; Secure'}`});
  }
  const token=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  if(!isLocal && !(await verifySession(token,env.APP_PASSWORD))) return json({error:'Sign in to your private NBA recap.'},401);
  if(url.pathname==='/api/logout'&&request.method==='POST') return json({ok:true},200,{'Set-Cookie':`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure`});
  if(url.pathname==='/api/dashboard'&&request.method==='GET') {
    const date=url.searchParams.get('date')??undefined;
    if(date&&!validDate(date)) return json({error:'Choose a valid date.'},400);
    return json(await dashboard(env,date));
  }
  if(url.pathname==='/api/schedule'&&request.method==='GET') {
    const date=url.searchParams.get('date');
    if(!date||url.searchParams.getAll('date').length!==1||!validDate(date)) return json({error:'Choose a valid schedule date.'},400);
    try { return json(await fetchSchedule(date)); }
    catch { return json({error:'The NBA schedule could not be loaded. Try again shortly.'},502); }
  }
  if(['/api/injuries','/api/boxscore'].includes(url.pathname)&&request.method==='GET') {
    const date=url.searchParams.get('date');
    const gameId=url.searchParams.get('gameId');
    if(!date||!validDate(date)||url.searchParams.getAll('date').length!==1||!gameId||!/^[1-9]\d{0,11}$/.test(gameId)||url.searchParams.getAll('gameId').length!==1) return json({error:'Choose a valid game and date.'},400);
    const schedule=await fetchSchedule(date);
    const game=schedule.games.find(candidate=>candidate.id===gameId);
    if(!game) return json({error:'That game is not on the selected schedule.'},404);
    return json(url.pathname==='/api/boxscore' ? await loadGameBoxScore(env.DB,game,date) : await loadGameInjuries(env.DB,game,date));
  }
  if(url.pathname==='/api/refresh'&&request.method==='POST') {
    const input=await body(request) as {date?:string};
    if(input?.date && !validDate(input.date)) return json({error:'Choose a valid date.'},400);
    return json(await dashboard(env,input?.date,true));
  }
  if(url.pathname==='/api/preferences'&&request.method==='PUT') {
    const preferences=validatePreferences(await body(request));
    const previous=await getPreferences(env.DB);
    await savePreferences(env.DB,preferences);
    await resetInjuryAlertBaselines(env.DB,previous,preferences);
    return json({preferences});
  }
  if(url.pathname==='/api/players'&&request.method==='GET') {
    const q=(url.searchParams.get('q')??'').trim().slice(0,80);
    return json({players:q.length>=2?await searchPlayers(env.DB,q):[]});
  }
  if(request.method==='GET' && ['/api/history/career','/api/history/games','/api/history/honors'].includes(url.pathname)) {
    const id=url.searchParams.get('id');
    if(url.pathname!=='/api/history/honors' && !validHistoryId(id)) return json({error:'Invalid ESPN player ID.'},400);
    if(url.pathname==='/api/history/career') return json(await loadCareerHistory(env.DB,id!));
    const rawSeason=url.searchParams.get('season');
    const season=Number(rawSeason);
    if(!rawSeason || !/^\d{4}$/.test(rawSeason) || !validHistorySeason(season)) return json({error:'Invalid NBA season.'},400);
    return json(url.pathname==='/api/history/games' ? await loadSeasonLog(env.DB,id!,season) : await loadSeasonHonors(env.DB,season));
  }
  if(url.pathname==='/api/push/key'&&request.method==='GET') return env.VAPID_PUBLIC_KEY?json({publicKey:env.VAPID_PUBLIC_KEY}):json({error:'Push notifications are not configured yet.'},503);
  // Owner-requested release notice. Fixed copy and durable release ID prevent
  // this private operation becoming an arbitrary broadcast endpoint.
  if(url.pathname==='/api/push/release'&&request.method==='POST') {
    if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT) return json({error:'Push notifications are not configured yet.'},503);
    const id='release:2026-10-10-injury-alerts-boxscores';
    if(await env.DB.prepare('SELECT id FROM notifications WHERE id=?').bind(id).first()) return json({accepted:true,alreadySent:true});
    if(!(await acquireLock(env.DB,'push-release:owner',60))) return json({error:'Release notification already being submitted. Try again in a minute.'},429);
    const accepted=await notify(env,id,{title:'Buzzer update is live',body:'Full box scores + injury-change alerts are ready. Close and reopen Buzzer. Enable injury alerts in Settings and pick players in Watchlist.',url:'/?latest=1',tag:id});
    return accepted?json({accepted:true,alreadySent:false}):json({error:'No notification was accepted. Check registered devices and notification permission.'},502);
  }
  if(url.pathname==='/api/push/test'&&request.method==='POST') {
    if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT) return json({error:'Push notifications are not configured yet.'},503);
    const input=await body(request) as {endpoint?:unknown};
    if(typeof input?.endpoint!=='string'||!validPushEndpoint(input.endpoint)) return json({error:'Invalid browser push endpoint.'},400);
    const row=await env.DB.prepare('SELECT endpoint,payload FROM push_subscriptions WHERE endpoint=?').bind(input.endpoint).first<{endpoint:string;payload:string}>();
    if(!row) return json({error:'This device is not registered. Enable notifications on this device first.'},404);
    let subscription:Parameters<typeof sendPush>[0]|undefined;
    try {
      const saved=JSON.parse(row.payload);
      if(saved?.endpoint===input.endpoint && typeof saved.keys?.p256dh==='string' && typeof saved.keys.auth==='string'
        && validSubscriptionKeys(saved.keys.p256dh,saved.keys.auth)) subscription=saved;
    } catch { /* Invalid stored data requires a new browser subscription. */ }
    if(!subscription) return json({error:'This device subscription needs to be renewed. Enable notifications again.'},410);
    // Keep this claim until expiry, including failed sends. One owner cannot
    // bypass the cooldown by rotating through registered device endpoints.
    if(!(await acquireLock(env.DB,'push-test:owner',60))) return json({error:'Wait 60 seconds before sending another test notification.'},429,{'Retry-After':'60'});
    const result=await sendPush(subscription,{title:'Buzzer notification test',body:'This is your test notification. Tap to open the latest recap.',url:'/?latest=1',tag:'buzzer-test'},env);
    if(result.expired) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(input.endpoint).run();
      return json({error:'This device subscription expired. Enable notifications again.'},410);
    }
    if(!result.ok) return json({error:'The test notification was not accepted by the push service. Wait a minute and try again.'},502);
    // Acceptance by the push service is not proof of delivery to the phone.
    return json({ok:true});
  }
  if(url.pathname==='/api/push/subscribe'&&request.method==='POST') {
    if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT) return json({error:'Push notifications are not configured yet.'},503);
    const p=await body(request) as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}};
    if(typeof p?.endpoint!=='string'||!validPushEndpoint(p.endpoint)||typeof p.keys?.p256dh!=='string'||typeof p.keys.auth!=='string'||p.keys.p256dh.length>200||p.keys.auth.length>100||!validSubscriptionKeys(p.keys.p256dh,p.keys.auth)) return json({error:'Invalid browser push subscription.'},400);
    await env.DB.prepare('INSERT INTO push_subscriptions(endpoint,payload) VALUES (?,?) ON CONFLICT(endpoint) DO UPDATE SET payload=excluded.payload').bind(p.endpoint,JSON.stringify(p)).run();
    return json({ok:true});
  }
  if(url.pathname==='/api/push/subscribe'&&request.method==='DELETE') {
    const p=await body(request) as {endpoint?:string};
    if(typeof p?.endpoint!=='string') return json({error:'Invalid subscription.'},400);
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(p.endpoint).run();
    return json({ok:true});
  }
  return json({error:'Not found.'},404);
}

async function notify(env:Env,id:string,payload:{title:string;body:string;url:string;tag:string}):Promise<boolean> {
  if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT) return false;
  const subscriptions=await env.DB.prepare('SELECT endpoint,payload FROM push_subscriptions LIMIT 5').all<{endpoint:string;payload:string}>();
  if(!subscriptions.results.length) return false;
  const claimed=await env.DB.prepare('INSERT OR IGNORE INTO notifications(id,created_at) VALUES (?,?)').bind(id,new Date().toISOString()).run();
  if(!claimed.meta.changes) return false;
  let succeeded=false;
  for(const row of subscriptions.results) {
    try {
      const result=await sendPush(JSON.parse(row.payload),payload,env);
      succeeded ||= result.ok;
      if(result.expired) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(row.endpoint).run();
    } catch { /* Keep other registered devices working. */ }
  }
  if(!succeeded) await env.DB.prepare('DELETE FROM notifications WHERE id=?').bind(id).run();
  return succeeded;
}
export async function runScheduled(env:Env,now=new Date()):Promise<void> {
  if(!env.APP_PASSWORD) return; // Fail closed if a production deployment is unconfigured.
  const preferences=await getPreferences(env.DB);
  if(preferences.injuryAlerts===true&&preferences.players.some(player=>player.injuryAlerts===true&&player.tier!=='league')) {
    try { await runInjuryAlerts(env,preferences,now,(id,payload)=>notify(env,id,payload)); }
    catch(error) { console.error('Injury alert poll failed:',error instanceof Error?error.message:'unavailable'); }
  }
  const date=basketballDate(now,'America/New_York');
  const existing=await getNight(env.DB,date);
  const bedtime=isBedtimeDue(now,preferences);
  const quiet=isQuietHour(now,preferences);
  // Recover unfinished nights after outages without doubling a polling run's
  // provider request budget. Daytime only; bedtime/live evening takes priority.
  const hour=Number(localTime(now,'America/New_York').slice(0,2));
  if(!bedtime&&hour>=6&&hour<16&&now.getUTCMinutes()%10===0) {
    const rows=await env.DB.prepare('SELECT payload FROM editions WHERE date < ? AND date >= ? ORDER BY date DESC LIMIT 2').bind(date,new Date(now.getTime()-3*86400000).toISOString().slice(0,10)).all<{payload:string}>();
    const pending=rows.results.map(r=>JSON.parse(r.payload) as Night).find(n=>n.partial||n.games.some(g=>g.status==='live'||g.status==='scheduled'));
    if(pending) { await refresh(env,pending.date,preferences); return; }
  }
  // Completed nights need only an occasional correction pass. Live slates poll at five minutes.
  const freshFinal=existing?.edition==='final'&&!existing.partial&&existing.games.length>0&&now.getTime()-Date.parse(existing.updatedAt)<6*60*60*1000;
  const night=freshFinal?existing!:await refresh(env,date,preferences,bedtime?'bedtime':undefined);
  if(bedtime&&!quiet) {
    const payload=bedtimeNotification(night,preferences);
    if(payload) await notify(env,`bedtime:${date}`,payload);
  }
  if(preferences.liveAlerts&&!quiet&&!preferences.hideScores&&!bedtime) {
    let attempted=false;
    for(const player of night.players.filter(p=>p.status==='live'&&!p.didNotPlay)) {
      const watched=preferences.players.find(p=>p.id===player.id&&p.alerts&&p.tier!=='league');
      if(!watched) continue;
      const milestones=[['points',60],['blocks',10],['points',50],['blocks',7],['assists',15],['rebounds',20],['points',40]] as const;
      // One new alert across the invocation bounds push fanout. Look for an
      // unseen milestone so a prior rebound alert cannot hide a scoring one.
      for(const hit of milestones.filter(([key,n])=>player[key]>=n)) {
        const payload=milestoneNotification(night,preferences,player,hit[0]);
        if(!payload) continue;
        const id=`live:${player.gameId}:${player.id}:${hit[0]}:${hit[1]}`;
        if(await env.DB.prepare('SELECT id FROM notifications WHERE id=?').bind(id).first()) continue;
        attempted=true;
        const sent=await notify(env,id,payload);
        if(sent) for(const lower of milestones.filter(([key,n])=>key===hit[0]&&n<hit[1])) {
          await env.DB.prepare('INSERT OR IGNORE INTO notifications(id,created_at) VALUES (?,?)').bind(`live:${player.gameId}:${player.id}:${lower[0]}:${lower[1]}`,now.toISOString()).run();
        }
        break;
      }
      if(attempted) break;
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM locks WHERE expires_at < ?').bind(Date.now()-3600000),
    env.DB.prepare('DELETE FROM login_attempts WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('DELETE FROM notifications WHERE created_at < ?').bind(new Date(Date.now()-90*86400000).toISOString())
  ]);
}
export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    try { return await route(request,env); }
    catch(error) {
      const message=error instanceof Error?error.message:'Unable to load the recap.';
      const validation=/^(Invalid|Choose up to|Request too large)/.test(message);
      console.error('NBA recap request failed:',message);
      return json({error:validation?message:'The live feed could not be updated. Your saved recaps are still available; try again shortly.'},validation?400:502);
    }
  },
  async scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext) { ctx.waitUntil(runScheduled(env)); }
};
