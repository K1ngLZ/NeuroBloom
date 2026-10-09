import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame as platform} from '../games/modules/platform.js';
import {createGame as speed} from '../games/modules/speed.js';
import {createGame as sword} from '../games/modules/sword.js';

export function harness(createGame, saved={}) {
  let held=new Set(),previous=new Set(),stored=structuredClone(saved);
  const completions=[];
  const input={down:a=>held.has(a),pressed:a=>held.has(a)&&!previous.has(a),released:a=>!held.has(a)&&previous.has(a),axis:a=>a==='x'?Number(held.has('right'))-Number(held.has('left')):Number(held.has('down'))-Number(held.has('up'))};
  const gradient={addColorStop(){}};
  const ctx=new Proxy({measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(target,key)=>key in target?target[key]:()=>{},set:(target,key,value)=>(target[key]=value,true)});
  const runtime={width:960,height:540,input,settings:{sound:false,reducedMotion:true},audio:{play(){}},save:{load:()=>structuredClone(stored),store:value=>{stored=structuredClone(value);}},report(){},message(){},complete:value=>completions.push(value)};
  const game=createGame(runtime);
  return {game,ctx,completions,get saved(){return stored;},step(actions=[],frames=1){held=new Set(actions);for(let i=0;i<frames;i++){game.update(1/60);previous=new Set(held);}return game.getState();}};
}
function finite(value,path='state') {
  if(typeof value==='number') assert.ok(Number.isFinite(value),`${path} must be finite`);
  else if(value&&typeof value==='object') for(const [key,item] of Object.entries(value))finite(item,`${path}.${key}`);
}
for(const [name,create] of [['platform',platform],['speed',speed]]) {
  test(`${name}: landing, jump, movement and read-only snapshots`,()=>{
    const h=harness(create);let s=h.step([],90);assert.equal(s.player.ground,true);
    const y=s.player.y;s=h.step(['jump']);assert.ok(s.player.vy<0);assert.ok(s.player.y<y);
    h.step([],90);s=h.game.getState();assert.equal(s.player.ground,true);
    const x=s.player.x;s=h.step(['right'],20);assert.ok(s.player.x>x);
    const copy=h.game.getState();copy.player.x=NaN;assert.ok(Number.isFinite(h.game.getState().player.x));
    for(let i=0;i<40;i++){h.step(i%2?['right','jump']:['left'],30);h.game.draw(h.ctx);finite(h.game.getState());}
    h.game.restart();assert.equal(h.game.getState().level,1);assert.equal(h.game.getState().score,0);
  });
}
test('speed turbo consumes energy and recharges while idle',()=>{
  const h=harness(speed);h.step([],90);const before=h.game.getState().energy;
  const boosted=h.step(['right','dash'],20);assert.ok(boosted.energy<before);assert.ok(boosted.player.vx>0);
  const recovered=h.step([],30);assert.ok(recovered.energy>boosted.energy);
});
test('sword saves level, guard slows movement, and dodge consumes energy',()=>{
  const h=harness(sword,{version:1,level:4,xp:35,coins:90,potions:3,upgrade:1,crystals:[true,false,false]});
  assert.equal(h.game.getState().player.level,4);
  const x=h.game.getState().player.x;let s=h.step(['right','guard'],20);const guarded=s.player.x-x;
  s=h.step(['right'],20);assert.ok(s.player.x-x-guarded>guarded);
  const energy=s.player.energy;s=h.step(['dash']);assert.ok(s.player.energy<energy);assert.ok(s.player.dash>0);
  for(let i=0;i<80;i++){h.step(i%2?['left','attack','guard']:['right','attack'],20);h.game.draw(h.ctx);finite(h.game.getState());}
  h.game.destroy?.();assert.ok(h.saved.level>=4);
  const restored=harness(sword,h.saved);assert.equal(restored.game.getState().player.level,h.saved.level);
});

