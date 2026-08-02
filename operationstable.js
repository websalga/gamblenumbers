'use strict';

class OperationsTable {
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
      body.innerHTML = '<tr><td colspan="8" style="color:#7d8aa3;text-align:center;padding:20px">Nenhuma operação ainda. Clique com o botão direito no histórico para comprar.</td></tr>';
    }
  }

  _lotRow(lot) {
    let cls = 'row-y', result = '—', ret = '—';
    if (lot.realized > 1e-6) cls = 'row-g'; else if (lot.realized < -1e-6) cls = 'row-r';
    if (Math.abs(lot.realized) > 1e-6) {
      result = this._fmt.brl(lot.realized);
      ret = this._fmt.pct(lot.realized / (lot.sold * lot.price) * 100);
    } else {
      const current = this._ops.currentAvg(), unreal = lot.remaining * (current - lot.price);
      result = '<span style="color:#7d8aa3">' + this._fmt.brl(unreal) + ' proj.</span>';
      ret = this._fmt.pct(lot.price > 0 ? (current - lot.price) / lot.price * 100 : 0);
    }
    const tr = this._doc.createElement('tr'); tr.className = cls;
    tr.innerHTML = `<td><b>${lot.id}</b></td><td><span class="tag tag-buy">Compra</span></td>` +
      `<td>${this._fmt.utc(new Date(lot.time))}</td><td>${this._fmt.brl(lot.price)}</td>` +
      `<td>${this._fmt.btc(lot.qty)}<br><span style="color:#7d8aa3;font-size:10px">rest. ${this._fmt.btc(lot.remaining)}</span></td>` +
      `<td>${this._fmt.brl(lot.brl)}</td><td>${result}</td><td>${ret}</td>`;
    return tr;
  }

  _sellRow(sell) {
    let cls = 'row-y', result = 'VENDA CONDICIONAL', ret = '—';
    let price = sell.markPrice, value = sell.origVal, qty = sell.reserved || sell.qty;
    if (sell.status === 'executed') {
      cls = sell._profit >= 0 ? 'row-g' : 'row-r';
      result = this._fmt.brl(sell._pnl); ret = this._fmt.pct(sell._ret);
      price = sell.execPrice; value = sell._value; qty = sell.qty;
    } else {
      const steps = Math.max(0, Math.ceil((sell.markTime - this._now()) / this._period().stepMs));
      result = `VENDA CONDICIONAL<br><span style="color:#7d8aa3;font-size:10px">faltam ${steps} passos</span>`;
    }
    const tr = this._doc.createElement('tr'); tr.className = cls;
    const label = sell.status === 'executed' ? (sell._profit >= 0 ? 'L' : 'P') + sell.seq : 'V' + sell.seq;
    const when = sell.status === 'executed' ? sell.execTime : sell.markTime;
    tr.innerHTML = `<td><b>${label}</b></td><td><span class="tag tag-sell">Venda</span></td>` +
      `<td>${this._fmt.utc(new Date(when))}</td><td>${this._fmt.brl(price)}</td>` +
      `<td>${this._fmt.btc(qty)}</td><td>${this._fmt.brl(value)}</td><td>${result}</td><td>${ret}</td>`;
    return tr;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { OperationsTable };
if (typeof window !== 'undefined') window.OperationsTable = OperationsTable;
