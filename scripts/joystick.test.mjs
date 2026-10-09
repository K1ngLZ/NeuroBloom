import test from 'node:test';
import assert from 'node:assert/strict';
import {MovementJoystick,projectJoystick} from '../games/joystick.js';
import {InputState} from '../games/runtime.js';
import {createGame as platform} from '../games/modules/platform.js';
import {createGame as speed} from '../games/modules/speed.js';
import {createGame as sword} from '../games/modules/sword.js';
import {createGame as ninja} from '../games/modules/ninja.js';
import {createGame as energy} from '../games/modules/energy.js';

function fixture(){
 const input=new InputState(),element=new EventTarget(),windowTarget=new EventTarget(),documentTarget=new EventTarget(),properties=new Map(),classes=new Set(),captures=new Set();
 let active=true,engagements=0;
 const rect={left:20,top:40,width:128,height:128},thumb={getBoundingClientRect:()=>({width:48,height:48})};
 Object.assign(element,{querySelector:()=>thumb,ownerDocument:{defaultView:windowTarget},getBoundingClientRect:()=>rect,style:{setProperty:(key,value)=>properties.set(key,value)},classList:{add:key=>classes.add(key),remove:key=>classes.delete(key)},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)});
 const controller=new MovementJoystick(element,{input,isActive:()=>active,onEngage:()=>engagements++,thumb,windowTarget,documentTarget});
 const pointer=(type,{id=1,x=84,y=104,pointerType='touch',button=0}={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:id,clientX:x,clientY:y,pointerType,button});if(type==='lostpointercapture')captures.delete(id);element.dispatchEvent(event);return event;};
 return {input,controller,element,windowTarget,documentTarget,properties,classes,captures,pointer,get engagements(){return engagements;},set active(value){active=value;}};
}

test('radial projection has an exact dead zone, gradual travel and a circular diagonal limit',()=>{
 for(const [x,y] of [[0,0],[4,0],[0,-4],[3,3]]){const p=projectJoystick(x,y,40);assert.equal(Math.abs(p.x),0);assert.equal(Math.abs(p.y),0);}
 const partial=projectJoystick(20,0,40);assert.ok(partial.x>0&&partial.x<.5);assert.equal(partial.thumbX,20);
 const diagonal=projectJoystick(100,-100,40);assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-12);assert.ok(Math.abs(Math.hypot(diagonal.thumbX,diagonal.thumbY)-40)<1e-12);assert.equal(diagonal.x,-diagonal.y);
 for(const args of [[NaN,1,40],[1,Infinity,40],[1,1,0],[1,1,-5],[1,1,40,1]])assert.deepEqual(projectJoystick(...args),{x:0,y:0,thumbX:0,thumbY:0});
});

test('captured finger moves beyond the base and releases without affecting action or keyboard holds',()=>{
 const f=fixture();f.input.set('key:W','up',true);f.input.set('touch:2','jump',true);
 assert.equal(f.pointer('pointerdown',{x:104}).defaultPrevented,true);assert.ok(f.input.axis('x')>0&&f.input.axis('x')<.5);assert.ok(f.captures.has(1));assert.equal(f.engagements,1);
 f.pointer('pointermove',{x:2000,y:104});assert.equal(f.input.axis('x'),1);assert.equal(f.properties.get('--stick-x'),'40px');
 f.pointer('pointerup');assert.equal(f.input.axis('x'),0);assert.equal(f.input.axis('y'),-1);assert.ok(f.input.down('jump'));assert.equal(f.properties.get('--stick-x'),'0px');assert.equal(f.classes.has('held'),false);assert.equal(f.captures.size,0);f.controller.destroy();
});

test('second fingers cannot steal, move or release the stick and mouse secondary button is ignored',()=>{
 const f=fixture();assert.equal(f.pointer('pointerdown',{pointerType:'mouse',button:2,x:124}).defaultPrevented,false);assert.equal(f.input.axis('x'),0);
 f.pointer('pointerdown',{x:124});f.pointer('pointerdown',{id:2,x:44});f.pointer('pointermove',{id:2,x:44});f.pointer('pointercancel',{id:2});f.pointer('pointerup',{id:2});assert.equal(f.input.axis('x'),1);assert.deepEqual([...f.captures],[1]);assert.equal(f.engagements,1);
 f.pointer('pointerup');f.pointer('pointermove',{id:2,x:44});assert.equal(f.input.axis('x'),0);f.pointer('pointerdown',{id:2,x:44});assert.equal(f.input.axis('x'),-1);f.controller.destroy();
});

