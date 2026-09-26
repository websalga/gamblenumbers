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
    // getFee(t) -> feerate em sat/vB (BTC) ou sat/byte (BCH) no instante t
    this._getFee = deps.getFee || (() => 1.0);

    // De onde vem o session_id para o espelho SQL (sim_sync.php). Default
    // le window.GNIdentity.session, que e' onde identity.js ja guarda a
    // sessao atual -- mesma fonte usada em app.js para salvar_idioma via
    // sendBeacon. Injetavel so' para facilitar teste.
    this._getSessionId = deps.getSessionId || (() => {
      try {
        const sess = window.GNIdentity && window.GNIdentity.session;
        return (sess && sess.session_id) || null;
      } catch (e) { return null; }
    });
    // Fila confiavel de envio ao SQL Server (opssync.js). Sem ela (testes) cai no envio simples de antes.
    this._outbox = deps.outbox || null;
    this._empurrarFalhou = new Set();
    // Tamanho típico de transação: BTC SegWit P2WPKH ~140 vB, BCH P2PKH ~225 bytes
    this._txSize = (String(this._moeda).toUpperCase() === 'BCH') ? 225 : 140;
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

  /** Calcula taxa de rede em moeda de exibição para uma tx naquele preço/feerate. */
  _calcFeeBrl(feerate, price) {
    return (feerate > 0 && price > 0) ? feerate * this._txSize * (price / 1e8) : 0;
  }

  /** Rótulo de congestionamento da rede BTC/BCH. */
  _feeLabel(feerate) {
    if (String(this._moeda).toUpperCase() === 'BCH') return feerate.toFixed(1) + ' sat/byte 🟢';
    if (feerate >= 50)  return feerate.toFixed(0) + ' sat/vB 🔴';
    if (feerate >= 10)  return feerate.toFixed(0) + ' sat/vB 🟠';
    if (feerate >= 3)   return feerate.toFixed(1) + ' sat/vB 🟡';
    return feerate.toFixed(1) + ' sat/vB 🟢';
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

  /** Converte um valor entre duas moedas (pivo USD, mesmas taxas de converterPreco).
   *  Diferente de converterPreco, devolve null se nao ha cotacao de cambio. */
  converterValor(valor, de, para) {
    const o = String(de || 'BRL').toUpperCase(), d = String(para || 'BRL').toUpperCase();
    if (o === d) return valor;
    const rates = this._getRates();
    if (!rates) return null;
    const taxa = {
      USD: 1,
      BRL: rates.usd_brl, EUR: rates.usd_eur, GBP: rates.usd_gbp,
      JPY: rates.usd_jpy, CNY: rates.usd_cny, TRY: rates.usd_try, RUB: rates.usd_rub,
    };
    if (!(taxa[o] > 0) || !(taxa[d] > 0)) return null;
    return (valor / taxa[o]) * taxa[d];
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
    const removed = { lots: [], sells: [] };   // ids apagados: o SQL apaga (logicamente) os mesmos
    if (scope === 'sells' || scope === 'all') {
      for (const s of this.sells) if (s.status === 'pending') s.reserved = 0;
      apagadas += this.sells.length;
      removed.sells = this.sells.map(x => x.id);
      this.sells = [];
    }
    if (scope === 'lots' || scope === 'all') {
      const restantes = [];
      for (const l of this.lots) {
        if (this.canDeleteLot(l).ok) { apagadas++; removed.lots.push(l.id); }
        else { restantes.push(l); mantidas++; }
      }
      this.lots = restantes;
    }
    this._changed('operations:cleared', { scope, apagadas, mantidas }, { removed });
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
    const _buyTime = atTime || this._now();
    const _feerate = this._getFee(_buyTime);
    const _feeBrl  = this._calcFeeBrl(_feerate, price);
    const lot = {
      id: 'LT' + seq, seq, time: _buyTime, price, brl: value,
      qty, remaining: qty, sold: 0, realized: 0, status: 'open',
      moedaExib: this._moedaExib,
      fee_brl: _feeBrl,    // taxa de rede paga na compra (moeda de exibição atual)
      feerate:  _feerate,  // sat/vB ou sat/byte registrado no momento da compra
    };
    this.lots.push(lot);
    if (this._panel && typeof this._panel.debitSaldo === 'function') this._panel.debitSaldo(value + _feeBrl, lot.id);
    const _feeInfo = _feeBrl > 0.005 ? ' | taxa: ' + this._fmt.brl(_feeBrl) + ' (' + this._feeLabel(_feerate) + ')' : '';
    this._toast('ok', this._t('toast_compra_registrada', { id: lot.id, qtd: this._fmt.btc(qty), moeda: this._moeda, preco: this._fmt.brl(price) }) + _feeInfo);
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
    const touched = [];   // lotes consumidos: vao ao SQL na mesma acao que a venda
    const lots = this.lots.filter(l => l.remaining > 1e-12).sort((a, b) => a.seq - b.seq);
    for (const lot of lots) {
      if (qty <= 1e-12) break;
      const take = Math.min(lot.remaining, qty);
      const precoLote = this.precoOp(lot);
      const pnl = take * (execPrice - precoLote);
      lot.remaining -= take;
      lot.sold += take;
      lot.realized += pnl;
      touched.push(lot);
      if (lot.remaining <= 1e-10) { lot.remaining = 0; lot.status = 'closed'; }
      orderPnl += pnl; orderCost += take * precoLote; orderQty += take; qty -= take;
    }
    // Taxa de rede na venda
    const _sellFeerate = this._getFee(this._now());
    const _sellFeeBrl  = this._calcFeeBrl(_sellFeerate, execPrice);
    // Taxa de compra proporcional às cotas vendidas
    const _buyFeeTotal = this.lots.reduce((s, l) => s + (l.fee_brl || 0), 0);
    // Descontar ambas as fees do PnL líquido
    const _netPnl = orderPnl - _sellFeeBrl - (_buyFeeTotal > 0 ? _buyFeeTotal * (orderQty / Math.max(this.totalRemainingBTC() + orderQty, orderQty)) : 0);
    sell.status = 'executed';
    sell.execPrice = execPrice;
    sell.execTime = this._now();
    sell.reserved = 0;
    sell.moedaExib = this._moedaExib;
    sell.fee_brl   = _sellFeeBrl;     // taxa de rede paga na venda
    sell.feerate   = _sellFeerate;
    sell._profit = _netPnl;
    sell._pnl    = _netPnl;
    sell._value  = orderQty * execPrice - _sellFeeBrl;  // recebimento líquido
    sell._ret = orderCost > 0 ? _netPnl / orderCost * 100 : 0;
    if (this._panel && typeof this._panel.creditSaldo === 'function') this._panel.creditSaldo(sell._value, sell.id);
    this._changed('sell:executed', sell, { lots: touched });
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
    // Hover sobre marcador de venda agendada → tooltip informativo
    const _pendSells = this.sells.filter(s => s.status === 'pending');
    for (const _ps of _pendSells) {
      const _psx = this._plot.X(_ps.markTime), _psy = this._plot.Y(this.precoOp(_ps));
      if (Math.hypot(_psx - x, _psy - y) < 20) {
        const _loc0 = (window.I18N && I18N.idioma) ? I18N.idioma : navigator.language;
        const _dt0 = new Date(_ps.markTime).toLocaleString(_loc0, { dateStyle: 'short', timeStyle: 'short' });
        const _mp = this.precoOp(_ps);
        const _sfr = this._getFee(this._now()), _sf = this._calcFeeBrl(_sfr, _mp);
        const abrevL0 = _esc(this._t('tooltip_lucro_abrev')), abrevP0 = _esc(this._t('tooltip_prejuizo_abrev'));
        let _pnl0 = '';
        this.openLots().slice(0, 4).forEach(l => {
          const pL = this.precoOp(l);
          const luc = l.remaining * (_mp - pL) - (l.fee_brl || 0) - _sf;
          _pnl0 += `<span style="color:${luc >= 0 ? '#22c55e' : '#ef4444'}">${_esc(l.id)} ${luc >= 0 ? abrevL0 : abrevP0} ${this._fmt.brl(Math.abs(luc))}</span> `;
        });
        const _feeHtml0 = _sf >= 0.005 ? `<br><span style="color:#94a3b8;font-size:0.9em">⛓ Taxa rede: <b>${this._fmt.brl(_sf)}</b> (${_esc(this._feeLabel(_sfr))})</span>` : '';
        const _cancelLabel = (window.I18N ? I18N.t('tooltip_cancelar_venda') : null) || 'Clique para cancelar';
        this._showTip(e, `<b>${_esc(_ps.id)}</b> — ${_esc(_dt0)}<br>${_esc(this._t('tooltip_preco_livre'))} <b>${this._fmt.brl(_mp)}</b><br>${_pnl0}${_feeHtml0}<br><span style="color:#7d8aa3">${_esc(_cancelLabel)}</span>`);
        this._bus.emit('chart:mouse', { ...this.mouse });
        return;
      }
    }
    if (t > this._now()) {
      const _loc2 = (window.I18N && I18N.idioma) ? I18N.idioma : navigator.language;
      const _dt2 = new Date(t).toLocaleString(_loc2, { dateStyle: 'short', timeStyle: 'short' });
      // Feerate atual para estimar taxa de venda neste ponto
      const _futFeerate = this._getFee(this._now());
      const _futSellFee = this._calcFeeBrl(_futFeerate, price);
      let html = `<b>${_esc(this._t('tooltip_previa_venda'))}</b> <span style="color:#a0aec0;font-size:0.88em">${_esc(_dt2)}</span><br>${_esc(this._t('tooltip_preco_livre'))} <b>${this._fmt.brl(price)}</b><br>`;
      const open = this.openLots();
      if (open.length) {
        html += '<span style="color:#7d8aa3">' + _esc(this._t('tooltip_lotes_verdes')) + '</span><br>';
        const abrevL = _esc(this._t('tooltip_lucro_abrev')), abrevP = _esc(this._t('tooltip_prejuizo_abrev'));
        open.slice(0, 4).forEach(l => {
          const precoLote = this.precoOp(l);
          const buyFeePerBtc = (l.fee_brl || 0) / (l.qty || 1);
          const sellFeePerBtc = _futSellFee / (l.remaining || l.qty || 1);
          const netPrice = price - sellFeePerBtc - buyFeePerBtc;
          const win = netPrice > precoLote;
          const lucro = l.remaining * (price - precoLote) - (l.fee_brl || 0) - _futSellFee;
          const lucroStr = this._fmt.brl(Math.abs(lucro));
          html += `<span style="color:${win ? '#22c55e' : '#ef4444'}">${_esc(l.id)} ${win ? abrevL : abrevP} ${lucroStr}</span> `;
        });
      } else html += '<span style="color:#7d8aa3">' + _esc(this._t('tooltip_sem_lotes')) + '</span>';
      const _feeStr = _futSellFee >= 0.005 ? `<br><span style="color:#94a3b8;font-size:0.9em">⛓ Taxa rede: <b>${this._fmt.brl(_futSellFee)}</b> (${_esc(this._feeLabel(_futFeerate))})</span>` : '';
      html += _feeStr + '<br><span style="color:#7d8aa3">' + _esc(this._t('tooltip_clique_venda')) + '</span>';
      this.mouse.blinkUntil = Date.now() + 99999;
      this._showTip(e, html);
    } else {
      const best = this._nearestHistorical(t);
      if (best) {
        const _loc = (window.I18N && I18N.idioma) ? I18N.idioma : navigator.language;
        const _dt = new Date(best.t).toLocaleString(_loc, { dateStyle: 'short', timeStyle: 'short' });
        const _histFeerate = this._getFee(best.t);  // busca feerate no store via timestamp
        const _histFee = this._calcFeeBrl(_histFeerate, best.avg);
        const _feeHtml = _histFee >= 0.005
          ? `<br><span style="color:#94a3b8;font-size:0.9em">⛓ Taxa rede: <b>${this._fmt.brl(_histFee)}</b> (${_esc(this._feeLabel(_histFeerate))})</span>`
          : '';
        this._showTip(e, `<b>${_esc(this._t('tooltip_cotacao_real'))}</b> <span style="color:#a0aec0;font-size:0.88em">${_esc(_dt)}</span><br>${_esc(this._t('tooltip_media_lbl'))} <b>${this._fmt.brl(best.avg)}</b>${_feeHtml}<br><span style="color:#7d8aa3">${_esc(this._t('tooltip_botao_direito'))}</span>`);
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
  _changed(reason, subject, extra) {
    this._bus.emit('operations:changed', { reason, subject, lots: this.lots, sells: this.sells });
    this._syncToServer(reason, subject, extra);
  }

  /**
   * Espelha a acao do usuario no SQL Server (fonte de verdade) pela fila confiavel (OpsOutbox): o evento so' sai da
   * fila quando o servidor confirma e, se a rede cair, e' reenviado. `extra`: { lots } lotes afetados pela execucao
   * de uma venda, { removed } ids apagados por "limpar", { force } item antigo que so' existia no navegador.
   * Sem fila injetada (testes) cai no envio simples de antes.
   */
  _syncToServer(reason, subject, extra) {
    if (!subject) return;
    const clone = o => JSON.parse(JSON.stringify(o));
    const ev = { moeda: this._moeda, moeda_exib: this._moedaExib, reason, subject: clone(subject) };
    if (extra && extra.lots) ev.lots = extra.lots.map(clone);
    if (extra && extra.removed) ev.removed = extra.removed;
    if (extra && extra.force) ev.force = true;
    if (this._outbox) { this._outbox.enqueue(ev); return; }
    const sid = this._getSessionId();
    if (!sid) return;
    const body = JSON.stringify(Object.assign({ session_id: sid }, ev));
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) navigator.sendBeacon('sim_sync.php', new Blob([body], { type: 'application/json' }));
      else fetch('sim_sync.php', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    } catch (e) { /* nunca deixa o sync quebrar a UI */ }
  }

  /* ============ Estado do banco (fonte de verdade) ============ */

  _arr(tipo) { return tipo === 'lote' ? this.lots : this.sells; }
  _findOp(tipo, id) { return this._arr(tipo).find(o => o.id === id) || null; }
  /** O banco manda: copia os campos dele para o item local, mantendo o mesmo objeto. */
  _adotar(op, srv) { for (const k of Object.keys(srv)) op[k] = srv[k]; }
  _seqAtLeast(m) {
    if (!m) return;
    if (m.lot > this.lotSeq) this.lotSeq = m.lot;
    if (m.sell > this.sellSeq) this.sellSeq = m.sell;
  }
  _remover(tipo, id) {
    const a = this._arr(tipo), i = a.findIndex(o => o.id === id);
    if (i < 0) return false;
    a.splice(i, 1);
    return true;
  }
  /** Item que so' existe neste navegador (anterior ao espelho, ou nunca confirmado): grava no banco, sem checar versao. */
  _empurrar(tipo, op) {
    if (this._empurrarFalhou.has(tipo + ':' + op.id)) return;   // o banco ja recusou: nao insiste a cada ciclo
    this._syncToServer(tipo === 'lote' ? 'lot:sync' : 'sell:sync', op, { force: true });
  }

  /** Confirmacao do servidor: registra a versao de cada item gravado e remove o que o banco tem como excluido. */
  applyAck(resp) {
    let mudou = false;
    for (const it of (resp.itens || [])) {
      const op = this._findOp(it.tipo, it.id);
      if (it.excluido) { if (op) mudou = this._remover(it.tipo, it.id) || mudou; continue; }
      if (op && it.v > 0 && op._v !== it.v) { op._v = it.v; mudou = true; }
    }
    this._seqAtLeast(resp.seq_max);
    return mudou;
  }

  /**
   * Conflito: o banco tem uma versao mais recente do item (um robo ou outro navegador mexeu) e NAO gravou nada.
   * A tela adota o estado do banco. Excecao: colisao de id em item NOVO — se for a mesma operacao (reenvio de um
   * evento ja gravado) so' registra a versao; senao o item recebe um id novo e e' reenviado.
   */
  applyConflict(ev, resp) {
    let mudou = false;
    const atuais = resp.atuais || { lots: [], sells: [] };
    this._seqAtLeast(resp.seq_max);
    const srvPor = { lote: new Map((atuais.lots || []).map(x => [x.id, x])), venda: new Map((atuais.sells || []).map(x => [x.id, x])) };
    const mesma = (tipo, op, s) => tipo === 'lote'
      ? (s.time === op.time && Math.abs((s.qty || 0) - (op.qty || 0)) < 1e-9 && Math.abs((s.price || 0) - (op.price || 0)) < 1e-6)
      : (s.markTime === op.markTime && Math.abs((s.qty || 0) - (op.qty || 0)) < 1e-9 && Math.abs((s.markPrice || 0) - (op.markPrice || 0)) < 1e-6);
    for (const c of (resp.conflitos || [])) {
      if (c.motivo !== 'id_existente') continue;
      const op = this._findOp(c.tipo, c.id), s = srvPor[c.tipo].get(c.id);
      if (!op || !s || s.excluido || op._v !== undefined) continue;
      if (mesma(c.tipo, op, s)) { this._adotar(op, s); mudou = true; continue; }
      if (c.tipo === 'lote') { op.seq = ++this.lotSeq; op.id = 'LT' + op.seq; this._syncToServer('buy', op); }
      else { op.seq = ++this.sellSeq; op.id = 'V' + op.seq; this._syncToServer(ev.reason, op, ev.lots ? { lots: ev.lots } : undefined); }
      mudou = true;
    }
    for (const tipo of ['lote', 'venda']) {
      for (const s of srvPor[tipo].values()) {
        const op = this._findOp(tipo, s.id);
        if (s.excluido) { if (op) mudou = this._remover(tipo, s.id) || mudou; continue; }
        if (op) { if (op._v !== s._v) { this._adotar(op, s); mudou = true; } }
        else { this._arr(tipo).push(Object.assign({}, s, { _remote: true })); mudou = true; }
      }
    }
    this.lots.sort((a, b) => a.seq - b.seq);
    this.sells.sort((a, b) => a.seq - b.seq);
    return mudou;
  }

  /**
   * Mescla o que o SQL Server tem (sim_load.php) com o estado local. O BANCO MANDA, exceto itens com envio
   * pendente na fila (a acao do usuario ainda nao chegou la):
   *   - item so' no banco -> entra; excluido no banco -> sai; mais novo no banco (versao maior) -> adota
   *   - item local com versao conhecida que sumiu do banco -> sai (foi apagado la)
   *   - item local antigo, sem versao (anterior ao espelho) -> vai para o banco (gravacao forcada)
   * Devolve true se a tela precisa ser redesenhada.
   */
  mergeServer(j, temPendente) {
    const pend = temPendente || (() => false);
    let mudou = false;
    const ex = j.excluidos || { lots: [], sells: [] };
    const grupos = [
      { tipo: 'lote',  campo: 'lots',  srv: j.lots || [],  exc: ex.lots || [] },
      { tipo: 'venda', campo: 'sells', srv: j.sells || [], exc: ex.sells || [] },
    ];
    for (const g of grupos) {
      const ativos = new Map(g.srv.map(x => [x.id, x]));
      const apagados = new Map(g.exc.map(x => [x.id, x]));
      const manter = [];
      for (const op of this[g.campo]) {
        if (pend(g.tipo, op.id)) { manter.push(op); continue; }
        if (apagados.has(op.id)) { mudou = true; continue; }
        const s = ativos.get(op.id);
        if (s) {
          if (op._v === undefined) {
            if (op._remote) { this._adotar(op, s); mudou = true; }
            else this._empurrar(g.tipo, op);
          } else if (s._v > op._v) { this._adotar(op, s); mudou = true; }
          manter.push(op);
          continue;
        }
        if (op._v !== undefined) { mudou = true; continue; }
        this._empurrar(g.tipo, op);
        manter.push(op);
      }
      const ja = new Set(manter.map(o => o.id));
      for (const s of g.srv) {
        if (ja.has(s.id) || pend(g.tipo, s.id)) continue;
        manter.push(Object.assign({}, s, { _remote: true }));
        mudou = true;
      }
      manter.sort((a, b) => a.seq - b.seq);
      this[g.campo] = manter;
    }
    this._seqAtLeast(j.seq_max);
    return mudou;
  }

  /** Resultado de um envio (chamado pela fila). */
  onSyncResult(r) {
    let mudou = false;
    if (r.tipo === 'ok') mudou = this.applyAck(r.resposta);
    else if (r.tipo === 'conflito') {
      mudou = this.applyConflict(r.evento, r.resposta);
      this._toast('warn', 'Operação atualizada: o banco tinha uma versão mais recente (outro navegador ou um robô alterou). A tela mostra o estado do banco.');
    } else {
      for (const x of (r.evento.ids || [])) this._empurrarFalhou.add(x.t + ':' + x.id);
      if (typeof console !== 'undefined') console.warn('sim_sync recusou um evento (descartado):', r.evento.reason, r.resposta && r.resposta.error);
    }
    if (mudou) this._bus.emit('operations:changed', { reason: 'sync', lots: this.lots, sells: this.sells });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { OperationsController };
if (typeof window !== 'undefined') window.OperationsController = OperationsController;
