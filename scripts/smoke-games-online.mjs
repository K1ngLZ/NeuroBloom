import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Creates two fictional QA families. Secrets exist in memory only. No deletion or cleanup mutations.
// Usage: node scripts/smoke-games-online.mjs [site-url] [api-url]
export async function smokeGamesOnline(siteUrl='https://neuro-bloom-swart.vercel.app', apiUrl=siteUrl) {
  const site=new URL(siteUrl).origin, apiOrigin=new URL(apiUrl).origin;
  assert.equal(new URL(site).protocol,'https:','Site must use HTTPS');
  assert.equal(new URL(apiOrigin).protocol,'https:','API must use HTTPS');
  let checks=0;
  const games=['platform','speed','ninja','sword','energy'];
  async function request(jar,route,{method='GET',body,status=200}={}) {
    const response=await fetch(apiOrigin+route,{method,signal:AbortSignal.timeout(30000),headers:{Origin:site,
      ...(body?{'Content-Type':'application/json'}:{}),
      ...(jar.size?{Cookie:[...jar].map(([key,value])=>`${key}=${value}`).join('; ')}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.status,status,`${method} ${route}: unexpected status`);
    assert.match(response.headers.get('content-type')||'',/application\/json/,`${route}: expected JSON`);
    for(const cookie of response.headers.getSetCookie()) {
      const pair=cookie.split(';')[0], index=pair.indexOf('='), key=pair.slice(0,index),value=pair.slice(index+1);
      if(value) {
        assert.ok(/HttpOnly/i.test(cookie)&&/Secure/i.test(cookie),'Session cookie security attributes missing');
        jar.set(key,value);
      } else jar.delete(key);
    }
    checks++;
    return response.json();
  }
  async function family() {
    const jar=new Map(), email=`games-qa-${randomUUID()}@example.com`, password=randomBytes(24).toString('base64url'),pin=randomBytes(8).toString('hex');
    const signup=await request(jar,'/api/auth/signup',{method:'POST',status:201,body:{guardianName:'QA Fictício Jogos',childName:'Perfil Fictício QA',email,password,kidPin:pin,consent:true}});
    const childId=signup.child.id;
    await request(jar,`/api/children/${childId}/kid-login`,{method:'POST',body:{pin}});
    return {jar,childId,pin};
  }
  const base='/api/children/me';
  assert.equal((await request(new Map(),'/api/health')).database,'connected');
  await request(new Map(),`${base}/game-profile`,{status:401});
  const first=await family(),second=await family();
  const run=(route,options)=>request(first.jar,base+route,options);
  const other=(route,options)=>request(second.jar,base+route,options);
  assert.equal((await run('/game-profile')).nickname,null);
  await run('/game-profile',{method:'PATCH',body:{nickname:'Lua QA'}});
  await other('/game-profile',{method:'PATCH',body:{nickname:'Lua QA'}});
  const started=(await run('/game-sessions',{method:'POST',status:201,body:{gameId:'platform'}})).session;
  assert.equal(started.nickname,'Lua QA');
  await run('/game-profile',{method:'PATCH',body:{nickname:'Sol QA'}});
  await request(first.jar,'/api/children/logout',{method:'POST'});
  await request(first.jar,`/api/children/${first.childId}/kid-login`,{method:'POST',body:{pin:first.pin}});
  assert.equal((await run('/game-profile')).nickname,'Sol QA');
  assert.equal((await other('/game-profile')).nickname,'Lua QA');
  assert.equal((await run('/refresh',{method:'POST'})).ok,true);
  await other(`/game-sessions/${started.id}`,{method:'PATCH',status:404,body:{status:'ended'}});
  const summary={status:'completed',durationSeconds:8,score:123,level:2,stars:2};
  const finish=await run(`/game-sessions/${started.id}`,{method:'PATCH',body:summary});
  assert.equal(finish.session.nickname,'Lua QA');
  assert.deepEqual(await run(`/game-sessions/${started.id}`,{method:'PATCH',body:{status:'ended',score:1}}),finish);
  for(const [index,gameId] of games.entries()) {
    await run(`/game-progress/${gameId}`,{method:'PUT',body:{progress:{level:index+1,score:123}}});
    await run(`/game-progress/${gameId}`,{method:'PUT',body:{progress:{level:index+2,score:456}}});
    if(gameId!=='platform') {
      const session=(await run('/game-sessions',{method:'POST',status:201,body:{gameId}})).session;
      assert.equal(session.nickname,'Sol QA');
      await run(`/game-sessions/${session.id}`,{method:'PATCH',body:summary});
    }
  }
  const progress=(await run('/game-progress')).progress;
  for(const [index,gameId] of games.entries()) assert.equal(progress[gameId].level,index+2);
  assert.deepEqual((await other('/game-progress')).progress,{});
  assert.deepEqual((await other('/game-sessions')).sessions,[]);
  await other('/game-progress/platform',{method:'PUT',body:{progress:{level:99}}});
  assert.equal((await run('/game-progress')).progress.platform.level,2);
  const history=(await run('/game-sessions')).sessions;
  assert.equal(history.length,5);
  assert.ok(history.every(session=>session.status==='completed'));
  assert.equal(history.find(session=>session.id===started.id).nickname,'Lua QA');
  const assets=['/games/index.html','/games/runtime.js',...games.map(game=>`/games/modules/${game}.js`)];
  for(const asset of assets) {
    const response=await fetch(site+asset,{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200,`${asset}: unavailable`);
    const mime=response.headers.get('content-type')||'', text=await response.text();
    if(asset.endsWith('.js')) { assert.match(mime,/(?:javascript|ecmascript)/,`${asset}: expected JavaScript MIME`); assert.doesNotMatch(text,/^\s*<!doctype html/i,`${asset}: HTML fallback`); assert.ok(text.length>100,`${asset}: empty module`); }
    else assert.match(mime,/text\/html/);
    checks++;
  }
  for(const {jar} of [first,second]) {
    await request(jar,'/api/children/logout',{method:'POST'});
    await request(jar,'/api/auth/logout',{method:'POST'});
  }
  return {checks,fictionalFamiliesCreated:2,childIds:[first.childId,second.childId],sessionsVerified:history.length,assetsVerified:assets.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await smokeGamesOnline(process.argv[2],process.argv[3]),null,2)); }
  catch(error) { console.error('Game smoke failed:',error.message); process.exitCode=1; }
}
