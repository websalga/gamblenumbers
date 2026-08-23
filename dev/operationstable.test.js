'use strict';
const { OperationsTable } = require('./operationstable.js');

function node() { return { innerHTML: '', className: '', textContent: '', title: '', disabled: false, style: {}, onclick: null, children: [], appendChild(x) { this.children.push(x); return x; } }; }
const body = node();
const doc = { getElementById: id => id === 'opsBody' ? body : null, createElement: () => node() };
const operations = {
  lots: [{ id: 'LT1', time: 1, price: 100, qty: 1, remaining: 0, sold: 1, brl: 100, realized: 20 }],
  sells: [{ id: 'V1', seq: 1, status: 'executed', markPrice: 110, execPrice: 120, execTime: 2, qty: 1, reserved: 0, origVal: 100, _profit: 20, _pnl: 20, _value: 120, _ret: 20 }],
  currentAvg: () => 120,
};
const table = new OperationsTable({
  doc, operations, now: () => 2, getPeriod: () => ({ stepMs: 1 }),
  fmt: { brl: n => `R$${n}`, btc: n => `${n}BTC`, pct: n => `${n}%`, utc: d => String(d.getTime()) },
});
table.render();
if (body.children.length !== 2) throw new Error('deve renderizar lote e venda');
if (!/LT1/.test(body.children[0].innerHTML)) throw new Error('linha do lote ausente');
if (!/L1/.test(body.children[1].innerHTML)) throw new Error('linha da venda executada ausente');
console.log('operationstable.test.js: OK');
