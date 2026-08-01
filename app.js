'use strict';
/* ============ formatação ============ */
const BRL = n => 'R$ ' + n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const USD = n => 'US$ ' + n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
const BTC = n => n.toLocaleString('pt-BR',{minimumFractionDigits:8,maximumFractionDigits:8});
const PCT = n => (n>=0?'+':'') + n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) + '%';
const parseBRL = s => { const v = parseFloat(String(s).replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.')); return isNaN(v)?0:v; };
let USDRATE = 5.4; // atualizado com usd_brl real do último snapshot
function realUsdRate(){ const last=state.raw[state.raw.length-1]; return (last&&last.usd_brl)?last.usd_brl:USDRATE; }
const pad = n => String(n).padStart(2,'0');
const fmtUTC = d => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth()+1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

/* ============ estado ============ */
const EXCH = {avg:'Média',binance:'Binance',kraken:'Kraken',coinbase:'Coinbase'};
const COL  = {avg:'#22d3ee',binance:'#f7c948',kraken:'#a855f7',coinbase:'#3b82f6'};
const PREMIUM = {avg:0, binance:0.0015, kraken:-0.0020, coinbase:0.0008}; // ágio/deságio vs média

const PERIODS = [
  {id:'5M',  label:'5M',  points:60,  stepMs:5*60*1000/60,      vol:0.0012, trend: 0.00004, freq:3.0},
  {id:'10M', label:'10M', points:60,  stepMs:10*60*1000/60,     vol:0.0016, trend:-0.00003, freq:2.4},
  {id:'20M', label:'20M', points:60,  stepMs:20*60*1000/60,     vol:0.0022, trend: 0.00005, freq:2.0},
  {id:'30M', label:'30M', points:60,  stepMs:30*60*1000/60,     vol:0.0028, trend: 0.00002, freq:1.8},
  {id:'1H',  label:'1H',  points:60,  stepMs:60*60*1000/60,     vol:0.0035, trend:-0.00004, freq:1.5},
  {id:'6H',  label:'6H',  points:72,  stepMs:6*3600*1000/72,    vol:0.0060, trend: 0.00006, freq:1.2},
  {id:'1D',  label:'1D',  points:96,  stepMs:24*3600*1000/96,   vol:0.0090, trend: 0.00003, freq:1.0},
  {id:'7D',  label:'7D',  points:84,  stepMs:7*86400*1000/84,   vol:0.0150, trend:-0.00005, freq:0.8},
  {id:'30D', label:'30D', points:90,  stepMs:30*86400*1000/90,  vol:0.0240, trend: 0.00008, freq:0.6},
  {id:'1Y',  label:'1Y',  points:96,  stepMs:365*86400*1000/96, vol:0.0400, trend: 0.00010, freq:0.4},
];

const BASE = 350000; // preço base BTC em R$
let state = {
  periodId:'1H',
  ret:5.0,
  opValue:55000,
  stop:0,
  lots:[],       // {id,seq,time,price,brl,qty,remaining,sold,realized,status}
  sells:[],      // {id,seq,markTime,markPrice,qty,reserved,status}
  lotSeq:0,
  sellSeq:0,
  now:Date.now(),
  series:{},     // por período: {hist:[{t,avg,binance,kraken,coinbase}], fut:[...]}
  updatedAt:Date.now(),
};

/* ============ dados REAIS + projeção estatística ============
 * state.raw = array de snapshots reais {t,avg,binance,kraken,coinbase,...}
 * carregado do backend (api.php?acao=cotacoes). Cada período faz um "resample"
 * da série real na sua escala temporal, e a metade futura é projetada
 * pelo módulo Forecast a partir do histórico real.
 */
state.raw = [];
state.dataReady = false;
state.predLog = {}; // por período: [{t, avg}] previsões CONGELADAS no momento em que foram feitas

// registra uma previsão congelada (previsto vs realizado)
function logPrediction(pid, t, avg){
  if(!state.predLog[pid]) state.predLog[pid]=[];
  const log=state.predLog[pid];
  // evita duplicar o mesmo instante; mantém o primeiro valor previsto
  if(!log.some(e=>Math.abs(e.t-t)<1)) log.push({t, avg});
  // limita tamanho
  if(log.length>2000) log.shift();
}

async function loadReal(limite){
  const res = await fetch('api.php?acao=cotacoes&limite='+(limite||1500));
  const j = await res.json();
  if(!j.ok || !j.data.length) throw new Error(j.error||'Sem dados do backend.');
  state.raw = j.data;
  state.now = state.raw[state.raw.length-1].t; // "agora" = último snapshot real
  state.dataReady = true;
  state.predLog = {}; // recomeça o registro de previsões
  state.series = {}; // invalida cache
}

// pega o snapshot real mais próximo de um instante t
function nearestRaw(t){
  const r=state.raw; if(!r.length) return null;
  let lo=0, hi=r.length-1;
  while(lo<hi){ const m=(lo+hi)>>1; if(r[m].t<t) lo=m+1; else hi=m; }
  const a=r[Math.max(0,lo-1)], b=r[lo];
  return (Math.abs(a.t-t)<=Math.abs(b.t-t))? a : b;
}

// reamostra a série real na escala do período e projeta o futuro
function buildSeries(pid){
  const p = PERIODS.find(x=>x.id===pid);
  const n = p.points;
  const hist=[];
  const end = state.now;
  const start = end - n*p.stepMs;
  for(let i=0;i<n;i++){
    const t = start + i*p.stepMs;
    const snap = nearestRaw(t);
    if(snap){
      hist.push({ t, avg:snap.avg, binance:snap.binance, kraken:snap.kraken, coinbase:snap.coinbase });
    } else {
      const prev = hist[hist.length-1];
      hist.push(prev? {...prev,t} : {t,avg:0,binance:0,kraken:0,coinbase:0});
    }
  }
  // projeção estatística baseada no histórico real reamostrado
  const proj = window.Forecast.project(hist, n, PREMIUM);
  // preserva o ágio/deságio médio real de cada exchange p/ aplicar na projeção
  const spread = avgSpread(hist);
  const fut=[];
  for(let i=0;i<n;i++){
    const avg = proj[i];
    fut.push({
      t: end + (i+1)*p.stepMs,
      avg,
      binance: avg*(1+spread.binance),
      kraken:  avg*(1+spread.kraken),
      coinbase:avg*(1+spread.coinbase),
    });
  }
  return {hist,fut};
}

// ágio/deságio médio real de cada exchange vs a média (price_brl)
function avgSpread(hist){
  const acc={binance:0,kraken:0,coinbase:0}, cnt={binance:0,kraken:0,coinbase:0};
  hist.forEach(h=>{
    ['binance','kraken','coinbase'].forEach(k=>{
      if(h.avg>0 && h[k]>0){ acc[k]+=(h[k]/h.avg-1); cnt[k]++; }
    });
  });
  return {
    binance: cnt.binance? acc.binance/cnt.binance : 0,
    kraken:  cnt.kraken?  acc.kraken/cnt.kraken   : 0,
    coinbase:cnt.coinbase?acc.coinbase/cnt.coinbase:0,
  };
}

function makePoint(t,avg){ // usado só como fallback
  return { t, avg, binance:avg, kraken:avg, coinbase:avg };
}
function getSeries(){ if(!state.series[state.periodId]) state.series[state.periodId]=buildSeries(state.periodId); return state.series[state.periodId]; }
function curAvg(){ const s=getSeries(); const h=s.hist[s.hist.length-1]; return h?h.avg:0; }
function curPrice(ex){ const s=getSeries(); const h=s.hist[s.hist.length-1]; return h?(h[ex]||h.avg):0; }

/* ============ cálculos de lotes ============ */
function openLots(){ return state.lots.filter(l=>l.remaining>1e-12); }
function weightedAvg(){
  const o=openLots(); let q=0,c=0;
  o.forEach(l=>{ q+=l.remaining; c+=l.remaining*l.price; });
  return q>0? c/q : 0;
}
function totalRemainingBTC(){ return openLots().reduce((a,l)=>a+l.remaining,0); }
function reservedBTC(){ return state.sells.filter(s=>s.status==='pending').reduce((a,s)=>a+s.reserved,0); }
function freeBTC(){ return Math.max(0, totalRemainingBTC()-reservedBTC()); }
function targetPrice(){ const w=weightedAvg(); return w>0? w*(1+state.ret/100) : curAvg()*(1+state.ret/100); }

/* ============ ações ============ */
function doBuy(price, atTime){
  const val = state.opValue;
  if(val<=0){ toast('warn','Informe um valor de compra válido.'); return; }
  const qty = val/price;
  state.lotSeq++;
  state.lots.push({
    id:'LT'+state.lotSeq, seq:state.lotSeq, time:atTime||state.now,
    price, brl:val, qty, remaining:qty, sold:0, realized:0, status:'open'
  });
  toast('ok', `Compra registrada • ${'LT'+state.lotSeq} • ${BTC(qty)} BTC @ ${BRL(price)}`);
  refreshAll();
}

function scheduleSell(markPrice, markTime){
  const free = freeBTC();
  if(free<=1e-10){ toast('err','Saldo totalmente reservado. Nenhuma venda possível.'); return; }
  const val = state.opValue;
  let qty = val/markPrice;
  let adjusted=false;
  if(qty>free){ qty=free; adjusted=true; }
  state.sellSeq++;
  state.sells.push({
    id:'V'+state.sellSeq, seq:state.sellSeq, markTime, markPrice,
    qty, reserved:qty, status:'pending', origVal:val
  });
  if(adjusted) toast('warn',`Ordem ajustada ao saldo final • V${state.sellSeq} • ${BTC(qty)} BTC`);
  else toast('ok',`Venda agendada • V${state.sellSeq} • ${BTC(qty)} BTC @ ${BRL(markPrice)}`);
  refreshAll();
}

function cancelSell(id){
  const s=state.sells.find(x=>x.id===id && x.status==='pending');
  if(!s) return;
  s.status='cancelled';
  toast('info',`Venda ${id} cancelada • ${BTC(s.reserved)} BTC liberados`);
  refreshAll();
}

// FIFO
function executeSell(sell, execPrice){
  let qty = sell.qty;
  let orderPnl=0, orderCost=0, orderQty=0;
  const lots = state.lots.filter(l=>l.remaining>1e-12).sort((a,b)=>a.seq-b.seq);
  for(const l of lots){
    if(qty<=1e-12) break;
    const take = Math.min(l.remaining, qty);
    const pnl = take*(execPrice - l.price);
    l.remaining -= take;
    l.sold += take;
    l.realized += pnl;
    if(l.remaining<=1e-10){ l.remaining=0; l.status='closed'; }
    orderPnl+=pnl; orderCost+=take*l.price; orderQty+=take;
    qty -= take;
  }
  sell.status = 'executed';
  sell.execPrice = execPrice;
  sell.execTime = state.now;
  sell.reserved = 0;
  sell._profit = orderPnl;
  sell._pnl = orderPnl;
  sell._value = orderQty*execPrice;
  sell._ret = orderCost>0? orderPnl/orderCost*100 : 0;
}

/* ============ avanço do tempo ============
 * Busca no backend snapshots reais mais novos que o último conhecido.
 * Se houver novos, o "agora" avança para dados reais; a projeção é
 * refeita a partir do histórico real atualizado. Se não houver novos
 * (banco ainda não gravou), o tempo avança consumindo a projeção,
 * como um cenário até o próximo dado real chegar.
 */
async function tick(){
  const p = PERIODS.find(x=>x.id===state.periodId);
  let gotReal=false;
  try{
    const res=await fetch('api.php?acao=atual');
    const j=await res.json();
    if(j.ok && j.data.t > state.raw[state.raw.length-1].t){
      // antes de refazer, congela as previsões atuais para comparar com o realizado
      const sPrev=state.series[state.periodId];
      if(sPrev && sPrev.fut){ sPrev.fut.forEach(pt=>logPrediction(state.periodId, pt.t, pt.avg)); }
      state.raw.push(j.data);
      if(state.raw.length>3000) state.raw.shift();
      state.now = j.data.t;
      state.series={}; // refaz reamostragem + projeção com dado real novo
      gotReal=true;
      state.updatedAt=Date.now();
    }
  }catch(e){ /* backend fora do ar: segue com projeção */ }

  if(!gotReal){
    // avança consumindo a projeção estatística
    const s=getSeries();
    const next=s.fut.shift();
    if(next){
      next.t=state.now;
      s.hist.push(next); s.hist.shift();
      // novo ponto projetado à direita, refit a partir do histórico atual
      const reproj=window.Forecast.project(s.hist, 1, PREMIUM);
      const sp=avgSpread(s.hist); const avg=reproj[0];
      const newT=state.now+s.fut.length*p.stepMs+p.stepMs;
      logPrediction(state.periodId, newT, avg); // congela a previsão feita agora
      s.fut.push({t:newT, avg,
        binance:avg*(1+sp.binance), kraken:avg*(1+sp.kraken), coinbase:avg*(1+sp.coinbase)});
    }
    state.now += p.stepMs;
    state.updatedAt=Date.now();
  }

  // vendas cujo markTime alcançou o "agora"
  state.sells.filter(x=>x.status==='pending' && x.markTime<=state.now).forEach(sell=>{
    const cur = curAvg();
    if(cur >= sell.markPrice - 1e-9){
      const exec = Math.max(cur, sell.markPrice);
      executeSell(sell, exec);
      if(exec>sell.markPrice+1e-6) toast('ok',`Venda ${sell.id} executada e elevada para a cotação atual ${BRL(exec)}`);
      else toast('ok',`Venda ${sell.id} executada @ ${BRL(exec)}`);
    } else {
      sell.status='expired';
      toast('err',`Venda ${sell.id} expirada • cotação-alvo ${BRL(sell.markPrice)} não atingida`);
    }
  });
  refreshAll();
}

/* expõe para render/interação */
window.__S = state;

/* ============ canvas render ============ */
const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
let VIEW = {x0:0,y0:0,w:0,h:0, tMin:0,tMax:0, pMin:0,pMax:0};
let mouse = {x:null,y:null,inside:false, blinkUntil:0};

function resize(){
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio||1;
  canvas.width = r.width*dpr; canvas.height = r.height*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  VIEW.w=r.width; VIEW.h=r.height;
}
window.addEventListener('resize',()=>{resize();draw();});

function computeBounds(){
  const s=getSeries();
  const all=[...s.hist,...s.fut];
  let pMin=Infinity,pMax=-Infinity;
  all.forEach(pt=>{['avg','binance','kraken','coinbase'].forEach(k=>{pMin=Math.min(pMin,pt[k]);pMax=Math.max(pMax,pt[k]);});});
  // inclui alvo e ordens
  const tgt=targetPrice(); pMin=Math.min(pMin,tgt);pMax=Math.max(pMax,tgt);
  state.sells.filter(x=>x.status==='pending').forEach(x=>{pMin=Math.min(pMin,x.markPrice);pMax=Math.max(pMax,x.markPrice);});
  const pad=(pMax-pMin)*0.08||1;
  VIEW.pMin=pMin-pad; VIEW.pMax=pMax+pad;
  VIEW.tMin=all[0].t; VIEW.tMax=all[all.length-1].t;
}
const PADL=8, PADR=64, PADT=10, PADB=22;
function X(t){ const {tMin,tMax}=VIEW; const x0=PADL, x1=VIEW.w-PADR; return x0+(t-tMin)/(tMax-tMin)*(x1-x0); }
function Y(p){ const {pMin,pMax}=VIEW; const y0=VIEW.h-PADB, y1=PADT; return y0+(p-pMin)/(pMax-pMin)*(y1-y0); }
function invX(x){ const x0=PADL,x1=VIEW.w-PADR; return VIEW.tMin+(x-x0)/(x1-x0)*(VIEW.tMax-VIEW.tMin); }
function invY(y){ const y0=VIEW.h-PADB,y1=PADT; return VIEW.pMin+(y-y0)/(y1-y0)*(VIEW.pMax-VIEW.pMin); }

function timeLabel(t){
  const p=PERIODS.find(x=>x.id===state.periodId);
  const d=new Date(t);
  if(['5M','10M','20M','30M','1H'].includes(p.id)) return pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
  if(['6H','1D'].includes(p.id)) return pad(d.getUTCHours())+'h';
  if(['7D','30D'].includes(p.id)) return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1);
  return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][d.getUTCMonth()];
}

