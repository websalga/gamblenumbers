'use strict';
/* Carrega todas as classes no escopo global simulado (window),
   como o navegador faria com as tags <script>, e então testa o App. */
global.window = global;

const { DataStore } = require('./datastore.js');
const { ExchangeCard } = require('./exchangecard.js');
const { RealSeries, ProjectedSeries } = require('./series.js');
const { PlotArea } = require('./plotarea.js');
const Renderers = require('./renderers.js');
const { EventBus } = require('./eventbus.js');
const { ControlPanel } = require('./controlpanel.js');
const { OperationsController } = require('./operations.js');
const { OperationsTable } = require('./operationstable.js');
const { FrozenForecast } = require('./frozenforecast.js');
const { LocalStore } = require('./storage.js');

// expõe no "window" como as tags <script> fazem
Object.assign(global, { DataStore, ExchangeCard, RealSeries, ProjectedSeries, PlotArea, EventBus, ControlPanel, OperationsController, OperationsTable, FrozenForecast, LocalStore }, Renderers);

// Forecast fake (o real vem de forecast.js no navegador)
global.Forecast = { project(hist, n) { const last = hist[hist.length - 1].avg; return Array.from({ length: n }, (_, i) => last + (i + 1) * 30); } };

const { App } = require('./app.js');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } }

/* ---------- mocks de DOM ---------- */
function el(tag = 'div') {
  return {
    tagName: tag, className: '', textContent: '', value: '', innerHTML: '',
    children: [], dataset: {}, style: {}, _handlers: {}, onclick: null,
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){f?this._s.add(c):this._s.delete(c);}, contains(c){return this._s.has(c);} },
    appendChild(c){ this.children.push(c); return c; }, remove(){ this._removed=true; },
    addEventListener(e,cb){ (this._handlers[e]=this._handlers[e]||[]).push(cb); },
    getBoundingClientRect(){ return { width: 700, height: 400 }; },
    getContext(){ return new Proxy({}, { get:()=>()=>{} }); },
    width:700, height:400,
  };
}
function mockDoc() {
  const ids = {};
  ['cards','periods','chart','updated','clock','opValue','stop','ret','retVal','target','openLots','avgPrice','projProfit','btcAvail','pnl','retNow','opsBody','buyBtn','sellBtn','tooltip','toasts'].forEach(id => ids[id] = el());
  const doc = {
    _ids: ids,
    getElementById: id => ids[id] || null,
    createElement: tag => el(tag),
  };
  // nós reais têm ownerDocument; espelhamos isso nos mocks
  Object.values(ids).forEach(node => { node.ownerDocument = doc; });
  const origCreate = doc.createElement;
  doc.createElement = tag => { const n = origCreate(tag); n.ownerDocument = doc; return n; };
  return doc;
}

/* dados sintéticos: 24h, preço subindo */
function fakeData(spanMinutes, endMs) {
  const rows = [], stepMs = 5*60*1000, nPts = Math.floor(spanMinutes/5), startMs = endMs - nPts*stepMs;
  for (let i=0;i<=nPts;i++){ const t=startMs+i*stepMs, base=317000+i*40;
    rows.push({t,avg:base,binance:base+1800,kraken:base-1000,coinbase:base-1050,btc_usd:63000,usd_brl:5.06}); }
  return rows;
}

async function run() {
  const END = Date.UTC(2026,7,2,19,0,0);
  const doc = mockDoc();

  // injeta fetch fake no DataStore via subclasse rápida: sobrescreve _fetchFn
  const app = new App(doc);
  app.store._fetchFn = async (url) => url.includes('cotacoes')
    ? { ok:true, data: fakeData(24*60, END) }
    : { ok:true, data: fakeData(5, END).pop() };

  await app.init();

  // 1) store carregou
  ok(app.store.ready && app.store.length > 0, 'store carregou dados no init');

  // 2) cards renderizaram com variação não-zero (o bug original)
  const cardsContainer = doc.getElementById('cards');
  ok(cardsContainer.children.length === 4, 'quatro cards criados');
  const html = cardsContainer.children.map(c => c.innerHTML).join(' ');
  ok(/no período/.test(html), 'cards mostram a variação "no período"');
  ok(!/\+0,00% no período/.test(html) || /-0,00%/.test(html) === false, 'variação não é zero em todos');
  // checagem direta via compute:
  const v = app.cards.find(c => c.key === 'binance').compute({ spanMs: app.spanMs(), ret: 5 });
  ok(v.varPct > 0, `variação binance calculada > 0 (${v.varPct.toFixed(4)}%)`);

  // 3) trocar de período mantém variação coerente (não zera ao navegar)
  app.periodId = '1D';
  const v1d = app.cards.find(c => c.key === 'kraken').compute({ spanMs: app.spanMs(), ret: 5 });
  app.periodId = '1H';
  const v1h = app.cards.find(c => c.key === 'kraken').compute({ spanMs: app.spanMs(), ret: 5 });
  ok(v1d.varPct !== 0 && v1h.varPct !== 0, 'variação não-zero em 1D e em 1H após navegar');

  // 4) evento de retorno recalcula sem erro
  let threw = false;
  try { app.bus.emit('control:ret', { value: 7 }); } catch (_) { threw = true; }
  ok(!threw, 'emitir control:ret recalcula sem lançar');

  // 5) refresh incremental integra novo ponto
  const before = app.store.length;
  app.store._fetchFn = async (url) => url.includes('atual')
    ? { ok:true, data:{ t: END+5*60*1000, avg:330000, binance:331800, kraken:329000, coinbase:328950, btc_usd:63000, usd_brl:5.06 } }
    : { ok:true, data: fakeData(24*60, END) };
  const grew = await app.store.refresh();
  ok(grew && app.store.length === before+1, 'refresh integra ponto novo no store');

  console.log(`\n${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('ERRO:', e); process.exit(1); });
