const API_BASE=['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&location.port!=='3333'?location.protocol+'//'+location.hostname+':3333':'';
const BLE_SERVICE_UUID='7b6e1000-8d4a-4a7f-9b31-0b6e2a1c1000';
const BLE_DATA_UUID='7b6e1001-8d4a-4a7f-9b31-0b6e2a1c1000';
let bandDevice=null;
let bandCharacteristic=null;
let activeChildId=null;
let bandReconnectTimer=null;
let bandDisconnectHandler=null;
let bandReconnectAttempts=0;
let portalRequest=0;
let diagnostics={api:'checking',bluetooth:'checking',device:'offline',gatt:'idle',notifications:'idle',lastPacket:'—',lastPersist:'—'};
const $=s=>document.querySelector(s);
const modal=$('#modalBackdrop'), content=$('#modalContent');
const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
function readLocal(key){try{return localStorage.getItem(key)}catch{return null}}
function writeLocal(key,value){try{localStorage.setItem(key,value)}catch{}}
function readVisualPreferences(){try{const saved=JSON.parse(readLocal('nb_prefs')||'{}');return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{}}catch{return {}}}
let savedVisualPreferences=readVisualPreferences();
let explicitMotionPreference=typeof savedVisualPreferences.motion==='boolean';
const legacyTheme=readLocal('nb-theme');
let visualPreferences={dark:typeof savedVisualPreferences.dark==='boolean'?savedVisualPreferences.dark:legacyTheme==='light'?false:true,motion:explicitMotionPreference?savedVisualPreferences.motion:motionPreference.matches,font:!!savedVisualPreferences.font};
function applyVisualPreferences(persist=false){
  const body=document.body,theme=visualPreferences.dark?'dark':'light';
  body.classList.toggle('dark',visualPreferences.dark);
  body.classList.toggle('theme-dark',visualPreferences.dark);
  body.classList.toggle('reduce-motion',visualPreferences.motion);
  body.classList.toggle('large-type',visualPreferences.font);
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.colorScheme=theme;
  document.documentElement.style.fontSize=visualPreferences.font?'112.5%':'';
  body.style.fontSize=visualPreferences.font?'18px':'';
  const themeMeta=$('meta[name="theme-color"]');
  if(themeMeta)themeMeta.content=visualPreferences.dark?'#14151b':'#f9f9fc';
  ['prefDark','prefMotion','prefFont'].forEach((id,i)=>{const control=$('#'+id);if(control)control.checked=visualPreferences[['dark','motion','font'][i]]});
  document.querySelectorAll('#siteThemeToggle, #themeToggle').forEach(button=>{
    const next=visualPreferences.dark?'claro':'escuro';
    button.setAttribute('aria-label','Alternar para o tema '+next);
    button.setAttribute('aria-pressed',String(visualPreferences.dark));
    button.title='Usar tema '+next;
    if(button.id==='themeToggle')button.textContent=(visualPreferences.dark?'☼':'◐')+' Tema '+next;
    const label=button.querySelector('[data-theme-label]');if(label)label.textContent='Tema '+next;
  });
  if(persist){savedVisualPreferences={...savedVisualPreferences,...visualPreferences};if(!explicitMotionPreference)delete savedVisualPreferences.motion;writeLocal('nb_prefs',JSON.stringify(savedVisualPreferences));writeLocal('nb-theme',theme)}
  document.dispatchEvent(new CustomEvent('neurobloom:preferences',{detail:{...visualPreferences}}));
}
function toggleTheme(){visualPreferences.dark=!visualPreferences.dark;applyVisualPreferences(true)}
applyVisualPreferences();
motionPreference.addEventListener?.('change',()=>{if(!explicitMotionPreference){visualPreferences.motion=motionPreference.matches;applyVisualPreferences()}});
let modalReturnFocus=null,modalInertElements=[];
let closeVisualSettings=()=>{};
function modalFocusable(){return [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter(element=>!element.hidden&&element.getClientRects().length>0)}
function openModal(html){
  closeVisualSettings();
  if(!modal.classList.contains('show'))modalReturnFocus=document.activeElement;
  content.innerHTML=html;
  content.querySelectorAll('.modal-close').forEach(button=>{button.hidden=true;button.style.display='none';button.tabIndex=-1;button.setAttribute('aria-hidden','true')});
  const dialog=modal.querySelector('.modal'),heading=content.querySelector('h2'),description=content.querySelector('p');
  dialog.tabIndex=-1;
  if(heading){heading.id='modalTitle';dialog.setAttribute('aria-labelledby',heading.id)}
  if(description){description.id='modalDescription';dialog.setAttribute('aria-describedby',description.id)}
  content.querySelectorAll('input, select, textarea').forEach((input,index)=>{
    if(!input.id)input.id='modalField'+index;
    const label=input.closest('label')||input.closest('.field')?.querySelector('label');
    if(label)label.htmlFor=input.id;
    if(input.name==='password')input.autocomplete=content.querySelector('#signupForm')?'new-password':'current-password';
    if(input.name==='email')input.autocomplete='email';
  });
  modal.classList.add('show');modal.setAttribute('aria-hidden','false');
  if(!modalInertElements.length){[...document.body.children].filter(element=>element!==modal&&element.id!=='toast'&&element.tagName!=='SCRIPT').forEach(element=>{modalInertElements.push([element,element.inert]);element.inert=true})}
  requestAnimationFrame(()=>{if(modal.classList.contains('show'))(content.querySelector('input:not([type="checkbox"]), select, textarea')||modalFocusable()[0]||dialog).focus({preventScroll:true})});
}
function closeModal(){
  const wasOpen=modal.classList.contains('show');
  modal.classList.remove('show');
  modalInertElements.forEach(([element,previous])=>{element.inert=previous});modalInertElements=[];
  if(wasOpen&&modalReturnFocus?.isConnected)modalReturnFocus.focus({preventScroll:true});
  modal.setAttribute('aria-hidden','true');
  modalReturnFocus=null;
}
let toastTimer=null;
function notify(s){const t=$('#toast');if(!t)return;clearTimeout(toastTimer);t.textContent=s;t.classList.add('show');toastTimer=setTimeout(()=>t.classList.remove('show'),3000)}
async function api(path,options={}){
  if(location.protocol==='file:')throw new Error('Abra o NeuroBloom pelo endereço do site para acessar sua conta.');
  const headers=new Headers(options.headers||{});
  if(!headers.has('Accept'))headers.set('Accept','application/json');
  if(options.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
    let res;
    try{res=await fetch(API_BASE+path,{...options,headers,credentials:'include',cache:'no-store',signal:options.signal||controller.signal})}
    catch(err){throw new Error(err.name==='AbortError'?'O servidor demorou para responder. Tente novamente.':'Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.')}
    if(!(res.headers.get('Content-Type')||'').toLowerCase().includes('application/json')){
      const err=new Error(res.status>=500?'O servidor está indisponível. Tente novamente em alguns instantes.':'O serviço de contas não está disponível neste endereço.');err.status=res.status;throw err;
    }
    let data;
    try{data=await res.json()}catch{throw new Error('O servidor enviou uma resposta inválida. Tente novamente.')}
    if(!res.ok){const err=new Error(typeof data?.error==='string'?data.error:'Não foi possível concluir a operação');err.status=res.status;throw err}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('O servidor enviou uma resposta inválida. Tente novamente.');
    return data;
  }finally{clearTimeout(timeout)}
}
async function submitAuth(form,pendingLabel,action){
  if(form.dataset.submitting==='true'||!form.reportValidity())return;
  form.dataset.submitting='true';form.setAttribute('aria-busy','true');
  const buttons=[...form.querySelectorAll('button[type="submit"], button:not([type])')].map(button=>({button,text:button.textContent,disabled:button.disabled}));
  buttons.forEach(({button})=>{button.disabled=true;button.textContent=pendingLabel});
  let errorBox=form.querySelector('[data-form-error]');if(errorBox)errorBox.textContent='';
  try{await action()}
  catch(err){
    if(form.isConnected){if(!errorBox){errorBox=document.createElement('p');errorBox.className='form-note';errorBox.dataset.formError='';errorBox.setAttribute('role','alert');form.appendChild(errorBox)}errorBox.textContent=err.message}
    notify(err.message);
  }finally{delete form.dataset.submitting;form.removeAttribute('aria-busy');buttons.forEach(({button,text,disabled})=>{button.disabled=disabled;button.textContent=text})}
}
function normalizeChild(child){return child?.id?{...child,name:String(child.name??child.display_name??'Criança')}:null}
function setPortalRoute(view,historyMode='push'){
  if(historyMode==='none')return;
  const path=view==='guardian'?'/responsavel':view==='child'?'/crianca':'/';
  if(location.pathname!==path)history[historyMode==='replace'?'replaceState':'pushState']({view},'',path);
}
function leavePortal(historyMode='push'){
  closeVisualSettings(false);
  $('#portalRoot')?.kidCleanup?.();
  portalRequest+=1;activeChildId=null;closeModal();disconnectBand();
  document.body.classList.remove('portal-mode');$('#portalRoot')?.remove();setPortalRoute(null,historyMode);window.scrollTo(0,0);
}
async function logoutPortal(button,path,message){
  if(button.disabled)return;
  button.disabled=true;
  try{await api(path,{method:'POST'});leavePortal('replace');notify(message)}
  catch(err){notify('Não foi possível encerrar a sessão. '+err.message)}
  finally{button.disabled=false}
}
function updateDiagnostics(){const box=$('#diagnosticsBox');if(!box)return;const rows=[['API',diagnostics.api],['Web Bluetooth',diagnostics.bluetooth],['NeuroBand',diagnostics.device],['GATT',diagnostics.gatt],['Notificações',diagnostics.notifications],['Último pacote',diagnostics.lastPacket],['Persistência',diagnostics.lastPersist],['Reconexões',String(bandReconnectAttempts)]];box.innerHTML=rows.map(([k,v])=>'<div class="diag-row"><span>'+k+'</span><strong>'+escapeHtml(v)+'</strong></div>').join('')}
async function checkApi(options={}){
  diagnostics.api='testando…';updateDiagnostics();
  try{const h=await api('/api/health');diagnostics.api=h.ok?'online':'indisponível';if(!options.silent)notify(h.ok?'API NeuroBloom online':'API indisponível');}
  catch{diagnostics.api='offline';if(!options.silent)notify('Modo demonstração: API ainda não está online')}
  updateDiagnostics();
}
function signupForm(){
  openModal('<button class="modal-close" onclick="closeModal()">×</button><h2>Criar conta da família</h2><p>Use apenas dados fictícios nesta versão escolar.</p><form id="signupForm"><div class="form-grid"><div class="field full"><label>Nome do responsável</label><input name="guardianName" minlength="2" maxlength="80" autocomplete="name" required></div><div class="field full"><label>E-mail de teste</label><input name="email" type="email" maxlength="254" required></div><div class="field"><label>Senha (mín. 12)</label><input name="password" type="password" minlength="12" maxlength="128" required></div><div class="field"><label>PIN infantil (6+)</label><input name="kidPin" type="password" inputmode="numeric" minlength="6" maxlength="32" autocomplete="new-password" required></div><div class="field full"><label>Nome fictício da criança</label><input name="childName" minlength="2" maxlength="80" required></div><div class="field"><label>Ano de nascimento fictício</label><input name="birthYear" type="number" min="1900" max="'+new Date().getFullYear()+'" step="1"></div></div><label class="field"><span><input name="consent" type="checkbox" required> Confirmo que é um teste escolar com dados fictícios</span></label><button class="btn primary" type="submit">Criar conta</button></form><p class="form-note">A conta real só deve ser usada depois de consentimento, segurança e revisão LGPD.</p>');
  $('#signupForm').onsubmit=handleSignup;
}
async function handleSignup(e){
  e.preventDefault();const form=e.currentTarget;
  await submitAuth(form,'Criando conta…',async()=>{
    const f=new FormData(form),payload={guardianName:String(f.get('guardianName')).trim(),email:String(f.get('email')).trim().toLowerCase(),password:f.get('password'),childName:String(f.get('childName')).trim(),kidPin:f.get('kidPin'),consent:f.get('consent')==='on'};
    if(payload.guardianName.length<2||payload.childName.length<2)throw new Error('Informe nomes com pelo menos 2 caracteres.');
    if(f.get('birthYear'))payload.birthYear=Number(f.get('birthYear'));
    const r=await api('/api/auth/signup',{method:'POST',body:JSON.stringify(payload)});await showPortal(r.guardian,r.child);notify('Conta de teste criada');
  });
}
function signinForm(){
  openModal('<button class="modal-close" onclick="closeModal()">×</button><h2>Entrar</h2><p>Login do responsável para o ambiente de teste.</p><form id="signinForm"><div class="field"><label>E-mail</label><input name="email" type="email" maxlength="254" required></div><div class="field"><label>Senha</label><input name="password" type="password" maxlength="128" required></div><button class="btn primary" type="submit">Entrar</button></form><p class="form-note">Use o mesmo e-mail e senha cadastrados para entrar de qualquer dispositivo.</p>');
  $('#signinForm').onsubmit=handleSignin;
}
async function handleSignin(e){
  e.preventDefault();const form=e.currentTarget;
  await submitAuth(form,'Entrando…',async()=>{const f=new FormData(form);const r=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:String(f.get('email')).trim().toLowerCase(),password:f.get('password')})});const family=await api('/api/family');await showPortal(family.guardian||r.guardian,family.children?.[0]);notify('Login realizado')});
}
function kidLoginForm(){
  openModal('<button class="modal-close" onclick="closeModal()">×</button><h2>Mundo Kids</h2><p>O acesso infantil usa um perfil previamente criado pelo responsável.</p><form id="kidForm"><div class="field"><label>ID do perfil infantil</label><input name="id" maxlength="36" autocomplete="username" required></div><div class="field"><label>PIN</label><input name="pin" type="password" inputmode="numeric" maxlength="32" autocomplete="current-password" required></div><button class="btn primary" type="submit">Entrar no mundo kids</button></form>');
  $('#kidForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;await submitAuth(form,'Entrando…',async()=>{const f=new FormData(form);const r=await api('/api/children/'+encodeURIComponent(String(f.get('id')).trim())+'/kid-login',{method:'POST',body:JSON.stringify({pin:f.get('pin')})});await showChildPortal(r.child);notify(r.message||'Sessão infantil iniciada')})};
}
async function handleBandPacket(event){
  const value=event.target.value;
  if(!value||value.byteLength<3){diagnostics.lastPacket='pacote inválido';updateDiagnostics();return}
  const bpm=value.getUint16(0,true), quality=value.getUint8(2);
  if(bpm<25||bpm>250||quality>100){diagnostics.lastPacket='dados fora do formato';updateDiagnostics();return}
  diagnostics.lastPacket=bpm+' BPM · '+quality+'% sinal';
  diagnostics.device='conectada';
  updateDiagnostics();
  const measuredAt=new Date().toISOString();
  const bpmEl=$('#liveBandBpm'),qEl=$('#liveBandQuality'),statusEl=$('#bandStatus');
  if(bpmEl)bpmEl.textContent=bpm||'—';
  if(qEl)qEl.textContent=quality+'%';
  if(statusEl)statusEl.textContent='● NeuroBand conectada';
  if(activeChildId){
    try{await api('/api/children/'+encodeURIComponent(activeChildId)+'/vitals/ble',{method:'POST',body:JSON.stringify({bpm,signalQuality:quality,measuredAt})});diagnostics.lastPersist='salva na API';updateDiagnostics()}
    catch(err){diagnostics.lastPersist='falhou: '+err.message;updateDiagnostics();console.debug('BLE leitura não persistida:',err.message)}
  }
}
async function connectBand(manual=true){
  if(!('bluetooth' in navigator)){diagnostics.bluetooth='não suportado';updateDiagnostics();return notify('Seu navegador não oferece Web Bluetooth. Use Chrome ou Edge em localhost/HTTPS.')}
  diagnostics.bluetooth='suportado';updateDiagnostics();
  try{
    if(manual||!bandDevice){bandReconnectAttempts=0;bandDevice=await navigator.bluetooth.requestDevice({filters:[{namePrefix:'NeuroBand'}],optionalServices:[BLE_SERVICE_UUID]})}
    diagnostics.device='selecionando…';diagnostics.gatt='aguardando';updateDiagnostics();
    if(bandDisconnectHandler)bandDevice.removeEventListener('gattserverdisconnected',bandDisconnectHandler);
    bandDisconnectHandler=()=>{bandCharacteristic=null;diagnostics.device='desconectada';diagnostics.gatt='desconectado';diagnostics.notifications='paradas';bandReconnectAttempts+=1;updateDiagnostics();const s=$('#bandStatus');if(s)s.textContent='○ NeuroBand desconectada';if(bandReconnectTimer)clearTimeout(bandReconnectTimer);if(bandDevice)bandReconnectTimer=setTimeout(()=>connectBand(false).catch(()=>{}),3000);notify('NeuroBand desconectada — tentando reconectar...')};
    bandDevice.addEventListener('gattserverdisconnected',bandDisconnectHandler);
    const server=await bandDevice.gatt.connect();diagnostics.device='conectada';diagnostics.gatt='conectado';updateDiagnostics();
    const service=await server.getPrimaryService(BLE_SERVICE_UUID);diagnostics.gatt='serviço encontrado';updateDiagnostics();
    bandCharacteristic=await service.getCharacteristic(BLE_DATA_UUID);diagnostics.gatt='característica encontrada';updateDiagnostics();
    await bandCharacteristic.startNotifications();diagnostics.notifications='ativas';updateDiagnostics();
    bandCharacteristic.addEventListener('characteristicvaluechanged',handleBandPacket);
    const s=$('#bandStatus');if(s)s.textContent='● NeuroBand conectada';
    notify('NeuroBand conectada com sucesso');
  }catch(err){diagnostics.device=err.name==='NotFoundError'?'cancelada':'erro';diagnostics.gatt=err.name==='NotFoundError'?'—':'falhou';diagnostics.notifications='—';updateDiagnostics();notify(err.name==='NotFoundError'?'Conexão cancelada':('Falha no Bluetooth: '+err.message))}
}
async function disconnectBand(){
  if(bandReconnectTimer){clearTimeout(bandReconnectTimer);bandReconnectTimer=null}
  if(bandCharacteristic)bandCharacteristic.removeEventListener('characteristicvaluechanged',handleBandPacket);
  if(bandDevice&&bandDisconnectHandler)bandDevice.removeEventListener('gattserverdisconnected',bandDisconnectHandler);
  bandDisconnectHandler=null;
  try{if(bandDevice?.gatt?.connected)bandDevice.gatt.disconnect()}finally{bandCharacteristic=null;bandDevice=null;diagnostics.device='offline';diagnostics.gatt='idle';diagnostics.notifications='idle';updateDiagnostics();const s=$('#bandStatus');if(s)s.textContent='○ NeuroBand desconectada'}
}
async function showPortal(guardian,child,{historyMode='push'}={}){
  closeVisualSettings(false);
  child=normalizeChild(child);
  if(!guardian?.id||!child)throw new Error('Não foi possível carregar o perfil da família.');
  guardian={...guardian,name:String(guardian.name||'Responsável')};
  const request=++portalRequest;
  closeModal();
  activeChildId=child.id;
  setPortalRoute('guardian',historyMode);
  await renderGuardianPortal(guardian,child,()=>request===portalRequest&&location.pathname==='/responsavel');
}

async function renderGuardianPortal(guardian,child,shouldRender=()=>true){
  let reading=null;try{reading=await api('/api/children/'+child.id+'/vitals/latest')}catch{}
  if(!shouldRender())return;
  document.body.classList.add('portal-mode');
  let root=$('#portalRoot');if(!root){root=document.createElement('div');root.id='portalRoot';document.body.appendChild(root)}
  root.innerHTML='<div class="portal-app"><aside class="portal-sidebar"><div class="portal-brand"><span>✿</span> Neuro<span>Bloom</span></div><div class="portal-user"><div class="portal-avatar">'+escapeHtml((guardian.name||'N').slice(0,1).toUpperCase())+'</div><div><strong>'+escapeHtml(guardian.name)+'</strong><small>Responsável</small></div></div><nav class="portal-tabs"><button class="active" data-tab="overview">⌂ <span>Visão geral</span></button><button data-tab="history">◷ <span>Histórico</span></button><button data-tab="band">◉ <span>NeuroBand</span></button><button data-tab="family">♧ <span>Família</span></button><button data-tab="settings">⚙ <span>Configurações</span></button></nav><button class="portal-exit" id="portalExit">← Voltar ao site</button></aside><main class="portal-main"><header class="portal-header"><div><span class="portal-kicker">NEUROBLOOM / RESPONSÁVEL</span><h1>Olá, '+escapeHtml(guardian.name.split(' ')[0])+' <span>✦</span></h1><p>Acompanhe a experiência de '+escapeHtml(child.name)+' em um só lugar.</p><div class="portal-child-id">ID da criança <code>'+escapeHtml(child.id)+'</code></div></div><div class="portal-header-actions"><span class="online-chip"><i></i> Sistema online</span><button class="theme-toggle" id="themeToggle" title="Alternar tema">◐ Tema</button><button class="icon-btn" id="portalLogout" title="Sair">↪</button></div></header><section class="portal-content"><div class="portal-tab-panel active" data-panel="overview"><div class="portal-grid"><article class="metric-card metric-main"><div class="metric-label">LEITURA MAIS RECENTE <span>DEMO</span></div><div class="metric-value"><strong id="liveBandBpm">'+(reading?.reading?.bpm??'—')+'</strong><small>BPM</small></div><div class="metric-footer"><span id="bandStatus">○ NeuroBand desconectada</span><button class="btn primary small" id="connectBand">Conectar</button></div></article><article class="metric-card"><div class="metric-label">QUALIDADE DO SINAL</div><div class="metric-value compact"><strong id="liveBandQuality">—</strong><small>%</small></div><p>Recebido pela conexão BLE quando disponível.</p></article><article class="metric-card"><div class="metric-label">PERFIL INFANTIL</div><div class="child-mini"><div class="child-orb">✿</div><div><strong>'+escapeHtml(child.name)+'</strong><span>Perfil acompanhado</span></div></div><p>Dados demonstrativos e fictícios nesta versão escolar.</p></article></div><div class="portal-section-head"><div><span class="portal-kicker">ATIVIDADE</span><h2>Visão rápida</h2></div><button class="btn small" id="refreshReading">Atualizar</button></div><div class="insight-grid"><article class="insight-card"><span class="insight-icon">⌁</span><div><strong>Status da NeuroBand</strong><p id="overviewBandState">Aguardando conexão com o dispositivo.</p></div></article><article class="insight-card"><span class="insight-icon mint">✦</span><div><strong>Última persistência</strong><p id="overviewPersist">Nenhuma leitura BLE nesta sessão.</p></div></article><article class="insight-card"><span class="insight-icon peach">♡</span><div><strong>Ambiente seguro</strong><p>Protótipo escolar, sem uso para decisões clínicas ou emergências.</p></div></article></div></div><div class="portal-tab-panel" data-panel="history"><div class="portal-section-head"><div><span class="portal-kicker">DADOS</span><h2>Histórico de leituras</h2></div><button class="btn small" id="historyBtn">Atualizar histórico</button></div><div id="historyBox" class="portal-history"><div class="empty-state">Carregue o histórico para visualizar as leituras.</div></div></div><div class="portal-tab-panel" data-panel="band"><div class="portal-section-head"><div><span class="portal-kicker">DISPOSITIVO</span><h2>NeuroBand</h2></div><span class="online-chip" id="bandPill"><i></i> Desconectada</span></div><div class="band-layout"><article class="band-visual"><div class="band-glow"></div><div class="band-ring">◉</div><strong>NeuroBand</strong><span>ESP32 · MAX30102 · BLE</span><div class="band-actions"><button class="btn primary" id="bandConnect2">Conectar pulseira</button><button class="btn small" id="bandDisconnect2">Desconectar</button></div></article><article class="diagnostic-card"><div class="diag-head"><strong>Diagnóstico técnico</strong><button class="btn small" id="diagRefresh">Testar API</button></div><div id="diagnosticsBox" class="diagnostics-box"></div><p class="form-note">Este painel serve para depuração da demonstração e não exibe segredos.</p></article></div></div><div class="portal-tab-panel" data-panel="family"><div class="portal-section-head"><div><span class="portal-kicker">FAMÍLIA</span><h2>Perfil acompanhado</h2></div></div><div class="family-card"><div class="family-avatar">✿</div><div><strong>'+escapeHtml(child.name)+'</strong><p>Perfil infantil vinculado a '+escapeHtml(guardian.name)+'.</p></div><span class="status-badge">ATIVO</span></div></div><div class="portal-tab-panel" data-panel="settings"><div class="portal-section-head"><div><span class="portal-kicker">PREFERÊNCIAS</span><h2>Configurações</h2></div></div><div class="settings-card"><div><strong>Experiência visual</strong><p>Use o botão de engrenagem do site para modo escuro, fonte maior e redução de animações.</p></div><div><strong>Privacidade</strong><p>Continue usando apenas dados fictícios enquanto o projeto estiver em demonstração.</p></div></div></div></section></main></div>';
  diagnostics.bluetooth='bluetooth' in navigator?'suportado':'não suportado';diagnostics.device=bandDevice?.gatt?.connected?'conectada':'offline';diagnostics.gatt=bandCharacteristic?'característica pronta':'idle';updateDiagnostics();
  const tabs=[...root.querySelectorAll('.portal-tabs button')],panels=[...root.querySelectorAll('.portal-tab-panel')];
  const tabList=root.querySelector('.portal-tabs');tabList.setAttribute('aria-label','Navegação do painel familiar');tabList.setAttribute('role','tablist');tabList.setAttribute('aria-orientation','vertical');
  panels.forEach(panel=>{panel.id='portalPanel-'+panel.dataset.panel;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','portalTab-'+panel.dataset.panel);panel.tabIndex=0});
  tabs.forEach((tab,index)=>{
    const active=tab.classList.contains('active');tab.id='portalTab-'+tab.dataset.tab;tab.setAttribute('role','tab');tab.setAttribute('aria-label',tab.querySelector('span')?.textContent||tab.textContent.trim());tab.setAttribute('aria-controls','portalPanel-'+tab.dataset.tab);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
    tab.onclick=()=>{tabs.forEach(x=>{x.classList.remove('active');x.setAttribute('aria-selected','false');x.tabIndex=-1});panels.forEach(x=>x.classList.remove('active'));tab.classList.add('active');tab.setAttribute('aria-selected','true');tab.tabIndex=0;const p=root.querySelector('[data-panel="'+tab.dataset.tab+'"]');if(p)p.classList.add('active')};
    tab.addEventListener('keydown',event=>{let next=null;if(event.key==='ArrowDown')next=(index+1)%tabs.length;if(event.key==='ArrowUp')next=(index-1+tabs.length)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next!==null){event.preventDefault();tabs[next].click();tabs[next].focus()}});
  });
  root.querySelector('#themeToggle').onclick=toggleTheme;applyVisualPreferences();
  root.querySelector('#portalLogout').setAttribute('aria-label','Sair da conta do responsável');
  root.querySelector('#connectBand').onclick=connectBand;root.querySelector('#bandConnect2').onclick=connectBand;root.querySelector('#bandDisconnect2').onclick=disconnectBand;root.querySelector('#diagRefresh').onclick=checkApi;
  root.querySelector('#refreshReading').onclick=async()=>{try{const r=await api('/api/children/'+child.id+'/vitals/latest');const el=$('#liveBandBpm');if(el)el.textContent=r.reading?.bpm??'—';notify(r.reading?'Leitura atualizada':'Sem leituras reais')}catch(err){notify(err.message)}};
  root.querySelector('#historyBtn').onclick=async()=>{try{const r=await api('/api/children/'+child.id+'/vitals?limit=20');const box=root.querySelector('#historyBox');box.innerHTML=r.readings.length?r.readings.map(x=>'<div class="portal-history-row"><span>'+new Date(x.measured_at).toLocaleString('pt-BR')+'</span><strong>'+x.bpm+' BPM</strong><small>'+x.signal_quality+'% sinal</small></div>').join(''):'<div class="empty-state">Nenhuma leitura registrada.</div>'}catch(err){notify(err.message)}};
  root.querySelector('#portalExit').onclick=()=>leavePortal();
  root.querySelector('#portalLogout').onclick=event=>logoutPortal(event.currentTarget,'/api/auth/logout','Sessão encerrada');
}

const kidAdventures=[
  {id:'platform',title:'Jardins de Aurora',tag:'EXPLORE',detail:'Plataformas, fases e descobertas',colors:['#194c53','#85e0b0','#ffe7a3']},
  {id:'speed',title:'Rastro Solar',tag:'ACELERE',detail:'Anéis, impulso e velocidade',colors:['#68413c','#ffb77d','#ffe9a2']},
  {id:'sword',title:'Espada da Aurora',tag:'EVOLUA',detail:'Missões, forja e um grande guardião',colors:['#343958','#b3a0ef','#fff1ac']},
  {id:'ninja',title:'Ninja do Vento',tag:'DOMINE',detail:'Combos, shurikens e clones',colors:['#193e53','#79d9dc','#d3f7cc']},
  {id:'energy',title:'Arena Cósmica',tag:'TRANSFORME',detail:'Voo, energia e transformação',colors:['#442865','#d899ed','#9be8ff']}
];
function adventurePoster(game,index){
  const [bg,accent,light]=game.colors;
  const scene=game.id==='platform'?'<path d="M0 160Q60 65 120 155T300 140V220H0" fill="#2f7c73"/><path d="M20 180h85v12H20zm145-40h70v12h-70z" fill="#a9e2aa"/><path d="M210 140V95l30 10-30 12" fill="#fff2b4"/>':game.id==='speed'?'<path d="M-30 230 220 80h55L135 230" fill="#efa873"/><path d="m0 95 100-20m-65 45 83-20m-78 46 50-12" stroke="#ffe9a2" stroke-width="4"/>'+[170,215,260].map((x,i)=>'<ellipse cx="'+x+'" cy="'+(150-i*28)+'" rx="12" ry="19" fill="none" stroke="#ffe9a2" stroke-width="6"/>').join(''):game.id==='sword'?'<path d="M15 185V85h35V65h28v120m145 0V60h28v25h33v100" fill="#66628b"/><path d="m189 165 36-101 8 18-29 90z" fill="#fff1ac"/><path d="m180 151 38 16" stroke="#d899ed" stroke-width="8"/>':game.id==='ninja'?'<path d="M20 205V55m16 150V30m223 175V45m17 160V70" stroke="#3c7c80" stroke-width="12"/><path d="m210 65 8 17 18 7-18 7-8 18-7-18-18-7 18-7z" fill="#d3f7cc"/><path d="M175 160q-70-75-120-25" fill="none" stroke="#c3f9e8" stroke-width="4"/>':'<ellipse cx="154" cy="126" rx="92" ry="66" fill="none" stroke="#aa7ad1" stroke-width="2" transform="rotate(-25 154 126)"/><circle cx="240" cy="65" r="22" fill="#8061ac"/><path d="m190 138 110-40v64l-110-8" fill="#9be8ff" opacity=".75"/>';
  return '<svg class="adventure-poster" viewBox="0 0 300 220" aria-hidden="true"><defs><linearGradient id="poster'+index+'" x2="0" y2="1"><stop stop-color="'+bg+'"/><stop offset="1" stop-color="#151b32"/></linearGradient></defs><rect width="300" height="220" fill="url(#poster'+index+')"/><circle cx="80" cy="57" r="29" fill="'+light+'" opacity=".8"/><g fill="'+light+'" opacity=".6"><circle cx="175" cy="30" r="2"/><circle cx="263" cy="24" r="2"/><circle cx="38" cy="117" r="2"/></g>'+scene+'<ellipse cx="143" cy="198" rx="43" ry="9" fill="#10172e" opacity=".5"/><path d="m126 133-27 43 31-8 18-27 24 28 25-4-32-35" fill="'+accent+'"/><path d="m131 162-10 31m33-31 12 31" stroke="'+accent+'" stroke-width="15" stroke-linecap="round"/><rect x="120" y="107" width="46" height="57" rx="17" fill="'+accent+'"/><rect x="116" y="74" width="53" height="49" rx="20" fill="'+light+'"/><path d="m116 93 12-23 14 9 18-11 9 25" fill="'+accent+'"/><rect x="127" y="95" width="6" height="9" rx="3" fill="#22263a"/><rect x="151" y="95" width="6" height="9" rx="3" fill="#22263a"/><path d="m135 111 9 3 8-4" fill="none" stroke="#22263a" stroke-width="2"/><path d="M123 124q-28 6-43-10 13 32 47 24" fill="'+accent+'"/></svg>';
}
async function showChildPortal(child,{historyMode='push'}={}){
  closeVisualSettings(false);child=normalizeChild(child);
  if(!child)throw new Error('Não foi possível carregar o perfil infantil.');
  const request=++portalRequest;activeChildId=null;setPortalRoute('child',historyMode);await disconnectBand();
  if(request!==portalRequest||location.pathname!=='/crianca')return;
  closeModal();document.body.classList.add('portal-mode');
  let root=$('#portalRoot');if(!root){root=document.createElement('div');root.id='portalRoot';document.body.appendChild(root)}
  root.kidCleanup?.();
  root.innerHTML='<div class="kid-app"><header class="kid-header"><a class="brand" href="/">✿ Neuro<span>Bloom</span></a><div class="kid-chip">SEU UNIVERSO DE AVENTURAS</div><button class="icon-btn" id="kidLogout" aria-label="Sair do mundo kids">↪</button></header><main class="kid-main"><section class="kid-hero"><div><span class="portal-kicker">CINCO MUNDOS. SEU JEITO DE JOGAR.</span><h1>Vamos explorar, <span id="kidNicknameGreeting">aventureiro</span>?</h1><p>Descubra caminhos, aprenda novos poderes e comemore cada conquista.</p></div><div class="kid-planet" aria-hidden="true"><div class="kid-star">✦</div><div class="kid-orbit">◌</div><div class="kid-flower">✿</div></div></section><form class="kid-profile" id="kidNicknameForm"><div><label for="kidNickname">Seu apelido de aventura</label><p id="kidNicknameHelp">Privado, só neste perfil. Use de 3 a 20 letras, números, espaços, _ ou -.</p></div><input id="kidNickname" name="nickname" minlength="3" maxlength="20" autocomplete="off" aria-describedby="kidNicknameHelp kidProfileStatus" placeholder="Ex.: Astro Azul" required><button class="btn small" type="submit">Salvar apelido</button><p class="kid-profile-status" id="kidProfileStatus" role="status">Carregando seu apelido…</p></form><section class="kid-games" aria-label="Escolha sua aventura">'+kidAdventures.map((g,i)=>'<button class="kid-game adventure-card" data-game="'+g.id+'" aria-pressed="false">'+adventurePoster(g,i)+'<span class="adventure-tag">0'+(i+1)+' / '+g.tag+'</span><strong>'+g.title+'</strong><small>'+g.detail+'</small><span class="adventure-play">Jogar aventura <b aria-hidden="true">↗</b></span></button>').join('')+'</section><section class="kid-play"><div class="game-window kid-game-frame"><div class="game-bar"><span aria-hidden="true">● ● ●</span><span id="kidGameTitle">Sua próxima aventura</span><button class="game-close" id="kidGameClose" aria-label="Fechar jogo">×</button></div><div class="kid-iframe-wrap"><div class="kid-iframe-empty" id="kidGameEmpty">✦ Escolha um dos cinco mundos acima para começar.</div><iframe id="kidGameFrame" title="Aventura NeuroBloom" loading="lazy" allowfullscreen></iframe></div><div class="game-caption"><span>Seu ritmo · sem anúncios · personagens originais</span><button class="btn small" id="kidGameFullscreen">Tela cheia</button></div></div></section><section class="kid-sessions" aria-labelledby="kidHistoryTitle"><div class="kid-history-heading"><div><span class="portal-kicker">SEU DIÁRIO</span><h2 id="kidHistoryTitle">Últimas aventuras</h2></div><button class="btn small" id="kidHistoryRefresh">Atualizar</button></div><p>As 12 sessões mais recentes deste perfil.</p><div id="kidHistory" aria-live="polite">Carregando aventuras…</div></section></main></div>';
  setupKidGames(root,child);applyVisualPreferences();
  root.querySelector('#kidLogout').onclick=async event=>{const button=event.currentTarget;root.querySelector('#kidGameFrame').contentWindow?.postMessage({type:'nb:close'},location.origin);await new Promise(resolve=>setTimeout(resolve,60));logoutPortal(button,'/api/children/logout','Até logo!')};
}
function setupKidGames(root,child){
  const cards=[...root.querySelectorAll('.kid-game')],frame=root.querySelector('#kidGameFrame'),empty=root.querySelector('#kidGameEmpty'),title=root.querySelector('#kidGameTitle'),form=root.querySelector('#kidNicknameForm'),input=root.querySelector('#kidNickname'),status=root.querySelector('#kidProfileStatus');
  const names=Object.fromEntries(kidAdventures.map(g=>[g.id,g.title]));let historyRequest=0,gameSwitch=0;
  const alive=()=>root.isConnected&&root.contains(frame);
  function pause(){frame.contentWindow?.postMessage({type:'nb:close'},location.origin)}
  async function openGame(id){const change=++gameSwitch;pause();await new Promise(resolve=>setTimeout(resolve,60));if(!alive()||change!==gameSwitch)return;cards.forEach(c=>{c.classList.toggle('active',c.dataset.game===id);c.setAttribute('aria-pressed',String(c.dataset.game===id))});title.textContent=names[id];empty.hidden=true;frame.src='/games/index.html?game='+encodeURIComponent(id)+'&profile='+encodeURIComponent(child.id);frame.classList.add('loaded');root.querySelector('.kid-game-frame').scrollIntoView({behavior:visualPreferences.motion?'auto':'smooth',block:'start'})}
  cards.forEach(card=>card.onclick=()=>openGame(card.dataset.game));
  root.querySelector('#kidGameClose').onclick=async()=>{const change=++gameSwitch;pause();await new Promise(resolve=>setTimeout(resolve,60));if(!alive()||change!==gameSwitch)return;frame.src='about:blank';frame.classList.remove('loaded');empty.hidden=false;title.textContent='Sua próxima aventura';cards.forEach(card=>{card.classList.remove('active');card.setAttribute('aria-pressed','false')});refreshHistory()};
  root.querySelector('#kidGameFullscreen').onclick=async()=>{if(!frame.classList.contains('loaded'))return notify('Escolha uma aventura primeiro');try{if(frame.requestFullscreen)await frame.requestFullscreen();else notify('Tela cheia não disponível neste navegador')}catch{notify('Não foi possível abrir a tela cheia')}};
  function setNickname(nickname){input.value=nickname||'';root.querySelector('#kidNicknameGreeting').textContent=nickname||'aventureiro'}
  let nicknameEdited=false;input.addEventListener('input',()=>{nicknameEdited=true;status.textContent='Salve para usar este apelido nas próximas aventuras.'});
  api('/api/children/me/game-profile').then(data=>{if(!alive()||nicknameEdited)return;setNickname(data.nickname);status.textContent=data.nickname?'Seu apelido está salvo.':'Escolha um apelido para suas aventuras.'}).catch(()=>{if(alive())status.textContent='Não foi possível carregar o apelido. Você pode tentar salvá-lo novamente.'});
  form.onsubmit=async event=>{event.preventDefault();const nickname=input.value.trim();if(!/^[\p{L}\p{N} _-]{3,20}$/u.test(nickname)){status.textContent='Use de 3 a 20 letras, números, espaços, _ ou -.';input.focus();return}const button=form.querySelector('button');button.disabled=true;status.textContent='Salvando…';try{const data=await api('/api/children/me/game-profile',{method:'PATCH',body:JSON.stringify({nickname})});if(alive()){setNickname(data.nickname);frame.contentWindow?.postMessage({type:'nb:nickname',nickname:data.nickname},location.origin);status.textContent='Apelido salvo. Sua próxima sessão usará este nome.'}}catch(err){if(alive())status.textContent='Não foi possível salvar: '+err.message}finally{button.disabled=false}};
  async function refreshHistory(){const request=++historyRequest,box=root.querySelector('#kidHistory');try{const data=await api('/api/children/me/game-sessions');if(!alive()||request!==historyRequest)return;const sessions=Array.isArray(data.sessions)?data.sessions.slice(0,12):[];box.innerHTML=sessions.length?'<ol class="kid-session-list">'+sessions.map(session=>{const date=new Date(session.startedAt),duration=Math.max(0,Number(session.durationSeconds)||0),stars=Math.max(0,Math.min(3,Number(session.stars)||0));return '<li><div><strong>'+escapeHtml(names[session.gameId]||'Aventura')+'</strong><small>'+escapeHtml(session.nickname||'Aventureiro')+' · '+escapeHtml(Number.isNaN(date.getTime())?'Data indisponível':date.toLocaleString('pt-BR'))+'</small></div><div><strong>'+escapeHtml(Number(session.score)||0)+' pontos</strong><small>Fase '+escapeHtml(Number(session.level)||1)+' · '+Math.floor(duration/60)+'min '+Math.floor(duration%60)+'s · '+escapeHtml({'started':'Em andamento','ended':'Encerrada','completed':'Concluída'}[session.status]||'Registrada')+'</small><small aria-label="'+stars+' estrelas">'+'★'.repeat(stars)+'☆'.repeat(3-stars)+'</small></div></li>'}).join('')+'</ol>':'<p class="empty-state">Seu diário começa na primeira aventura. Escolha um mundo e jogue!</p>'}catch{if(alive()&&request===historyRequest)box.textContent='Não foi possível carregar seu diário. Toque em Atualizar para tentar novamente.'}}
  root.querySelector('#kidHistoryRefresh').onclick=refreshHistory;refreshHistory();
  function onSessionMessage(event){if(!alive()){window.removeEventListener('message',onSessionMessage);return}if(event.origin!==location.origin||event.source!==frame.contentWindow)return;if(event.data?.type==='nb:session-ended')refreshHistory();if(event.data?.type==='nb:resize'&&Number.isFinite(event.data.height)){frame.style.height=Math.max(320,Math.min(1600,Math.ceil(event.data.height)))+'px';frame.style.minHeight='0'}}
  window.addEventListener('message',onSessionMessage);
  root.kidCleanup=()=>{pause();window.removeEventListener('message',onSessionMessage)};
}

function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>({signup:signupForm,signin:signinForm,kidlogin:kidLoginForm}[b.dataset.open]||(()=>notify('Área em construção')) )());
$('#modalClose').onclick=closeModal;modal.onclick=e=>{if(e.target===modal)closeModal()};
modal.setAttribute('aria-hidden','true');
const menuToggle=$('#menuToggle'),siteNavigation=$('.topbar nav');
if(menuToggle&&siteNavigation){
  if(!siteNavigation.id)siteNavigation.id='siteNavigation';
  menuToggle.setAttribute('aria-controls',siteNavigation.id);menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label','Abrir menu de navegação');
  function setMenu(open){siteNavigation.classList.toggle('open',open);menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'Fechar menu de navegação':'Abrir menu de navegação')}
  menuToggle.onclick=()=>setMenu(!siteNavigation.classList.contains('open'));
  siteNavigation.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>setMenu(false)));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&siteNavigation.classList.contains('open')){setMenu(false);menuToggle.focus()}});
}
document.addEventListener('keydown',event=>{
  if(!modal.classList.contains('show'))return;
  if(event.key==='Escape'){event.preventDefault();closeModal();return}
  if(event.key==='Tab'){
    const focusable=modalFocusable(),first=focusable[0],last=focusable[focusable.length-1];
    if(!first){event.preventDefault();modal.querySelector('.modal').focus();return}
    if(event.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){event.preventDefault();first.focus()}
  }
});
$('#siteThemeToggle')?.addEventListener('click',toggleTheme);

