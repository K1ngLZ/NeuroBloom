const GAME_IDS = ['platform', 'speed', 'sword', 'ninja', 'energy'];
const KEYS = { ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',Space:'jump',KeyK:'jump',KeyJ:'attack',KeyX:'attack',KeyL:'special',KeyC:'special',ShiftLeft:'dash',ShiftRight:'dash',KeyI:'guard',KeyZ:'guard',KeyE:'interact',KeyF:'interact' };
const LABELS = {jump:'Espaço',attack:'J',special:'L',dash:'Shift',guard:'I',interact:'E'};
const FEATURES = {platform:['3 mundos','Salto preciso','Checkpoints','Guardião final'],speed:['Turbo e molas','Rotas e anéis','3 circuitos','Medalhas'],sword:['Mundo para explorar','Missões e cristais','XP e forja','Guardião em 2 fases'],ninja:['Salto duplo','Combo de 3 golpes','Clone do vento','3 santuários'],energy:['Voo livre','Raio carregado','Transformação','3 duelos']};

export class InputState {
  constructor(){this.sources=new Map();this.held=new Set();this.pendingPress=new Set();this.pendingRelease=new Set();this.press=new Set();this.release=new Set();}
  set(source,action,held){const before=this.held;if(held)this.sources.set(source,action);else this.sources.delete(source);this.held=new Set(this.sources.values());for(const item of this.held)if(!before.has(item))this.pendingPress.add(item);for(const item of before)if(!this.held.has(item))this.pendingRelease.add(item);}
  beginStep(){this.press=this.pendingPress;this.release=this.pendingRelease;this.pendingPress=new Set();this.pendingRelease=new Set();}
  endStep(){this.press.clear();this.release.clear();}
  down(action){return this.held.has(action);}
  pressed(action){return this.press.has(action);}
  released(action){return this.release.has(action);}
  axis(axis){return axis==='x'?Number(this.down('right'))-Number(this.down('left')):Number(this.down('down'))-Number(this.down('up'));}
  clear(){this.sources.clear();this.held.clear();this.pendingPress.clear();this.pendingRelease.clear();this.press.clear();this.release.clear();}
}

export function sanitizeProgress(value,depth=0){
  if(depth>6)throw new Error('Progresso muito profundo');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object')throw new Error('Progresso inválido');
  if(Array.isArray(value))return value.map(item=>sanitizeProgress(item,depth+1));
  const clean={};for(const [key,item] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw new Error('Chave inválida');clean[key]=sanitizeProgress(item,depth+1);}return clean;
}
const bounded=(value,max=100000000)=>Number.isFinite(value)?Math.max(0,Math.min(max,Math.floor(value))):0;
const clone=value=>JSON.parse(JSON.stringify(value));

export class ProgressStore {
  constructor(gameId,{storage,request,profile='guest',onStatus=()=>{}}={}){this.gameId=gameId;this.storage=storage;this.request=request;this.profile=profile;this.onStatus=onStatus;this.data={};this.revision=0;this.dirty=false;this.online=false;this.timer=null;this.inFlight=null;this.child=null;this.nickname=null;}
  get key(){return `nb-game:${this.profile}:${this.gameId}`;}
  readLocal(){try{const record=JSON.parse(this.storage?.getItem(this.key)||'null');if(record?.data&&typeof record.data==='object'){this.data=sanitizeProgress(record.data);this.dirty=record.dirty===true;}}catch{this.data={};this.dirty=false;}}
  writeLocal(){try{this.storage?.setItem(this.key,JSON.stringify({data:this.data,dirty:this.dirty}));}catch{this.onStatus('Armazenamento indisponível neste aparelho');}}
  async hydrate(){
    try{const result=await this.request('/api/children/me');this.child=result.child;this.profile=this.child.id;this.online=true;}catch{this.online=false;}
    this.readLocal();
    let progressLoaded=false;
    if(this.online){const results=await Promise.allSettled([this.request('/api/children/me/game-progress'),this.request('/api/children/me/game-profile')]);
      if(results[0].status==='fulfilled'){const remote=results[0].value.progress?.[this.gameId];try{if(remote&&!Array.isArray(remote)&&typeof remote==='object'&&(!this.dirty||Number(remote._savedAt||0)>Number(this.data._savedAt||0))){this.data=sanitizeProgress(remote);this.dirty=false;this.writeLocal();}progressLoaded=true;}catch{this.onStatus('Cópia local preservada · progresso online inválido');}}
      else this.onStatus('Progresso online indisponível · cópia neste aparelho');
      if(results[1].status==='fulfilled')this.nickname=results[1].value.nickname;
    }
    this.onStatus(this.online?(progressLoaded?(this.dirty?'Sincronização pendente':'Progresso carregado'):'Progresso online indisponível · cópia neste aparelho'):this.child?'Salvo neste aparelho':'Entre no mundo kids para salvar online');
    if(this.online&&this.dirty)this.schedule();return this;
  }
  load(){return clone(this.data);}
  store(value){let clean;try{clean=sanitizeProgress(value);if(!clean||Array.isArray(clean)||typeof clean!=='object')return;clean._savedAt=Date.now();if(new TextEncoder().encode(JSON.stringify(clean)).length>8192)return;}catch{return;}
    this.data=clean;this.revision++;this.dirty=true;this.writeLocal();this.onStatus(this.online?'Salvo neste aparelho · sincronizando':'Salvo neste aparelho');if(this.online)this.schedule();
  }
  schedule(){if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.flush();},4000);}
  async flush({keepalive=false}={}){
    clearTimeout(this.timer);this.timer=null;if(!this.online||!this.dirty)return;
    if(this.inFlight){await this.inFlight;if(this.dirty)return this.flush({keepalive});return;}
    const revision=this.revision,data=clone(this.data);
    this.inFlight=(async()=>{try{await this.request(`/api/children/me/game-progress/${this.gameId}`,{method:'PUT',body:JSON.stringify({progress:data}),keepalive:true});if(this.revision===revision){this.dirty=false;this.writeLocal();}this.onStatus(this.dirty?'Sincronização pendente':'Progresso salvo online');}
      catch(error){if(error.status===401)this.online=false;this.onStatus(error.status===401?'Sessão expirada · salvo neste aparelho':'Salvo neste aparelho · internet indisponível');}})();
    await this.inFlight;this.inFlight=null;if(this.dirty&&this.online&&this.revision!==revision)this.schedule();
  }
}

