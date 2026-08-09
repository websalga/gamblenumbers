'use strict';

class OperationsController {
  constructor(deps = {}) {
    if (!deps.bus) throw new Error('OperationsController exige um EventBus.');
    if (!deps.canvas) throw new Error('OperationsController exige um canvas.');
    if (!deps.plot) throw new Error('OperationsController exige um PlotArea.');
    if (!deps.panel) throw new Error('OperationsController exige um ControlPanel.');
    if (!deps.doc) throw new Error('OperationsController exige um document.');
    this._bus = deps.bus;
    this._canvas = deps.canvas;
    this._plot = deps.plot;
    this._panel = deps.panel;
    this._doc = deps.doc;
    this._moeda = deps.moeda || 'BTC';
    this._t = (k, vars) => (window.I18N ? I18N.t(k, vars) : k);
    this._now = deps.now || (() => 0);
    this._series = deps.getSeries || (() => ({ hist: [], fut: [] }));
    this._period = deps.getPeriod || (() => ({ stepMs: 1 }));
    // acesso à projeção congelada (para ancorar vendas no preço projetado)
    this._frozen = deps.getFrozen || (() => null);
    // Veto de clique: durante/logo após um arraste (pan), o clique não deve
    // virar uma venda marcada sem intenção.
    this._clickVetoed = deps.isClickVetoed || (() => false);
    this._fmt = Object.assign({
      brl: n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      btc: n => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 8, maximumFractionDigits: 8 }),
    }, deps.fmt || {});
    this.lots = [];
    this.sells = [];
    this.lotSeq = 0;
    this.sellSeq = 0;
    this.mouse = { x: null, y: null, inside: false, blinkUntil: 0 };
    this._mounted = false;
  }

  snapshot() { return { lots: this.lots, sells: this.sells }; }
  openLots() { return this.lots.filter(l => l.remaining > 1e-12); }
  weightedAvg() {
    let qty = 0, cost = 0;
    for (const l of this.openLots()) { qty += l.remaining; cost += l.remaining * l.price; }
    return qty > 0 ? cost / qty : 0;
  }
  totalRemainingBTC() { return this.openLots().reduce((sum, l) => sum + l.remaining, 0); }
  reservedBTC() { return this.sells.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.reserved, 0); }
  freeBTC() { return Math.max(0, this.totalRemainingBTC() - this.reservedBTC()); }
  currentAvg() {
    const series = this._series();
    const hist = series && series.hist || [];
    return hist.length ? hist[hist.length - 1].avg : 0;
  }
  targetPrice() {
    const weighted = this.weightedAvg();
    const base = weighted > 0 ? weighted : this.currentAvg();
    return base * (1 + this._panel.ret / 100);
  }

  /* ============ Remoção / visibilidade de operações ============ */

  /**
   * Uma compra só pode ser apagada quando está CONSOLIDADA: todo o BTC dela já
   * foi vendido (remaining ~ 0). Enquanto sobrar saldo, apagá-la corromperia o
   * saldo disponível e o preço médio — por isso é bloqueada, e o usuário pode
   * apenas ocultá-la do gráfico.
   * @param {object} lot
   * @returns {{ok:boolean, reason?:string, remaining?:number}}
   */
  canDeleteLot(lot) {
    if (!lot) return { ok: false, reason: 'Lote inexistente.' };
    if (lot.remaining > 1e-10) {
      return {
        ok: false, remaining: lot.remaining,
        reason: this._t('toast_compra_saldo_restante', { qtd: this._fmt.btc(lot.remaining), moeda: this._moeda }),
      };
    }
    return { ok: true };
  }

  /** Remove uma compra consolidada. Respeita canDeleteLot(). */
  deleteLot(id) {
    const i = this.lots.findIndex(l => l.id === id);
    if (i < 0) return false;
    const check = this.canDeleteLot(this.lots[i]);
    if (!check.ok) { this._toast('warn', check.reason); return false; }
    const [rm] = this.lots.splice(i, 1);
    this._toast('ok', `Compra ${rm.id} excluída.`);
    this._changed('lot:deleted', rm);
    return true;
  }

  /**
   * Remove uma venda. Se estiver pendente, libera a reserva de BTC antes
   * (equivale a cancelar); executadas apenas saem da lista.
   */
  deleteSell(id) {
    const i = this.sells.findIndex(x => x.id === id);
    if (i < 0) return false;
    const sell = this.sells[i];
    if (sell.status === 'pending') sell.reserved = 0;
    this.sells.splice(i, 1);
    this._toast('ok', `Venda ${sell.id} excluída.`);
    this._changed('sell:deleted', sell);
    return true;
  }

  /** Alterna a visibilidade de uma operação no gráfico (não apaga nada). */
  toggleVisible(kind, id) {
    const arr = kind === 'lot' ? this.lots : this.sells;
    const op = arr.find(o => o.id === id);
    if (!op) return false;
    op.hidden = !op.hidden;
    this._changed(kind + ':visibility', op);
    return true;
  }

  /**
   * Limpeza em massa. scope: 'sells' | 'lots' | 'all'.
   * Compras com saldo restante NÃO são apagadas (regra de consolidação);
   * o retorno informa quantas ficaram para trás.
   */
  clearOperations(scope) {
    let apagadas = 0, mantidas = 0;
    if (scope === 'sells' || scope === 'all') {
      for (const s of this.sells) if (s.status === 'pending') s.reserved = 0;
      apagadas += this.sells.length;
      this.sells = [];
    }
    if (scope === 'lots' || scope === 'all') {
      const restantes = [];
      for (const l of this.lots) {
        if (this.canDeleteLot(l).ok) apagadas++;
        else { restantes.push(l); mantidas++; }
      }
      this.lots = restantes;
    }
    this._changed('operations:cleared', { scope, apagadas, mantidas });
    if (mantidas > 0) {
      this._toast('warn', `${apagadas} operação(ões) removida(s). ${mantidas} compra(s) mantida(s) por ainda terem saldo.`);
    } else {
      this._toast('ok', `${apagadas} operação(ões) removida(s).`);
    }
    return { apagadas, mantidas };
  }

  doBuy(price, atTime) {
    const value = this._panel.opValue;
    if (value <= 0) { this._toast('warn', 'Informe um valor de compra válido.'); return null; }
    if (!(price > 0)) return null;
    const qty = value / price;
    const seq = ++this.lotSeq;
    const lot = {
      id: 'LT' + seq, seq, time: atTime || this._now(), price, brl: value,
      qty, remaining: qty, sold: 0, realized: 0, status: 'open',
    };
    this.lots.push(lot);
    this._toast('ok', this._t('toast_compra_registrada', { id: lot.id, qtd: this._fmt.btc(qty), moeda: this._moeda, preco: this._fmt.brl(price) }));
    this._changed('buy', lot);
    return lot;
  }

  scheduleSell(markPrice, markTime) {
    const free = this.freeBTC();
    if (free <= 1e-10) { this._toast('err', 'Saldo totalmente reservado. Nenhuma venda possível.'); return null; }
    const value = this._panel.opValue;
    let qty = value / markPrice;
    let adjusted = false;
    if (qty > free) { qty = free; adjusted = true; }
    const seq = ++this.sellSeq;
    const sell = { id: 'V' + seq, seq, markTime, markPrice, qty, reserved: qty, status: 'pending', origVal: value };
    this.sells.push(sell);
    if (adjusted) this._toast('warn', this._t('toast_ordem_ajustada', { id: sell.id, qtd: this._fmt.btc(qty), moeda: this._moeda }));
    else this._toast('ok', this._t('toast_venda_agendada', { id: sell.id, qtd: this._fmt.btc(qty), moeda: this._moeda, preco: this._fmt.brl(markPrice) }));
    this._changed('sell:scheduled', sell);
    return sell;
  }

  cancelSell(id) {
    const sell = this.sells.find(x => x.id === id && x.status === 'pending');
    if (!sell) return false;
    sell.status = 'cancelled';
    this._toast('info', this._t('toast_venda_cancelada', { id: id, qtd: this._fmt.btc(sell.reserved), moeda: this._moeda }));
    this._changed('sell:cancelled', sell);
    return true;
  }

  executeSell(sell, execPrice) {
    let qty = sell.qty, orderPnl = 0, orderCost = 0, orderQty = 0;
    const lots = this.lots.filter(l => l.remaining > 1e-12).sort((a, b) => a.seq - b.seq);
    for (const lot of lots) {
      if (qty <= 1e-12) break;
      const take = Math.min(lot.remaining, qty);
      const pnl = take * (execPrice - lot.price);
      lot.remaining -= take;
      lot.sold += take;
      lot.realized += pnl;
      if (lot.remaining <= 1e-10) { lot.remaining = 0; lot.status = 'closed'; }
      orderPnl += pnl; orderCost += take * lot.price; orderQty += take; qty -= take;
    }
    sell.status = 'executed';
    sell.execPrice = execPrice;
    sell.execTime = this._now();
    sell.reserved = 0;
    sell._profit = orderPnl;
    sell._pnl = orderPnl;
    sell._value = orderQty * execPrice;
    sell._ret = orderCost > 0 ? orderPnl / orderCost * 100 : 0;
    this._changed('sell:executed', sell);
    return sell;
  }

  processPending() {
    const now = this._now();
    for (const sell of this.sells.filter(x => x.status === 'pending' && x.markTime <= now)) {
      const current = this.currentAvg();
      if (current >= sell.markPrice - 1e-9) {
        const exec = Math.max(current, sell.markPrice);
        this.executeSell(sell, exec);
        if (exec > sell.markPrice + 1e-6) this._toast('ok', `Venda ${sell.id} executada e elevada para a cotação atual ${this._fmt.brl(exec)}`);
        else this._toast('ok', `Venda ${sell.id} executada @ ${this._fmt.brl(exec)}`);
      } else {
        sell.status = 'expired';
        this._toast('err', `Venda ${sell.id} expirada • cotação-alvo ${this._fmt.brl(sell.markPrice)} não atingida`);
        this._changed('sell:expired', sell);
      }
    }
  }

  mount() {
    if (this._mounted) return this;
    this._mounted = true;
    this._canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this._canvas.addEventListener('mouseleave', () => this._onMouseLeave());
    this._canvas.addEventListener('contextmenu', e => this._onContextMenu(e));
    this._canvas.addEventListener('click', e => this._onClick(e));
    const buy = this._doc.getElementById('buyBtn');
    if (buy) buy.onclick = () => this.doBuy(this.currentAvg(), this._now());
    const sell = this._doc.getElementById('sellBtn');
    if (sell) sell.onclick = () => {
      if (this.freeBTC() <= 1e-10) { this._toast('err', this._t('toast_saldo_reservado')); return; }
      // Horizonte ABSOLUTO (48h à frente), independente da escala em que o
      // usuário estiver. Antes usava stepMs*8, que mudava com a faixa e fazia
      // a marca "descolar" ao trocar de escala.
      const HORIZON_MS = 48 * 3600 * 1000;
      const t = this._now() + HORIZON_MS;
      // O preço vem da projeção congelada naquele instante (é sobre ela que a
      // venda é marcada). Sem frozen, cai no preço-alvo calculado.
      const fz = this._frozen();
      const projected = fz && typeof fz.priceAt === 'function' ? fz.priceAt(t) : null;
      this.scheduleSell(projected != null && projected > 0 ? projected : this.targetPrice(), t);
    };
    return this;
  }

  _coords(e) {
    const rect = this._canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  _nearestHistorical(t) {
    const hist = (this._series() || {}).hist || [];
    let best = null, distance = Infinity;
    for (const pt of hist) { const d = Math.abs(pt.t - t); if (d < distance) { distance = d; best = pt; } }
    return best;
  }
  _onContextMenu(e) {
    if (e.preventDefault) e.preventDefault();
    const { x } = this._coords(e), t = this._plot.invX(x);
    if (t > this._now()) { this._toast('warn', 'Compras só são permitidas no histórico.'); return; }
    const best = this._nearestHistorical(t);
    if (best) this.doBuy(best.avg, best.t);
  }
  _onClick(e) {
    if (this._clickVetoed()) return;   // veio de um arraste: não marca venda
    const { x, y } = this._coords(e), t = this._plot.invX(x), price = this._plot.invY(y);
    if (t <= this._now()) return;
    for (const sell of this.sells.filter(s => s.status === 'pending')) {
      if (Math.hypot(this._plot.X(sell.markTime) - x, this._plot.Y(sell.markPrice) - y) < 14) {
        this.cancelSell(sell.id); return;
      }
    }
    this.scheduleSell(price, t);
    this.mouse.blinkUntil = Date.now() + 3000;
    this._bus.emit('chart:mouse', { ...this.mouse });
  }
  _onMouseMove(e) {
    const { x, y } = this._coords(e), t = this._plot.invX(x), price = this._plot.invY(y);
    this.mouse = { x, y, inside: true, blinkUntil: this.mouse.blinkUntil || 0 };
    if (t > this._now()) {
      let html = `<b>Prévia de venda</b><br>Preço livre: <b>${this._fmt.brl(price)}</b><br>`;
      const open = this.openLots();
      if (open.length) {
        html += '<span style="color:#7d8aa3">Lotes verdes lucram, vermelhos perdem.</span><br>';
        open.slice(0, 4).forEach(l => { const win = price > l.price; html += `<span style="color:${win ? '#22c55e' : '#ef4444'}">${l.id} ${win ? 'L' : 'P'}</span> `; });
      } else html += '<span style="color:#7d8aa3">Sem lotes abertos.</span>';
      html += '<br><span style="color:#7d8aa3">Clique para marcar a venda.</span>';
      this.mouse.blinkUntil = Date.now() + 99999;
      this._showTip(e, html);
    } else {
      const best = this._nearestHistorical(t);
      if (best) this._showTip(e, `<b>Cotação real</b><br>Média: <b>${this._fmt.brl(best.avg)}</b><br><span style="color:#7d8aa3">Botão direito registra uma compra.</span>`);
      this.mouse.blinkUntil = 0;
    }
    this._bus.emit('chart:mouse', { ...this.mouse });
  }
  _onMouseLeave() {
    this.mouse = { x: null, y: null, inside: false, blinkUntil: 0 };
    const tip = this._doc.getElementById('tooltip');
    if (tip) tip.style.display = 'none';
    this._bus.emit('chart:mouse', { ...this.mouse });
  }
  _showTip(e, html) {
    const tip = this._doc.getElementById('tooltip');
    if (!tip) return;
    tip.innerHTML = html; tip.style.display = 'block';
    tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  }
  _toast(type, message) { this._bus.emit('toast', { type, message }); }
  _changed(reason, subject) { this._bus.emit('operations:changed', { reason, subject, lots: this.lots, sells: this.sells }); }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { OperationsController };
if (typeof window !== 'undefined') window.OperationsController = OperationsController;