const game=$('#miniGame'),ctx=game?.getContext('2d');
let px=60,py=220,vy=0,run=false,previewVisible=false,previewFrame=null,previewLastTime=0;
const previewPlatforms=[{x:190,y:200,w:110},{x:390,y:160,w:100}];
function previewGrounded(){return py>=220||previewPlatforms.some(platform=>Math.abs(py+40-platform.y)<.1&&px+28>platform.x&&px<platform.x+platform.w)}
function previewShape(x,y,w,h,r,color){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=color;ctx.fill()}
function previewCloud(x,y,scale){
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.fillStyle='#ffffffbd';ctx.beginPath();ctx.ellipse(0,8,35,10,0,0,Math.PI*2);ctx.ellipse(-14,0,14,15,0,0,Math.PI*2);ctx.ellipse(4,-6,18,20,0,0,Math.PI*2);ctx.ellipse(24,4,14,12,0,0,Math.PI*2);ctx.fill();ctx.restore();
}
function previewFlower(x,y,color,size=1){
  ctx.save();ctx.translate(x,y);ctx.scale(size,size);ctx.strokeStyle='#74a898';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,8);ctx.lineTo(0,-3);ctx.stroke();ctx.fillStyle=color;
  for(let petal=0;petal<5;petal++){const angle=petal*Math.PI*2/5;ctx.beginPath();ctx.arc(Math.cos(angle)*4,-5+Math.sin(angle)*4,3.2,0,Math.PI*2);ctx.fill()}
  ctx.fillStyle='#fff5bd';ctx.beginPath();ctx.arc(0,-5,2.3,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawPreview(time=0){
  if(!ctx)return;
  const sky=ctx.createLinearGradient(0,0,0,300);sky.addColorStop(0,'#eaeaf8');sky.addColorStop(.62,'#eef8ef');sky.addColorStop(1,'#dbefe0');ctx.fillStyle=sky;ctx.fillRect(0,0,560,300);
  const sunshine=ctx.createRadialGradient(450,67,10,450,67,85);sunshine.addColorStop(0,'#fff6d0');sunshine.addColorStop(1,'#fff6d000');ctx.fillStyle=sunshine;ctx.fillRect(355,0,190,170);
  ctx.fillStyle='#f7dba7';ctx.beginPath();ctx.arc(450,67,24,0,Math.PI*2);ctx.fill();
  previewCloud(130,65,.8);previewCloud(330,47,.7);previewCloud(516,107,.56);
  ctx.fillStyle='#d8e6d9';ctx.beginPath();ctx.moveTo(0,221);ctx.bezierCurveTo(70,103,118,134,190,198);ctx.bezierCurveTo(280,95,353,122,425,193);ctx.bezierCurveTo(500,139,530,168,560,165);ctx.lineTo(560,300);ctx.lineTo(0,300);ctx.fill();
  ctx.fillStyle='#bcd8c9';ctx.beginPath();ctx.moveTo(0,244);ctx.bezierCurveTo(75,172,127,227,218,221);ctx.bezierCurveTo(342,181,355,219,429,220);ctx.bezierCurveTo(479,212,512,182,560,221);ctx.lineTo(560,300);ctx.lineTo(0,300);ctx.fill();
  ctx.fillStyle='#9ec7b2';ctx.beginPath();ctx.moveTo(0,259);ctx.bezierCurveTo(93,242,190,266,289,252);ctx.bezierCurveTo(395,241,470,254,560,248);ctx.lineTo(560,300);ctx.lineTo(0,300);ctx.fill();
  ctx.fillStyle='#edf0d6';ctx.beginPath();ctx.moveTo(0,272);ctx.bezierCurveTo(156,252,211,287,360,268);ctx.bezierCurveTo(434,258,512,268,560,271);ctx.lineTo(560,285);ctx.bezierCurveTo(400,278,321,300,213,287);ctx.bezierCurveTo(116,277,53,285,0,288);ctx.fill();
  previewPlatforms.forEach(platform=>{previewShape(platform.x,platform.y+3,platform.w,14,7,'#91b6a4');previewShape(platform.x-3,platform.y,platform.w+6,8,4,'#e9efcc');previewFlower(platform.x+16,platform.y-5,'#e5a2b5',.7)});
  [[21,259,'#ceabd9',.85],[102,267,'#f3cad0',1],[336,262,'#efb9c6',.85],[512,259,'#d6b2df',1],[541,265,'#f4d795',.8]].forEach(flower=>previewFlower(...flower));
  for(let i=0;i<6;i++){
    const cx=150+i*65,cy=235-(i%3)*55+(run&&!visualPreferences.motion?Math.sin(time/600+i)*2:0);
    ctx.fillStyle='#fff6d8';ctx.beginPath();ctx.arc(cx,cy,10,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#e2be77';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cx,cy,7,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#d6ac60';ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillText('✦',cx,cy+3);
  }
  ctx.fillStyle='#547c6928';ctx.beginPath();ctx.ellipse(px+14,py+41,18,4,0,0,Math.PI*2);ctx.fill();
  const character=ctx.createLinearGradient(px,py,px+28,py+38);character.addColorStop(0,'#b69adf');character.addColorStop(1,'#8a71bd');
  previewShape(px,py+2,28,34,12,character);previewShape(px+3,py,6,10,3,'#ae91d7');previewShape(px+20,py,6,10,3,'#ae91d7');previewShape(px+3,py+31,8,9,4,'#8067b4');previewShape(px+17,py+31,8,9,4,'#8067b4');
  ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(px+9,py+16,4,5,0,0,Math.PI*2);ctx.ellipse(px+20,py+16,4,5,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#443359';ctx.beginPath();ctx.arc(px+10,py+17,1.8,0,Math.PI*2);ctx.arc(px+21,py+17,1.8,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#57406e';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(px+15,py+23,3,0,Math.PI);ctx.stroke();
  previewShape(18,17,113,28,14,'#ffffffa6');ctx.fillStyle='#66766d';ctx.textAlign='left';ctx.font='600 10px system-ui';ctx.fillText('✦ BLOOM QUEST',31,35);
}
function previewCanAnimate(){return !!ctx&&run&&previewVisible&&!document.hidden&&!document.body.classList.contains('portal-mode')&&(!visualPreferences.motion||!previewGrounded()||vy!==0)}
function cancelPreviewFrame(){if(previewFrame!==null)cancelAnimationFrame(previewFrame);previewFrame=null;previewLastTime=0}
function schedulePreview(){if(previewCanAnimate()&&previewFrame===null)previewFrame=requestAnimationFrame(animatePreview)}
function animatePreview(time){
  previewFrame=null;if(!previewCanAnimate()){previewLastTime=0;return}
  const delta=previewLastTime?Math.min((time-previewLastTime)/16.667,2):1;previewLastTime=time;
  const oldFeet=py+40;if(!visualPreferences.motion)px+=1.2*delta;
  if(!previewGrounded()||vy!==0){vy+=.25*delta;py+=vy*delta}
  let landing=260;
  if(vy>=0)previewPlatforms.forEach(platform=>{if(px+28>platform.x&&px<platform.x+platform.w&&oldFeet<=platform.y+.1&&py+40>=platform.y)landing=Math.min(landing,platform.y)});
  if(py+40>=landing){py=landing-40;vy=0}
  if(px>540){px=10;py=220;vy=0}
  drawPreview(time);schedulePreview();
}
function previewAction(action){
  if(!run||!ctx)return;
  if(action==='left')px=Math.max(0,px-12);
  if(action==='right')px=Math.min(530,px+12);
  if(action==='jump'&&previewGrounded())vy=-8;
  drawPreview();schedulePreview();
}
function setPreviewRunning(active){
  run=active;const button=$('#playPreview');if(button){button.textContent=run?'Pausar prévia':'Jogar prévia';button.setAttribute('aria-pressed',String(run))}
  document.querySelectorAll('[data-preview-control]').forEach(button=>button.disabled=!run);
  if(run){game?.focus({preventScroll:true});schedulePreview()}else{cancelPreviewFrame();drawPreview()}
}
if(game&&ctx){
  game.width=560;game.height=300;game.tabIndex=0;game.setAttribute('role','group');game.setAttribute('aria-label','Prévia interativa de Jardins de Aurora');game.setAttribute('aria-describedby','previewInstructions');
  const instructions=document.createElement('p');instructions.id='previewInstructions';instructions.className='sr-only';instructions.textContent='Ative Jogar prévia. Com o jogo em foco, use as setas esquerda e direita para andar, espaço ou seta para cima para pular. Toque no cenário para pular. Escape pausa o jogo.';instructions.style.cssText='position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';game.after(instructions);
  if(!document.querySelector('[data-preview-control]')){const controls=document.createElement('div');controls.className='preview-controls';controls.setAttribute('aria-label','Controles da prévia');controls.innerHTML='<button class="preview-control" data-preview-control="left" aria-label="Mover para a esquerda">←</button><button class="preview-control" data-preview-control="jump" aria-label="Pular">Pular ↑</button><button class="preview-control" data-preview-control="right" aria-label="Mover para a direita">→</button>';instructions.after(controls)}
  document.querySelectorAll('[data-preview-control]').forEach(button=>{button.type='button';button.onclick=()=>{game.focus({preventScroll:true});previewAction(button.dataset.previewControl)}});
  game.addEventListener('keydown',event=>{if(document.activeElement!==game||!run)return;const action={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowUp:'jump',' ':'jump',w:'jump',W:'jump'}[event.key];if(action){event.preventDefault();previewAction(action)}else if(event.key==='Escape'){event.preventDefault();setPreviewRunning(false);$('#playPreview')?.focus()}});
  game.style.touchAction='manipulation';game.addEventListener('pointerdown',()=>{game.focus({preventScroll:true});previewAction('jump')});
  $('#playPreview')?.addEventListener('click',()=>setPreviewRunning(!run));
  if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{previewVisible=entries[0].isIntersecting;if(previewVisible){drawPreview();schedulePreview()}else cancelPreviewFrame()},{threshold:.05});observer.observe(game)}else previewVisible=true;
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelPreviewFrame();else{drawPreview();schedulePreview()}});
  document.addEventListener('neurobloom:preferences',()=>{cancelPreviewFrame();drawPreview();schedulePreview()});
  drawPreview();setPreviewRunning(false);
}

