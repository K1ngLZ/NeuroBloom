import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
const guardianId='00000000-0000-4000-8000-000000000001';
const child1='00000000-0000-4000-8000-000000000002';
const child2='00000000-0000-4000-8000-000000000003';
test('progress is scoped to child cookie, validated, and upserted', async t => {
  const records=new Map();
  const pool={async query(sql,args){
    if(sql.startsWith('INSERT INTO game_progress')) { records.set(`${args[0]}/${args[1]}`,JSON.parse(args[2])); return {rows:[]}; }
    if(sql.startsWith('SELECT game_id')) return {rows:[...records].filter(([key])=>key.startsWith(`${args[0]}/`)).map(([key,progress])=>({game_id:key.split('/')[1],progress}))};
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const config=readConfig({DATABASE_URL:'postgres://test@localhost/test',JWT_SECRET:'test-only-secret-with-at-least-thirty-two-characters',FRONTEND_ORIGIN:'http://localhost:5500'});
  const app=await buildApp({config,pool,logger:false});t.after(()=>app.close());await app.ready();
  const cookie=id=>`nb_kid_session=${app.jwt.sign({sub:id,guardianId,role:'child'})}`;
  const url='/api/children/me/game-progress';
  const put=(id,progress,game='platform',extra={})=>app.inject({method:'PUT',url:`${url}/${game}`,headers:{cookie:cookie(id)},payload:{progress,...extra}});
  for(const method of ['GET','PUT']) {
    const denied=await app.inject({method,url:method==='GET'?url:`${url}/platform`,headers:{cookie:`nb_session=${app.jwt.sign({sub:guardianId,role:'guardian'})}`},...(method==='PUT'?{payload:{progress:{}}}:{})});
    assert.equal(denied.statusCode,401);
  }
  assert.equal((await put(child1,{level:2},'platform',{childId:child2})).statusCode,200);
  assert.equal((await put(child2,{level:1})).statusCode,200);
  assert.equal((await put(child1,{level:3,medals:['gold']})).statusCode,200);
  for(const [id,level] of [[child1,3],[child2,1]]) {
    const response=await app.inject({url,headers:{cookie:cookie(id)}});
    assert.equal(response.statusCode,200);assert.equal(response.json().progress.platform.level,level);
  }
  assert.equal(records.size,2);
  for(const bad of [null,[],3,{a:{b:{c:{d:{e:{f:{g:1}}}}}}}]) assert.equal((await put(child1,bad)).statusCode,400);
  assert.equal((await put(child1,{},'unknown')).statusCode,400);
  assert.equal((await put(child1,{text:'ç'.repeat(4200)})).statusCode,413);
  const infinite=await app.inject({method:'PUT',url:`${url}/platform`,headers:{cookie:cookie(child1),'content-type':'application/json'},payload:'{"progress":{"score":1e400}}'});
  assert.equal(infinite.statusCode,400);
  assert.equal(records.get(`${child1}/platform`).level,3);
});
