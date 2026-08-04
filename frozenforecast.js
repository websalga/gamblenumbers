'use strict';
/* ============================================================
 * frozenforecast.js — projeção CONGELADA que só cresce pela borda.
 *
 * PROBLEMA que resolve:
 *   A forecast gera bem, mas era recalculada a cada render, com semente
 *   dependente da escala e do histórico. Ao trocar de escala a curva
 *   mudava de forma e as vendas marcadas sobre ela "descolavam".
 *
 * MODELO:
 *   - A projeção nasce UMA vez, a partir do "agora" real, e vira uma
 *     linha-mestra de { t, avg, binance, kraken, coinbase } com
 *     timestamps ABSOLUTOS.
 *   - Trocar de escala NÃO regenera: só recorta (slice) a linha-mestra.
 *   - Escala menor -> maior: preserva o que existe e COMPLEMENTA apenas
 *     o trecho faltante na BORDA DIREITA, retomando do último ponto.
 *   - Escala maior -> menor: nada é gerado (geração congelada).
 *
 * NÃO altera forecast.js — apenas a consome uma vez por trecho.
 * ============================================================ */
(function () {
  class FrozenForecast {
    constructor(deps) {
      deps = deps || {};
      if (!deps.forecast || typeof deps.forecast.project !== 'function') {
        throw new Error('FrozenForecast exige um forecast com .project().');
      }
      this._forecast = deps.forecast;
      this._premium = deps.premium || { avg: 0, binance: 0, kraken: 0, coinbase: 0 };
      this._master = [];
      this._baseT = null;
      this._stepMs = null;
      this._spread = { binance: 0, kraken: 0, coinbase: 0 };
    }

    get hasMaster() { return this._master.length > 0; }
    get baseT() { return this._baseT; }
    get edgeT() { return this._master.length ? this._master[this._master.length - 1].t : null; }
    get stepMs() { return this._stepMs; }
    get length() { return this._master.length; }

    toJSON() {
      return { baseT: this._baseT, stepMs: this._stepMs, spread: this._spread, master: this._master };
    }
    fromJSON(o) {
      if (!o || !Array.isArray(o.master)) return this;
      this._master = o.master.slice();
      this._baseT = (o.baseT != null) ? o.baseT : (this._master[0] ? this._master[0].t : null);
      this._stepMs = o.stepMs || null;
      this._spread = o.spread || this._spread;
      return this;
    }
    reset() { this._master = []; this._baseT = null; this._stepMs = null; return this; }

    /**
     * Garante cobertura até untilT. Cria na 1a vez; depois só COMPLEMENTA
     * a borda direita. Retorna quantos pontos novos entraram.
     */
    ensure(hist, untilT, stepHint) {
      if (!Array.isArray(hist) || hist.length < 2) return 0;
      const step = (stepHint > 0) ? stepHint : (this._stepMs || 6 * 3600 * 1000);

      if (!this.hasMaster) {
        this._baseT = hist[hist.length - 1].t;
        this._stepMs = step;
        this._spread = computeSpread(hist);
        const span = Math.max(0, untilT - this._baseT);
        const n = Math.max(1, Math.ceil(span / this._stepMs));
        const raw = this._forecast.project(hist, n, this._premium);
        this._appendFromRaw(raw, this._baseT, this._stepMs);
        return this._master.length;
      }

      const edge = this.edgeT;
      if (untilT <= edge) return 0;
      const missing = Math.ceil((untilT - edge) / this._stepMs);
      if (missing <= 0) return 0;

      // histórico sintético = real + projeção já congelada, para o forecast
      // continuar coerente de onde parou (emenda contínua na borda).
      const seedHist = hist.concat(this._master.map(function (m) { return { avg: m.avg }; }));
      const raw = this._forecast.project(seedHist, missing, this._premium);
      this._appendFromRaw(raw, edge, this._stepMs);
      return missing;
    }

    /** Recorta a linha-mestra para [fromT,toT] no passo pedido. Não gera nada. */
    slice(fromT, toT, stepMs) {
      if (!this.hasMaster || !(stepMs > 0) || !(toT > fromT)) return [];
      const out = [];
      const tol = stepMs;
      for (let t = fromT; t <= toT + 1; t += stepMs) {
        const m = this._nearestMaster(t, tol);
        if (m) out.push({ t: t, avg: m.avg, binance: m.binance, kraken: m.kraken, coinbase: m.coinbase });
        else out.push({ t: t, avg: null, binance: null, kraken: null, coinbase: null });
      }
      return out;
    }

    /**
     * RASTRO: o trecho da projeção que já VENCEU, isto é, que ficou para trás
     * do "agora" real conforme o tempo avançou. Serve para comparar o que foi
     * previsto com o que de fato aconteceu (acerto/desvio da forecast).
     *
     * @param {number} nowT instante real atual
     * @param {number} [stepMs] passo de amostragem (default: o da linha-mestra)
     * @returns {Array<object>} [{ t, avg }] entre baseT e nowT (vazio se nada venceu)
     */
    pastTrail(nowT, stepMs) {
      if (!this.hasMaster || nowT == null) return [];
      const step = (stepMs > 0) ? stepMs : this._stepMs;
      const out = [];
      for (const m of this._master) {
        if (m.t > nowT) break;          // ainda não venceu: para aqui
        out.push({ t: m.t, avg: m.avg });
      }
      if (!(step > 0) || out.length <= 2) return out;
      // reduz a amostragem para não poluir a tela em escalas longas
      const passo = Math.max(1, Math.round(step / this._stepMs));
      if (passo <= 1) return out;
      const red = [];
      for (let i = 0; i < out.length; i += passo) red.push(out[i]);
      if (red[red.length - 1] !== out[out.length - 1]) red.push(out[out.length - 1]);
      return red;
    }

    /**
     * Erro entre o que foi projetado e o que aconteceu de fato, no trecho já
     * vencido. `realAt(t)` deve devolver o preço real naquele instante.
     * @param {number} nowT
     * @param {function(number):(number|null)} realAt
     * @returns {object|null} { n, mae, mape, bias } ou null se nada a comparar
     */
    trailError(nowT, realAt) {
      const trail = this.pastTrail(nowT);
      if (!trail.length || typeof realAt !== 'function') return null;
      let n = 0, somaAbs = 0, somaPct = 0, somaBias = 0;
      for (const p of trail) {
        const real = realAt(p.t);
        if (real == null || !(real > 0)) continue;
        const err = p.avg - real;
        n++; somaAbs += Math.abs(err); somaPct += Math.abs(err) / real; somaBias += err;
      }
      if (!n) return null;
      return { n: n, mae: somaAbs / n, mape: (somaPct / n) * 100, bias: somaBias / n };
    }

    /** Preço projetado exatamente em t (interpolado). Ancora as vendas. */
    priceAt(t) {
      const m = this._master;
      if (!m.length) return null;
      if (t <= m[0].t) return m[0].avg;
      if (t >= m[m.length - 1].t) return m[m.length - 1].avg;
      let lo = 0, hi = m.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (m[mid].t <= t) lo = mid; else hi = mid; }
      const a = m[lo], b = m[hi];
      const span = (b.t - a.t) || 1;
      return a.avg + (b.avg - a.avg) * ((t - a.t) / span);
    }

    _appendFromRaw(raw, fromT, stepMs) {
      if (!Array.isArray(raw)) return;
      for (let i = 0; i < raw.length; i++) {
        const avg = +raw[i];
        if (!isFinite(avg) || avg <= 0) continue;
        this._master.push({
          t: fromT + (i + 1) * stepMs,
          avg: avg,
          binance: avg * (1 + this._spread.binance),
          kraken: avg * (1 + this._spread.kraken),
          coinbase: avg * (1 + this._spread.coinbase),
        });
      }
    }

    _nearestMaster(t, tol) {
      const m = this._master;
      if (!m.length) return null;
      if (t <= m[0].t) return Math.abs(m[0].t - t) <= tol ? m[0] : null;
      if (t >= m[m.length - 1].t) return Math.abs(m[m.length - 1].t - t) <= tol ? m[m.length - 1] : null;
      let lo = 0, hi = m.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (m[mid].t <= t) lo = mid; else hi = mid; }
      const a = m[lo], b = m[hi];
      const pick = (Math.abs(a.t - t) <= Math.abs(b.t - t)) ? a : b;
      return Math.abs(pick.t - t) <= tol ? pick : null;
    }
  }

  function computeSpread(hist) {
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

  if (typeof module !== 'undefined' && module.exports) module.exports = { FrozenForecast: FrozenForecast };
  if (typeof window !== 'undefined') window.FrozenForecast = FrozenForecast;
})();
