'use strict';
/* ============================================================
 * backendforecast.js — traço de referência da previsão ESTATÍSTICA
 * real (motor rodando em lsql2019: validação cruzada rolling-origin +
 * geração a cada 5min). Puramente informativo: não substitui a
 * simulação client-side (forecast.js/frozenforecast.js) nem ancora
 * vendas — só desenha uma linha pontilhada de referência no lado da
 * projeção do gráfico, cobrindo no máximo 24h à frente (o horizonte
 * validado pelo motor).
 * ============================================================ */
(function () {
  class BackendForecast {
    constructor(deps = {}) {
      this._moeda = deps.moeda || 'BTC';
      this._pontos = [];
      this._modelo = null;
      this._cenario = [];
      this._cenarioPassado = [];
      this._faixaPct = null;
      this._ready = false;
    }

    get ready() { return this._ready && this._pontos.length > 1; }
    get pontos() { return this._pontos; }
    get modelo() { return this._modelo; }
    /** Curva ilustrativa da Mimetagem (copia de um trecho real do passado), igual para todos. */
    get cenario() { return this._cenario; }
    /** Curvas ANTERIORES da Mimetagem, cortadas no agora: [{lookback_min, ancora:{t,avg}, pontos:[{t,avg}]}]. */
    get cenarioPassado() { return this._cenarioPassado; }
    /** Largura nominal do miolo desenhado (% dos casos reais que devem cair dentro). */
    get faixaPct() { return this._faixaPct; }

    /** Busca a previsão mais recente do backend. Falha em silêncio —
     * a linha de referência é só um extra, nunca deve travar o gráfico. */
    async refresh() {
      try {
        const r = await fetch('api.php?acao=previsao&moeda=' + encodeURIComponent(this._moeda), { cache: 'no-store' });
        const j = await r.json();
        if (j && j.ok && Array.isArray(j.pontos) && j.pontos.length) {
          this._pontos = j.pontos;
          this._modelo = j.modelo || null;
          this._cenario = (j.cenario && Array.isArray(j.cenario.pontos)) ? j.cenario.pontos : [];
          this._cenarioPassado = Array.isArray(j.cenario_passado) ? j.cenario_passado : [];
          this._faixaPct = (j.faixa && j.faixa.central_pct) || null;
          this._ready = true;
        }
      } catch (e) { /* silencioso — linha de referência é opcional */ }
      return this._ready;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { BackendForecast: BackendForecast };
  if (typeof window !== 'undefined') window.BackendForecast = BackendForecast;
})();
