export const metadata = { id: 'sword', title: 'Espada da Aurora', description: 'Explore o bosque, liberte três cristais e salve a guardiã da Aurora.', controls: [{action:'attack',label:'Espada'},{action:'dash',label:'Esquiva'},{action:'guard',label:'Escudo'},{action:'interact',label:'Usar'},{action:'special',label:'Poção'}] };

const W=2000,H=1500, TAU=Math.PI*2;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const crystalSpots=[{x:510,y:340},{x:1460,y:400},{x:1500,y:1130}];
const home={x:270,y:790};
export function createGame(runtime){
 let saved;try{saved=runtime.save.load()||{};}catch{saved={};}
 let p, enemies,crystals,loot,particles,clock=0,camera={x:0,y:0},objective='',boss,won=false,reportTime=0,toast='',toastTime=0,tutorial=18,combo=0,comboTime=0,attackTime=0,deathTime=0,checkpoint={...home};
 const sound=(name,f=440)=>{try{runtime.audio?.play(name,{frequency:f,duration:.09,volume:.14});}catch{}};
 const say=t=>{toast=t;toastTime=4;runtime.message?.(t);};
 function save(){runtime.save.store({version:1,level:p.level,xp:p.xp,coins:p.coins,potions:p.potions,upgrade:p.upgrade,crystals:crystals.map(c=>c.done),checkpoint,completed:won});}
 function reset(useSave=true){
  const raw=useSave&&saved?.version===1?saved:{};const num=(v,d,a,b)=>Number.isFinite(v)?clamp(Math.floor(v),a,b):d;
  const s={level:num(raw.level,1,1,30),xp:num(raw.xp,0,0,1799),coins:num(raw.coins,0,0,99999),potions:num(raw.potions,3,0,99),upgrade:num(raw.upgrade,0,0,4),crystals:Array.isArray(raw.crystals)?raw.crystals.map(v=>v===true):[]};
  const cp=raw.checkpoint;if(cp&&Number.isFinite(cp.x)&&Number.isFinite(cp.y)&&!blocked(cp.x,cp.y))s.checkpoint={x:cp.x,y:cp.y};
  p={x:home.x,y:home.y,hp:100,maxHp:100,energy:100,level:s.level||1,xp:s.xp||0,coins:s.coins||0,potions:s.potions??3,upgrade:s.upgrade||0,face:0,inv:0,dash:0,dashCd:0,hit:0};p.maxHp=90+p.level*10;p.hp=p.maxHp;
  checkpoint=s.checkpoint||{...home};p.x=checkpoint.x;p.y=checkpoint.y;
  crystals=crystalSpots.map((c,i)=>({...c,done:!!s.crystals?.[i]}));
  enemies=[];loot=[];particles=[];won=false;deathTime=0;attackTime=0;comboTime=0;combo=0;clock=0;tutorial=18;
  crystalSpots.forEach((c,i)=>{if(crystals[i].done)return;for(let j=0;j<3;j++){const angle=j*TAU/3;enemies.push(mob(c.x+Math.cos(angle)*115,c.y+Math.sin(angle)*100,j===2?'archer':j===1?'brute':'slime',i));}});
  enemies.push(mob(670,830,'slime',-1),mob(1230,775,'brute',-1));
  boss=mob(1770,700,'boss',3);boss.hp=boss.maxHp=460;boss.active=false;boss.phase=1;enemies.push(boss);if(raw.completed===true&&crystals.every(c=>c.done)){won=true;boss.hp=0;}
 }
 function mob(x,y,type,group){return{x,y,sx:x,sy:y,type,group,hp:type==='brute'?95:type==='archer'?55:65,maxHp:type==='brute'?95:type==='archer'?55:65,r:type==='brute'?23:type==='boss'?40:18,mode:'idle',timer:Math.random()*.8,cd:1,face:0,hit:0,active:true,attackId:0};}
 function burst(x,y,color,n=12){for(let i=0;i<n;i++){const a=Math.random()*TAU;particles.push({x,y,vx:Math.cos(a)*(30+Math.random()*110),vy:Math.sin(a)*(30+Math.random()*110),life:.4+Math.random()*.4,color});}}
 function blocked(x,y,r=15){if(x<r||y<r||x>W-r||y>H-r)return true; if(x>900-r&&x<1030+r && !(y>660+r&&y<880-r))return true; return x>120-r&&x<290+r&&y>580-r&&y<695+r;}
 function move(o,dx,dy){if(!blocked(o.x+dx,o.y,o.r||13))o.x+=dx;if(!blocked(o.x,o.y+dy,o.r||13))o.y+=dy;}
 function hurt(damage,source){if(p.inv>0||p.hp<=0)return;let guarding=runtime.input.down('guard')&&p.energy>18;const toward=Math.atan2(source.y-p.y,source.x-p.x);if(guarding&&Math.cos(toward-p.face)>.05){damage*=.15;p.energy=Math.max(0,p.energy-22);burst(p.x,p.y,'#b7f9ff');sound('guard',650);}else{p.inv=.65;p.hit=.25;sound('hurt',160);}p.hp=Math.max(0,p.hp-damage);if(!p.hp){deathTime=2;say('A luz do santuário está trazendo você de volta…');}}
 function award(e){burst(e.x,e.y,'#ffe08a',20);loot.push({x:e.x,y:e.y,type:'coin',value:e.type==='boss'?100:12});p.xp+=e.type==='boss'?180:30;if(Math.random()<.22)loot.push({x:e.x+18,y:e.y,type:'potion',value:1});while(p.xp>=p.level*60){p.xp-=p.level*60;p.level++;p.maxHp=90+p.level*10;p.hp=p.maxHp;say(`Nível ${p.level}! Mais vida e força.`);burst(p.x,p.y,'#d8b4ff',30);}sound('coin',800);save();}
 function strike(){if(attackTime>0||p.dash>0||p.energy<12)return;combo=comboTime>0?combo%3+1:1;comboTime=.8;attackTime=.26;p.energy-=12;const reach=combo===3?112:90;enemies.forEach(e=>{if(e.hp<=0||!e.active)return;const a=Math.atan2(e.y-p.y,e.x-p.x);if(distance(e,p)<reach+e.r&&Math.cos(a-p.face)>(combo===3?-.2:.05)){e.hp-=22+p.level*4+p.upgrade*7+(combo===3?15:0);e.hit=.22;const k=e.type==='boss'?5:16;move(e,Math.cos(a)*k,Math.sin(a)*k);burst(e.x,e.y,'#fff4ba',8);if(e.hp<=0)award(e);}});sound('attack',combo===3?300:480);}
 function interact(){const near=crystals.find(c=>!c.done&&distance(c,p)<100);if(near){if(enemies.some(e=>e.group===crystals.indexOf(near)&&e.hp>0)){say('Afaste os sentinelas para libertar este cristal.');return;}near.done=true;checkpoint={x:near.x,y:near.y+50};p.hp=p.maxHp;p.potions++;burst(near.x,near.y,'#8effea',40);say('Cristal livre! Santuário ativado e uma poção recebida.');save();return;}
  if(distance(p,home)<115){p.hp=p.maxHp;p.energy=100;checkpoint={...home};const cost=40+p.upgrade*35;if(p.coins>=cost&&p.upgrade<4){p.coins-=cost;p.upgrade++;say(`Espada aprimorada! Força +7. Próximo: ${40+p.upgrade*35} moedas.`);}else say(`Vida recuperada. Aprimorar espada: ${cost} moedas.`);save();return;}
  if(boss.hp<=0&&distance(p,{x:1835,y:690})<120&&!won){won=true;say('Você salvou Luma! A Aurora voltou ao bosque.');save();runtime.complete({score:p.coins+p.level*100+600,stars:3});}
 }
 function enemyUpdate(e,dt){if(e.hp<=0||!e.active)return;e.hit=Math.max(0,e.hit-dt);e.cd-=dt;const d=distance(e,p);if(d>360&&e.mode==='idle')return;
  if(e.mode==='windup'){e.timer-=dt;if(e.timer<=0){e.mode='recover';e.timer=e.type==='boss'?1.1:.8;const range=e.type==='boss'?e.phase===2?170:135:e.type==='brute'?95:66;if(e.type==='archer'){loot.push({x:e.x,y:e.y,vx:Math.cos(e.face)*240,vy:Math.sin(e.face)*240,type:'bolt',life:2});}else if(distance(e,p)<range&&Math.cos(Math.atan2(p.y-e.y,p.x-e.x)-e.face)>-.1)hurt(e.type==='boss'?25:e.type==='brute'?20:12,e);burst(e.x+Math.cos(e.face)*range*.6,e.y+Math.sin(e.face)*range*.6,'#ffc79f',10);}return;}
  if(e.mode==='recover'){e.timer-=dt;if(e.timer<=0){e.mode='idle';e.cd=.65;}return;}
  e.face=Math.atan2(p.y-e.y,p.x-e.x);const range=e.type==='archer'?265:e.type==='boss'?130:e.type==='brute'?90:60;
  if(d<range&&e.cd<=0){e.mode='windup';e.timer=e.type==='boss'?.95:e.type==='brute'?.85:e.type==='archer'?.9:.65;return;}
  const speed=e.type==='boss'?(e.phase===2?82:58):e.type==='brute'?42:e.type==='archer'?54: seventy();if(d>range*.8)move(e,Math.cos(e.face)*speed*dt,Math.sin(e.face)*speed*dt);else if(e.type==='archer'&&d<135)move(e,-Math.cos(e.face)*speed*dt,-Math.sin(e.face)*speed*dt);
 }
 function seventy(){return 70;}
 function update(dt){if(!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.05);clock+=dt;toastTime-=dt;tutorial-=dt;if(won)return;
  if(deathTime>0){deathTime-=dt;if(deathTime<=0){p.x=checkpoint.x;p.y=checkpoint.y;p.hp=p.maxHp;p.energy=100;p.inv=2;p.potions=Math.max(1,p.potions);enemies.forEach(e=>{if(e.hp>0){e.x=e.sx;e.y=e.sy;e.hp=e.maxHp;e.mode='idle';e.cd=1;}});say('De volta ao santuário. Seu progresso foi preservado!');}return;}
  p.inv=Math.max(0,p.inv-dt);p.hit=Math.max(0,p.hit-dt);p.dashCd=Math.max(0,p.dashCd-dt);p.dash=Math.max(0,p.dash-dt);comboTime-=dt;attackTime=Math.max(0,attackTime-dt);
  let ax=runtime.input.axis('x'),ay=runtime.input.axis('y');let length=Math.hypot(ax,ay);if(length>0){ax/=Math.max(1,length);ay/=Math.max(1,length);if(!p.dash)p.face=Math.atan2(ay,ax);}
  if(runtime.input.pressed('dash')&&p.dashCd<=0&&p.energy>=25){p.energy-=25;p.dash=.2;p.inv=.28;p.dashCd=.85;burst(p.x,p.y,'#d1efff',8);}
  const guarding=runtime.input.down('guard');p.energy=clamp(p.energy+dt*(guarding?5:24),0,100);const speed=guarding?85:175;if(p.dash>0)move(p,Math.cos(p.face)*570*dt,Math.sin(p.face)*570*dt);else move(p,ax*speed*dt,ay*speed*dt);
  if(runtime.input.pressed('attack'))strike();if(runtime.input.pressed('interact'))interact();if(runtime.input.pressed('special')&&p.potions>0&&p.hp<p.maxHp){p.potions--;p.hp=Math.min(p.maxHp,p.hp+65);burst(p.x,p.y,'#8dffc1',24);say('Poção: +65 de vida.');save();}
  const count=crystals.filter(c=>c.done).length;boss.active=count===3;if(boss.hp<boss.maxHp*.5)boss.phase=2;enemies.forEach(e=>enemyUpdate(e,dt));
  for(const item of loot){if(item.type==='bolt'){item.x+=item.vx*dt;item.y+=item.vy*dt;item.life-=dt;if(blocked(item.x,item.y,4))item.life=0;if(distance(item,p)<22){hurt(13,item);item.life=0;}}else if(distance(item,p)<40){if(item.type==='coin')p.coins+=item.value;else p.potions++;item.life=0;sound('coin',980);save();}}
  loot=loot.filter(l=>l.life!==0&&(l.life===undefined||l.life>0));particles.forEach(a=>{a.life-=dt;a.x+=a.vx*dt;a.y+=a.vy*dt;});particles=particles.filter(a=>a.life>0);
  camera.x=clamp(p.x-480,0,W-960);camera.y=clamp(p.y-270,0,H-540);
  objective=boss.hp<=0?'Encontre Luma na torre e use Interagir':count===3?'Atravesse o bosque e enfrente o Guardião da Névoa':`Liberte os cristais: ${count}/3 • derrote sentinelas e interaja`;
  reportTime-=dt;if(reportTime<=0){reportTime=.25;runtime.report({title:'Espada da Aurora',message:objective,score:p.coins+p.level*100,level:p.level,health:Math.ceil(p.hp),energy:Math.round(p.energy),coins:p.coins,status:deathTime>0?'Voltando ao santuário':'Explorando'});}
 }
 function draw(ctx){const c=ctx;c.save();c.fillStyle='#183e37';c.fillRect(0,0,960,540);c.translate(-camera.x,-camera.y);
  c.fillStyle='#367a54';c.fillRect(0,0,W,H);for(let y=0;y<H;y+=44)for(let x=0;x<W;x+=44){const k=Math.sin(x*12+y*7);c.fillStyle=k>.2?'#43865a':'#32734d';c.fillRect(x+14+k*8,y+15,3,7);if(k>.8){c.fillStyle='#f4d78c';c.fillRect(x+20,y+20,3,3);}}
  c.strokeStyle='#b1a06a';c.lineWidth=88;c.lineCap='round';c.beginPath();c.moveTo(250,790);c.lineTo(1750,790);c.lineTo(1780,690);c.moveTo(550,790);c.lineTo(510,350);c.moveTo(1420,790);c.lineTo(1460,400);c.moveTo(1430,790);c.lineTo(1500,1130);c.stroke();
  c.fillStyle='#236d83';c.fillRect(900,0,130,H);for(let y=0;y<H;y+=35){c.strokeStyle='#5aabb4';c.lineWidth=2;c.beginPath();c.moveTo(913,y+Math.sin(clock+y)*4);c.lineTo(951,y+3);c.moveTo(982,y+15);c.lineTo(1018,y+15);c.stroke();}c.fillStyle='#94673d';c.fillRect(882,660,166,220);for(let y=663;y<880;y+=18){c.fillStyle='#c99a62';c.fillRect(882,y,166,13);}c.fillStyle='#63452f';c.fillRect(880,654,170,8);c.fillRect(880,879,170,8);
  for(let i=0;i<65;i++){let x=45+(i*283)%1900,y=55+(i*431)%1380;if(x>820&&x<1100||y>600&&y<920||crystalSpots.some(s=>Math.hypot(x-s.x,y-s.y)<180)||Math.hypot(x-1780,y-690)<210)continue;tree(c,x,y);}
  c.fillStyle='#655c59';c.fillRect(120,590,170,100);c.fillStyle='#e2c39b';c.fillRect(130,600,150,80);c.fillStyle='#804b45';c.beginPath();c.moveTo(103,600);c.lineTo(205,526);c.lineTo(305,600);c.fill();c.fillStyle='#493c42';c.fillRect(192,636,30,44);c.fillStyle='#ffdfa0';c.fillRect(146,620,25,26);label(c,'FERGE DE L’AURORE'.replace('FERGE DE L’AURORE','FORJA DA AURORA'),205,711,13);
  c.fillStyle='#75978a';c.beginPath();c.ellipse(home.x,home.y+10,55,28,0,0,TAU);c.fill();c.strokeStyle='#a6ffda';c.lineWidth=3;c.stroke();label(c,'Santuário • Usar para curar / aprimorar',home.x,home.y+60,13);
  crystals.forEach((s,i)=>{c.fillStyle='#718e85';c.beginPath();c.ellipse(s.x,s.y+18,44,22,0,0,TAU);c.fill();c.save();c.translate(s.x,s.y-10+Math.sin(clock*2+i)*5);c.fillStyle=s.done?'#97ffe0':'#baacff';c.shadowColor=c.fillStyle;c.shadowBlur=22;c.beginPath();c.moveTo(0,-30);c.lineTo(18,0);c.lineTo(0,25);c.lineTo(-18,0);c.closePath();c.fill();c.restore();label(c,s.done?'Santuário ativo':`Cristal ${i+1}`,s.x,s.y+56,14);if(distance(s,p)<100&&!s.done)label(c,'Usar para libertar',s.x,s.y-60,14);});
  c.fillStyle='#667689';c.fillRect(1800,540,95,165);c.fillStyle='#8899a9';for(let i=0;i<4;i++)c.fillRect(1796+i*28,521,18,29);c.fillStyle='#283f53';c.fillRect(1824,638,45,67);if(boss.hp<=0){hero(c,1835,690,0,'#fbd1ff');label(c,'Luma • Usar para resgatar',1820,740,14);}else label(c,crystals.every(s=>s.done)?'Guardião da Névoa':'Torre selada • 3 cristais',1780,500,15);
  loot.forEach(l=>{c.fillStyle=l.type==='coin'?'#ffdf70':l.type==='bolt'?'#fa9dbe':'#a4ffbf';c.beginPath();c.arc(l.x,l.y,l.type==='bolt'?7:8,0,TAU);c.fill();});
  enemies.filter(e=>e.hp>0&&e.active).sort((a,b)=>a.y-b.y).forEach(e=>{if(e.mode==='windup'){const range=e.type==='boss'?(e.phase===2?170:135):e.type==='brute'?95:66;c.save();c.translate(e.x,e.y);c.rotate(e.face);c.fillStyle='rgba(255,174,116,.30)';c.strokeStyle='#ffd29d';c.lineWidth=3;c.beginPath();c.moveTo(0,0);c.arc(0,0,e.type==='archer'?270:range,-1.65,1.65);c.closePath();c.fill();c.stroke();c.restore();}shadow(c,e.x,e.y,e.r);c.fillStyle=e.hit>0?'#fff':e.type==='boss'?'#66548d':e.type==='brute'?'#bd795b':e.type==='archer'?'#735c99':'#82bcca';c.beginPath();c.ellipse(e.x,e.y-12,e.r,e.r*(.85+Math.sin(clock*4)*.03),0,0,TAU);c.fill();c.fillStyle='#203544';c.fillRect(e.x-9,e.y-18,5,6);c.fillRect(e.x+5,e.y-18,5,6);if(e.type==='boss'){c.fillStyle='#c4b4ff';c.beginPath();c.moveTo(e.x-35,e.y-31);c.lineTo(e.x-30,e.y-64);c.lineTo(e.x-9,e.y-40);c.lineTo(e.x+12,e.y-61);c.lineTo(e.x+27,e.y-32);c.fill();}if(e.hp<e.maxHp){c.fillStyle='#243c42';c.fillRect(e.x-25,e.y-e.r-25,50,5);c.fillStyle='#f5c783';c.fillRect(e.x-25,e.y-e.r-25,50*e.hp/e.maxHp,5);}if(e.mode==='windup')label(c,'!',e.x,e.y-e.r-34,25);});
  c.globalAlpha=p.inv>0?.65:1;hero(c,p.x,p.y,p.face,p.hit>0?'#fff':'#ffd68e');c.globalAlpha=1;
  if(runtime.input.down('guard')){c.strokeStyle='#acf2ff';c.lineWidth=5;c.beginPath();c.arc(p.x,p.y-8,30,p.face-1.1,p.face+1.1);c.stroke();}
  if(attackTime>0){c.save();c.translate(p.x,p.y-8);c.rotate(p.face);c.strokeStyle=combo===3?'#fff6b3':'#eefbff';c.lineWidth=combo===3?13:8;c.beginPath();c.arc(0,0,combo===3?85:65,-1.3,1.3);c.stroke();c.restore();}
  particles.forEach(a=>{c.globalAlpha=clamp(a.life*2,0,1);c.fillStyle=a.color;c.fillRect(a.x-2,a.y-2,4,4);});c.globalAlpha=1;c.restore();
  c.save();panel(c,18,16,310,92);label(c,`Nível ${p.level} • Espada +${p.upgrade} • ${p.coins} moedas`,34,38,15,'left');bar(c,34,49,270,10,p.hp/p.maxHp,'#f39c9c');bar(c,34,64,270,7,p.energy/100,'#90ddd6');bar(c,34,77,270,5,p.xp/(p.level*60),'#c8b1fa');label(c,`Poções: ${p.potions}   •   Combo: ${comboTime>0?combo:0}/3`,34,98,12,'left');
  panel(c,355,16,580,43);label(c,objective||'Explore o bosque e liberte os três cristais',371,43,15,'left');
  // Minimap includes both sides of the river and all mission landmarks.
  panel(c,799,365,143,155);c.fillStyle='#488467';c.fillRect(808,375,124,132);c.fillStyle='#55a6bc';c.fillRect(864,375,8,132);crystals.forEach(s=>{c.fillStyle=s.done?'#9affda':'#ddc5ff';c.fillRect(808+s.x/W*124-3,375+s.y/H*132-3,6,6);});c.fillStyle='#ffd08d';c.fillRect(808+1780/W*124-3,375+690/H*132-3,6,6);c.fillStyle='#fff';c.beginPath();c.arc(808+p.x/W*124,375+p.y/H*132,3,0,TAU);c.fill();label(c,'MAPA DO BOSQUE',870,517,10);
  if(boss.active&&boss.hp>0&&distance(p,boss)<420){panel(c,350, seventy(),400,41);label(c,`Guardião da Névoa${boss.phase===2?' • Tempestade':''}`,550,88,13);bar(c,365,96,370,7,boss.hp/boss.maxHp,'#bba4e9');}
  if(tutorial>0){panel(c,20,405,625,112);label(c,'A guardiã Luma precisa de você.',36,429,17,'left');label(c,'Mova-se pelo bosque. Espada: 3 golpes seguidos fazem um combo.',36,452,14,'left');label(c,'Saia dos avisos laranja! Esquiva atravessa golpes; escudo gasta energia.',36,475,13,'left');label(c,'Use poções quando precisar. Interaja com cristais, forja e Luma.',36,498,13,'left');}
  if(toastTime>0){panel(c,90,330,690,48);label(c,toast,435,360,14);}
  if(deathTime>0){c.fillStyle='rgba(17,31,50,.72)';c.fillRect(0,0,960,540);label(c,'A Aurora cuida de você…',480,260,27);label(c,'Voltando ao último santuário',480,295,17);}c.restore();
 }
 function label(c,t,x,y,size=14,align='center'){c.font=`600 ${size}px system-ui, sans-serif`;c.textAlign=align;c.fillStyle='#f5f6df';c.fillText(t,x,y);}
 function panel(c,x,y,w,h){c.fillStyle='rgba(20,43,49,.91)';c.beginPath();c.roundRect(x,y,w,h,12);c.fill();c.strokeStyle='rgba(197,235,211,.22)';c.stroke();}
 function bar(c,x,y,w,h,v,color){c.fillStyle='#28454b';c.fillRect(x,y,w,h);c.fillStyle=color;c.fillRect(x,y,w*clamp(v,0,1),h);}
 function shadow(c,x,y,r){c.fillStyle='rgba(15,43,37,.25)';c.beginPath();c.ellipse(x,y+8,r,8,0,0,TAU);c.fill();}
 function tree(c,x,y){shadow(c,x,y,37);c.fillStyle='#755438';c.fillRect(x-7,y-30,14,40);c.fillStyle='#205d43';c.beginPath();c.arc(x,y-51,40,0,TAU);c.fill();c.fillStyle='#337b50';c.beginPath();c.arc(x-10,y-63,28,0,TAU);c.fill();c.fillStyle='#438957';c.beginPath();c.arc(x-16,y-70,14,0,TAU);c.fill();}
 function hero(c,x,y,face,color){shadow(c,x,y,19);let walk=Math.sin(clock*12)*3;c.fillStyle='#293f52';c.fillRect(x-9,y-3,7,15+walk);c.fillRect(x+3,y-3,7,15-walk);c.fillStyle='#5877a6';c.beginPath();c.moveTo(x-14,y-19);c.lineTo(x+12,y-19);c.lineTo(x+18,y+6);c.lineTo(x-19,y+5);c.fill();c.fillStyle=color;c.beginPath();c.arc(x,y-27,11,0,TAU);c.fill();c.fillStyle='#594844';c.beginPath();c.arc(x,y-31,11,Math.PI,TAU);c.fill();c.save();c.translate(x+Math.cos(face)*16,y-9+Math.sin(face)*16);c.rotate(face);c.fillStyle='#d6eef3';c.fillRect(0,-3,24,6);c.fillStyle='#e9bd71';c.fillRect(1,-8,4,16);c.restore();}
 reset();return{update,draw,getState:()=>({player:{...p},quest:{crystals:crystals.map(c=>({...c})),objective,completed:won},boss:{...boss},enemies:enemies.map(e=>({...e})),checkpoint:{...checkpoint},deathTime}),restart(){saved={};reset(false);save();},destroy(){save();}};
}