import {createGame as ninja} from '../games/modules/ninja.js';
import {createGame as energy} from '../games/modules/energy.js';
const engines=[['platform',platform],['speed',speed],['sword',sword],['ninja',ninja],['energy',energy]];
for(const [name,create] of engines){
 test(`${name}: invalid or paused time cannot consume inputs or change state`,()=>{
  const h=harness(create);const before=h.game.getState();
  for(const dt of [0,-1,NaN,Infinity,undefined])h.game.update(dt);
  assert.deepEqual(h.game.getState(),before);
 });
 test(`${name}: malformed saves and extended input sequences stay finite`,()=>{
  const h=harness(create,{version:1,stage:NaN,level:Infinity,coins:-300,checkpoint:{x:Infinity,y:NaN},crystals:'bad',medals:{},xp:NaN,mastery:Infinity});
  for(let i=0;i<180;i++){h.step(i%3===0?['right','attack','special','dash']:i%3===1?['left','jump']:['guard','down'],6);finite(h.game.getState());}
  h.game.draw(h.ctx);
 });
}
test('ninja double jump, substitution, clone and defensive snapshots',()=>{
 const h=harness(ninja);h.step([],60);assert.equal(h.game.getState().player.ground,true);
 h.step(['jump'],4);h.step([],1);const s=h.step(['jump']);assert.equal(s.player.jumps,2);assert.ok(s.player.vy<0);
 h.step([],1);assert.equal(h.step(['jump']).player.jumps,2);
 const c=h.step(['interact']);assert.ok(c.clone>0);assert.ok(c.chakra<60);
 h.step([],1);const d=h.step(['dash']);assert.ok(d.player.inv>0);assert.ok(d.player.dash>0);
 const snapshot=h.game.getState();snapshot.enemies[0].hp=0;assert.ok(h.game.getState().enemies[0].hp>0);
});
test('energy beam release spends energy, hits distant rival and increases mastery',()=>{
 const h=harness(energy);const before=h.game.getState();h.step(['special'],96);const s=h.step([]);
 assert.ok(s.enemy.hp<before.enemy.hp);assert.ok(s.energy<before.energy);assert.ok(s.mastery>0);assert.equal(s.charge,0);
 const charged=h.step(['guard','down'],120);assert.ok(charged.energy>s.energy);
});
test('completed campaigns remain completed after reopening without duplicate rewards',()=>{
 const cases=[[platform,{status:'won',level:2}],[speed,{status:'won',level:2}],[ninja,{completed:true,stage:2}],[energy,{completed:true,stage:2}],[sword,{version:1,completed:true,crystals:[true,true,true]}]];
 for(const [create,save]of cases){const h=harness(create,save);h.step(['interact','right','attack'],120);const s=h.game.getState();assert.ok(s.status==='won'||s.quest?.completed);assert.equal(h.completions.length,0);}
});
test('platform checkpoint restore accepts only generated safe checkpoints',()=>{
 const safe=harness(platform,{level:1,checkpoint:{x:1062,y:420}});assert.equal(safe.game.getState().checkpoint.x,1062);
 const bad=harness(platform,{level:1,checkpoint:{x:2000,y:-999}});assert.equal(bad.game.getState().checkpoint.x,70);
});
for(const [name,create]of [['platform',platform],['speed',speed]])test(`${name}: scripted input completes all three courses and awards once`,()=>{
 const h=harness(create);
 for(let i=0;i<20000&&h.game.getState().status!=='won';i++){
  const s=h.game.getState();let actions;
  if(name==='speed')actions=['right','dash',...(i%70<65?['jump']:[])];
  else{actions=['right',...(i%50<46?['jump']:[]),...(i%24===0?['attack']:[])];if(s.boss&&s.player.x>s.goal+60)actions=[...(s.player.facing>0?['left']:[]),...(i%24===0?['attack']:[])];}
  h.step(actions);
 }
 assert.equal(h.game.getState().status,'won');assert.equal(h.game.getState().level,3);assert.equal(h.completions.length,1);
 h.step(['right','attack'],120);assert.equal(h.completions.length,1);
 if(name==='speed')assert.equal(h.game.getState().medals.length,3);
});
test('energy: ordinary combat inputs win all three duels',()=>{
 const h=harness(energy);
 for(let i=0;i<50000&&h.game.getState().status!=='won';i++){
  const s=h.game.getState(),p=s.player,e=s.enemy;let actions=[];
  if(s.status!=='fight')actions=i%2?['interact']:[];
  else{if(Math.abs(e.x-p.x)>70)actions.push(e.x>p.x?'right':'left');if(i%20===0)actions.push('attack');if(i%150<90&&p.energy>20)actions.push('special');if(p.energy<30)actions.push('guard','down');if(s.mastery>=6&&p.energy>65&&i%60===0)actions.push('interact');if(e.mode==='windup'&&e.timer<.2)actions.push('guard');}
  h.step(actions);
 }
 assert.equal(h.game.getState().status,'won');assert.equal(h.game.getState().stage,2);assert.equal(h.completions.length,1);
});
test('ninja: combos, shuriken, clone and substitution clear every sanctuary',()=>{
 const h=harness(ninja);
 for(let i=0;i<50000&&h.game.getState().status!=='won';i++){
  const s=h.game.getState(),p=s.player,e=s.enemies.filter(e=>e.hp>0).sort((a,b)=>Math.abs(a.x-p.x)-Math.abs(b.x-p.x))[0];let actions=[];
  assert.notEqual(s.status,'defeated');
  if(!e)actions=['right'];else{if(Math.abs(e.x-p.x)>55)actions.push(e.x>p.x?'right':'left');if(i%18===0)actions.push('attack');if(i%40===0)actions.push('special');if(i%60===0)actions.push('interact');if(e.phase==='warning'&&e.clock<.1&&i%2===0)actions.push('dash');}h.step(actions);
 }
 assert.equal(h.game.getState().status,'won');assert.equal(h.game.getState().stage,3);assert.equal(h.completions.length,1);
});
test('sword: explore both river banks, free three crystals and rescue Luma',()=>{
 const random=Math.random;Math.random=()=>.5;
 try{
 const h=harness(sword);
 for(let i=0;i<100000&&!h.game.getState().quest.completed;i++){
  const s=h.game.getState(),p=s.player,c=s.quest.crystals.find(c=>!c.done),distance=o=>Math.hypot(o.x-p.x,o.y-p.y);
  const foe=s.enemies.filter(e=>e.hp>0&&e.active&&(e.group===(c?s.quest.crystals.indexOf(c):3)||distance(e)<150)).sort((a,b)=>distance(a)-distance(b))[0];
  let target=foe??c??{x:1835,y:690},actions=[];
  // Use the actual bridge instead of attempting to walk through the river.
  if((p.x<1048&&target.x>1048)||(p.x>882&&target.x<882)){
   if(Math.abs(p.y-770)>8)target={x:p.x,y:770};else target={x:target.x>p.x?1100:830,y:770};
  }
  const d=distance(target),nearFoe=foe&&target===foe&&d<78;
  if(!nearFoe&&d>8){if(Math.abs(target.x-p.x)>4)actions.push(target.x>p.x?'right':'left');if(Math.abs(target.y-p.y)>4)actions.push(target.y>p.y?'down':'up');}
  if(foe&&distance(foe)<110){if(i%18===0)actions.push('attack');if(foe.mode==='windup'&&foe.timer<.15)actions.push('guard');}
  if(i%30===0)actions.push('interact');if(p.hp<p.maxHp*.55&&i%2===0)actions.push('special');h.step(actions);
 }
 const s=h.game.getState();assert.ok(s.quest.completed,JSON.stringify({player:s.player,crystals:s.quest.crystals,boss:s.boss}));assert.equal(h.completions.length,1);
 }finally{Math.random=random;}
});
for(const [name,create]of [['platform',platform],['speed',speed]])test(`${name}: reload retains collectibles and course medal time without rewarding again`,()=>{
 const h=harness(create);h.step([],90);const collected=h.game.getState();assert.ok(collected.score>0);h.game.destroy();
 assert.ok(h.saved.takenItems.length>0);assert.ok(JSON.stringify(h.saved).length<8192);
 const restored=harness(create,h.saved);assert.equal(restored.game.getState().levelTime,collected.levelTime);assert.equal(restored.game.getState().remainingItems,collected.remainingItems);
 restored.step([],90);assert.equal(restored.game.getState().score,collected.score);assert.equal(restored.game.getState().coins,collected.coins);
 const malformed=harness(create,{...h.saved,takenItems:[-1,1.5,Infinity,'0',99999],defeatedEnemies:[-1,NaN,99999],levelTime:NaN});finite(malformed.game.getState());assert.equal(malformed.game.getState().levelTime,0);
});
