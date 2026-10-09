import test from 'node:test';
import assert from 'node:assert/strict';
import {InputState, ProgressStore, GameSession, sanitizeProgress} from '../games/runtime.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function memory(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
function setup(t,{local,remote,child='child-a',put=async()=>({}),offline=false}={}){
 const storage=memory(),calls=[],statuses=[];
 if(local)for(const [key,value]of Object.entries(local))storage.setItem(key,JSON.stringify(value));
 const request=async(path,options)=>{calls.push({path,options});if(path==='/api/children/me'){if(offline)throw new Error('offline');return {child:{id:child}};}if(path.endsWith('/game-profile'))return {nickname:'Luz'};if(options?.method==='PUT')return put(path,options);return {progress:{platform:remote}};};
 const store=new ProgressStore('platform',{storage,request,onStatus:s=>statuses.push(s)});t.after(()=>clearTimeout(store.timer));return {store,storage,calls,statuses};
}
test('input combines independent keyboard and touch holds and emits edges once',()=>{
 const i=new InputState();i.set('key','jump',true);i.set('touch','jump',true);i.beginStep();assert.ok(i.pressed('jump'));i.endStep();i.beginStep();assert.equal(i.pressed('jump'),false);i.endStep();
 i.set('key','jump',false);i.beginStep();assert.ok(i.down('jump'));assert.equal(i.released('jump'),false);i.endStep();i.set('touch','jump',false);i.beginStep();assert.ok(i.released('jump'));assert.equal(i.down('jump'),false);i.endStep();i.beginStep();assert.equal(i.released('jump'),false);
});
test('input preserves quick taps between steps, opposing axes, and clears pause state',()=>{
 const i=new InputState();i.set('k','attack',true);i.set('k','attack',false);i.beginStep();assert.ok(i.pressed('attack'));assert.ok(i.released('attack'));assert.equal(i.down('attack'),false);i.endStep();
 i.set('a','left',true);i.set('b','right',true);assert.equal(i.axis('x'),0);i.set('c','up',true);assert.equal(i.axis('y'),-1);i.clear();i.beginStep();assert.equal(i.axis('y'),0);assert.equal(i.pressed('left'),false);
});
test('reassigning an input source releases its previous action',()=>{
 const i=new InputState();i.set('touch:1','left',true);i.beginStep();i.endStep();i.set('touch:1','right',true);i.beginStep();assert.ok(i.released('left'));assert.ok(i.pressed('right'));assert.equal(i.axis('x'),1);
});
test('progress cache is scoped to authenticated child and remote clean state wins',async t=>{
 const h=setup(t,{local:{'nb-game:guest:platform':{data:{score:99}},'nb-game:child-b:platform':{data:{score:88}},'nb-game:child-a:platform':{data:{score:1,_savedAt:999}}},remote:{score:7,_savedAt:1}});await h.store.hydrate();assert.equal(h.store.key,'nb-game:child-a:platform');assert.equal(h.store.load().score,7);assert.equal(h.store.nickname,'Luz');const copy=h.store.load();copy.score=500;assert.equal(h.store.load().score,7);
});
test('newer dirty local progress survives stale remote and schedules one debounce',async t=>{
 const h=setup(t,{local:{'nb-game:child-a:platform':{data:{score:10,_savedAt:20},dirty:true}},remote:{score:1,_savedAt:10}});await h.store.hydrate();assert.equal(h.store.load().score,10);const timer=h.store.timer;h.store.store({score:11});h.store.store({score:12});assert.equal(h.store.timer,timer);assert.equal(h.calls.filter(c=>c.options?.method==='PUT').length,0);await h.store.flush();const writes=h.calls.filter(c=>c.options?.method==='PUT');assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0].options.body).progress.score,12);assert.equal(h.store.dirty,false);
});
test('newer remote replaces older unsynchronized cache',async t=>{
 const h=setup(t,{local:{'nb-game:child-a:platform':{data:{score:1,_savedAt:10},dirty:true}},remote:{score:2,_savedAt:20}});await h.store.hydrate();assert.equal(h.store.load().score,2);assert.equal(h.store.dirty,false);
});
test('in-flight write cannot mark a newer revision synchronized',async t=>{
 const first=deferred();let writes=0;const h=setup(t,{put:()=>++writes===1?first.promise:Promise.resolve({})});await h.store.hydrate();h.store.store({score:1});const pending=h.store.flush();h.store.store({score:2});first.resolve({});await pending;assert.equal(h.store.dirty,true);assert.equal(h.store.load().score,2);await h.store.flush({keepalive:true});assert.equal(writes,2);assert.equal(h.store.dirty,false);assert.equal(h.calls.at(-1).options.keepalive,true);
});
test('401 and offline writes retain local progress',async t=>{
 const h=setup(t,{put:async()=>{throw Object.assign(new Error('expired'),{status:401});}});await h.store.hydrate();h.store.store({level:2});await h.store.flush();assert.equal(h.store.online,false);assert.equal(h.store.dirty,true);assert.equal(JSON.parse(h.storage.getItem(h.store.key)).data.level,2);const count=h.calls.length;await h.store.flush();assert.equal(h.calls.length,count);
 const offline=setup(t,{offline:true});await offline.store.hydrate();offline.store.store({score:3});await offline.store.flush();assert.equal(offline.store.load().score,3);assert.equal(offline.store.dirty,true);
});
test('malformed and oversized saves cannot replace valid progress',async t=>{
 const h=setup(t,{offline:true});await h.store.hydrate();h.store.store({score:42});const before=h.store.load();for(const bad of [null,[],NaN,{x:Infinity},{x:undefined},JSON.parse('{"__proto__":1}'),{text:'a'.repeat(9000)}])h.store.store(bad);assert.deepEqual(h.store.load(),before);assert.throws(()=>sanitizeProgress({a:{b:{c:{d:{e:{f:{g:1}}}}}}}));
 h.storage.setItem(h.store.key,'broken JSON');h.store.readLocal();assert.deepEqual(h.store.load(),{});
});
test('malformed remote save falls back to valid local data without blocking boot',async t=>{
 const h=setup(t,{local:{'nb-game:child-a:platform':{data:{score:10}}},remote:{score:Infinity}});await h.store.hydrate();assert.equal(h.store.load().score,10);
});
test('closing before session start resolves waits, sends bounded metrics once, then stops time',async()=>{
 const started=deferred(),calls=[];let ended=0;const session=new GameSession((path,options)=>{calls.push({path,options});return options.method==='POST'?started.promise:Promise.resolve({});},'ninja',()=>ended++);
 session.start();session.tick(2.75);const closing=session.end({status:'completed',score:Infinity,level:999999,stars:9},true);session.tick(100);await session.end();assert.equal(calls.length,1);started.resolve({session:{id:'s1'}});await closing;assert.equal(calls.length,2);assert.equal(ended,1);assert.equal(calls[1].options.keepalive,true);assert.deepEqual(JSON.parse(calls[1].options.body),{status:'completed',durationSeconds:2,score:0,level:9999,stars:3});
});
test('session ignores malformed elapsed samples and failed starts produce no end request',async()=>{
 const calls=[];const s=new GameSession(async(path,o)=>{calls.push(o);return {session:{id:'s'}};},'sword');await s.start();s.tick(5);for(const dt of [-4,NaN,Infinity,undefined])s.tick(dt);await s.end({score:-4,stars:-1});assert.equal(JSON.parse(calls[1].body).durationSeconds,5);
 let count=0;const failed=new GameSession(async()=>{count++;throw new Error('offline');},'speed');await failed.start();await failed.end();assert.equal(count,1);
});