export class GameSession {
  constructor(request,gameId,onEnd=()=>{}){this.request=request;this.gameId=gameId;this.onEnd=onEnd;this.seconds=0;this.closed=false;this.promise=null;}
  start(){this.promise=this.request('/api/children/me/game-sessions',{method:'POST',keepalive:true,body:JSON.stringify({gameId:this.gameId})}).then(result=>result.session).catch(()=>null);return this.promise;}
  tick(dt){if(!this.closed&&Number.isFinite(dt)&&dt>0)this.seconds=Math.min(86400,this.seconds+dt);}
  async end(metrics={},keepalive=false){if(this.closed)return;this.closed=true;const session=await this.promise;if(!session)return;
    try{await this.request(`/api/children/me/game-sessions/${session.id}`,{method:'PATCH',keepalive,body:JSON.stringify({status:metrics.status==='completed'?'completed':'ended',durationSeconds:bounded(this.seconds,86400),score:bounded(metrics.score),level:bounded(metrics.level,9999),stars:bounded(metrics.stars,3)})});this.onEnd();}catch{/* A next start closes an unfinished online session. */}
  }
}

function createAudio(settings){let context,last=0;return {async unlock(){if(!settings.sound)return;try{context??=new (window.AudioContext||window.webkitAudioContext)();if(context.state==='suspended')await context.resume();}catch{}},play(name,{frequency=440,duration=.1,volume=.08}={}){if(!settings.sound||!context||context.state!=='running'||performance.now()-last<75)return;last=performance.now();const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='triangle';oscillator.frequency.value=Math.max(80,Math.min(1400,frequency));gain.gain.setValueAtTime(Math.min(.12,Math.max(0,volume)),context.currentTime);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+Math.min(.3,duration));oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+Math.min(.3,duration));},destroy(){void context?.close();}};}

