'use strict';
const { DataStore } = require('./datastore.js');
const { RealSeries, ProjectedSeries } = require('./series.js');

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

// forecast fake: continua a partir do último avg, somando +50 por passo.
const fakeForecast = {
  project(hist, n /*, premium */) {
    const last = hist[hist.length - 1].avg;
    const out = [];
    for (let i = 0; i < n; i++) out.push(last + (i + 1) * 50);
    return out;
  },
};

async function run() {
  const END = Date.UTC(2026, 7, 2, 19, 0, 0);
  const fetchFn = async (url) => url.includes('cotacoes')
    ? { ok: true, data: fakeData(24 * 60, END) }
    : { ok: true, data: fakeData(5, END).pop() };
  const store = new DataStore({ fetchFn });
  await store.load(1500);

  const P = { id: '1D', points: 96, stepMs: 24 * 3600 * 1000 / 96 };
  const real = new RealSeries({ store });
  const projected = new ProjectedSeries({ real, forecast: fakeForecast, premium: { avg: 0, binance: 0.0015, kraken: -0.002, coinbase: 0.0008 } });

  // 1) interface comum: ambas respondem points(period, endT) com o mesmo shape
  const rp = real.points(P, store.latestT());
  const pp = projected.points(P, store.latestT());
  ok(rp.length === 96, 'RealSeries devolve points do tamanho do período');
  ok(pp.length === 96, 'ProjectedSeries devolve points do tamanho do período');
  for (const k of ['t', 'avg', 'binance', 'kraken', 'coinbase']) {
    ok(k in rp[0] && k in pp[0], `ambas expõem o campo ${k}`);
  }

  // 2) âncora explícita: mudar endT desloca a janela real
  const earlierEnd = store.latestT() - 18 * 3600 * 1000;
  const rpEarlier = real.points(P, earlierEnd);
  ok(rpEarlier[rpEarlier.length - 1].t <= earlierEnd, 'RealSeries respeita o endT passado (sem now global)');
  ok(rp[rp.length - 1].avg !== rpEarlier[rpEarlier.length - 1].avg, 'janelas diferentes -> últimos pontos diferentes (âncora explícita funciona)');

  // 3) projeção começa DEPOIS do fim do histórico e é contínua no tempo
  const lastRealT = rp[rp.length - 1].t;
  ok(pp[0].t > lastRealT, 'primeiro ponto projetado vem após o último real');
  ok(approx(pp[0].t - lastRealT, P.stepMs), 'passo entre real e projeção é o stepMs do período');

  // 4) projeção usa o forecast injetado (avg sobe +50/passo no fake)
  ok(pp[0].avg > rp[rp.length - 1].avg, 'projeção sobe conforme o forecast fake');
  ok(approx(pp[1].avg - pp[0].avg, 50), 'incremento da projeção bate com o forecast fake');

  // 5) exchanges da projeção seguem o spread real do histórico
  //    (binance real ~ +1800 sobre avg; então binance projetado > avg projetado)
  ok(pp[0].binance > pp[0].avg, 'binance projetado acima da média (spread positivo herdado)');
  ok(pp[0].kraken < pp[0].avg, 'kraken projetado abaixo da média (spread negativo herdado)');

  // 6) store vazio -> ambas devolvem [] sem quebrar
  const empty = new DataStore({ fetchFn: async () => ({ ok: true, data: [] }) });
  const realE = new RealSeries({ store: empty });
  const projE = new ProjectedSeries({ real: realE, forecast: fakeForecast });
  ok(realE.points(P).length === 0, 'RealSeries vazio -> []');
  ok(projE.points(P).length === 0, 'ProjectedSeries vazio -> []');

  // 7) período inválido é rejeitado com erro claro
  let threw = false;
  try { real.points({ points: 1, stepMs: 0 }); } catch (_) { threw = true; }
  ok(threw, 'período inválido lança erro');

  // 8) construtores validam dependências
  let t1 = false, t2 = false;
  try { new RealSeries({}); } catch (_) { t1 = true; }
  try { new ProjectedSeries({ real }); } catch (_) { t2 = true; }
  ok(t1, 'RealSeries sem store lança');
  ok(t2, 'ProjectedSeries sem forecast lança');

  console.log(`\n${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('ERRO:', e); process.exit(1); });
