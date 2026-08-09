'use strict';
const { PlotArea } = require('./plotarea.js');
const R = require('./renderers.js');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } }

/* ctx mock que registra o nome de cada método chamado e argumentos */
function recordingCanvas(wCss = 700, hCss = 400) {
  const calls = [];
  const handler = { get: (_t, prop) => (...a) => { calls.push({ op: String(prop), args: a }); } };
  const ctx = new Proxy({}, handler);
  return {
    _calls: calls,
    width: wCss, height: hCss,
    getBoundingClientRect: () => ({ width: wCss, height: hCss }),
    getContext: () => ctx,
  };
}
function used(calls, op) { return calls.some(c => c.op === op); }
function texts(calls) { return calls.filter(c => c.op === 'fillText').map(c => c.args[0]); }

function makePlot() {
  const canvas = recordingCanvas();
  const pa = new PlotArea({ canvas, dpr: 1 });
  const pts = [
    { t: 1000, avg: 100, binance: 110, kraken: 90, coinbase: 95 },
    { t: 2000, avg: 120, binance: 130, kraken: 110, coinbase: 115 },
    { t: 3000, avg: 140, binance: 150, kraken: 130, coinbase: 135 },
  ];
  pa.setBoundsFromPoints(pts, { extraPrices: [200] });
  return { pa, canvas, pts };
}

function run() {
  // 1) PriceAxis desenha N+1 linhas de grid e rótulos "k"
  {
    const { pa, canvas } = makePlot();
    new R.PriceAxisRenderer({ lines: 4 }).draw(pa, {});
    ok(used(canvas._calls, 'stroke'), 'PriceAxis traça linhas de grid');
    ok(texts(canvas._calls).some(t => /k$/.test(t)), 'PriceAxis rotula preços em milhares (k)');
  }

  // 2) TimeAxis usa o formatador injetado
  {
    const { pa, canvas, pts } = makePlot();
    new R.TimeAxisRenderer({ ticks: 3 }).draw(pa, { points: pts, labelFor: t => 'T' + t });
    ok(texts(canvas._calls).some(t => /^T\d+$/.test(t)), 'TimeAxis usa labelFor injetado');
  }

  // 3) Series desenha histórico e projeção (linha tracejada via setLineDash)
  {
    const { pa, canvas, pts } = makePlot();
    const fut = [{ t: 4000, avg: 160, binance: 170, kraken: 150, coinbase: 155 }];
    new R.SeriesRenderer().draw(pa, { hist: pts, fut });
    ok(used(canvas._calls, 'moveTo') && used(canvas._calls, 'lineTo'), 'Series traça linhas');
    ok(canvas._calls.some(c => c.op === 'setLineDash' && c.args[0] && c.args[0].length === 2), 'Series usa tracejado na projeção');
  }

  // 4) TargetLine só desenha se target != null e escreve "ALVO"
  {
    const { pa, canvas } = makePlot();
    new R.TargetLineRenderer().draw(pa, { target: 150, fmtBRL: n => 'R$' + n });
    ok(texts(canvas._calls).some(t => /^ALVO/.test(t)), 'TargetLine escreve rótulo ALVO');
    const c2 = recordingCanvas(); const pa2 = new PlotArea({ canvas: c2, dpr: 1 });
    new R.TargetLineRenderer().draw(pa2, { target: null, fmtBRL: n => '' + n });
    ok(!used(c2._calls, 'stroke'), 'TargetLine não desenha quando target é null');
  }

  // 5) NowDivider escreve AGORA e os rótulos das áreas
  {
    const { pa, canvas } = makePlot();
    new R.NowDividerRenderer().draw(pa, { nowT: 2500 });
    const ts = texts(canvas._calls);
    ok(ts.includes('AGORA'), 'NowDivider escreve AGORA');
    ok(ts.some(t => /HIST/.test(t)) && ts.some(t => /PROJET/.test(t)), 'NowDivider rotula as duas áreas');
  }

  // 6) Cursor só desenha se mouse.inside
  {
    const { pa, canvas } = makePlot();
    new R.CursorRenderer().draw(pa, { mouse: { inside: false, x: 10, y: 10 } });
    ok(!used(canvas._calls, 'stroke'), 'Cursor não desenha com mouse fora');
    const c2 = recordingCanvas(); const pa2 = new PlotArea({ canvas: c2, dpr: 1 }); pa2.setBounds(0, 10, 0, 10);
    new R.CursorRenderer().draw(pa2, { mouse: { inside: true, x: 50, y: 50 } });
    ok(used(c2._calls, 'stroke'), 'Cursor desenha com mouse dentro');
  }

  // 7) LotMarker respeita a janela de tempo (fora não desenha)
  {
    const { pa, canvas } = makePlot(); // janela 1000..3000
    new R.LotMarkerRenderer().draw(pa, { lots: [{ id: 'LT1', time: 2000, price: 120, realized: 0 }] });
    ok(texts(canvas._calls).includes('LT1'), 'LotMarker desenha lote dentro da janela');
    const c2 = recordingCanvas(); const pa2 = new PlotArea({ canvas: c2, dpr: 1 }); pa2.setBounds(1000, 3000, 0, 300);
    new R.LotMarkerRenderer().draw(pa2, { lots: [{ id: 'LT9', time: 99999, price: 120, realized: 0 }] });
    ok(!texts(c2._calls).includes('LT9'), 'LotMarker ignora lote fora da janela');
  }

  // 8) SellMarker rotula por status
  {
    const { pa, canvas } = makePlot();
    new R.SellMarkerRenderer().draw(pa, { sells: [
      { id: 'V1', seq: 1, status: 'pending', markTime: 2000, markPrice: 120 },
      { seq: 2, status: 'executed', execTime: 2500, execPrice: 140, _profit: 10 },
    ] });
    const ts = texts(canvas._calls);
    ok(ts.includes('V1'), 'SellMarker rotula venda pendente como V#');
    ok(ts.includes('L2'), 'SellMarker rotula venda executada com lucro como L#');
  }

  // 9) contrato uniforme: todo renderer tem draw(plot,data)
  {
    const all = Object.keys(R);
    ok(all.length >= 8, 'há ao menos 8 renderers');
    ok(all.every(name => typeof new R[name]().draw === 'function'), 'todo renderer expõe draw()');
  }

  console.log(`\n${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
}

run();
