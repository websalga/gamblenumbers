'use strict';
const { DataStore } = require('./datastore.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ FALHOU:', msg); } }
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

/* Gera snapshots imitando o padrão real: 1 ponto a cada ~5 min,
   preço subindo devagar. spanMinutes = quanto tempo de histórico. */
function fakeData(spanMinutes, endMs) {
  const rows = [];
  const stepMs = 5 * 60 * 1000;
  const nPts = Math.floor(spanMinutes / 5);
  const startMs = endMs - nPts * stepMs;
  for (let i = 0; i <= nPts; i++) {
    const t = startMs + i * stepMs;
    const base = 317000 + i * 40; // sobe 40 BRL por passo
    rows.push({
      t,
      avg: base,
      binance: base + 1800,
      kraken: base - 1000,
      coinbase: base - 1050,
      btc_usd: 63000,
      usd_brl: 5.06,
    });
  }
  return rows;
}

async function run() {
  const END = Date.UTC(2026, 7, 2, 19, 0, 0); // 2026-08-02 19:00 UTC

  // fetch falso: responde 'cotacoes' com 24h de dados e 'atual' com um ponto novo
  let atualExtra = null;
  const fetchFn = async (url) => {
    if (url.includes('acao=cotacoes')) {
      return { ok: true, data: fakeData(24 * 60, END) };
    }
    if (url.includes('acao=atual')) {
      if (atualExtra) return { ok: true, data: atualExtra };
      return { ok: true, data: fakeData(5, END).pop() }; // mesmo último = nada novo
    }
    return { ok: false, error: 'rota desconhecida' };
  };

  const store = new DataStore({ fetchFn });

  // 1) carga
  const n = await store.load(1500);
  ok(n > 0, 'load trouxe linhas');
  ok(store.ready === true, 'ready vira true após load');
  ok(store.latestT() === END, 'latestT é o fim da janela');

  // 2) nearest / between
  const mid = store.nearest(END - 12 * 3600 * 1000);
  ok(mid != null && mid.t <= END, 'nearest devolve ponto do meio');
  const win = store.between(END - 3600 * 1000, END);
  ok(win.length >= 12 && win.length <= 14, 'between ~1h traz ~12-13 pontos (5 min cada)');

  // 3) resample não depende de "now" global — ancorado em endT explícito
  const P1D = { points: 96, stepMs: 24 * 3600 * 1000 / 96 };
  const serie = store.resample(P1D, store.latestT());
  ok(serie.length === 96, 'resample 1D devolve 96 pontos');
  ok(serie[0].avg > 0 && serie[95].avg > 0, 'primeiro e último ponto têm preço');
  ok(!approx(serie[0].avg, serie[95].avg), 'primeiro != último (série tem movimento, NÃO colapsa)');

  // 4) variation: o número que hoje zera, agora calculado direto do vetor real
  const v = store.variation('avg', 24 * 3600 * 1000);
  ok(v != null, 'variation devolve resultado');
  ok(v.pct > 0, `variação 24h da média é POSITIVA e não-zero (pct=${v.pct.toFixed(4)}%)`);
  const vb = store.variation('binance', 24 * 3600 * 1000);
  ok(vb.pct > 0 && !approx(vb.pct, 0), `variação binance também não-zero (pct=${vb.pct.toFixed(4)}%)`);

  // 5) refresh incremental: nada novo -> false; ponto novo -> true e cresce só na ponta
  const before = store.length;
  const r0 = await store.refresh();
  ok(r0 === false, 'refresh sem dado novo retorna false');
  ok(store.length === before, 'vetor não cresce quando não há novidade');

  atualExtra = { t: END + 5 * 60 * 1000, avg: 321000, binance: 322800, kraken: 320000, coinbase: 319950, btc_usd: 63100, usd_brl: 5.06 };
  const r1 = await store.refresh();
  ok(r1 === true, 'refresh com dado novo retorna true');
  ok(store.length === before + 1, 'vetor cresce exatamente 1 na ponta');
  ok(store.latestT() === atualExtra.t, 'latestT avança para o novo instante real');

  // 6) unicidade: reenviar o mesmo instante não duplica
  const r2 = await store.refresh();
  ok(r2 === false, 'reenviar mesmo instante não duplica');
  ok(store.length === before + 1, 'tamanho estável após tentativa de duplicar');

  // 7) getters devolvem cópia (imutabilidade do interno)
  const l = store.latest(); l.avg = -999;
  ok(store.latest().avg !== -999, 'latest() devolve cópia; mexer no retorno não altera o store');

  // 8) trim respeita o teto
  const small = new DataStore({ fetchFn, maxLen: 50 });
  await small.load(1500);
  ok(small.length <= 50, `trim mantém no máximo maxLen (=${small.length})`);
  ok(small.latestT() === END, 'após trim, o mais recente continua na ponta');

  console.log(`\n${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('ERRO no teste:', e); process.exit(1); });