(()=>{
  const icon=paths=>'<svg viewBox="0 0 24 24" class="settings-icon" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg>';
  const gear=icon('<path d="m9 3-.6 2.2-2 .9-2-.6-2 3.4 1.6 1.6-.2 2.1-1.5 1.6 2 3.4 2.2-.6 1.8 1L9 21h4l.6-2.2 2-.9 2 .6 2-3.4-1.6-1.6.2-2.1 1.5-1.6-2-3.4-2.2.6-1.8-1L13 3H9Z"/><circle cx="11" cy="12" r="3"/>');
  const moon=icon('<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/><path d="M17 3v4m-2-2h4"/>');
  const movement=icon('<path d="M3 7h9M5 12h13M3 17h9m6-10 4 5-4 5"/>');
  const letters=icon('<path d="m3 19 6-14 6 14M5 15h8m4-3c4-2 5 0 5 2v5m0-4c-6-2-7 4-2 4l2-1"/>');
  const shield=icon('<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6"/>');
  const bloom='<svg viewBox="0 0 32 32" class="settings-bloom" aria-hidden="true"><use href="#i-bloom"/></svg>';
  const fab=document.createElement('button');
  fab.id='settingsToggle';fab.type='button';fab.className='settings-fab';fab.title='Configurações de aparência e acessibilidade';
  fab.setAttribute('aria-label','Abrir configurações de aparência e acessibilidade');fab.setAttribute('aria-controls','settingsPanel');fab.setAttribute('aria-expanded','false');
  fab.innerHTML=gear+'<span class="settings-fab-tooltip" aria-hidden="true">Sua experiência</span>';
  document.body.appendChild(fab);

  const drawer=document.createElement('div');
  drawer.id='settingsDrawer';drawer.className='settings-drawer';drawer.inert=true;drawer.setAttribute('aria-hidden','true');
  drawer.innerHTML=`
    <div class="settings-backdrop" id="settingsBackdrop" aria-hidden="true"></div>
    <aside id="settingsPanel" class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" aria-describedby="settingsDescription" tabindex="-1">
      <header class="settings-drawer-header">
        <div class="settings-heading-icon">${bloom}</div>
        <div class="settings-heading-copy"><span class="settings-kicker">NO SEU RITMO</span><h2 id="settingsTitle">Sua experiência</h2></div>
        <button type="button" class="settings-close" id="settingsClose" aria-label="Fechar configurações">${icon('<path d="m6 6 12 12M18 6 6 18"/>')}</button>
        <p id="settingsDescription">Pequenos ajustes. Um espaço mais seu.</p>
      </header>
      <div class="settings-drawer-content">
        <div class="settings-preview" aria-hidden="true">
          <div class="settings-preview-top"><span class="settings-preview-brand">${bloom} NeuroBloom</span><span class="settings-preview-badge" id="settingsThemeName">Escuro</span></div>
          <div class="settings-preview-copy">Floresça<br><span>do seu jeito.</span><span class="settings-preview-flower">${bloom}</span></div>
          <div class="settings-preview-cards"><i></i><i></i><i></i></div>
        </div>
        <div class="settings-preview-caption"><i></i> Seus ajustes aparecem na hora</div>
        <section class="settings-group" aria-labelledby="appearanceTitle">
          <div class="settings-group-heading"><h3 id="appearanceTitle">Aparência</h3><span>01</span></div>
          <div class="settings-options">
            <label class="setting-row" for="prefDark"><span class="setting-icon setting-icon-lilac">${moon}</span><span class="setting-copy"><strong>Modo escuro</strong><small id="prefDarkDescription">Uma paleta para cada momento.</small></span><input class="switch" id="prefDark" type="checkbox" role="switch" aria-label="Modo escuro" aria-describedby="prefDarkDescription"></label>
          </div>
        </section>
        <section class="settings-group" aria-labelledby="accessibilityTitle">
          <div class="settings-group-heading"><h3 id="accessibilityTitle">Conforto & acessibilidade</h3><span>02</span></div>
          <div class="settings-options">
            <label class="setting-row" for="prefMotion"><span class="setting-icon setting-icon-mint">${movement}</span><span class="setting-copy"><strong>Reduzir animações</strong><small id="prefMotionDescription">Uma experiência mais tranquila.</small></span><input class="switch" id="prefMotion" type="checkbox" role="switch" aria-label="Reduzir animações" aria-describedby="prefMotionDescription"></label>
            <label class="setting-row" for="prefFont"><span class="setting-icon setting-icon-peach">${letters}</span><span class="setting-copy"><strong>Fonte maior</strong><small id="prefFontDescription">Mais espaço para cada palavra.</small></span><input class="switch" id="prefFont" type="checkbox" role="switch" aria-label="Fonte maior" aria-describedby="prefFontDescription"></label>
          </div>
        </section>
        <button type="button" class="settings-reset" id="settingsReset">${icon('<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7"/>')} Restaurar padrão</button>
      </div>
      <footer class="settings-drawer-footer"><span class="settings-privacy-icon">${shield}</span><div><strong>Seu jeito fica salvo.</strong><p>Preferências ficam somente neste navegador.</p></div><span class="settings-saved-dot" aria-hidden="true"></span></footer>
    </aside>`;
  document.body.appendChild(drawer);
  const panel=$('#settingsPanel'),backdrop=$('#settingsBackdrop'),close=$('#settingsClose');
  let returnFocus=null,inertElements=[],isOpen=false;
  const focusable=()=>[...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(element=>element.getClientRects().length);
  function setSettings(open,restoreFocus=true){
    if(isOpen===open)return;
    isOpen=open;
    if(open){
      returnFocus=document.activeElement;
      panel.querySelector('.settings-drawer-content').scrollTop=0;
      inertElements=[...document.body.children].filter(element=>element!==drawer&&element.id!=='toast'&&element.tagName!=='SCRIPT').map(element=>[element,element.inert]);
      inertElements.forEach(([element])=>element.inert=true);
    }else{
      inertElements.forEach(([element,previous])=>element.inert=previous);inertElements=[];
    }
    drawer.inert=!open;drawer.setAttribute('aria-hidden',String(!open));drawer.classList.toggle('open',open);panel.classList.toggle('open',open);
    document.body.classList.toggle('settings-open',open);
    fab.setAttribute('aria-expanded',String(open));
    if(open)requestAnimationFrame(()=>{if(isOpen)close.focus({preventScroll:true})});
    else if(restoreFocus&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    if(!open)returnFocus=null;
  }
  closeVisualSettings=restoreFocus=>setSettings(false,restoreFocus!==false);
  fab.onclick=()=>setSettings(true);
  close.onclick=()=>setSettings(false);
  backdrop.onclick=()=>setSettings(false);
  document.addEventListener('keydown',event=>{
    if(!isOpen)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setSettings(false);return}
    if(event.key==='Tab'){
      const elements=focusable(),first=elements[0],last=elements[elements.length-1],active=document.activeElement;
      if(!first){event.preventDefault();panel.focus();return}
      if(!panel.contains(active)||(event.shiftKey&&active===first)||(!event.shiftKey&&active===last)){
        event.preventDefault();(event.shiftKey?last:first).focus();
      }
    }
  },true);
  $('#prefDark').onchange=event=>{visualPreferences.dark=event.target.checked;applyVisualPreferences(true)};
  $('#prefMotion').onchange=event=>{explicitMotionPreference=true;visualPreferences.motion=event.target.checked;applyVisualPreferences(true)};
  $('#prefFont').onchange=event=>{visualPreferences.font=event.target.checked;applyVisualPreferences(true)};
  $('#settingsReset').onclick=()=>{
    explicitMotionPreference=false;visualPreferences={dark:true,motion:motionPreference.matches,font:false};applyVisualPreferences(true);
    notify('Préférências restauradas. Tudo pronto para florescer.');
  };
  document.addEventListener('neurobloom:preferences',()=>{
    $('#settingsThemeName').textContent=visualPreferences.dark?'Escuro':'Claro';
  });
  applyVisualPreferences();
})();
checkApi({silent:true});
async function restorePortalRoute(){
  const path=location.pathname.replace(/\/+$/,'')||'/',request=++portalRequest;
  if(path!=='/responsavel'&&path!=='/crianca'){leavePortal('none');return}
  if(location.pathname!==path)history.replaceState(history.state,'',path+location.search+location.hash);
  try{
    if(path==='/responsavel'){
      const family=await api('/api/family');
      if(request!==portalRequest||location.pathname!==path)return;
      await showPortal(family.guardian,family.children?.[0],{historyMode:'none'});
    }else{
      const r=await api('/api/children/me');
      if(request!==portalRequest||location.pathname!==path)return;
      if(!r.child){const err=new Error('Faça o acesso infantil para abrir este painel.');err.status=401;throw err}
      await showChildPortal(r.child,{historyMode:'none'});
    }
  }catch(err){
    if(request!==portalRequest||location.pathname!==path)return;
    if(err.status===401||err.status===403){leavePortal('replace');path==='/responsavel'?signinForm():kidLoginForm();notify(path==='/responsavel'?'Faça login para abrir o painel do responsável.':'Faça o acesso infantil para abrir este painel.')}
    else{leavePortal('none');notify(err.message)}
  }
}
window.addEventListener('popstate',restorePortalRoute);
if(/^\/(responsavel|crianca)\/?$/.test(location.pathname))restorePortalRoute();
