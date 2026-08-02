'use strict';
const { PlotArea } = require('./plotarea.js');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } }
function approx(a, b, e = 1e-6) { return Math.abs(a - b) <= e; }

/* canvas mock: 700x400 CSS px, contexto que só registra chamadas */
function mockCanvas(wCss = 700, hCss = 400) {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'setTransform' || prop === 'clearRect') return (...a) => calls.push([prop, ...a]);
      return (...a) => calls.push([prop, ...a]);
    },
  });
  return {
    _calls: calls,
    width: wCss, height: hCss,
    getBoundingClientRect: () => ({ width: wCss, height: hCss }),
    getContext: () => ctx,
  };
}

function run() {
  const canvas = mockCanvas(700, 400);
  const pa = new PlotArea({ canvas, dpr: 2 });

  // 1) resize aplicou dpr no buffer físico
  ok(canvas.width === 1400 && canvas.height === 800, 'resize multiplica dimensão física pelo dpr');
  ok(pa.w === 700 && pa.h === 400, 'dimensões CSS preservadas');

  // 2) limites a partir de pontos, com folga vertical
  const pts = [
    { t: 1000, avg: 100, binance: 110, kraken: 90, coinbase: 95 },
    { t: 2000, avg: 200, binance: 210, kraken: 190, coinbase: 195 },
  ];
  pa.setBoundsFromPoints(pts);
  ok(pa.tMin === 1000 && pa.tMax === 2000, 'tMin/tMax vêm dos pontos');
  ok(pa.pMin < 90 && pa.pMax > 210, 'pMin/pMax incluem folga além dos extremos');

  // 3) X/Y mapeiam para dentro do plotRect
  const r = pa.plotRect;
  const xL = pa.X(pa.tMin), xR = pa.X(pa.tMax);
  ok(approx(xL, pa.pad.l), 'X(tMin) = margem esquerda');
  ok(approx(xR, pa.w - pa.pad.r), 'X(tMax) = borda direita útil');
  const yTopPrice = pa.Y(pa.pMax), yBotPrice = pa.Y(pa.pMin);
  ok(yTopPrice < yBotPrice, 'preço maior mapeia para y menor (eixo invertido)');
  ok(approx(yTopPrice, pa.pad.t), 'Y(pMax) = topo');

  // 4) roundtrip dado -> pixel -> dado
  const t = 1500, p = 150;
  ok(approx(pa.invX(pa.X(t)), t, 1e-6), 'invX(X(t)) == t');
  ok(approx(pa.invY(pa.Y(p)), p, 1e-6), 'invY(Y(p)) == p');

  // 5) extraPrices ampliam os limites (ex.: linha de alvo fora da faixa)
  pa.setBoundsFromPoints(pts, { extraPrices: [500] });
  ok(pa.pMax > 500, 'extraPrices (alvo) entram no cálculo de limites');

  // 6) inViewT
  ok(pa.inViewT(1500) && !pa.inViewT(9999), 'inViewT detecta dentro/fora da janela');

  // 7) setBounds protege contra faixa degenerada (min==max)
  pa.setBounds(5, 5, 7, 7);
  ok(pa.tMax > pa.tMin && pa.pMax > pa.pMin, 'faixa degenerada é expandida para não dividir por zero');

  // 8) construtor exige canvas
  let threw = false;
  try { new PlotArea({}); } catch (_) { threw = true; }
  ok(threw, 'construtor sem canvas lança');

  // 9) cores acessíveis por nome
  ok(pa.color('binance') === '#f7c948', 'paleta padrão acessível via color()');
  const pa2 = new PlotArea({ canvas: mockCanvas(), colors: { binance: '#000000' } });
  ok(pa2.color('binance') === '#000000', 'cor customizada sobrescreve a padrão');

  console.log(`\n${pass} passaram, ${fail} falharam.`);
  process.exit(fail ? 1 : 0);
}

run();
