'use strict';

/* Escapa HTML para uso seguro em innerHTML. */
function _escT(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Ordenacao da grid: indice = posicao do <th>. Acoes (ultima coluna) nao ordena. */
const _OPS_COL_DATA = 3;
const _OPS_COLS_ORDENAVEIS = 10;
const _OPS_COLS_TEXTO = 3;            // 0..2 (Lote, Tipo, Origem) comecam em A-Z
const _OPS_SORT_KEY = 'gn_ops_sort';

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
    // Ordem escolhida clicando no titulo da coluna; padrao: data/hora, mais recente em cima.
    this._sort = { col: _OPS_COL_DATA, dir: -1 };
    try {
      const s = JSON.parse(localStorage.getItem(_OPS_SORT_KEY) || 'null');
      if (s && Number.isInteger(s.col) && s.col >= 0 && s.col < _OPS_COLS_ORDENAVEIS && (s.dir === 1 || s.dir === -1)) this._sort = s;
    } catch (e) { /* sem storage: fica o padrao */ }
    this._headWired = false;
  }

  render() {
    const body = this._doc.getElementById(this._bodyId);
    if (!body) return;
    this._wireHead(body);
    body.innerHTML = '';
    // Compras e vendas numa lista unica, na ordem escolhida.
    const rows = [];
    for (const lot of this._ops.lots) rows.push({ kind: 'lot', op: lot, k: this._lotKeys(lot) });
    for (const sell of this._ops.sells) {
      if (sell.status !== 'cancelled' && sell.status !== 'expired') rows.push({ kind: 'sell', op: sell, k: this._sellKeys(sell) });
    }
    rows.sort((a, b) => this._cmp(a, b));
    for (const r of rows) body.appendChild(r.kind === 'lot' ? this._lotRow(r.op) : this._sellRow(r.op));
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="11" style="color:var(--muted);text-align:center;padding:20px">' + _escT(this._t('op_nenhuma')) + '</td></tr>';
    }
  }

  /** Torna os titulos clicaveis (uma vez) e marca a seta da coluna/ordem atual. */
  _wireHead(body) {
    const table = body.parentNode;
    const head = table && typeof table.querySelector === 'function' ? table.querySelector('thead tr') : null;
    if (!head) return;
    const ths = head.children;
    if (!this._headWired) {
      this._headWired = true;
      for (let i = 0; i < Math.min(ths.length, _OPS_COLS_ORDENAVEIS); i++) {
        ths[i].classList.add('th-sort');
        ths[i].addEventListener('click', () => this.sortBy(i));
      }
    }
    for (let i = 0; i < ths.length; i++) {
      ths[i].classList.toggle('sort-asc', i === this._sort.col && this._sort.dir === 1);
      ths[i].classList.toggle('sort-desc', i === this._sort.col && this._sort.dir === -1);
    }
  }

  /** Mesma coluna inverte; coluna nova comeca em A-Z (texto) ou maior/mais recente primeiro. */
  sortBy(col) {
    if (!(col >= 0 && col < _OPS_COLS_ORDENAVEIS)) return;
    this._sort = (this._sort.col === col)
      ? { col, dir: -this._sort.dir }
      : { col, dir: col < _OPS_COLS_TEXTO ? 1 : -1 };
    try { localStorage.setItem(_OPS_SORT_KEY, JSON.stringify(this._sort)); } catch (e) { /* sem storage */ }
    this.render();
  }

  _cmp(a, b) {
    const { col, dir } = this._sort;
    const va = a.k[col], vb = b.k[col];
    // valor ausente (ex.: resultado de venda condicional) fica sempre no fim
    const na = va == null || Number.isNaN(va), nb = vb == null || Number.isNaN(vb);
    if (na !== nb) return na ? 1 : -1;
    let c = 0;
    if (!na) {
      c = (typeof va === 'string' || typeof vb === 'string')
        ? String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' })
        : va - vb;
    }
    if (c) return c * dir;
    // desempate: momento do evento, mais recente primeiro
    return (b.k[_OPS_COL_DATA] || 0) - (a.k[_OPS_COL_DATA] || 0);
  }

  _ms(t) { const n = new Date(t).getTime(); return Number.isNaN(n) ? null : n; }

  _origemTxt(op) { return op.roboApelido || op.roboClientId || this._t('op_origem_manual'); }

  /* Chaves de ordenacao, uma por coluna, com os mesmos valores exibidos na linha. */
  _lotKeys(lot) {
    const price = this._ops.precoOp(lot);
    let result, ret;
    if (Math.abs(lot.realized) > 1e-6) {
      result = this._ops.converterPreco(lot.realized, lot.moedaExib);
      ret = lot.realized / (lot.sold * lot.price) * 100;
    } else {
      const current = this._ops.currentAvg();
      result = lot.remaining * (current - price);
      ret = price > 0 ? (current - price) / price * 100 : 0;
    }
    return [String(lot.id), this._t('op_compra'), this._origemTxt(lot), this._ms(lot.time), price, lot.qty,
      this._ops.converterPreco(lot.brl, lot.moedaExib),
      lot.fee_brl > 0.005 ? this._ops.converterPreco(lot.fee_brl, lot.moedaExib) : 0,
      result, ret];
  }

  _sellKeys(sell) {
    const exec = sell.status === 'executed';
    return [this._sellLabel(sell), this._t('op_venda'), this._origemTxt(sell), this._ms(exec ? sell.execTime : sell.markTime),
      this._ops.converterPreco(exec ? sell.execPrice : sell.markPrice, sell.moedaExib),
      exec ? sell.qty : (sell.reserved || sell.qty),
      this._ops.converterPreco(exec ? sell._value : sell.origVal, sell.moedaExib),
      exec && sell.fee_brl > 0.005 ? this._ops.converterPreco(sell.fee_brl, sell.moedaExib) : 0,
      exec ? this._ops.converterPreco(sell._pnl, sell.moedaExib) : null,
      exec ? sell._ret : null];
  }

  _sellLabel(sell) {
    return sell.status === 'executed' ? (sell._profit >= 0 ? 'L' : 'P') + (sell.seq ?? '') : (sell.id || ('V' + sell.seq));
  }

  /**
   * Quem fez a operacao: nome do robo (vindo de roboApelido, resolvido no
   * servidor a partir de robo_client_id) ou "(manual)" quando foi o proprio
   * usuario que comprou/vendeu pela tela.
   */
  _origemHtml(op) {
    const robo = op.roboApelido || op.roboClientId;
    if (robo) return `<span style="color:var(--accent)">${_escT(robo)}</span>`;
    return `<span style="color:var(--muted)">${_escT(this._t('op_origem_manual'))}</span>`;
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
      result = '<span style="color:var(--muted)">' + this._fmt.brl(unreal) + ' ' + _escT(this._t('op_proj')) + '</span>';
      ret = this._fmt.pct(price > 0 ? (current - price) / price * 100 : 0);
    }
    const tr = this._doc.createElement('tr'); tr.className = cls;
    tr.innerHTML = `<td><b>${_escT(lot.id)}</b></td><td><span class="tag tag-buy">${_escT(this._t('op_compra'))}</span></td><td>${this._origemHtml(lot)}</td>` +
      `<td>${this._fmt.utc(new Date(lot.time))}</td><td>${this._fmt.brl(price)}</td>` +
      `<td>${this._fmt.btc(lot.qty)}<br><span style="color:var(--muted);font-size:10px">${this._t('op_rest')} ${this._fmt.btc(lot.remaining)}</span></td>` +
      `<td>${this._fmt.brl(brlConv)}</td>` + `<td style="color:var(--muted);font-size:0.9em">${(lot.fee_brl > 0.005) ? this._fmt.brl(this._ops.converterPreco(lot.fee_brl, lot.moedaExib)) + ' ⛓' : '—'}</td>` + `<td>${result}</td><td>${ret}</td>`;
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
      result = `${_escT(this._t('op_venda_condicional'))}<br><span style="color:var(--muted);font-size:10px">${_escT(this._t('op_faltam_passos', {n: steps}))}</span>`;
    }
    const tr = this._doc.createElement('tr'); tr.className = cls;
    const label = this._sellLabel(sell);
    const when = sell.status === 'executed' ? sell.execTime : sell.markTime;
    tr.innerHTML = `<td><b>${_escT(label)}</b></td><td><span class="tag tag-sell">${_escT(this._t('op_venda'))}</span></td><td>${this._origemHtml(sell)}</td>` +
      `<td>${this._fmt.utc(new Date(when))}</td><td>${this._fmt.brl(price)}</td>` +
      `<td>${this._fmt.btc(qty)}</td><td>${this._fmt.brl(value)}</td>` + `<td style="color:var(--muted);font-size:0.9em">${(sell.status === 'executed' && sell.fee_brl > 0.005) ? this._fmt.brl(this._ops.converterPreco(sell.fee_brl, sell.moedaExib)) + ' ⛓' : '—'}</td>` + `<td>${result}</td><td>${ret}</td>`;
    tr.appendChild(this._actionsCell('sell', sell));
    if (sell.hidden && tr.style) tr.style.opacity = '0.5';
    return tr;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { OperationsTable };
if (typeof window !== 'undefined') window.OperationsTable = OperationsTable;
