/* ============================================================
 * forecast.js — Banda Min/Max + Delta Nativo do Período (v7)
 *
 * v7: dois ajustes de realismo físico
 *
 * 1. CAP DE STEP — cada delta é limitado ao p95 dos movimentos
 *    absolutos observados no histórico. O forecast nunca pode
 *    saltar mais do que o maior movimento real já visto naquele
 *    período, excluindo outliers extremos (p95 em vez de max).
 *    Isso replica a física: para o preço cair muito ele precisa
 *    de muitos lançamentos intermediários, não de um salto único.
 *
 * 2. MEAN REVERSION SUAVE — gatilho sobe de 0.72/0.28 → 0.85/0.15
 *    e probabilidade cai de 65% → 30%. A reversão só age quando
 *    muito próximo dos extremos e com menor frequência, evitando
 *    que vários passos seguidos usem o delta mais extremo.
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
    let bandMax = Math.max(...prices);
    let bandMin = Math.min(...prices);
    // Garantir amplitude mínima configurável (evita banda plana em pares de baixa volatilidade)
    if (_minAmpPct != null) {
      const mid  = (bandMax + bandMin) / 2;
      const minH = mid * _minAmpPct / 2;
      if ((bandMax - bandMin) < mid * _minAmpPct) {
        bandMax = mid + minH;
        bandMin = mid - minH;
      }
    }

    /* Diferenças reais consecutivas do período */
    const diffs = [];
    for (let i = 1; i < prices.length; i++) {
      diffs.push(prices[i] - prices[i - 1]);
    }

    /* 3 deltas nativos (p25/p50/p75) */
    const dLow  = percentil(diffs, 0.25);
    const dMid  = percentil(diffs, 0.50);
    const dHigh = percentil(diffs, 0.75);
    const deltas = [dLow, dMid, dHigh];

    /* Cap físico: p95 dos movimentos absolutos observados.
     * Nenhum passo da simulação pode exceder o que já aconteceu
     * de fato naquele período/resolução, eliminando saltos irreais. */
    const absDiffs = diffs.map(d => Math.abs(d));
    const capStep  = percentil(absDiffs, 0.95);

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

      /* Mean reversion suave: só ativa próximo dos extremos (0.85/0.15)
       * e com baixa probabilidade (30%) — evita rajadas de passos extremos */
      if (pos > 0.85 && r < 0.30) {
        delta = dLow;
      } else if (pos < 0.15 && r < 0.30) {
        delta = dHigh;
      } else {
        delta = deltas[Math.floor(Math.random() * 3)];
      }

      /* Aplica o cap físico: nenhum passo excede o p95 observado */
      delta = clamp(delta, -capStep, capStep);

      cur = clamp(cur + delta, bandMin, bandMax);
      resultado.push(cur);
    }

    return resultado;
  }

  let _minAmpPct = null; // configurável via applyConfig

  function applyConfig(cfg) {
    _minAmpPct = (cfg && cfg.forecastMinAmpPct != null) ? cfg.forecastMinAmpPct / 100 : null;
  }

  return { project, applyConfig };
})();
