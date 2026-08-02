'use strict';

(function () {
  const EXCH = { avg: 'Média', binance: 'Binance', kraken: 'Kraken', coinbase: 'Coinbase' };
  const COL = { avg: '#22d3ee', binance: '#f7c948', kraken: '#a855f7', coinbase: '#3b82f6' };
  const PREMIUM = { avg: 0, binance: 0.0015, kraken: -0.0020, coinbase: 0.0008 };
  const PERIODS = [
    { id: '5M', label: '5M', points: 60, stepMs: 5 * 60 * 1000 / 60 },
    { id: '10M', label: '10M', points: 60, stepMs: 10 * 60 * 1000 / 60 },
    { id: '20M', label: '20M', points: 60, stepMs: 20 * 60 * 1000 / 60 },
    { id: '30M', label: '30M', points: 60, stepMs: 30 * 60 * 1000 / 60 },
    { id: '1H', label: '1H', points: 60, stepMs: 60 * 60 * 1000 / 60 },
    { id: '6H', label: '6H', points: 72, stepMs: 6 * 3600 * 1000 / 72 },
    { id: '1D', label: '1D', points: 96, stepMs: 24 * 3600 * 1000 / 96 },
    { id: '7D', label: '7D', points: 84, stepMs: 7 * 86400 * 1000 / 84 },
    { id: '30D', label: '30D', points: 90, stepMs: 30 * 86400 * 1000 / 90 },
    { id: '60D', label: '60D', points: 90, stepMs: 60 * 86400 * 1000 / 90 },
    { id: '90D', label: '90D', points: 90, stepMs: 90 * 86400 * 1000 / 90 },
    { id: '120D', label: '120D', points: 96, stepMs: 120 * 86400 * 1000 / 96 },
    { id: '180D', label: '180D', points: 96, stepMs: 180 * 86400 * 1000 / 96 },
    { id: '220D', label: '220D', points: 96, stepMs: 220 * 86400 * 1000 / 96 },
    { id: '1Y', label: '1Y', points: 96, stepMs: 365 * 86400 * 1000 / 96 },
    { id: '2Y', label: '2Y', points: 104, stepMs: 2 * 365 * 86400 * 1000 / 104 },
    { id: '3Y', label: '3Y', points: 108, stepMs: 3 * 365 * 86400 * 1000 / 108 },
    { id: '5Y', label: '5Y', points: 120, stepMs: 5 * 365 * 86400 * 1000 / 120 },
  ];
  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const pad = n => String(n).padStart(2, '0');
  const BRL = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const BTC = n => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 8, maximumFractionDigits: 8 });
  const PCT = n => (n >= 0 ? '+' : '') + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  const fmtUTC = d => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

  function timeLabel(t, periodId) {
    const d = new Date(t);
    if (['5M', '10M', '20M', '30M', '1H'].includes(periodId)) return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    if (['6H', '1D'].includes(periodId)) return pad(d.getUTCHours()) + 'h';
    if (['7D', '30D', '60D', '90D', '120D', '180D', '220D'].includes(periodId)) return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1);
    if (['2Y', '3Y', '5Y'].includes(periodId)) return MES[d.getUTCMonth()] + '/' + String(d.getUTCFullYear()).slice(2);
    return MES[d.getUTCMonth()];
  }

  class App {
    constructor(doc) {
      this.doc = doc;
      this.bus = new EventBus();
      this.store = new DataStore({});
      this.periodId = '1H';
      this.real = new RealSeries({ store: this.store });
      this.projected = new ProjectedSeries({ real: this.real, forecast: window.Forecast, premium: PREMIUM });
      this.cards = Object.keys(EXCH).map(k => new ExchangeCard(k, {
        store: this.store, meta: { label: EXCH[k], color: COL[k], premium: PREMIUM[k] },
      }));

      this.canvas = doc.getElementById('chart');
      this.plot = new PlotArea({ canvas: this.canvas, colors: Object.assign({}, COL) });
      this.renderers = {
        projBg: new ProjectionBgRenderer(), priceAxis: new PriceAxisRenderer({ lines: 4 }),
        timeAxis: new TimeAxisRenderer({ ticks: 6 }), series: new SeriesRenderer(),
        target: new TargetLineRenderer(), now: new NowDividerRenderer(),
        lots: new LotMarkerRenderer(), sells: new SellMarkerRenderer(), cursor: new CursorRenderer(),
      };
      this.panel = new ControlPanel({ doc, bus: this.bus, defaults: { opValue: 55000, stop: 0, ret: 5.0 } });
      this.operations = new OperationsController({
        doc, bus: this.bus, canvas: this.canvas, plot: this.plot, panel: this.panel,
        now: () => this.store.latestT() || 0,
        getSeries: () => this.seriesData(), getPeriod: () => this.period(),
        fmt: { brl: BRL, btc: BTC },
      });
      this.operationsTable = new OperationsTable({
        doc, operations: this.operations, now: () => this.store.latestT() || 0,
        getPeriod: () => this.period(), fmt: { brl: BRL, btc: BTC, pct: PCT, utc: fmtUTC },
      });
      this.mouse = this.operations.mouse;
      this._wire();
    }

    period() { return PERIODS.find(p => p.id === this.periodId); }
    spanMs() { const p = this.period(); return p.points * p.stepMs; }
    seriesData() {
      const endT = this.store.latestT();
      if (endT == null) return { hist: [], fut: [] };
      return { hist: this.real.points(this.period(), endT), fut: this.projected.points(this.period(), endT) };
    }

    _wire() {
      this.store.onChange(() => {
        this.operations.processPending();
        this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render(); this.updateStatus();
      });
      this.bus.on('control:ret', () => { this.renderCards(); this.renderChart(); this.renderSidePanel(); });
      this.bus.on('control:opValue', () => {});
      this.bus.on('control:stop', () => {});
      this.bus.on('operations:changed', () => {
        this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render();
      });
      this.bus.on('chart:mouse', mouse => { this.mouse = mouse; this.renderChart(); });
      this.bus.on('toast', data => this.toast(data.type, data.message));
    }

    renderCards() {
      const container = this.doc.getElementById('cards'); if (!container) return;
      const ctx = {
        spanMs: this.spanMs(), ret: this.panel.ret,
        weighted: this.operations.weightedAvg(), remainingBTC: this.operations.totalRemainingBTC(),
      };
      const models = this.cards.map(c => ({ c, m: c.compute(ctx) })).filter(x => x.m);
      let bestKey = null, bestProfit = -Infinity;
      for (const { m } of models) if (m.profit > bestProfit) { bestProfit = m.profit; bestKey = m.key; }
      const hasLots = ctx.remainingBTC > 0;
      for (const c of this.cards) c.render(container, ctx, hasLots && c.key === bestKey);
    }

    renderChart() {
      const endT = this.store.latestT(); if (endT == null) return;
      const { hist, fut } = this.seriesData(), all = hist.concat(fut);
      const target = this.operations.targetPrice();
      const extraPrices = [target]
        .concat(this.operations.lots.map(l => l.price))
        .concat(this.operations.sells.filter(s => s.status === 'pending').map(s => s.markPrice));
      this.plot.resize();
      this.plot.setBoundsFromPoints(all, { extraPrices });
      this.plot.clear();
      const data = {
        points: all, hist, fut, nowT: endT, target, fmtBRL: BRL,
        labelFor: t => timeLabel(t, this.periodId), lots: this.operations.lots,
        sells: this.operations.sells, mouse: this.mouse,
      };
      this.renderers.projBg.draw(this.plot, data);
      this.renderers.priceAxis.draw(this.plot, data);
      this.renderers.timeAxis.draw(this.plot, data);
      this.renderers.series.draw(this.plot, data);
      this.renderers.target.draw(this.plot, data);
      this.renderers.now.draw(this.plot, data);
      this.renderers.lots.draw(this.plot, data);
      this.renderers.sells.draw(this.plot, data);
      this.renderers.cursor.draw(this.plot, data);
    }

    renderSidePanel() {
      const setText = (id, value) => { const el = this.doc.getElementById(id); if (el) el.textContent = value; };
      const weighted = this.operations.weightedAvg();
      const remain = this.operations.totalRemainingBTC();
      const target = this.operations.targetPrice();
      const targetEl = this.doc.getElementById('target'); if (targetEl) targetEl.value = BRL(target);
      setText('openLots', this.operations.openLots().length);
      setText('avgPrice', weighted > 0 ? BRL(weighted) : '—');
      setText('projProfit', remain > 0 ? BRL(remain * (target - weighted)) : '—');
      setText('btcAvail', BTC(remain));
      const realized = this.operations.lots.reduce((sum, l) => sum + l.realized, 0);
      const current = this.operations.currentAvg();
      const unreal = this.operations.openLots().reduce((sum, l) => sum + l.remaining * (current - l.price), 0);
      const pnl = realized + unreal;
      const pnlEl = this.doc.getElementById('pnl');
      if (pnlEl) { pnlEl.textContent = BRL(pnl); pnlEl.className = ''; pnlEl.style.color = pnl >= 0 ? '#22c55e' : '#ef4444'; }
      const cost = this.operations.openLots().reduce((sum, l) => sum + l.remaining * l.price, 0);
      const ret = cost > 0 ? unreal / cost * 100 : 0;
      const retEl = this.doc.getElementById('retNow');
      if (retEl) { retEl.textContent = PCT(ret); retEl.style.color = ret >= 0 ? '#22c55e' : '#ef4444'; }
    }

    toast(type, message) {
      const box = this.doc.getElementById('toasts'); if (!box) return;
      const el = this.doc.createElement('div'); el.className = 'toast ' + type; el.textContent = message;
      box.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 4200);
    }

    buildPeriods() {
      const wrap = this.doc.getElementById('periods'); if (!wrap) return;
      wrap.innerHTML = '';
      for (const p of PERIODS) {
        const b = this.doc.createElement('button'); b.textContent = p.label;
        if (p.id === this.periodId) b.className = 'active';
        b.onclick = () => {
          this.periodId = p.id;
          Array.from(wrap.children).forEach(c => c.classList.remove('active'));
          b.classList.add('active');
          this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render();
        };
        wrap.appendChild(b);
      }
    }

    updateStatus() {
      const upd = this.doc.getElementById('updated');
      if (upd) upd.textContent = this.store.latestT() ? 'Dados atualizados' : 'Sem dados';
    }
    startClock() {
      const tick = () => {
        const el = this.doc.getElementById('clock');
        if (el) { const d = new Date(); el.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`; }
      };
      tick(); setInterval(tick, 1000);
    }

    async init() {
      this.buildPeriods(); this.panel.mount(); this.operations.mount(); this.startClock();
      try { await this.store.load(1500); }
      catch (e) { const upd = this.doc.getElementById('updated'); if (upd) upd.textContent = 'Falha ao conectar ao backend'; return; }
      this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render(); this.updateStatus();
      setInterval(() => { this.store.refresh(); }, 8000);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', () => this.renderChart());
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { App, PERIODS, timeLabel };
  if (typeof window !== 'undefined') {
    window.__App = App;
    if (typeof window.addEventListener === 'function' && typeof document !== 'undefined') window.addEventListener('DOMContentLoaded', () => { new App(document).init(); });
  }
})();
