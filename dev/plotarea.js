'use strict';
/* ============================================================
 * PlotArea — o "quadro" do gráfico.
 *
 * Responsabilidade ÚNICA: ser dono da área de plotagem. Sabe:
 *   - dimensões do canvas (com device pixel ratio)
 *   - as margens internas (padding)
 *   - os limites de dados atuais (tMin/tMax no eixo tempo,
 *     pMin/pMax no eixo preço)
 *   - as escalas: X(t)/Y(p) (dado -> pixel) e invX/invY (pixel -> dado)
 *   - a paleta de cores
 *
 * NÃO desenha séries, eixos, marcadores — isso é dos renderers
 * (os "robôs"). O PlotArea só entrega o contexto e as conversões.
 * É o "objeto do tipo gráfico de plotagem que disponibiliza a área
 * dele para ser desenhada e informa parâmetros de tamanho, coordenadas,
 * pontos, limites e cores".
 *
 * Injeta-se um canvas real (navegador) ou um mock (teste). O mock
 * só precisa de getContext(), getBoundingClientRect(), width, height.
 * ============================================================ */

class PlotArea {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement|object} deps.canvas
   * @param {object} [deps.padding] { l, r, t, b }
   * @param {object} [deps.colors]  mapa exchange->cor e cores de UI
   * @param {number} [deps.dpr]     device pixel ratio (default: do ambiente ou 1)
   */
  constructor(deps = {}) {
    if (!deps.canvas) throw new Error('PlotArea exige um canvas.');
    this._canvas = deps.canvas;
    this._ctx = deps.canvas.getContext ? deps.canvas.getContext('2d') : null;
    this._pad = Object.assign({ l: 8, r: 64, t: 10, b: 22 }, deps.padding || {});
    this._colors = Object.assign({
      avg: '#22d3ee', binance: '#f7c948', kraken: '#a855f7', coinbase: '#3b82f6',
      grid: 'rgba(30,42,68,0.6)', axisText: '#7d8aa3', target: '#22c55e',
      now: 'rgba(232,237,247,0.55)', nowText: '#e8edf7', projBg: 'rgba(34,211,238,0.03)',
    }, deps.colors || {});
    this._dpr = deps.dpr || (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

    this.w = 0; this.h = 0;                         // dimensões CSS (px lógicos)
    this.tMin = 0; this.tMax = 1;                   // limites tempo
    this._forcedWindow = null;                      // janela fixada pelo pan
    this.pMin = 0; this.pMax = 1;                   // limites preço
    this.resize();
  }

  /* ---------- dimensões ---------- */

  /** Relê o tamanho do canvas e ajusta a resolução física (dpr). */
  resize() {
    const rect = this._canvas.getBoundingClientRect
      ? this._canvas.getBoundingClientRect()
      : { width: this._canvas.width || 0, height: this._canvas.height || 0 };
    this.w = rect.width; this.h = rect.height;
    if (this._ctx && 'width' in this._canvas) {
      this._canvas.width = Math.max(1, Math.round(rect.width * this._dpr));
      this._canvas.height = Math.max(1, Math.round(rect.height * this._dpr));
      if (this._ctx.setTransform) this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    }
    return this;
  }

  /* ---------- limites de dados ---------- */

  /**
   * Define os limites a partir de um conjunto de pontos (real+projeção)
   * mais valores extras a incluir (alvo, ordens). Adiciona folga vertical.
   * @param {Array<object>} points pontos com t e chaves de exchange
   * @param {object} [opts] { extraPrices: number[], keys: string[], padFrac }
   */
  setBoundsFromPoints(points, opts = {}) {
    const keys = opts.keys || ['avg', 'binance', 'kraken', 'coinbase'];
    const extra = opts.extraPrices || [];
    const padFrac = opts.padFrac != null ? opts.padFrac : 0.08;
    if (!points || !points.length) return this;

    let pMin = Infinity, pMax = -Infinity, tMin = Infinity, tMax = -Infinity;
    for (const pt of points) {
      if (pt.t < tMin) tMin = pt.t;
      if (pt.t > tMax) tMax = pt.t;
      for (const k of keys) {
        const v = pt[k];
        if (v == null || !Number.isFinite(+v)) continue;
        if (v < pMin) pMin = v;
        if (v > pMax) pMax = v;
      }
    }
    for (const v of extra) {
      if (v == null || !Number.isFinite(+v)) continue;
      if (v < pMin) pMin = v;
      if (v > pMax) pMax = v;
    }
    if (!Number.isFinite(pMin) || !Number.isFinite(pMax)) return this;
    const pad = (pMax - pMin) * padFrac || 1;
    this.pMin = pMin - pad; this.pMax = pMax + pad;
    // Se uma janela de tempo foi forçada (pan/rolagem), ela manda: o eixo X
    // deixa de ser "o que os pontos cobrem" e passa a ser o trecho que o
    // usuário está olhando. O eixo Y continua automático pelos pontos.
    if (this._forcedWindow) {
      this.tMin = this._forcedWindow.tMin;
      this.tMax = this._forcedWindow.tMax;
    } else {
      this.tMin = tMin; this.tMax = (tMax === tMin) ? tMin + 1 : tMax;
    }
    return this;
  }

  /**
   * Fixa a janela de tempo visível (usada pelo pan/rolagem). Enquanto
   * definida, setBoundsFromPoints não sobrescreve o eixo X.
   * @param {number} tMin
   * @param {number} tMax
   */
  setTimeWindow(tMin, tMax) {
    if (!(tMax > tMin)) return this;
    this._forcedWindow = { tMin: tMin, tMax: tMax };
    this.tMin = tMin; this.tMax = tMax;
    return this;
  }

  /** Volta a derivar o eixo X dos próprios pontos. */
  clearTimeWindow() { this._forcedWindow = null; return this; }

  /** Janela de tempo forçada atual (ou null). */
  get timeWindow() { return this._forcedWindow || null; }

  /** Define limites manualmente (usado em teste ou casos especiais). */
  setBounds(tMin, tMax, pMin, pMax) {
    this.tMin = tMin; this.tMax = (tMax === tMin) ? tMin + 1 : tMax;
    this.pMin = pMin; this.pMax = (pMax === pMin) ? pMin + 1 : pMax;
    return this;
  }

  /* ---------- escalas (dado <-> pixel) ---------- */

  /** tempo -> x em pixels */
  X(t) {
    const x0 = this._pad.l, x1 = this.w - this._pad.r;
    return x0 + (t - this.tMin) / (this.tMax - this.tMin) * (x1 - x0);
  }
  /** preço -> y em pixels (invertido: preço maior = y menor) */
  Y(p) {
    const y0 = this.h - this._pad.b, y1 = this._pad.t;
    return y0 + (p - this.pMin) / (this.pMax - this.pMin) * (y1 - y0);
  }
  /** x em pixels -> tempo */
  invX(x) {
    const x0 = this._pad.l, x1 = this.w - this._pad.r;
    return this.tMin + (x - x0) / (x1 - x0) * (this.tMax - this.tMin);
  }
  /** y em pixels -> preço */
  invY(y) {
    const y0 = this.h - this._pad.b, y1 = this._pad.t;
    return this.pMin + (y - y0) / (y1 - y0) * (this.pMax - this.pMin);
  }

  /* ---------- acessos para os renderers ---------- */

  get ctx() { return this._ctx; }
  get pad() { return this._pad; }
  color(name) { return this._colors[name]; }
  /** Retângulo útil de plotagem (dentro das margens). */
  get plotRect() {
    return { x: this._pad.l, y: this._pad.t, w: (this.w - this._pad.r) - this._pad.l, h: (this.h - this._pad.b) - this._pad.t };
  }
  /** Limpa a área toda. */
  clear() { if (this._ctx && this._ctx.clearRect) this._ctx.clearRect(0, 0, this.w, this.h); }
  /** true se um instante está na janela de tempo visível. */
  inViewT(t) { return t >= this.tMin && t <= this.tMax; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PlotArea };
if (typeof window !== 'undefined') window.PlotArea = PlotArea;
