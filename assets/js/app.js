// ===== Helpers =====
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const $=id=>document.getElementById(id);
const fmt=n=>Number.isFinite(n)?n.toString():'-';

// ===== Estado =====
let state={
  horizon:30,
  quantum:1, // referência (assumido no texto)
  processos:[
    {id:'P1', chegada:0, burst:4, cor:'#86efac'},
    {id:'P2', chegada:1, burst:10, cor:'#93c5fd'},
    {id:'P3', chegada:3, burst:1, cor:'#fca5a5'},
    {id:'P4', chegada:4, burst:3, cor:'#fcd34d'},
  ],
  grid:{ FCFS:{}, SJF:{}, RR:{} },
  metrics:{ FCFS:[], SJF:[], RR:[] },
  rrQueue:[[],[],[],[]], // 4 posições por tempo (controle manual)
};

// ===== Processos (UI) =====
function renderProcessos(){
  const tbody=$('proc-tbody'); if(!tbody) return; tbody.innerHTML='';
  state.processos.forEach((p,i)=>{
    const tr=document.createElement('tr'); tr.className='border-b';
    tr.innerHTML=`
      <td class="p-2"><input class="w-16 px-2 py-1 rounded border" value="${p.id}" oninput="updatePid(${i}, this.value)"/></td>
      <td class="p-2"><input type="number" min="0" class="w-20 px-2 py-1 rounded border" value="${p.chegada}" oninput="updateChegada(${i}, this.value)"/></td>
      <td class="p-2"><input type="number" min="1" class="w-20 px-2 py-1 rounded border" value="${p.burst}" oninput="updateBurst(${i}, this.value)"/></td>
      <td class="p-2"><input type="color" value="${p.cor}" onchange="updateCor(${i}, this.value)"/></td>
      <td class="p-2 text-right"><button class="text-red-600 hover:underline" onclick="removeProc(${i})">remover</button></td>`;
    tbody.appendChild(tr);
  });
  renderAllGrades();
  renderAllMetrics();
  renderComparison();
  renderQueueControlRR();
}
window.updatePid=(i,v)=>{state.processos[i].id=v||`P${i+1}`; renderAllGrades(); renderAllMetrics(); renderComparison(); renderQueueControlRR();};
window.updateChegada=(i,v)=>{state.processos[i].chegada=clamp(parseInt(v||0),0,999); renderAllMetrics(); renderComparison();};
window.updateBurst=(i,v)=>{state.processos[i].burst=clamp(parseInt(v||1),1,999); renderAllMetrics(); renderComparison();};
window.updateCor=(i,v)=>{state.processos[i].cor=v; renderAllGrades();};
window.addProc=()=>{const n=state.processos.length+1; state.processos.push({id:`P${n}`, chegada:0, burst:3, cor:randPastel()}); renderProcessos();};
window.removeProc=i=>{state.processos.splice(i,1); renderProcessos();};
function randPastel(){const r=()=>Math.floor(140+Math.random()*100); const h=x=>x.toString(16).padStart(2,'0'); return `#${h(r())}${h(r())}${h(r())}`;}

// ===== Grade + Métricas =====
function ensureRow(alg, id){
  const H=state.horizon;
  if(!state.grid[alg][id]) state.grid[alg][id]=Array(H).fill('');
  let row=state.grid[alg][id];
  if(row.length!==H){ if(row.length<H) row.push(...Array(H-row.length).fill('')); else state.grid[alg][id]=row=row.slice(0,H); }
  return row;
}

function renderGrade(alg, hostId){
  const H=state.horizon; const host=$(hostId); if(!host) return; host.innerHTML='';
  const head=document.createElement('div'); head.className='grid grid-cols-[120px_repeat(var(--c),minmax(20px,1fr))] gap-1 items-center text-xs font-medium'; head.style.setProperty('--c',H);
  head.innerHTML=`<div class="text-right pr-2 text-slate-500">tempo →</div>`+Array.from({length:H}).map((_,i)=>`<div class="text-center text-slate-500">${i}</div>`).join('');
  host.appendChild(head);
  state.processos.forEach(p=>{
    const row=document.createElement('div'); row.className='grid grid-cols-[120px_repeat(var(--c),minmax(20px,1fr))] gap-1 items-center'; row.style.setProperty('--c',H);
    const label=document.createElement('div'); label.className='text-right pr-2 font-semibold'; label.textContent=p.id; row.appendChild(label);
    const arr=ensureRow(alg, p.id);
    for(let t=0;t<H;t++){
      const v=arr[t]||''; const cell=document.createElement('button');
      const base='h-7 rounded text-xs flex items-center justify-center border';
      let extra='bg-slate-100 hover:bg-slate-200 border-slate-200'; let text='';
      if(v==='x'){ extra='bg-green-200 border-green-300 font-bold'; text='x'; }
      if(v==='w'){ extra='bg-orange-200 border-orange-300 font-bold'; text='w'; }
      cell.className=base+' '+extra; cell.textContent=text; cell.title=`${alg} • t=${t}`;
      cell.onclick=()=>{ const cur=state.grid[alg][p.id][t]||''; const next=cur===''?'x':(cur==='x'?'w':''); state.grid[alg][p.id][t]=next; renderGrade(alg, hostId); calcMetrics(alg); renderMetrics(alg); renderComparison(); };
      row.appendChild(cell);
    }
    host.appendChild(row);
  });
}