async function bootstrap(){
  const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),id=GAME_IDS.includes(params.get('game'))?params.get('game'):'platform';
  const arcade=$('arcade'),canvas=$('gameCanvas'),ctx=canvas.getContext('2d'),overlay=$('gameOverlay'),input=new InputState();
  arcade.dataset.game=id;
  const base=['localhost','127.0.0.1','[::1]'].includes(location.hostname)?'http://localhost:3333':'';
  const request=async(path,options={})=>{const response=await fetch(base+path,{credentials:'include',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),...options});const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||'Não foi possível conectar');error.status=response.status;throw error;}return data;};
  let storage;try{storage=localStorage;}catch{}
  let prefs={};try{prefs=JSON.parse(storage?.getItem('nb_prefs')||'{}');}catch{}
  const settings={sound:false,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches||prefs.motion===true};
  const audio=createAudio(settings),save=new ProgressStore(id,{storage,request,profile:params.get('profile')||'guest',onStatus:text=>$('saveStatus').textContent=text});
  let game,metadata,active=false,started=false,destroyed=false,lastTime=0,accumulator=0,raf,session=null,metrics={},announcementTimer,refreshTimer;
  const notify=text=>{$('announcement').textContent=text;$('announcement').hidden=false;clearTimeout(announcementTimer);announcementTimer=setTimeout(()=>$('announcement').hidden=true,4200);};
  const report=value=>{metrics={...metrics,...value};const fields={hudLevel:value.level,hudScore:value.score,hudHealth:value.health,hudEnergy:value.energy,hudCoins:value.coins};for(const [field,num] of Object.entries(fields))if(num!==undefined)$(field).textContent=Number.isFinite(num)?Math.ceil(num).toLocaleString('pt-BR'):String(num);if(value.message)$('objective').textContent=value.message;canvas.dataset.status=String(value.status||'playing');};
  const sessionEnded=()=>{if(window.parent!==window)window.parent.postMessage({type:'nb:session-ended'},location.origin);};
  const finishSession=(status='ended',value={},keepalive=false)=>session?.end({...metrics,...value,status},keepalive);
  const clearInput=()=>{input.clear();document.querySelectorAll('[data-action]').forEach(button=>button.classList.remove('held'));};
  const setOverlay=(kind,title,description)=>{overlay.hidden=false;$('overlayKicker').textContent=kind;$('overlayTitle').textContent=title;$('overlayDescription').textContent=description;$('pauseButton').textContent='Continuar';$ ('startButton').textContent=started?'Continuar partida':'Jogar agora';$('restartButton').hidden=!started;$('gameFeatures').hidden=started;};
  const pause=()=>{if(!game||!started||destroyed)return;active=false;accumulator=0;clearInput();if(!overlay.hidden)return;setOverlay('NO SEU RITMO','Uma pausa para respirar','Sua aventura espera por você. Continue quando quiser.');void save.flush();};
  const complete=value=>{active=false;accumulator=0;clearInput();void finishSession('completed',value);report({...value,status:'won'});setOverlay('AVENTURA CONCLUÍDA','Você fez o mundo florescer!','Suas conquistas foram salvas. Você pode explorar a aventura novamente.');$('startButton').hidden=true;$('restartButton').hidden=false;$('restartButton').textContent='Jogar novamente';$('pauseButton').disabled=true;};
  await save.hydrate();
  if(save.online)refreshTimer=setInterval(()=>{if(!document.hidden)request('/api/children/me/refresh',{method:'POST',body:'{}'}).catch(error=>{if(error.status===401){save.online=false;notify('Sessão expirada. Progresso salvo neste aparelho; entre novamente no mundo kids.');}});},600000);
  const module=await import(`./modules/${id}.js`);metadata=module.metadata;
  $('gameTitle').textContent=metadata.title;document.title=`${metadata.title} · NeuroBloom`;$('playerTag').textContent=save.nickname?`✦ ${save.nickname}`:'✦ Escolha seu nickname no mundo kids';
  $('objective').textContent='Aventura pronta · '+FEATURES[id].join(' · ');
  $('overlayTitle').textContent=metadata.title;$('overlayDescription').textContent=metadata.description;
  $('gameFeatures').replaceChildren(...FEATURES[id].map(text=>{const span=document.createElement('span');span.textContent=text;return span;}));
  const movement=document.createElement('span');movement.innerHTML='<kbd>WASD / ↑↓←→</kbd>Mover';$('controlGuide').append(movement);
  for(const {action,label} of metadata.controls){const hint=document.createElement('span'),key=document.createElement('kbd');key.textContent=LABELS[action];hint.append(key,document.createTextNode(label));$('controlGuide').append(hint);const button=document.createElement('button');button.dataset.action=action;button.setAttribute('aria-label',label);const b=document.createElement('b'),small=document.createElement('small');b.textContent=LABELS[action];small.textContent=label;button.append(b,small);$('actionControls').append(button);}
  $('keyboardHint').textContent=`WASD / setas: mover · ${metadata.controls.map(c=>`${LABELS[c.action]}: ${c.label.split(' / ')[0]}`).join(' · ')} · Esc: pausa`;
  game=module.createGame({width:960,height:540,input,settings,audio,save,report,message:notify,complete});
  game.draw(ctx);report({title:metadata.title,level:game.getState().level||game.getState().player?.level||1,score:game.getState().score||0});
  $('startButton').disabled=false;$('startButton').textContent='Jogar agora';
  if(['won','completed'].includes(game.getState().status)||game.getState().quest?.completed){complete({score:game.getState().score||0});started=true;$('restartButton').textContent='Jogar novamente';}
  const begin=()=>{if(destroyed)return;audio.unlock();if(!started){started=true;if(save.online){session=new GameSession(request,id,sessionEnded);void session.start();}}active=true;overlay.hidden=true;clearInput();accumulator=0;lastTime=performance.now();$('pauseButton').disabled=false;$('pauseButton').textContent='Pausar';canvas.focus({preventScroll:true});};
  $('startButton').onclick=begin;
  $('pauseButton').onclick=()=>{if(overlay.hidden)pause();else if(!$('startButton').hidden)begin();};
  $('helpButton').onclick=()=>{if(!game)return;active=false;accumulator=0;clearInput();setOverlay('GUIA DO EXPLORADOR',metadata.title,metadata.description);$('gameFeatures').hidden=false;$('startButton').hidden=['won','completed'].includes(game.getState().status)||game.getState().quest?.completed;$('startButton').textContent=started?'Continuar partida':'Jogar agora';};
  $('restartButton').onclick=async()=>{const button=$('restartButton');button.disabled=true;await finishSession();session=null;started=false;metrics={};game.restart();$('startButton').hidden=false;button.textContent='Recomeçar aventura';button.disabled=false;begin();};
  $('soundToggle').onclick=()=>{settings.sound=!settings.sound;$('soundToggle').textContent=settings.sound?'Som: ligado':'Som: desligado';$('soundToggle').setAttribute('aria-pressed',String(settings.sound));audio.unlock();};
  document.querySelectorAll('[data-action]').forEach(button=>{button.addEventListener('pointerdown',event=>{if(!active)return;event.preventDefault();button.setPointerCapture(event.pointerId);input.set(`touch:${event.pointerId}`,button.dataset.action,true);button.classList.add('held');});const release=event=>{input.set(`touch:${event.pointerId}`,button.dataset.action,false);if(!input.down(button.dataset.action))button.classList.remove('held');};button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);button.addEventListener('contextmenu',event=>event.preventDefault());});
  window.addEventListener('keydown',event=>{if(event.code==='Escape'){if(active)pause();else if(started&&!$('startButton').hidden)begin();return;}const action=KEYS[event.code];if(action&&active){event.preventDefault();input.set(`key:${event.code}`,action,true);}});
  window.addEventListener('keyup',event=>{const action=KEYS[event.code];if(action){if(active)event.preventDefault();input.set(`key:${event.code}`,action,false);}});
  window.addEventListener('blur',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent)return;if(event.data?.type==='nb:pause')pause();if(event.data?.type==='nb:close')destroy();if(event.data?.type==='nb:nickname'&&typeof event.data.nickname==='string'){$('playerTag').textContent='✦ '+event.data.nickname.slice(0,40);save.nickname=event.data.nickname;}});
  window.addEventListener('online',()=>void save.flush());
  const resizeObserver=new ResizeObserver(()=>{if(window.parent!==window)window.parent.postMessage({type:'nb:resize',height:Math.ceil(arcade.getBoundingClientRect().height)},location.origin);});resizeObserver.observe(arcade);
  function destroy(){if(destroyed)return;destroyed=true;active=false;clearInput();cancelAnimationFrame(raf);clearTimeout(announcementTimer);clearInterval(refreshTimer);resizeObserver.disconnect();game.destroy?.();void save.flush({keepalive:true});void finishSession('ended',{},true);audio.destroy();}
  window.addEventListener('pagehide',destroy);
  function frame(now){if(destroyed)return;const delta=Math.max(0,Math.min(.1,(now-lastTime)/1000));lastTime=now;if(active){accumulator+=delta;let steps=0;while(accumulator>=1/60&&steps<6&&active){input.beginStep();game.update(1/60);session?.tick(1/60);input.endStep();accumulator-=1/60;steps++;}}else accumulator=0;game.draw(ctx);raf=requestAnimationFrame(frame);}
  lastTime=performance.now();raf=requestAnimationFrame(frame);
}

if(typeof document!=='undefined')bootstrap().catch(error=>{document.getElementById('overlayTitle').textContent='A aventura precisa de um instante';document.getElementById('overlayDescription').textContent='Não foi possível carregar o jogo. Atualize a página para tentar novamente.';console.error('Bloom Arcade initialization:',error.message);});
