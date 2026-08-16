'use strict';

/* Escapa HTML para uso seguro em innerHTML. */
function _escT(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class OperationsTable {
  _t(k, vars) { return window.I18N ? I18N.t(k, vars) : k; }
  constructor(deps = {}) {
    if (!deps.doc) throw new Error('OperationsTable exige um document.');
    if (!deps.operations) throw new Error('OperationsTable exige OperationsController.');
    this._doc = deps.doc;
    this._ops = deps.operations;
    this._now = deps.now || (() => 0);
    this._period = deps.getPeriod || (() => ({ stepMs: 1 }));
    this._fmt = Object.assign({ brl: String, btc: String, pct: String, utc: String }, deps.fmt || {});
    this._bodyId = deps.bodyId || 'opsBody';
  }

  render() {
    const body = this._doc.getElementById(this._bodyId);
    if (!body) return;
    body.innerHTML = '';
    for (const lot of this._ops.lots) body.appendChild(this._lotRow(lot));
    for (const sell of this._ops.sells) {
      if (sell.status !== 'cancelled' && sell.status !== 'expired') body.appendChild(this._sellRow(sell));
    }
    if (!this._ops.lots.length && !this._ops.sells.length) {
      body.innerHTML = '<tr><td colspan="9" style="color:#7d8aa3;text-align:center;padding:20px">' + _escT(this._t('op_nenhuma')) + '</td></tr>';
    }
  }

  /**
   * Célula de ações: olhinho (ocultar/mostrar no gráfico) e ✕ (excluir).
   * Para compras com saldo restante o ✕ fica desabilitado, com o motivo e o
   * saldo no title (hint) — a regra é: só compra consolidada pode ser apagada.
   */
  _actionsCell(kind, op) {
    const td = this._doc.createElement('td');
    td.className = 'ops-actions';

    const olho = this._doc.createElement('button');
    olho.className = 'opbtn';
    olho.textContent = op.hidden ? '\u{1F441}\u200D\u{1F5E8}' : '\u{1F441}';
    olho.title = op.hidden ? this._t('op_mostrar_grafico') : this._t('op_ocultar_grafico');
    olho.onclick = () => { if (typeof this._ops.toggleVisible === 'function') this._ops.toggleVisible(kind, op.id); };
    if (op.hidden && olho.style) olho.style.opacity = '0.45';
    td.appendChild(olho);

    const x = this._doc.createElement('button');
    x.className = 'opbtn opbtn-del';
    x.textContent = '\u2715';
    let bloqueio = null;
    if (kind === 'lot') {
      const check = (typeof this._ops.canDeleteLot === 'function')
        ? this._ops.canDeleteLot(op)
        // fallback: mesma regra, caso o controller não exponha o método
        : { ok: !(op.remaining > 1e-10), reason: this._t('op_compra_saldo_bloqueio') };
      if (!check.ok) bloqueio = check.reason;
    }
    if (bloqueio) {
      x.title = bloqueio;                       // hint com o saldo restante
      x.disabled = true;
      if (x.style) { x.style.opacity = '0.35'; x.style.cursor = 'not-allowed'; }
      x.onclick = () => { if (typeof this._ops._toast === 'function') this._ops._toast('warn', bloqueio); };
    } else {
      x.title = kind === 'lot' ? 'Excluir compra' : 'Excluir venda';
      x.onclick = () => {
        if (kind === 'lot') { if (this._ops.deleteLot) this._ops.deleteLot(op.id); }
        else if (this._ops.deleteSell) this._ops.deleteSell(op.id);
      };
    }
    td.appendChild(x);
    return td;
  }

  _lotRow(lot) {
    // preco/valor do lote convertidos para a moeda de exibicao atual -
    // o lote pode ter sido comprado com outro par selecionado.
    const price = this._ops.precoOp(lot);
    const brlConv = this._ops.converterPreco(lot.brl, lot.moedaExib);
    let cls = 'row-y', result = '—', ret = '—';
    if (lot.realized > 1e-6) cls = 'row-g'; else if (lot.realized < -1e-6) cls = 'row-r';
    if (Math.abs(lot.realized) > 1e-6) {
      const realizedConv = this._ops.converterPreco(lot.realized, lot.moedaExib);
      result = this._fmt.brl(realizedConv);
      ret = this._fmt.pct(lot.realized / (lot.sold * lot.price) * 100);
    } else {
      const current = this._ops.currentAvg(), unreal = lot.remaining * (current - price);
      result = '<span style="color:#7d8aa3">' + this._fmt.brl(unreal) + ' ' + _escT(this._t('op_proj')) + '</span>';
      ret = this._fmt.pct(price > 0 ? (current - price) / price * 100 : 0);
    }
    const tr = this._doc.createElement('tr'); tr.className = cls;
    tr.innerHTML = `<td><b>${_escT(lot.id)}</b></td><td><span class="tag tag-buy">${_escT(this._t('op_compra'))}</span></td>` +
      `<td>${this._fmt.utc(new Date(lot.time))}</td><td>${this._fmt.brl(price)}</td>` +
      `<td>${this._fmt.btc(lot.qty)}<br><span style="color:#7d8aa3;font-size:10px">${this._t('op_rest')} ${this._fmt.btc(lot.remaining)}</span></td>` +
      `<td>${this._fmt.brl(brlConv)}</td><td>${result}</td><td>${ret}</td>`;
    tr.appendChild(this._actionsCell('lot', lot));
    if (lot.hidden && tr.style) tr.style.opacity = '0.5';
    return tr;
  }

  _sellRow(sell) {
    // preco/valor da venda convertidos para a moeda de exibicao atual.
    let cls = 'row-y', result = this._t('op_venda_condicional'), ret = '—';
    let price = this._ops.converterPreco(sell.markPrice, sell.moedaExib);
    let value = this._ops.converterPreco(sell.origVal, sell.moedaExib);
    let qty = sell.reserved || sell.qty;
    if (sell.status === 'executed') {
      cls = sell._profit >= 0 ? 'row-g' : 'row-r';
      const pnlConv = this._ops.converterPreco(sell._pnl, sell.moedaExib);
      result = this._fmt.brl(pnlConv); ret = this._fmt.pct(sell._ret);
      price = this._ops.converterPreco(sell.execPrice, sell.moedaExib);
      value = this._ops.converterPreco(sell._value, sell.moedaExib);
      qty = sell.qty;
    } else {
      const steps = Math.max(0, Math.ceil((sell.markTime - this._now()) / this._period().stepMs));
      result = `${_escT(this._t('op_venda_condicional'))}<br><span style="color:#7d8aa3;font-size:10px">${_escT(this._t('op_faltam_passos', {n: steps}))}</span>`;
    }
    const tr = this._doc.createElement('tr'); tr.className = cls;
    const label = sell.status === 'executed' ? (sell._profit >= 0 ? 'L' : 'P') + (sell.seq ?? '') : (sell.id || ('V' + sell.seq));
    const when = sell.status === 'executed' ? sell.execTime : sell.markTime;
    tr.innerHTML = `<td><b>${_escT(label)}</b></td><td><span class="tag tag-sell">${_escT(this._t('op_venda'))}</span></td>` +
      `<td>${this._fmt.utc(new Date(when))}</td><td>${this._fmt.brl(price)}</td>` +
      `<td>${this._fmt.btc(qty)}</td><td>${this._fmt.brl(value)}</td><td>${result}</td><td>${ret}</td>`;
    tr.appendChild(this._actionsCell('sell', sell));
    if (sell.hidden && tr.style) tr.style.opacity = '0.5';
    return tr;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { OperationsTable };
if (typeof window !== 'undefined') window.OperationsTable = OperationsTable;