function clearGrade(alg){
  const H=state.horizon; state.processos.forEach(p=>state.grid[alg][p.id]=Array(H).fill(''));
  renderGrade(alg, `grid-${alg.toLowerCase()}`);
  calcMetrics(alg); renderMetrics(alg); renderComparison();
}

function calcMetrics(alg){
  const H=state.horizon;
  state.metrics[alg] = state.processos.map(p=>{
    const arr=(state.grid[alg]&&state.grid[alg][p.id])||[];
    // Espera: RR usa "espera inicial"; FCFS/SJF usam soma de 'w'
    let waiting;
    const firstX = arr.indexOf('x');
    if(alg==='RR'){
      waiting = (firstX<0 || !Number.isFinite(p.chegada)) ? null : Math.max(0, firstX - (p.chegada||0));
    } else {
      waiting = arr.filter(c=>c==='w').length;
    }
    // Turnaround = término (último x + 1) − chegada
    const lastX=[...arr].reverse().findIndex(c=>c==='x');
    const finish=lastX<0?null:(H-1-lastX+1);
    const turnaround=finish==null?null:(finish-(p.chegada||0));
    return { id:p.id, chegada:p.chegada, burst:p.burst, waiting, turnaround };
  });
}

function renderMetrics(alg){
  const body=$(`metrics-${alg.toLowerCase()}`); if(!body) return; body.innerHTML='';
  const rows=state.metrics[alg] && state.metrics[alg].length ? state.metrics[alg] : state.processos.map(p=>({id:p.id, chegada:p.chegada, burst:p.burst, waiting:null, turnaround:null}));
  rows.forEach(r=>{
    const tr=document.createElement('tr'); tr.className='border-b';
    tr.innerHTML=`
      <td class=\"p-2 font-semibold\">${r.id}</td>
      <td class=\"p-2 text-center\">${fmt(r.chegada)}</td>
      <td class=\"p-2 text-center\">${fmt(r.burst)}</td>
      <td class=\"p-2 text-center\">${fmt(r.waiting)}</td>
      <td class=\"p-2 text-center\">${fmt(r.turnaround)}</td>`;
    body.appendChild(tr);
  });
  const avg=a=>{const v=a.filter(Number.isFinite); return v.length?(v.reduce((x,y)=>x+y,0)/v.length).toFixed(2):'-';};
  $(`avg-w-${alg.toLowerCase()}`).textContent=avg(rows.map(r=>r.waiting));
  $(`avg-t-${alg.toLowerCase()}`).textContent=avg(rows.map(r=>r.turnaround));
}

function renderAllGrades(){ ['FCFS','SJF','RR'].forEach(alg=>renderGrade(alg, `grid-${alg.toLowerCase()}`)); }
function renderAllMetrics(){ ['FCFS','SJF','RR'].forEach(alg=>{calcMetrics(alg); renderMetrics(alg);}); }

// ===== Comparativo (médias) =====
function renderComparison(){
  const avg=a=>{const v=a.filter(Number.isFinite); return v.length?(v.reduce((x,y)=>x+y,0)/v.length).toFixed(2):'-';};
  const ensure=alg=>{ if(!state.metrics[alg]||!state.metrics[alg].length) { calcMetrics(alg); } };
  ['FCFS','SJF','RR'].forEach(ensure);
  const set=(id,val)=>{ const el=$(id); if(el) el.textContent=val; };
  const W=alg=>avg((state.metrics[alg]||[]).map(r=>r.waiting));
  const T=alg=>avg((state.metrics[alg]||[]).map(r=>r.turnaround));
  set('cmp-w-fcfs', W('FCFS')); set('cmp-t-fcfs', T('FCFS'));
  set('cmp-w-sjf',  W('SJF'));  set('cmp-t-sjf',  T('SJF'));
  set('cmp-w-rr',   W('RR'));   set('cmp-t-rr',   T('RR'));
}

