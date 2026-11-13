const $ = id => document.getElementById(id);
let key = '', hospitalName = '';
const dialog = $('popup');
const labels = {PENDING:'응답 대기', ACCEPTED:'수용 확정', DECLINED:'수용 불가', CANCELLED:'구급대원 호출 취소', CLOSED_BY_CONFIRMATION:'타 병원 확정으로 호출 종료'};
let rows = [], selected = null, seen = new Set(), busy = false, version = 0;

function element(tag,text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
async function json(url, options) {
  const res = await fetch(url,{cache:'no-store',...options,headers:{...options?.headers,Authorization:'Bearer '+key}});
  if (!res.ok && !(options?.method === 'POST' && res.status === 409)) throw Object.assign(Error(), {status:res.status});
  return res.status === 204 || res.status === 409 ? null : res.json();
}
function show(record) {
  selected = record.id;
  const r = record.report;
  $('hospitalName').textContent = hospitalName;
  $('patient').textContent = [r.patient,r.symptoms].filter(Boolean).join(' · ') || '환자 보고서';
  $('status').className = record.status;
  $('status').textContent = record.status === 'PENDING' ? '응급 환자 호출 · KTAS ' + r.ktas : labels[record.status];
  $('severity').textContent = 'KTAS ' + r.ktas;
  $('notes').textContent = '대원 메모  ' + (r.notes || '없음');
  $('facilities').textContent = r.requiredFacilities?.length ? '필수 시설  ' + r.requiredFacilities.join(', ') : '';
  $('fields').replaceChildren();
  for (const [name,value] of Object.entries({'혈압':r.bp,'의식':r.consciousness,'발현':r.onset,'ETA':record.eta == null ? '' : record.eta+'분'})) {
    const tile = document.createElement('div');
    tile.append(element('dt',name),element('dd',value || '—'));
    $('fields').append(tile);
  }
  $('actions').hidden = record.status !== 'PENDING';
  for(const b of $('actions').children) b.disabled = busy;
  if (!dialog.open) dialog.showModal();
}
function renderList(id,list,empty) {
  const container = $(id);
  container.replaceChildren();
  if (!list.length) container.append(element('p',empty));
  for (const r of list) {
    const button = document.createElement('button');
    button.className = 'row';
    const info = element('span',[r.report.patient,r.report.symptoms].filter(Boolean).join(' · ') || '환자 보고서');
    info.append(element('small',(r.retryOf?'재요청':'최초 호출')+' · KTAS '+r.report.ktas+(id==='queue' ? ' · ETA '+(r.eta == null ? '—' : r.eta+'분') : ' · '+new Date(r.startedAt).toLocaleString('ko-KR'))));
    const badge = element('span',labels[r.status]);
    badge.className = 'badge '+r.status;
    button.append(info,badge);
    button.onclick = () => { $('feedback').textContent=''; show(r); };
    container.append(button);
  }
}
function render() {
  $('activeHospital').textContent = hospitalName ? hospitalName + ' · ' : '';
  $('date').textContent = new Date().toLocaleDateString('sv-SE');
  const pending = rows.filter(r=>r.status==='PENDING');
  const today = new Date().toDateString();
  const responses = rows.filter(r=>r.respondedAt && new Date(r.respondedAt).toDateString()===today);
  $('waiting').textContent=pending.length+'건';
  $('accepted').textContent=responses.filter(r=>r.status==='ACCEPTED').length+'건';
  $('average').textContent=responses.length ? Math.round(responses.reduce((sum,r)=>sum+Date.parse(r.respondedAt)-Date.parse(r.startedAt),0)/responses.length/1000)+'초' : '—';
  renderList('queue',pending,'대기 중인 호출이 없습니다.');
  renderList('history',rows.filter(r=>r.status!=='PENDING'),'종료된 호출이 없습니다.');
  const current=rows.find(r=>r.id===selected);
  if(dialog.open && current && current.status==='CLOSED_BY_CONFIRMATION' && !$('actions').hidden) {
    $('closedCall').textContent=(current.report.patient || '환자')+' · 다른 병원으로 확정되어 호출이 종료되었습니다.';
    $('closedCall').hidden=false;
    dialog.close();
  } else if(dialog.open && current) show(current);
  else if(!dialog.open && $('alerts').getAttribute('aria-pressed')==='true') {
    const incoming=pending.find(r=>!seen.has(r.id));
    if(incoming){seen.add(incoming.id);$('feedback').textContent='';show(incoming);}
  }
}
async function refresh() {
  const revision=++version;
  try {
    const result=await json('/api/hospitals/me/requests');
    if(revision!==version)return;
    rows=result; render();
    $('notice').textContent='';
  } catch (error) {
    if(revision!==version)return;
    if(error.status===401) signOut();
    $('notice').textContent=error.status===401?'병원 접근 키를 다시 입력해 주세요.':'연결을 확인 중입니다. 잠시 후 다시 조회합니다.';
  }
}
function signOut() {
  version++; key=''; hospitalName=''; rows=[]; seen.clear(); selected=null;
  if(dialog.open)dialog.close();
  $('patient').textContent=''; $('fields').replaceChildren(); $('notes').textContent='';
  $('facilities').textContent=''; $('closedCall').textContent=''; $('closedCall').hidden=true;
  $('login').hidden=false; $('logout').hidden=true; $('notice').textContent='';
  render();
}
$('login').onsubmit=async event=>{
  event.preventDefault();
  const revision=++version;
  key=$('accessKey').value.trim();
  $('accessKey').value='';
  try {
    const identity=await json('/api/hospitals/me');
    if(revision!==version)return;
    hospitalName=identity.name; $('login').hidden=true; $('logout').hidden=false;
    await refresh();
  } catch(error) {
    if(revision!==version)return;
    signOut(); $('notice').textContent=error.status===401?'병원 접근 키를 확인해 주세요.':'서버 연결을 확인해 주세요.';
  }
};
$('logout').onclick=signOut;
async function poll(){if(hospitalName)await refresh();setTimeout(poll,1500);}
$('alerts').onclick=()=>{
  const enabled=$('alerts').getAttribute('aria-pressed')!=='true';
  $('alerts').setAttribute('aria-pressed',String(enabled));
  $('alerts').textContent=enabled?'알림 ON':'알림 OFF';
  render();
};
$('close').onclick=()=>dialog.close();
dialog.onclose=()=>{if(selected)seen.add(selected);selected=null;};
$('actions').onclick=async event=>{
  const decision=event.target.dataset.decision;
  if(busy || !decision || !selected)return;
  const id=selected;
  busy=true;
  for(const b of $('actions').children)b.disabled=true;
  try {
    await json('/api/hospitals/me/requests/'+encodeURIComponent(id)+'/response',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})});
  } catch { $('feedback').textContent='응답 전송을 확인하지 못했습니다. 현재 상태를 확인하고 다시 시도하세요.'; }
  finally {busy=false;await refresh();for(const b of $('actions').children)b.disabled=false;}
};
poll();
