'use strict';
const { OperationsController } = require('./operations.js');

class Bus {
  constructor() { this.events = []; }
  emit(name, data) { this.events.push({ name, data }); }
}
const canvas = { addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0 }; } };
const plot = { invX: x => x, invY: y => y, X: x => x, Y: y => y };
const doc = { getElementById() { return null; } };
const panel = { opValue: 100, ret: 5 };
let now = 1000;
let hist = [{ t: 900, avg: 100 }, { t: 1000, avg: 120 }];
const ops = new OperationsController({
  bus: new Bus(), canvas, plot, panel, doc, now: () => now,
  getSeries: () => ({ hist, fut: [] }), getPeriod: () => ({ stepMs: 10 }),
  fmt: { brl: String, btc: String },
});

function assert(condition, message) { if (!condition) throw new Error(message); }

const first = ops.doBuy(100, 900);       // 1 BTC
panel.opValue = 200;
const second = ops.doBuy(200, 950);      // 1 BTC
assert(ops.totalRemainingBTC() === 2, 'saldo comprado');
assert(ops.weightedAvg() === 150, 'preço médio ponderado');

panel.opValue = 150;
const sell = ops.scheduleSell(100, 1100); // 1,5 BTC
assert(ops.freeBTC() === 0.5, 'reserva da venda');
now = 1100; hist = [{ t: 1100, avg: 220 }];
ops.processPending();
assert(sell.status === 'executed', 'venda executada');
assert(first.status === 'closed' && first.remaining === 0, 'FIFO fecha primeiro lote');
assert(Math.abs(second.remaining - 0.5) < 1e-12, 'FIFO consome metade do segundo lote');
assert(sell._pnl === 130, 'PnL FIFO correto');

panel.opValue = 50;
const expiring = ops.scheduleSell(300, 1200);
now = 1200; hist = [{ t: 1200, avg: 250 }];
ops.processPending();
assert(expiring.status === 'expired', 'ordem expira sem atingir alvo');

const cancellable = ops.scheduleSell(260, 1300);
assert(ops.cancelSell(cancellable.id), 'cancelamento funciona');
assert(cancellable.status === 'cancelled', 'status cancelado');

console.log('operations.test.js: OK');