// ===== Fila RR — Controle manual =====
function ensureQueueSize(){
  const H = state.horizon;
  if(!state.rrQueue || !Array.isArray(state.rrQueue) || state.rrQueue.length!==4){
    state.rrQueue = [[],[],[],[]];
  }
  for(let r=0;r<4;r++){
    if(!Array.isArray(state.rrQueue[r])) state.rrQueue[r]=[];
    if(state.rrQueue[r].length!==H){
      if(state.rrQueue[r].length<H) state.rrQueue[r].push(...Array(H-state.rrQueue[r].length).fill(''));
      else state.rrQueue[r] = state.rrQueue[r].slice(0,H);
    }
  }
}
function cycleQueueValue(cur){
  const ids = state.processos.map(p=>p.id);
  const all = [''].concat(ids);
  const i = all.indexOf(cur);
  const next = all[(i+1) % all.length];
  return next;
}
function applyRRQueueToGridColumn(t){
  const alg = 'RR';
  const ids = state.processos.map(p=>p.id);
  ids.forEach(id=>{
    if(!state.grid[alg][id]) state.grid[alg][id] = Array(state.horizon).fill('');
    state.grid[alg][id][t] = '';
  });
  const col = [state.rrQueue[0][t], state.rrQueue[1][t], state.rrQueue[2][t], state.rrQueue[3][t]];
  const seen = new Set();
  if(col[0] && ids.includes(col[0])){ state.grid[alg][col[0]][t] = 'x'; seen.add(col[0]); }
  for(let i=1;i<col.length;i++){
    const id = col[i];
    if(id && ids.includes(id) && !seen.has(id)) state.grid[alg][id][t] = 'w';
  }
  calcMetrics('RR');
  renderMetrics('RR');
  renderGrade('RR','grid-rr');
  renderComparison();
}
function renderQueueControlRR(){
  ensureQueueSize();
  const H = state.horizon;
  const host = document.getElementById('queue-rr-control-host');
  if(!host) return;
  host.innerHTML='';
  const head = document.createElement('div');
  head.className='grid grid-cols-[80px_repeat(var(--c),minmax(20px,1fr))] gap-1 items-center text-xs font-medium';
  head.style.setProperty('--c', H);
  head.innerHTML = `<div class=\"text-right pr-2 text-slate-500\">tempo →</div>` + Array.from({length:H}).map((_,i)=>`<div class=\"text-center text-slate-500\">${i}</div>`).join('');
  host.appendChild(head);
  for(let r=0;r<4;r++){
    const row = document.createElement('div');
    row.className='grid grid-cols-[80px_repeat(var(--c),minmax(20px,1fr))] gap-1 items-center';
    row.style.setProperty('--c', H);
    const label = document.createElement('div');
    label.className='text-right pr-2 font-semibold';
    label.textContent = r===0 ? '1ª posição' : `${r+1}ª posição`;
    row.appendChild(label);
    for(let t=0;t<H;t++){
      const v = state.rrQueue[r][t] || '';
      const cell = document.createElement('button');
      const base='h-7 rounded text-xs flex items-center justify-center border min-w-[20px]';
      let extra = r===0 ? 'bg-green-200 border-green-300' : 'bg-orange-200 border-orange-300';
      cell.className = base + ' ' + extra + ' hover:opacity-80';
      cell.textContent = v;
      cell.title = `pos=${r+1}, t=${t}`;
      cell.onclick = ()=>{
        state.rrQueue[r][t] = cycleQueueValue(v);
        renderQueueControlRR();
        applyRRQueueToGridColumn(t);
      };
      row.appendChild(cell);
    }
    host.appendChild(row);
  }
}
function clearRRQueue(){
  state.rrQueue = [[],[],[],[]];
  ensureQueueSize();
  const H = state.horizon; state.processos.forEach(p=>{ if(!state.grid.RR[p.id]) state.grid.RR[p.id]=Array(H).fill(''); state.grid.RR[p.id].fill(''); });
  renderQueueControlRR();
  renderGrade('RR','grid-rr');
  calcMetrics('RR'); renderMetrics('RR'); renderComparison();
}

// ===== Init =====
window.onload=()=>{ renderProcessos(); renderAllGrades(); renderAllMetrics(); renderComparison(); renderQueueControlRR(); };
