'use strict';

/* Escapa HTML para evitar XSS ao usar innerHTML com strings de origem externa
 * (textos de i18n vindos do banco, datas, etc.). */
function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
    this._moedaExib = deps.moedaExibicao || 'BRL';
    this._t = (k, vars) => (window.I18N ? I18N.t(k, vars) : k);
    this._now = deps.now || (() => 0);
    this._series = deps.getSeries || (() => ({ hist: [], fut: [] }));
    this._period = deps.getPeriod || (() => ({ stepMs: 1 }));
    // acesso à projeção congelada (para ancorar vendas no preço projetado)
    this._frozen = deps.getFrozen || (() => null);
    this._getRates = deps.getRates || (() => null);
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

  /**
   * Converte um valor de preco da moeda em que a operacao foi feita
   * (op.moedaExib) para a moeda de exibicao ATUAL da sessao, usando USD
   * como moeda-ponte (rates traz usd_brl/eur/gbp/jpy/cny/try/rub; USD=1).
   * Se faltar taxa ou a moeda ja for a mesma, devolve o valor original -
   * mais seguro que travar a UI por falta de dado de cambio.
   */
  converterPreco(valor, moedaOrigem) {
    const origem = String(moedaOrigem || 'BRL').toUpperCase(); // lotes antigos sem moedaExib nasceram em BRL
    const atual = String(this._moedaExib).toUpperCase();
    if (origem === atual || !(valor > 0)) return valor;
    const rates = this._getRates();
    if (!rates) return valor;
    const taxa = {
      USD: 1,
      BRL: rates.usd_brl, EUR: rates.usd_eur, GBP: rates.usd_gbp,
      JPY: rates.usd_jpy, CNY: rates.usd_cny, TRY: rates.usd_try, RUB: rates.usd_rub,
    };
    const tOrigem = taxa[origem], tAtual = taxa[atual];
    if (!(tOrigem > 0) || !(tAtual > 0)) return valor;
    return (valor / tOrigem) * tAtual;
  }

  /** Preco de um lote/venda ja convertido para a moeda de exibicao atual. */
  precoOp(op) { return this.converterPreco(op.price != null ? op.price : op.markPrice, op.moedaExib); }

  weightedAvg() {
    let qty = 0, cost = 0;
    for (const l of this.openLots()) { qty += l.remaining; cost += l.remaining * this.precoOp(l); }
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
    this._toast('ok', this._t('toast_compra_excluida', { id: rm.id }));
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
    this._toast('ok', this._t('toast_venda_excluida', { id: sell.id }));
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
      this._toast('warn', this._t('toast_limpeza_parcial', { apagadas, mantidas }));
    } else {
      this._toast('ok', this._t('toast_limpeza_total', { apagadas }));
    }
    return { apagadas, mantidas };
  }

  doBuy(price, atTime) {
    const value = this._panel.opValue;
    if (value <= 0) { this._toast('warn', this._t('toast_valor_invalido')); return null; }
    if (!(price > 0)) return null;
    const qty = value / price;
    const seq = ++this.lotSeq;
    const lot = {
      id: 'LT' + seq, seq, time: atTime || this._now(), price, brl: value,
      qty, remaining: qty, sold: 0, realized: 0, status: 'open',
      moedaExib: this._moedaExib,
    };
    this.lots.push(lot);
    if (this._panel && typeof this._panel.debitSaldo === 'function') this._panel.debitSaldo(value);
    this._toast('ok', this._t('toast_compra_registrada', { id: lot.id, qtd: this._fmt.btc(qty), moeda: this._moeda, preco: this._fmt.brl(price) }));
    this._changed('buy', lot);
    return lot;
  }

  scheduleSell(markPrice, markTime) {
    const free = this.freeBTC();
    if (free <= 1e-10) { this._toast('err', this._t('toast_saldo_reservado_venda')); return null; }
    const value = this._panel.opValue;
    let qty = value / markPrice;
    let adjusted = false;
    if (qty > free) { qty = free; adjusted = true; }
    const seq = ++this.sellSeq;
    const sell = { id: 'V' + seq, seq, markTime, markPrice, qty, reserved: qty, status: 'pending', origVal: value, moedaExib: this._moedaExib };
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
    // execPrice ja chega na moeda de exibicao ATUAL (vem de currentAvg()).
    // lot.price pode ter sido gravado numa moeda diferente (lote comprado
    // antes de trocar o par) - converte antes de calcular o PnL.
    let qty = sell.qty, orderPnl = 0, orderCost = 0, orderQty = 0;
    const lots = this.lots.filter(l => l.remaining > 1e-12).sort((a, b) => a.seq - b.seq);
    for (const lot of lots) {
      if (qty <= 1e-12) break;
      const take = Math.min(lot.remaining, qty);
      const precoLote = this.precoOp(lot);
      const pnl = take * (execPrice - precoLote);
      lot.remaining -= take;
      lot.sold += take;
      lot.realized += pnl;
      if (lot.remaining <= 1e-10) { lot.remaining = 0; lot.status = 'closed'; }
      orderPnl += pnl; orderCost += take * precoLote; orderQty += take; qty -= take;
    }
    sell.status = 'executed';
    sell.execPrice = execPrice;
    sell.execTime = this._now();
    sell.reserved = 0;
    sell.moedaExib = this._moedaExib; // resultado calculado na moeda atual
    sell._profit = orderPnl;
    sell._pnl = orderPnl;
    sell._value = orderQty * execPrice;
    sell._ret = orderCost > 0 ? orderPnl / orderCost * 100 : 0;
    if (this._panel && typeof this._panel.creditSaldo === 'function') this._panel.creditSaldo(sell._value);
    this._changed('sell:executed', sell);
    return sell;
  }

  processPending() {
    const now = this._now();
    for (const sell of this.sells.filter(x => x.status === 'pending' && x.markTime <= now)) {
      const current = this.currentAvg();
      const markPriceAtual = this.precoOp(sell);
      if (current >= markPriceAtual - 1e-9) {
        const exec = Math.max(current, markPriceAtual);
        this.executeSell(sell, exec);
        if (exec > markPriceAtual + 1e-6) this._toast('ok', this._t('toast_venda_executada_elevada', { id: sell.id, preco: this._fmt.brl(exec) }));
        else this._toast('ok', this._t('toast_venda_executada', { id: sell.id, preco: this._fmt.brl(exec) }));
      } else {
        sell.status = 'expired';
        this._toast('err', this._t('toast_venda_expirada', { id: sell.id, preco: this._fmt.brl(markPriceAtual) }));
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
      // Preço-alvo calculado: preço médio ponderado × (1 + retorno desejado %).
      // Garante que o usuário vende exatamente quando o preço atingir o retorno
      // que ele configurou no slider — comportamento intuitivo e previsível.
      this.scheduleSell(this.targetPrice(), t);
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
    if (t > this._now()) { this._toast('warn', this._t('toast_compra_so_historico')); return; }
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
      const _loc2 = (window.I18N && I18N.idioma) ? I18N.idioma : navigator.language;
      const _dt2 = new Date(t).toLocaleString(_loc2, { dateStyle: 'short', timeStyle: 'short' });
      let html = `<b>${_esc(this._t('tooltip_previa_venda'))}</b> <span style="color:#a0aec0;font-size:0.88em">${_esc(_dt2)}</span><br>${_esc(this._t('tooltip_preco_livre'))} <b>${this._fmt.brl(price)}</b><br>`;
      const open = this.openLots();
      if (open.length) {
        html += '<span style="color:#7d8aa3">' + _esc(this._t('tooltip_lotes_verdes')) + '</span><br>';
        const abrevL = _esc(this._t('tooltip_lucro_abrev')), abrevP = _esc(this._t('tooltip_prejuizo_abrev'));
        open.slice(0, 4).forEach(l => { const win = price > this.precoOp(l); html += `<span style="color:${win ? '#22c55e' : '#ef4444'}">${l.id} ${win ? abrevL : abrevP}</span> `; });
      } else html += '<span style="color:#7d8aa3">' + _esc(this._t('tooltip_sem_lotes')) + '</span>';
      html += '<br><span style="color:#7d8aa3">' + _esc(this._t('tooltip_clique_venda')) + '</span>';
      this.mouse.blinkUntil = Date.now() + 99999;
      this._showTip(e, html);
    } else {
      const best = this._nearestHistorical(t);
      if (best) {
        const _loc = (window.I18N && I18N.idioma) ? I18N.idioma : navigator.language;
        const _dt = new Date(best.t).toLocaleString(_loc, { dateStyle: 'short', timeStyle: 'short' });
        this._showTip(e, `<b>${_esc(this._t('tooltip_cotacao_real'))}</b> <span style="color:#a0aec0;font-size:0.88em">${_esc(_dt)}</span><br>${_esc(this._t('tooltip_media_lbl'))} <b>${this._fmt.brl(best.avg)}</b><br><span style="color:#7d8aa3">${_esc(this._t('tooltip_botao_direito'))}</span>`);
      }
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
