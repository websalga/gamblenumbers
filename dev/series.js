'use strict';
/* ============================================================
 * Series — as duas fontes de linha do gráfico, isoladas.
 *
 * RealSeries      → pontos REAIS, vindos do DataStore (resample).
 * ProjectedSeries → pontos PROJETADOS, vindos do Forecast, a partir
 *                   do histórico real reamostrado.
 *
 * Ambas expõem a MESMA interface:
 *     points(period, endT) -> [{ t, avg, binance, kraken, coinbase }, ...]
 *
 * Por isso o gráfico pode tratar as duas do mesmo jeito, sem saber
 * qual é real e qual é projeção — só recebe "séries que sabem se
 * entregar por período". A âncora temporal (endT) é sempre EXPLÍCITA:
 * nenhuma das duas depende de um "now" global.
 *
 * period = { id, points, stepMs }  (o mesmo objeto da régua PERIODS)
 * ============================================================ */

/* ---------- Série real ---------- */
class RealSeries {
  /**
   * @param {object} deps
   * @param {DataStore} deps.store
   */
  constructor(deps = {}) {
    if (!deps.store) throw new Error('RealSeries exige um DataStore.');
    this._store = deps.store;
  }

  /**
   * Pontos reais reamostrados na escala do período, terminando em endT.
   * @param {object} period { points, stepMs }
   * @param {number} [endT] default = último dado real do store
   * @returns {Array<object>}
   */
  points(period, endT) {
    validatePeriod(period);
    const end = (endT == null) ? this._store.latestT() : endT;
    if (end == null) return [];
    return this._store.resample(period, end);
  }

  /** Último instante real coberto (para o gráfico posicionar o "AGORA"). */
  endT() { return this._store.latestT(); }
}

/* ---------- Série projetada ---------- */
class ProjectedSeries {
  /**
   * @param {object} deps
   * @param {RealSeries} deps.real     - fonte do histórico base
   * @param {object}     deps.forecast - objeto com .project(hist, n, premium)
   * @param {object}     [deps.premium]- ágio/deságio por exchange
   */
  constructor(deps = {}) {
    if (!deps.real) throw new Error('ProjectedSeries exige uma RealSeries base.');
    if (!deps.forecast || typeof deps.forecast.project !== 'function') {
      throw new Error('ProjectedSeries exige um forecast com .project().');
    }
    this._real = deps.real;
    this._forecast = deps.forecast;
    this._premium = deps.premium || { avg: 0, binance: 0, kraken: 0, coinbase: 0 };
    // Fonte CONGELADA opcional. Quando presente, a projeção não é recriada a
    // cada render: o frozen mantém a linha-mestra (que só cresce pela borda) e
    // aqui apenas recortamos a janela. É o que impede as vendas marcadas sobre
    // a projeção de "descolar" quando o usuário troca de escala.
    this._frozen = deps.frozen || null;
  }

  /** Liga/atualiza a fonte congelada depois de construída. */
  setFrozen(frozen) { this._frozen = frozen || null; return this; }

  /**
   * Pontos projetados para DEPOIS de endT, na escala do período.
   * Deriva do histórico real (via RealSeries) o drift/vol/ciclo e
   * projeta `period.points` passos à frente. As exchanges seguem o
   * ágio/deságio médio real do próprio histórico.
   * @param {object} period { points, stepMs }
   * @param {number} [endT]
   * @returns {Array<object>}
   */
  points(period, endT) {
    validatePeriod(period);
    const hist = this._real.points(period, endT);
    const n = period.points | 0;
    if (!hist.length) return [];
    const end = hist[hist.length - 1].t;

    // ---- Caminho CONGELADO (preferido quando ha frozen) ----
    // O frozen garante cobertura ate end+span, complementando so a borda
    // faltante; aqui apenas recortamos o que ja existe.
    if (this._frozen) {
      const span = n * period.stepMs;
      this._frozen.ensure(hist, end + span, period.stepMs);
      return this._frozen.slice(end + period.stepMs, end + span, period.stepMs);
    }

    // ---- Caminho DINAMICO (legado / testes) ----
    const projAvg = this._forecast.project(hist, n, this._premium);
    if (!Array.isArray(projAvg) || !projAvg.length) return [];

    const spread = avgSpread(hist);
    const out = [];
    for (let i = 0; i < n; i++) {
      const avg = num(projAvg[i]);
      if (avg == null) continue;
      out.push({
        t: end + (i + 1) * period.stepMs,
        avg,
        binance: avg * (1 + spread.binance),
        kraken: avg * (1 + spread.kraken),
        coinbase: avg * (1 + spread.coinbase),
      });
    }
    return out;
  }
}

/* ---------- helpers ---------- */

function validatePeriod(p) {
  if (!p || !(p.points > 1) || !(p.stepMs > 0)) {
    throw new Error('period inválido: precisa de points>1 e stepMs>0.');
  }
}

/* ágio/deságio médio real de cada exchange vs a média — igual à
 * lógica do app original, isolada aqui para a projeção herdar o
 * padrão real de cada corretora. */
function avgSpread(hist) {
  const acc = { binance: 0, kraken: 0, coinbase: 0 };
  const cnt = { binance: 0, kraken: 0, coinbase: 0 };
  for (const h of hist) {
    for (const k of ['binance', 'kraken', 'coinbase']) {
      if (h.avg > 0 && h[k] > 0) { acc[k] += (h[k] / h.avg - 1); cnt[k]++; }
    }
  }
  return {
    binance: cnt.binance ? acc.binance / cnt.binance : 0,
    kraken: cnt.kraken ? acc.kraken / cnt.kraken : 0,
    coinbase: cnt.coinbase ? acc.coinbase / cnt.coinbase : 0,
  };
}

function num(v) { if (v == null) return null; const n = +v; return Number.isFinite(n) ? n : null; }

if (typeof module !== 'undefined' && module.exports) module.exports = { RealSeries, ProjectedSeries };
if (typeof window !== 'undefined') { window.RealSeries = RealSeries; window.ProjectedSeries = ProjectedSeries; }
