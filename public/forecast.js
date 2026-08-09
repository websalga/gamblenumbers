/* ============================================================
 * forecast.js — Banda Min/Max + Delta Nativo do Período (v6b)
 *
 * Fix v6b: resultado[0] = lastPrice exato (sem delta no 1º ponto)
 * → garante conexão visual perfeita com a última cotação real.
 * ============================================================ */
window.Forecast = (function () {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function percentil(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = clamp(Math.floor(sorted.length * p), 0, sorted.length - 1);
    return sorted[idx];
  }

  function project(hist, nPontos, _premium) {

    const data = hist.filter(h => h.avg != null && isFinite(+h.avg) && +h.avg > 0);
    if (data.length < 4) {
      const last = data.length ? +data[data.length - 1].avg : 0;
      return Array.from({ length: nPontos }, () => last);
    }

    const prices    = data.map(h => +h.avg);
    const lastPrice = prices[prices.length - 1];

    /* Banda do período */
    const bandMax = Math.max(...prices);
    const bandMin = Math.min(...prices);

    /* 3 deltas nativos (p25/p50/p75) das diferenças reais do período */
    const diffs = [];
    for (let i = 1; i < prices.length; i++) {
      diffs.push(prices[i] - prices[i - 1]);
    }
    const dLow  = percentil(diffs, 0.25);
    const dMid  = percentil(diffs, 0.50);
    const dHigh = percentil(diffs, 0.75);
    const deltas = [dLow, dMid, dHigh];

    const resultado = [];
    let cur = lastPrice;

    /* Ponto 0: exatamente o último preço real — garante conexão sem salto */
    resultado.push(cur);

    /* Pontos 1..nPontos-1: simulação com deltas nativos */
    for (let i = 1; i < nPontos; i++) {
      const pos = bandMax > bandMin
        ? (cur - bandMin) / (bandMax - bandMin)
        : 0.5;

      let delta;
      const r = Math.random();
      if (pos > 0.72 && r < 0.65) {
        delta = dLow;
      } else if (pos < 0.28 && r < 0.65) {
        delta = dHigh;
      } else {
        delta = deltas[Math.floor(Math.random() * 3)];
      }

      cur = clamp(cur + delta, bandMin, bandMax);
      resultado.push(cur);
    }

    return resultado;
  }

  return { project };
})();
