export const metadata = { id:'platform', title:'Jardins de Aurora', description:'Explore três ilhas celestes, encontre cristais e liberte o farol dos jardins.', controls:[{action:'jump',label:'Pular'},{action:'attack',label:'Pulso'},{action:'special',label:'Pulso'}] };
export function createGame(runtime) { return createAdventure(runtime, false); }

// Both adventures share collision and drawing primitives, but have separate courses and rules.
export function createAdventure(r, speed=false) {
  const W=960,H=540,rand=(a,b)=>a+Math.random()*(b-a),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  let level=0,status='playing',score=0,coins=0,elapsed=0,levelTime=0,cam=0,t=0,hud=0,particles=[],shots=[],toast='',toastTime=0,energy=100,medals=[],deaths=0;
  let saved;try{saved=r.save?.load?.()||{};}catch{saved={};}
  const num=(v,a,b,d=0)=>Number.isFinite(v)?clamp(v,a,b):d;
  let best=num(saved.best,0,1e9);
  function persist(){r.save?.store?.({version:2,level,status,score,coins,elapsed,deaths,medals,checkpoint,levelTime,takenItems:items.flatMap((item,index)=>item.taken?[index]:[]),defeatedEnemies:enemies.flatMap((enemy,index)=>!enemy.alive?[index]:[]),best:Math.max(best,score)});}
  let platforms=[],items=[],enemies=[],springs=[],checks=[],goal=0,boss=null,checkpoint=null;
  const p={x:80,y:360,vx:0,vy:0,w:28,h:40,hp:3,ground:false,coyote:0,buffer:0,inv:0,facing:1,power:0,attack:0};
  const themes=[['#112c4d','#407f98','#94d5b3','#efc66e'],['#302b54','#98698c','#efaf92','#ffe8ab'],['#102e45','#43718e','#75d5cb','#ffd787']];
  function sound(name,f=440){if(r.settings?.sound!==false)r.audio?.play?.(name,{frequency:f,duration:.1,volume:.15});}
  function message(s){toast=s;toastTime=3;r.message?.(s);}
  function burst(x,y,color,n=12){if(r.settings?.reducedMotion)return;for(let i=0;i<n;i++)particles.push({x,y,vx:rand(-120,120),vy:rand(-170,40),life:rand(.3,.7),color});}
  function platform(x,y,w,h=32,moving=false){platforms.push({x,y,w,h,baseX:x,baseY:y,moving,dx:0,dy:0});}
  function item(x,y,type='coin'){items.push({x,y,type,taken:false});}
  function build(){
    platforms=[];items=[];enemies=[];springs=[];checks=[];shots=[];particles=[];boss=null;levelTime=0;energy=100;
    const span=speed?5600+level*600:3300+level*420;goal=span-160;
    const stride=speed?[560,700,640][level]:[470,510,550][level];
    for(let x=0,i=0;x<span;x+=stride,i++){
      const width=speed?[510,600,490][level]:[390,410,425][level];
      const floor=level===1&&i%3===1?425:460;
      platform(x,floor,width,120);
      if(level===2&&i%2===1){platform(x+25,205,speed?300:180,20,!speed);for(let j=0;j<5;j++)item(x+45+j*32,166,'gem');}
      if(speed&&level===1){platform(x+340,230,220,20);springs.push({x:x+190,y:338,w:34,h:12});}
      if(speed&&level===2){platform(x+420,310,160,20);springs.push({x:x+460,y:298,w:34,h:12});}
      if(i>0){platform(x+65,350,speed?220:120,22);platform(x+255,275,speed?180:110,22,!speed&&i%2===1);}
      for(let j=0;j<(speed?7:4);j++)item(x+110+j*(speed?50:48),floor-46);
      if(i>0){for(let j=0;j<3;j++)item(x+90+j*40,307);item(x+290,228,i%3===0?'power':'gem');}
      if(i>0)enemies.push({x:x+160,y:floor-32,base:x+160,vx:0,w:32,h:30,alive:true,phase:i});
      if(speed)springs.push({x:x+width-70,y:floor-12,w:34,h:12});
      if(i===2||i===5||i===8)checks.push({x:x+30,y:floor,active:false});
      // Stepping stones bridge wide gaps while preserving a lower and an upper route.
      platform(x+width-20,380,speed?150:95,18,!speed);
    }
    platform(span-420,460,480,100);
    if(!speed&&level===2)boss={x:span-260,y:390,w:70,h:70,hp:5,inv:0,clock:0};
    checkpoint={x:70,y:390};resetPlayer();
    message(`${level+1}/3 · ${speed?['Ventos do Pomar','Aquedutos Âmbar','Estrada das Estrelas'][level]:['Jardim Suspenso','Bosque do Crepúsculo','Farol Ancestral'][level]}`);
  }
  function resetPlayer(){Object.assign(p,{x:checkpoint.x,y:checkpoint.y,vx:0,vy:0,hp:3,ground:false,coyote:0,buffer:0,inv:1.4,power:0,attack:0});}
  function damage(){if(p.inv>0||status!=='playing')return;p.inv=1.5;burst(p.x,p.y,'#ffe580',18);sound('hurt',150);if(speed&&coins>0){coins=Math.max(0,coins-10);p.vx=-p.facing*210;p.vy=-230;return;}p.hp--;p.vy=-240;if(p.hp<=0)die();}
  function die(){deaths++;coins=speed?0:coins;score=Math.max(0,score-100);resetPlayer();persist();message('De volta ao marco · tente outra rota!');}
  const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  function finish(){
    if(speed)medals.push(levelTime<(goal/260)?'Ouro':levelTime<(goal/170)?'Prata':'Bronze');
    score+=1000+Math.max(0,Math.floor(180-levelTime)*5);sound('win',880);
    if(level<2){level++;build();persist();}else{status='won';persist();r.complete?.({score,stars:deaths===0?3:deaths<5?2:1,medals,elapsed});}
  }
  function update(dt){if(!Number.isFinite(dt)||dt<=0)return;
    if(status!=='playing')return;dt=Math.min(dt,.04);t+=dt;elapsed+=dt;levelTime+=dt;toastTime-=dt;p.inv-=dt;p.attack-=dt;p.power-=dt;
    const axis=r.input.axis('x'),jump=r.input.pressed('jump'),held=r.input.down('jump');
    if(jump)p.buffer=.14;else p.buffer-=dt;
    if(p.ground)p.coyote=.12;else p.coyote-=dt;
    const boost=speed&&r.input.down('dash')&&energy>0&&Math.abs(axis)>.1;
    energy=clamp(energy+(boost?-32:18)*dt,0,100);
    if(speed&&r.input.down('down'))p.vx*=Math.pow(.00001,dt);
    const max=speed?(boost?760:460):(p.power>0?295:250),acc=speed?650:1700;
    if(axis){p.vx=clamp(p.vx+axis*acc*dt,-max,max);p.facing=axis>0?1:-1;}else p.vx*=Math.pow(speed?.18:.0005,dt);
    if(p.buffer>0&&p.coyote>0){p.vy=speed?-545:-580;p.buffer=0;p.coyote=0;p.ground=false;sound('jump',550);burst(p.x+14,p.y+40,'#d1ffff',5);}
    if(!held&&p.vy<-220)p.vy+=1500*dt;
    if(!speed&&(r.input.pressed('attack')||r.input.pressed('special'))&&p.attack<=0){p.attack=.35;shots.push({x:p.x+14,y:p.y+18,vx:p.facing*620,life:.65});sound('pulse',700);}
    for(const q of platforms){const ox=q.x,oy=q.y;if(q.moving){q.x=q.baseX+Math.sin(t*1.2+q.baseX)*45;q.y=q.baseY+Math.sin(t+q.baseX)*22;}q.dx=q.x-ox;q.dy=q.y-oy;}
    const oldY=p.y;p.vy=Math.min(900,p.vy+1450*dt);p.x=clamp(p.x+p.vx*dt,0,goal+150);p.y+=p.vy*dt;p.ground=false;
    for(const q of platforms){if(p.x+p.w>q.x&&p.x<q.x+q.w&&p.vy>=0&&oldY+p.h<=q.y-q.dy+7&&p.y+p.h>=q.y){p.y=q.y-p.h;p.vy=0;p.ground=true;p.x+=q.dx;}}
    if(p.y>H+170)die();
    for(const c of checks)if(p.x>c.x&&!c.active){c.active=true;checkpoint={x:c.x+12,y:c.y-p.h};p.hp=3;persist();message('Marco ativado · energia restaurada');sound('checkpoint',740);}
    for(const q of items)if(!q.taken&&Math.hypot(p.x+14-q.x,p.y+20-q.y)<34){q.taken=true;score+=q.type==='gem'?100:25;if(q.type==='power'){p.power=12;p.hp=Math.min(3,p.hp+1);energy=100;message(speed?'Núcleo solar · turbo restaurado':'Aura floral · pulso ampliado');}else coins+=q.type==='gem'?5:1;burst(q.x,q.y,q.type==='gem'?'#bb90ff':'#ffe798',6);sound('coin',900);}
    for(const s of springs)if(overlap(p,s)&&p.vy>=0){p.vy=-790;p.ground=false;sound('spring',1000);burst(s.x,s.y,'#ff93bb');}
    for(const e of enemies){if(!e.alive)continue;e.x=e.base+Math.sin(t*1.4+e.phase)*65;if(overlap(p,e)){if((p.vy>30&&oldY+p.h<e.y+17)||boost){e.alive=false;p.vy=-380;score+=150;burst(e.x,e.y,'#ffbf8b');sound('stomp',300);}else damage();}}
    for(const s of shots){s.x+=s.vx*dt;s.life-=dt;for(const e of enemies)if(e.alive&&Math.abs(s.x-e.x-16)<25&&Math.abs(s.y-e.y-15)<35){e.alive=false;s.life=0;score+=150;burst(e.x,e.y,'#e0bcff');}if(boss&&boss.hp>0&&boss.inv<=0&&s.x>boss.x-8&&s.x<boss.x+boss.w+8&&s.y>boss.y-10&&s.y<boss.y+boss.h){boss.hp--;boss.inv=.6;s.life=0;burst(boss.x+35,boss.y+30,'#d3f39f',24);score+=200;}}
    shots=shots.filter(s=>s.life>0);
    if(boss&&boss.hp>0){boss.inv-=dt;boss.clock+=dt;boss.x=goal-100+Math.sin(t)*65;boss.y=390-Math.max(0,Math.sin(boss.clock*2))*70;if(overlap(p,boss)){if(p.vy>40&&oldY+p.h<boss.y+20&&boss.inv<=0){boss.hp--;boss.inv=.8;p.vy=-550;score+=200;}else damage();}}
    for(const q of particles){q.life-=dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.vy+=400*dt;}particles=particles.filter(q=>q.life>0);
    const target=clamp(p.x-W*.34+(speed?p.vx*.22:0),0,goal-W+220);cam+=(target-cam)*Math.min(1,dt*6);
    if(p.x>goal&&(!boss||boss.hp<=0))finish();
    hud-=dt;if(hud<=0){hud=.2;r.report?.({title:speed?'Rastro Solar':'Jardins de Aurora',score,level:level+1,health:p.hp,energy:Math.round(energy),coins,status,message:speed?`${levelTime.toFixed(1)} s · ${Math.round(Math.abs(p.vx))} km/h`:'Encontre o farol →'});}
  }
  function ellipse(ctx,x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
  function draw(ctx){
    const [sky,mountain,leaf,gold]=themes[level];ctx.save();const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,sky);grad.addColorStop(1,mountain);ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
    ellipse(ctx,740-cam*.035,95,49,49,gold);ellipse(ctx,725-cam*.035,83,49,49,sky);
    for(let layer=0;layer<3;layer++){ctx.fillStyle=layer===0?'#ffffff09':layer===1?'#17354d70':'#102c3d90';for(let i=-1;i<14;i++){let x=i*240-((cam*(.12+layer*.14))%240);ctx.beginPath();ctx.moveTo(x,540);ctx.lineTo(x+40,260+layer*55);ctx.bezierCurveTo(x+75,160+layer*70,x+140,180+layer*55,x+180,340);ctx.lineTo(x+270,540);ctx.fill();if(layer===2){ctx.fillStyle='#bddfa712';ellipse(ctx,x+90,330,80,40,'#bddfa712');ctx.fillStyle='#102c3d90';}}}
    for(let i=0;i<18;i++)ellipse(ctx,((i*149-cam*.22)%1050+1050)%1050,80+(i*71)%310,2,2,'#eaffcb60');
    ctx.translate(-cam,0);
    for(const q of platforms){if(q.x+q.w<cam-80||q.x>cam+W+80)continue;ctx.fillStyle=q.moving?'#77677c':'#3d5360';ctx.fillRect(q.x,q.y,q.w,q.h);ctx.fillStyle='#243e4c';ctx.fillRect(q.x,q.y+14,q.w,q.h-14);ctx.fillStyle=leaf;ctx.fillRect(q.x,q.y,q.w,7);ctx.fillStyle='#e1f7d8';ctx.fillRect(q.x,q.y,q.w,2);for(let x=q.x+10;x<q.x+q.w;x+=29){ctx.fillStyle='#57747a';ctx.fillRect(x,q.y+23,17,6);ctx.strokeStyle=leaf;ctx.beginPath();ctx.moveTo(x,q.y);ctx.quadraticCurveTo(x-5,q.y-12,x+3,q.y-17);ctx.stroke();}if(q.moving){ellipse(ctx,q.x+q.w/2,q.y+28,13,5,'#b6efff80');}}
    for(const c of checks){ctx.strokeStyle='#c9eae7';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(c.x,c.y);ctx.lineTo(c.x,c.y-100);ctx.stroke();ctx.fillStyle=c.active?'#aff8b0':'#7292a7';ctx.beginPath();ctx.moveTo(c.x,c.y-98);ctx.lineTo(c.x+36,c.y-85+Math.sin(t*4)*3);ctx.lineTo(c.x,c.y-68);ctx.fill();}
    for(const q of items){if(q.taken||q.x<cam-30||q.x>cam+W+30)continue;const yy=q.y+Math.sin(t*3+q.x)*4;ctx.save();ctx.translate(q.x,yy);if(q.type==='coin'){ctx.strokeStyle=gold;ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,0,Math.max(3,Math.abs(Math.cos(t*2+q.x)) *9),11,0,0,Math.PI*2);ctx.stroke();}else{ctx.rotate(Math.PI/4);ctx.fillStyle=q.type==='power'?'#9cfbcf':'#d4b1ff';ctx.fillRect(-9,-9,18,18);ctx.strokeStyle='#ffffff';ctx.strokeRect(-5,-5,10,10);}ctx.restore();}
    for(const s of springs){ctx.fillStyle='#ed83b4';ctx.fillRect(s.x,s.y,s.w,6);ctx.strokeStyle='#fff0bb';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(s.x+6,s.y+12);ctx.lineTo(s.x+26,s.y+8);ctx.lineTo(s.x+6,s.y+5);ctx.stroke();}
    for(const e of enemies){if(!e.alive)continue;ellipse(ctx,e.x+16,e.y+30,21,5,'#00000035');ellipse(ctx,e.x+16,e.y+14,19,14,'#ca7189');ellipse(ctx,e.x+16,e.y+7,15,8,'#eda392');ctx.fillStyle='#172e45';ctx.fillRect(e.x+8,e.y+10,5,5);ctx.fillRect(e.x+21,e.y+10,5,5);ctx.strokeStyle='#ebc088';ctx.lineWidth=3;for(let j=0;j<3;j++){ctx.beginPath();ctx.moveTo(e.x+j*13,e.y+23);ctx.lineTo(e.x+j*13+Math.sin(t*9+j)*5,e.y+32);ctx.stroke();}}
    if(boss&&boss.hp>0){ctx.save();ctx.translate(boss.x+35,boss.y+35);for(let i=0;i<6;i++){ctx.save();ctx.rotate(i*Math.PI/3+t*.3);ellipse(ctx,0,-32,18,28,boss.inv>0?'#efd5aa':'#bb88c5');ctx.restore();}ellipse(ctx,0,0,31,31,'#445a6d');ellipse(ctx,-10,-3,5,7,'#fff3aa');ellipse(ctx,10,-3,5,7,'#fff3aa');ctx.fillStyle='#151f3c';ctx.fillRect(-38,-65,76,8);ctx.fillStyle='#efafcc';ctx.fillRect(-38,-65,76*boss.hp/5,8);ctx.restore();}
    // Little guardian: scarf, swept hair, articulated feet and a luminous face.
    ctx.save();ctx.translate(p.x+14,p.y+20);ctx.scale(p.facing,1);if(p.inv>0)ctx.globalAlpha=.65;const run=p.ground?Math.sin(t*(speed?22:14))*Math.min(1,Math.abs(p.vx)/130):.5;
    ellipse(ctx,0,24,19,4,'#00000030');ctx.fillStyle=speed?'#ffc768':'#eb8fa8';ctx.beginPath();ctx.moveTo(-8,-10);ctx.quadraticCurveTo(-30,-12+Math.sin(t*12)*7,-35,-3);ctx.lineTo(-9,-1);ctx.fill();
    ctx.strokeStyle='#263b59';ctx.lineWidth=8;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-5,10);ctx.lineTo(-8+run*7,20);ctx.moveTo(5,10);ctx.lineTo(8-run*7,20);ctx.stroke();ellipse(ctx,-8+run*7,20,7,4,'#fff1cc');ellipse(ctx,8-run*7,20,7,4,'#fff1cc');ellipse(ctx,0,2,12,15,speed?'#53c2d3':'#88c4ab');ellipse(ctx,0,-14,14,13,'#ffdcaf');
    ctx.fillStyle=speed?'#d76777':'#596c96';ctx.beginPath();ctx.moveTo(-14,-8);ctx.lineTo(-19,-22);ctx.lineTo(-7,-20);ctx.lineTo(-11,-31);ctx.lineTo(7,-25);ctx.lineTo(14,-15);ctx.lineTo(1,-17);ctx.closePath();ctx.fill();ellipse(ctx,7,-13,2.3,3.3,'#183147');ctx.strokeStyle='#ffdcaf';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(8,-1);ctx.lineTo(15,5-run*5);ctx.stroke();if(p.power>0){ctx.strokeStyle='#bfffe280';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,-2,32,0,Math.PI*2);ctx.stroke();}ctx.restore();
    for(const s of shots){ellipse(ctx,s.x,s.y,13,7,'#b5ffe1');ellipse(ctx,s.x,s.y,6,4,'#ffffff');}
    for(const q of particles){ctx.globalAlpha=Math.max(0,q.life);ctx.fillStyle=q.color;ctx.fillRect(q.x,q.y,4,4);}ctx.globalAlpha=1;
    ctx.fillStyle='#bfebe2';ctx.fillRect(goal,330,6,130);ctx.strokeStyle=gold;ctx.lineWidth=7;ctx.beginPath();ctx.arc(goal+3,325,28,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff1cc';ctx.font='bold 13px system-ui';ctx.fillText(boss?.hp>0?'LIBERTE O FAROL':'CHEGADA',goal-40,278);
    ctx.restore();ctx.save();ctx.fillStyle='#0a1836c9';ctx.fillRect(18,18,speed?300:270,62);ctx.fillStyle='#f6e7b1';ctx.font='bold 18px system-ui';ctx.fillText(`${speed?'◉':'✦'} ${coins}    ${'♥'.repeat(p.hp)}    ${level+1}/3`,32,44);ctx.font='12px system-ui';ctx.fillStyle='#c9ece8';ctx.fillText(speed?`TEMPO ${levelTime.toFixed(1)}s  ·  TURBO ${Math.round(energy)}%`:`PULSO: J / L  ·  ${score} pontos`,32,66);
    if(speed){ctx.fillStyle='#193d55';ctx.fillRect(340,26,160,9);ctx.fillStyle='#ffcc71';ctx.fillRect(340,26,energy*1.6,9);}
    if(toastTime>0){ctx.font='bold 16px system-ui';const tw=ctx.measureText(toast).width;ctx.fillStyle='#102139dc';ctx.fillRect((W-tw)/2-20,98,tw+40,42);ctx.fillStyle='#f4efd5';ctx.fillText(toast,(W-tw)/2,125);}
    if(status==='won'){ctx.fillStyle='#101f39d9';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.fillStyle='#ffe3a3';ctx.font='bold 38px system-ui';ctx.fillText(speed?'O SOL CORRE COM VOCÊ':'O JARDIM VOLTOU A FLORESCER',W/2,230);ctx.font='20px system-ui';ctx.fillText(`${score} pontos · ${coins} ${speed?'anéis':'cristais'}`,W/2,279);if(speed)ctx.fillText(medals.join('  ·  '),W/2,315);}ctx.restore();
  }
  function restart(){level=0;status='playing';score=0;coins=0;elapsed=0;t=0;cam=0;deaths=0;medals=[];build();persist();}
  function getState(){return {status,level:level+1,score,coins,elapsed,levelTime,energy,deaths,medals:[...medals],player:{...p},checkpoint:{...checkpoint},goal,boss:boss?{...boss}:null,platforms:platforms.map(q=>({...q})),enemies:enemies.map(q=>({...q})),springs:springs.map(q=>({...q})),remainingItems:items.filter(q=>!q.taken).length};}
  level=Math.floor(num(saved.level,0,2));score=num(saved.score,0,1e9);coins=Math.floor(num(saved.coins,0,1e6));elapsed=num(saved.elapsed,0,1e7);deaths=Math.floor(num(saved.deaths,0,1e6));medals=Array.isArray(saved.medals)?saved.medals.filter(x=>['Ouro','Prata','Bronze'].includes(x)).slice(0,3):[];
  build();levelTime=num(saved.levelTime,0,1e7);
  const restoreIndexes=(value,list,apply)=>{if(!Array.isArray(value))return;for(const index of value.slice(0,list.length))if(Number.isInteger(index)&&index>=0&&index<list.length)apply(list[index]);};
  restoreIndexes(saved.takenItems,items,item=>{item.taken=true;});restoreIndexes(saved.defeatedEnemies,enemies,enemy=>{enemy.alive=false;});
  if(saved.status!=='won'&&saved.checkpoint&&Number.isFinite(saved.checkpoint.x)&&Number.isFinite(saved.checkpoint.y)){const q=checks.find(c=>Math.abs(c.x+12-saved.checkpoint.x)<2);if(q){checkpoint={x:q.x+12,y:q.y-p.h};for(const c of checks)c.active=c.x<=q.x;resetPlayer();}}
  if(saved.status==='won')status='won';
  return {update,draw,getState,restart,destroy:persist};
}
