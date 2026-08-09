/* ============================================================
 * forecast.js — Walk-Forward SMA-24 (v4, smooth anchor)
 *
 * Algoritmo vencedor do backtesting com dados reais BTC/BRL.
 * Opera sobre qualquer séria numérica, qualquer período, qualquer moeda.
 *
 * v4: suavização de saída — 1º bloco interpola do último preço real
 *     até a previsão SMA, eliminando o salto brusco na junção.
 *
 * Interface mantida: project(hist, nPontos, premium) → number[]
 * ============================================================ */
window.Forecast = (function () {
  'use strict';

  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
  }

  /* Componente cíclico: padrão médio de cada posição dentro de um
   * ciclo de `periodo` pontos (detectado via autocorrelação simples). */
  function calcCiclico(prices, periodo) {
    if (periodo < 4 || prices.length < periodo * 2) return null;
    const fatores = new Array(periodo).fill(0);
    const contagens = new Array(periodo).fill(0);
    const win = Math.min(24, Math.floor(prices.length / 2));
    for (let i = win; i < prices.length; i++) {
      const sma = mean(prices.slice(i - win, i));
      if (sma <= 0) continue;
      const pos = i % periodo;
      fatores[pos] += (prices[i] / sma - 1);
      contagens[pos]++;
    }
    return fatores.map((s, i) => contagens[i] >= 2 ? s / contagens[i] : 0);
  }

  /* ============================================================
   * project(hist, nPontos, premium)
   * ============================================================ */
  function project(hist, nPontos, _premium) {
    const prices = hist.map(h => h.avg != null ? +h.avg : null)
                       .filter(v => v != null && isFinite(v) && v > 0);

    if (prices.length < 4) {
      const last = prices[prices.length - 1] || 0;
      return Array.from({ length: nPontos }, () => last);
    }

    /* Parâmetros fixos — period-agnostic */
    const WIN = Math.min(24, prices.length - 1);   // janela SMA: 24 pontos
    const BLOCO = 6;                                // ancora a cada 6 predições
    const REVERSION = 0.12;                         // força de reversão à SMA por bloco

    const ciclo = calcCiclico(prices, 24);

    /* Último preço real — âncora para suavização do 1º bloco */
    const primeiroReal = prices[prices.length - 1];

    /* Walk-forward */
    const janela = prices.slice();
    const resultado = [];

    for (let idx = 0; idx < nPontos; idx++) {
      const smaAtual = mean(janela.slice(-WIN));
      const ultimo = janela[janela.length - 1];

      const posCiclo = (prices.length + idx) % 24;
      const compCiclo = ciclo ? ciclo[posCiclo] : 0;

      const desvio = smaAtual > 0 ? (ultimo / smaAtual - 1) : 0;
      const forcaPasso = REVERSION / BLOCO;

      /* Previsão SMA base */
      const pSMA = smaAtual * (1 + compCiclo) * (1 - desvio * forcaPasso);
      const pSafe = (isFinite(pSMA) && pSMA > 0) ? pSMA : ultimo;

      /* Suavização no 1º bloco: interpola do último preço real → SMA
       * blend=0 no idx=0 (começa no preço real) → blend=1 no idx=BLOCO-1 */
      const blend = Math.min(1, (idx + 1) / BLOCO);
      const p = primeiroReal * (1 - blend) + pSafe * blend;

      resultado.push(p);
      janela.push(p);

      /* A cada bloco: ancora nos últimos dados reais para limitar drift */
      if ((idx + 1) % BLOCO === 0 && prices.length >= WIN) {
        const ancora = prices.slice(-Math.min(BLOCO, prices.length));
        for (const v of ancora) janela.push(v);
      }
    }

    return resultado;
  }

  return { project };
})();
