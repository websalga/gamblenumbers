'use strict';
const { DataStore } = require('./datastore.js');
const { ExchangeCard } = require('./exchangecard.js');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } }
function approx(a, b, e = 1e-6) { return Math.abs(a - b) <= e; }

function fakeData(spanMinutes, endMs) {
  const rows = [], stepMs = 5 * 60 * 1000, nPts = Math.floor(spanMinutes / 5);
  const startMs = endMs - nPts * stepMs;
  for (let i = 0; i <= nPts; i++) {
    const t = startMs + i * stepMs, base = 317000 + i * 40;
    rows.push({ t, avg: base, binance: base + 1800, kraken: base - 1000, coinbase: base - 1050, btc_usd: 63000, usd_brl: 5.06 });
  }
  return rows;
}

const META = {
  avg: { label: 'Média', color: '#22d3ee', premium: 0 },
  binance: { label: 'Binance', color: '#f7c948', premium: 0.0015 },
  kraken: { label: 'Kraken', color: '#a855f7', premium: -0.0020 },
  coinbase: { label: 'Coinbase', color: '#3b82f6', premium: 0.0008 },
};

async function run() {
  const END = Date.UTC(2026, 7, 2, 19, 0, 0);
  const fetchFn = async (url) => url.includes('cotacoes')
    ? { ok: true, data: fakeData(24 * 60, END) }
    : { ok: true, data: fakeData(5, END).pop() };
  const store = new DataStore({ fetchFn });
  await store.load(1500);

  const DAY = 24 * 3600 * 1000;

  // 1) variação não-zero e coerente com o preço subindo
  const kraken = new ExchangeCard('kraken', { store, meta: META.kraken });
  const mk = kraken.compute({ spanMs: DAY });
  ok(mk != null, 'compute devolve modelo');
  ok(mk.varPct > 0, `variação Kraken 24h positiva e não-zero (${mk.varPct.toFixed(4)}%)`);

  // 2) cada card só olha a SUA exchange — valores diferentes entre eles
  const binance = new ExchangeCard('binance', { store, meta: META.binance });
  const mb = binance.compute({ spanMs: DAY });
  ok(!approx(mk.cur, mb.cur), 'Kraken e Binance têm preços atuais diferentes (isolamento correto)');
  ok(mb.cur > mk.cur, 'Binance > Kraken, como nos dados sintéticos');

  // 3) o card NÃO guarda cópia dos dados; lê do store na hora
  //    (checamos que um refresh no store reflete no próximo compute)
  const before = mb.cur;
  store.ingest([{ t: END + 5 * 60 * 1000, avg: 400000, binance: 402000, kraken: 399000, coinbase: 398900, btc_usd: 63000, usd_brl: 5.06 }]);
  const mb2 = binance.compute({ spanMs: DAY });
  ok(mb2.cur > before, 'após novo dado no store, o card reflete o preço novo (sem cópia própria)');

  // 4) USD calculado com a taxa real
  ok(mb2.usd != null && approx(mb2.usd, mb2.cur / 5.06, 1e-3), 'USD = preço / usd_brl real');

  // 5) meta e lucro respondem às entradas do usuário
  const semLote = binance.compute({ spanMs: DAY, ret: 6, weighted: 0, remainingBTC: 0 });
  ok(approx(semLote.profit, 0), 'sem lotes, lucro estimado é zero');
  const comLote = binance.compute({ spanMs: DAY, ret: 6, weighted: 300000, remainingBTC: 0.1 });
  ok(comLote.profit > 0, 'com lote e retorno positivo, lucro estimado > 0');
  ok(comLote.target > 300000, 'meta fica acima do preço médio quando retorno é positivo');

  // 6) premium por exchange entra na meta
  const c_avg = new ExchangeCard('avg', { store, meta: META.avg }).compute({ spanMs: DAY, ret: 6, weighted: 300000, remainingBTC: 0.1 });
  ok(comLote.target !== c_avg.target, 'premium diferente -> meta diferente entre exchanges');

  // 7) store vazio não quebra
  const empty = new DataStore({ fetchFn: async () => ({ ok: true, data: [] }) });
  const cEmpty = new ExchangeCard('avg', { store: empty, meta: META.avg });
  ok(cEmpty.compute({ spanMs: DAY }) === null, 'store vazio -> compute retorna null sem lançar');

  // 8) construtor valida dependências
  let threw = false;
  try { new ExchangeCard('avg', {}); } catch (_) { threw = true; }
  ok(threw, 'construtor sem store lança erro claro');

  console.log(`\n${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('ERRO:', e); process.exit(1); });