test('inactive gestures and stale moves do nothing, and capture failures leave no held movement',()=>{
 const f=fixture();f.active=false;assert.equal(f.pointer('pointerdown',{x:124}).defaultPrevented,false);assert.equal(f.input.axis('x'),0);assert.equal(f.captures.size,0);
 f.active=true;f.pointer('pointerdown',{x:124});f.active=false;f.pointer('pointermove',{x:124});assert.equal(f.input.axis('x'),0);assert.equal(f.captures.size,0);
 f.active=true;f.pointer('pointermove',{x:124});assert.equal(f.input.axis('x'),0);f.element.setPointerCapture=()=>{throw new Error('pointer no longer active');};f.pointer('pointerdown',{x:124});assert.equal(f.input.axis('x'),0);assert.equal(f.controller.pointerId,null);f.controller.destroy();
});

for(const reason of ['pointercancel','lostpointercapture','blur','resize','visibilitychange','reset','destroy'])test(`${reason} recenters the stick and requires a fresh gesture`,()=>{
 const f=fixture();f.pointer('pointerdown',{x:124,y:144});assert.ok(f.input.axis('x')>0);assert.ok(f.input.down('down'));
 if(reason.startsWith('pointer')||reason==='lostpointercapture')f.pointer(reason);
 else if(reason==='visibilitychange'){f.documentTarget.hidden=true;f.documentTarget.dispatchEvent(new Event(reason));}
 else if(reason==='reset'||reason==='destroy')f.controller[reason]();
 else f.windowTarget.dispatchEvent(new Event(reason));
 assert.equal(f.input.axis('x'),0);assert.equal(f.input.axis('y'),0);assert.equal(f.input.down('down'),false);assert.equal(f.properties.get('--stick-x'),'0px');assert.equal(f.properties.get('--stick-y'),'0px');assert.equal(f.captures.size,0);
 f.pointer('pointermove',{x:124});assert.equal(f.input.axis('x'),0);
 if(reason==='destroy'){f.pointer('pointerdown',{x:124});assert.equal(f.input.axis('x'),0);assert.equal(f.pointer('contextmenu').defaultPrevented,false);}f.controller.destroy();
});

function gameHarness(create){
 const input=new InputState(),game=create({width:960,height:540,input,settings:{sound:false,reducedMotion:true},audio:{play(){}},save:{load:()=>({}),store(){}},report(){},message(){},complete(){}});
 return {input,game,step(frames=1){for(let frame=0;frame<frames;frame++){input.beginStep();game.update(1/60);input.endStep();}return game.getState();}};
}

for(const [name,create] of Object.entries({platform,speed,sword,ninja,energy}))test(`${name}: real engine responds to partial analog movement and simultaneous action`,()=>{
 const slow=gameHarness(create),fast=gameHarness(create);slow.step(1);fast.step(1);const slowX=slow.game.getState().player.x,fastX=fast.game.getState().player.x;
 slow.input.setAnalog('joystick',.4,0);fast.input.setAnalog('joystick',1,0);const a=slow.step(8),b=fast.step(8);assert.ok(a.player.x>slowX);assert.ok(b.player.x-fastX>a.player.x-slowX,`${name} must preserve partial movement`);
 slow.input.set('touch:action',name==='sword'?'attack':'jump',true);slow.step();assert.equal(slow.input.axis('x'),.4);slow.input.set('touch:action',name==='sword'?'attack':'jump',false);slow.input.setAnalog('joystick',0,0);slow.step(90);assert.equal(slow.input.axis('x'),0);
 for(const value of Object.values(slow.game.getState().player))if(typeof value==='number')assert.ok(Number.isFinite(value));slow.game.destroy();fast.game.destroy();
});

test('energy: upward analog flight and downward joystick plus guard recharge work',()=>{
 const h=gameHarness(energy);h.input.set('jump','jump',true);h.step();h.input.set('jump','jump',false);const y=h.game.getState().player.y;
 h.input.setAnalog('joystick',0,-.5);assert.ok(h.step(10).player.y<y);h.input.set('attack','attack',true);h.step();h.input.set('attack','attack',false);const before=h.game.getState().energy;
 h.input.set('guard','guard',true);h.input.setAnalog('joystick',0,.8);const x=h.game.getState().player.x;assert.ok(h.step(6).energy>before);assert.equal(h.game.getState().player.x,x);
});