function draw(){
  computeBounds();
  ctx.clearRect(0,0,VIEW.w,VIEW.h);
  const s=getSeries();
  const nowX = X(state.now);
  // fundo previsão (direita)
  ctx.fillStyle='rgba(34,211,238,0.03)';
  ctx.fillRect(nowX,PADT,(VIEW.w-PADR)-nowX,VIEW.h-PADB-PADT);
  // grid horizontal + eixo preço
  ctx.strokeStyle='rgba(30,42,68,0.6)'; ctx.fillStyle='#7d8aa3'; ctx.font='10px monospace'; ctx.textAlign='left';
  for(let i=0;i<=4;i++){
    const p=VIEW.pMin+(VIEW.pMax-VIEW.pMin)*i/4; const y=Y(p);
    ctx.beginPath();ctx.moveTo(PADL,y);ctx.lineTo(VIEW.w-PADR,y);ctx.stroke();
    ctx.fillText((p/1000).toFixed(0)+'k', VIEW.w-PADR+4, y+3);
  }
  // eixo tempo
  ctx.textAlign='center';
  const all=[...s.hist,...s.fut];
  const step=Math.floor(all.length/6);
  for(let i=0;i<all.length;i+=step){ const x=X(all[i].t); ctx.fillText(timeLabel(all[i].t), x, VIEW.h-6); }

  // linhas por exchange
  const keys=['coinbase','kraken','binance','avg'];
  keys.forEach(k=>{
    // histórico contínuo
    ctx.beginPath(); ctx.strokeStyle=COL[k]; ctx.lineWidth=k==='avg'?2:1.3; ctx.setLineDash([]);
    s.hist.forEach((pt,i)=>{ const x=X(pt.t),y=Y(pt[k]); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.stroke();
    // previsão pontilhada
    ctx.beginPath(); ctx.setLineDash([4,4]); ctx.globalAlpha=0.85;
    const lastH=s.hist[s.hist.length-1];
    ctx.moveTo(X(lastH.t),Y(lastH[k]));
    s.fut.forEach(pt=>{ ctx.lineTo(X(pt.t),Y(pt[k])); });
    ctx.stroke(); ctx.globalAlpha=1; ctx.setLineDash([]);
  });

  // previsão CONGELADA sobre o histórico (previsto vs realizado)
  // desenha a linha da média que havia sido prevista, agora que o tempo já passou
  const log = state.predLog[state.periodId];
  if(log && log.length){
    const pts = log.filter(e=> e.t>=VIEW.tMin && e.t<=state.now).sort((a,b)=>a.t-b.t);
    if(pts.length>1){
      ctx.beginPath();
      ctx.strokeStyle='#22d3ee'; // mesma cor da média, mas pontilhada e translúcida
      ctx.setLineDash([2,3]); ctx.lineWidth=1; ctx.globalAlpha=0.55;
      pts.forEach((e,i)=>{ const x=X(e.t),y=Y(e.avg); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
      ctx.stroke();
      ctx.globalAlpha=1; ctx.setLineDash([]);
      // rótulo discreto
      ctx.fillStyle='rgba(34,211,238,0.7)'; ctx.font='9px monospace'; ctx.textAlign='left';
      const first=pts[0];
      ctx.fillText('previsão anterior', X(first.t)+3, Y(first.avg)-4);
    }
  }

  // linha alvo (percorre todo o gráfico)
  const tgt=targetPrice();
  ctx.strokeStyle='#22c55e'; ctx.setLineDash([6,4]); ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(PADL,Y(tgt)); ctx.lineTo(VIEW.w-PADR,Y(tgt)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#22c55e'; ctx.textAlign='left'; ctx.font='10px monospace';
  ctx.fillText('ALVO '+BRL(tgt), PADL+4, Y(tgt)-4);

  // divisor AGORA
  ctx.strokeStyle='rgba(232,237,247,0.55)'; ctx.setLineDash([3,3]); ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(nowX,PADT); ctx.lineTo(nowX,VIEW.h-PADB); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#e8edf7'; ctx.textAlign='center'; ctx.font='bold 10px monospace';
  ctx.fillText('AGORA', nowX, PADT+10);
  // rótulos de área
  ctx.fillStyle='#7d8aa3'; ctx.font='9px monospace';
  ctx.textAlign='left'; ctx.fillText('HISTÓRICO CONFIRMADO', PADL+4, PADT+10);
  ctx.textAlign='right'; ctx.fillText('CENÁRIO PROJETADO', VIEW.w-PADR-4, PADT+10);

  drawLotMarkers(); drawSellMarkers(); drawCursor();
}

function inView(t){ return t>=VIEW.tMin && t<=VIEW.tMax; }

function drawLotMarkers(){
  const blink = Date.now()<mouse.blinkUntil;
  const cursorP = (mouse.inside && invX(mouse.x)>state.now)? invY(mouse.y) : null;
  state.lots.forEach(l=>{
    if(!inView(l.time)) return;
    const x=X(l.time), y=Y(l.price);
    let color='#f7c948', suffix='';
    if(l.realized>1e-6){color='#22c55e';suffix=' • L';}
    else if(l.realized<-1e-6){color='#ef4444';suffix=' • P';}
    // preview piscante conforme cursor no futuro
    if(cursorP!==null && blink && l.remaining>1e-12){
      const win = cursorP>l.price;
      color = (Math.floor(Date.now()/300)%2)? (win?'#22c55e':'#ef4444') : color;
    }
    ctx.fillStyle=color; ctx.beginPath(); ctx.arc(x,y,4,0,7); ctx.fill();
    ctx.fillStyle=color; ctx.font='bold 10px monospace'; ctx.textAlign='center';
    let label=l.id+suffix;
    if(cursorP!==null && blink && l.remaining>1e-12) label=l.id+(cursorP>l.price?' • L':' • P');
    ctx.fillText(label, x, y-8);
  });
}

function drawSellMarkers(){
  state.sells.forEach(v=>{
    let t = v.status==='executed'? v.execTime : v.markTime;
    let p = v.status==='executed'? v.execPrice : v.markPrice;
    if(t==null||!inView(t)) return;
    const x=X(t), y=Y(p);
    let color='#f7c948', label=v.id;
    if(v.status==='executed'){
      // resultado do conjunto: aproxima por execPrice vs média ponderada consumida — usa sinal simples
      const win = v.execPrice >= v.markPrice ? true : false;
      // determina lucro real: compara execPrice com preço médio (heurística) -> usa realized flag
      const profit = v._profit!=null? v._profit>=0 : true;
      color = profit? '#22c55e':'#ef4444';
      label = (profit?'L':'P')+v.seq;
    } else if(v.status==='pending'){ color='#f7c948'; label='V'+v.seq; }
    else return; // cancelled/expired: sem marcador
    ctx.strokeStyle=color; ctx.lineWidth=1.4; ctx.beginPath();
    ctx.moveTo(x-5,y-5);ctx.lineTo(x+5,y+5);ctx.moveTo(x+5,y-5);ctx.lineTo(x-5,y+5);ctx.stroke();
    ctx.fillStyle=color; ctx.font='bold 10px monospace'; ctx.textAlign='center';
    ctx.fillText(label, x, y-9);
  });
}

function drawCursor(){
  if(!mouse.inside) return;
  ctx.strokeStyle='rgba(125,138,163,0.4)'; ctx.setLineDash([2,3]); ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(mouse.x,PADT);ctx.lineTo(mouse.x,VIEW.h-PADB);ctx.stroke();
  ctx.beginPath();ctx.moveTo(PADL,mouse.y);ctx.lineTo(VIEW.w-PADR,mouse.y);ctx.stroke();
  ctx.setLineDash([]);
}

/* ============ interação canvas ============ */
const tooltip = document.getElementById('tooltip');
canvas.addEventListener('mousemove', e=>{
  const r=canvas.getBoundingClientRect();
  mouse.x=e.clientX-r.left; mouse.y=e.clientY-r.top; mouse.inside=true;
  const t=invX(mouse.x), pAtCursor=invY(mouse.y);
  const future = t>state.now;
  if(future){
    let lines=`<b>Prévia de venda</b><br>Preço livre: <b>${BRL(pAtCursor)}</b><br>`;
    const o=openLots();
    if(o.length){
      lines+='<span style="color:#7d8aa3">Lotes verdes lucram, vermelhos perdem.</span><br>';
      o.slice(0,4).forEach(l=>{ const win=pAtCursor>l.price; lines+=`<span style="color:${win?'#22c55e':'#ef4444'}">${l.id} ${win?'L':'P'}</span> `; });
    } else lines+='<span style="color:#7d8aa3">Sem lotes abertos.</span>';
    lines+='<br><span style="color:#7d8aa3">Clique para marcar a venda.</span>';
    showTip(e,lines);
    mouse.blinkUntil=Date.now()+99999; // pisca enquanto no futuro
  } else {
    // ponto histórico mais próximo
    const s=getSeries(); let best=s.hist[0],bd=Infinity;
    s.hist.forEach(pt=>{const d=Math.abs(pt.t-t); if(d<bd){bd=d;best=pt;}});
    showTip(e,`<b>Cotação real</b><br>Média: <b>${BRL(best.avg)}</b><br><span style="color:#7d8aa3">Botão direito registra uma compra.</span>`);
    mouse.blinkUntil=0;
  }
  draw();
});
canvas.addEventListener('mouseleave', ()=>{mouse.inside=false;mouse.blinkUntil=0;tooltip.style.display='none';draw();});
function showTip(e,html){ tooltip.innerHTML=html; tooltip.style.display='block'; tooltip.style.left=(e.clientX+14)+'px'; tooltip.style.top=(e.clientY+14)+'px'; }

// botão direito = compra (só histórico)
canvas.addEventListener('contextmenu', e=>{
  e.preventDefault();
  const r=canvas.getBoundingClientRect(); const x=e.clientX-r.left,y=e.clientY-r.top;
  const t=invX(x);
  if(t>state.now){ toast('warn','Compras só são permitidas no histórico.'); return; }
  const s=getSeries(); let best=s.hist[0],bd=Infinity;
  s.hist.forEach(pt=>{const d=Math.abs(pt.t-t);if(d<bd){bd=d;best=pt;}});
  doBuy(best.avg, best.t);
});

// clique esquerdo = venda (só futuro) ou cancelar próxima
canvas.addEventListener('click', e=>{
  const r=canvas.getBoundingClientRect(); const x=e.clientX-r.left,y=e.clientY-r.top;
  const t=invX(x), p=invY(y);
  if(t<=state.now) return;
  // cancelar se perto de venda pendente
  for(const v of state.sells.filter(s=>s.status==='pending')){
    const vx=X(v.markTime),vy=Y(v.markPrice);
    if(Math.hypot(vx-x,vy-y)<14){ cancelSell(v.id); return; }
  }
  scheduleSell(p, t);
  mouse.blinkUntil=Date.now()+3000; draw();
});

/* ============ UI updates ============ */
function refreshAll(){ updateCards(); updateSide(); updateTable(); draw(); }

function updateCards(){
  const wrap=document.getElementById('cards');
  const s=getSeries();
  const first=s.hist[0], last=s.hist[s.hist.length-1];
  const w=weightedAvg(); const remain=totalRemainingBTC();
  // qual exchange dá maior lucro na meta
  const results={};
  Object.keys(EXCH).forEach(ex=>{
    const cur=last[ex];
    const varPct=(cur-first[ex])/first[ex]*100;
    // meta considera preço médio dos lotes abertos + retorno + ágio da exchange
    const baseTarget = (w>0? w : cur)*(1+state.ret/100);
    const exTarget = baseTarget*(1+PREMIUM[ex]);
    const profit = remain>0? remain*(exTarget - (w>0?w:cur)) : 0;
    results[ex]={cur,varPct,exTarget,profit};
  });
  let bestEx='avg',bestP=-Infinity;
  Object.keys(results).forEach(ex=>{ if(results[ex].profit>bestP){bestP=results[ex].profit;bestEx=ex;} });
  wrap.innerHTML='';
  Object.keys(EXCH).forEach(ex=>{
    const d=results[ex];
    const card=document.createElement('div'); card.className='card'+(ex===bestEx&&remain>0?' best':'');
    card.innerHTML=`
      ${ex===bestEx&&remain>0?'<div class="badge">MAIOR LUCRO</div>':''}
      <div class="top"><span class="name" style="color:${COL[ex]}">${EXCH[ex]}</span>
        <svg class="spark" viewBox="0 0 34 16"><polyline fill="none" stroke="${COL[ex]}" stroke-width="1.3" points="0,12 6,8 12,10 18,4 24,7 30,3 34,5"/></svg></div>
      <div class="brl">${BRL(d.cur)}</div>
      <div class="usd">${USD(d.cur/realUsdRate())}</div>
      <div class="var ${d.varPct>=0?'pos':'neg'}">${PCT(d.varPct)} no período</div>
      <div class="meta-row">Meta: <b>${BRL(d.exTarget)}</b><br>Lucro estimado: <b class="${d.profit>=0?'pos':'neg'}">${BRL(d.profit)}</b></div>`;
    wrap.appendChild(card);
  });
}

function updateSide(){
  const w=weightedAvg();
  document.getElementById('target').value = BRL(targetPrice());
  document.getElementById('openLots').textContent = openLots().length;
  document.getElementById('avgPrice').textContent = w>0?BRL(w):'—';
  const remain=totalRemainingBTC();
  const proj = remain>0? remain*(targetPrice()-w) : 0;
  document.getElementById('projProfit').textContent = remain>0?BRL(proj):'—';
  document.getElementById('btcAvail').textContent = BTC(remain);
  // lucro/prejuízo atual = realizado + não realizado (a preço atual)
  const realized=state.lots.reduce((a,l)=>a+l.realized,0);
  const cur=curAvg();
  const unreal=openLots().reduce((a,l)=>a+l.remaining*(cur-l.price),0);
  const pnl=realized+unreal;
  const el=document.getElementById('pnl'); el.textContent=BRL(pnl); el.className='';
  el.style.color = pnl>=0?'#22c55e':'#ef4444';
  const cost=openLots().reduce((a,l)=>a+l.remaining*l.price,0);
  const ret = cost>0? unreal/cost*100 : 0;
  const re=document.getElementById('retNow'); re.textContent=PCT(ret); re.style.color=ret>=0?'#22c55e':'#ef4444';
}

function updateTable(){
  const body=document.getElementById('opsBody'); body.innerHTML='';
  // lotes
  state.lots.forEach(l=>{
    let cls='row-y', res='—', ret='—';
    if(l.realized>1e-6){cls='row-g';} else if(l.realized<-1e-6){cls='row-r';}
    if(Math.abs(l.realized)>1e-6){ res=BRL(l.realized); ret=PCT(l.realized/(l.sold*l.price)*100); }
    else { const cur=curAvg(); const u=l.remaining*(cur-l.price); res='<span style="color:#7d8aa3">'+BRL(u)+' proj.</span>'; ret=PCT(l.price>0?(cur-l.price)/l.price*100:0); }
    const tr=document.createElement('tr'); tr.className=cls;
    tr.innerHTML=`<td><b>${l.id}</b></td><td><span class="tag tag-buy">Compra</span></td>
      <td>${fmtUTC(new Date(l.time))}</td><td>${BRL(l.price)}</td>
      <td>${BTC(l.qty)}<br><span style="color:#7d8aa3;font-size:10px">rest. ${BTC(l.remaining)}</span></td>
      <td>${BRL(l.brl)}</td><td>${res}</td><td>${ret}</td>`;
    body.appendChild(tr);
  });
  // vendas
  state.sells.forEach(v=>{
    if(v.status==='cancelled'||v.status==='expired') return;
    let cls='row-y', res='VENDA CONDICIONAL', ret='—', price=v.markPrice, val=v.origVal, qty=v.reserved||v.qty;
    if(v.status==='executed'){
      cls=v._profit>=0?'row-g':'row-r';
      res=BRL(v._pnl); ret=PCT(v._ret); price=v.execPrice; val=v._value; qty=v.qty;
    } else {
      const steps=Math.max(0,Math.ceil((v.markTime-state.now)/PERIODS.find(p=>p.id===state.periodId).stepMs));
      res=`VENDA CONDICIONAL<br><span style="color:#7d8aa3;font-size:10px">faltam ${steps} passos</span>`;
    }
    const tr=document.createElement('tr'); tr.className=cls;
    const label = v.status==='executed'? (v._profit>=0?'L':'P')+v.seq : 'V'+v.seq;
    tr.innerHTML=`<td><b>${label}</b></td><td><span class="tag tag-sell">Venda</span></td>
      <td>${fmtUTC(new Date(v.status==='executed'?v.execTime:v.markTime))}</td><td>${BRL(price)}</td>
      <td>${BTC(qty)}</td><td>${BRL(val)}</td><td>${res}</td><td>${ret}</td>`;
    body.appendChild(tr);
  });
  if(!state.lots.length && !state.sells.length){
    body.innerHTML='<tr><td colspan="8" style="color:#7d8aa3;text-align:center;padding:20px">Nenhuma operação ainda. Clique com o botão direito no histórico para comprar.</td></tr>';
  }
}

/* ============ toasts ============ */
function toast(type,msg){
  const box=document.getElementById('toasts');
  const el=document.createElement('div'); el.className='toast '+type; el.textContent=msg;
  box.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .4s';setTimeout(()=>el.remove(),400);},4200);
}

/* ============ controles laterais / períodos ============ */
function buildPeriods(){
  const wrap=document.getElementById('periods'); wrap.innerHTML='';
  PERIODS.forEach(p=>{
    const b=document.createElement('button'); b.textContent=p.label;
    if(p.id===state.periodId) b.className='active';
    b.onclick=()=>{ state.periodId=p.id; getSeries(); [...wrap.children].forEach(c=>c.classList.remove('active')); b.classList.add('active'); refreshAll(); };
    wrap.appendChild(b);
  });
}
document.getElementById('ret').addEventListener('input',e=>{
  state.ret=parseFloat(e.target.value);
  document.getElementById('retVal').textContent=state.ret.toFixed(1);
  refreshAll();
});
document.getElementById('opValue').addEventListener('change',e=>{ state.opValue=parseBRL(e.target.value); e.target.value=BRL(state.opValue); refreshAll(); });
document.getElementById('stop').addEventListener('change',e=>{ state.stop=parseBRL(e.target.value); e.target.value=BRL(state.stop); });
document.getElementById('buyBtn').onclick=()=>doBuy(curAvg(), state.now);
document.getElementById('sellBtn').onclick=()=>{
  const free=freeBTC(); if(free<=1e-10){toast('err','Saldo totalmente reservado.');return;}
  scheduleSell(targetPrice(), state.now + PERIODS.find(p=>p.id===state.periodId).stepMs*8);
};

/* ============ clock ============ */
function updateClock(){
  const d=new Date();
  document.getElementById('clock').textContent=`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  const secs=Math.floor((Date.now()-state.updatedAt)/1000);
  document.getElementById('updated').textContent=`Dados atualizados há ${secs}s`;
}

/* ============ init ============ */
async function init(){
  resize();
  buildPeriods();
  document.getElementById('opValue').value=BRL(state.opValue);
  document.getElementById('stop').value=BRL(state.stop);
  document.getElementById('updated').textContent='Carregando cotações reais…';
  try{
    await loadReal(1500);
    toast('ok','Cotações reais carregadas do SQL Server.');
  }catch(e){
    toast('err','Não foi possível carregar do backend: '+e.message);
    document.getElementById('updated').textContent='Falha ao conectar ao backend';
    return; // sem dados reais não há o que mostrar
  }
  getSeries();
  refreshAll();
  setInterval(updateClock,1000); updateClock();
  setInterval(tick,8000);        // busca dados reais novos / avança cenário
  setInterval(()=>{ if(mouse.inside||Date.now()<mouse.blinkUntil) draw(); },120);
}
init();

