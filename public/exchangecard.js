'use strict';
/* ============================================================
 * ExchangeCard — um card de corretora, isolado.
 *
 * Responsabilidade ÚNICA: representar UMA exchange (avg/binance/
 * kraken/coinbase). Sabe pegar do DataStore só a fatia que lhe
 * interessa, calcular seus próprios números (preço, USD, variação
 * no período, meta, lucro) e desenhar a si mesmo no DOM.
 *
 * Não conhece os outros cards. Não toca em estado global. Recebe
 * suas dependências no construtor (injeção), então é testável fora
 * do navegador.
 *
 * A variação "no período" é obtida de store.variation(), que mede
 * direto sobre o vetor real — nunca sobre série reamostrada ou um
 * "now" global. É isto que impede o número de zerar ao trocar de
 * escala.
 * ============================================================ */

class ExchangeCard {
  /**
   * @param {string} key 'avg'|'binance'|'kraken'|'coinbase'
   * @param {object} deps
   * @param {DataStore} deps.store   - a fonte da verdade dos dados
   * @param {object}    deps.meta    - { label, color, premium }
   * @param {object}    [deps.fmt]   - formatadores { brl, usd, pct }
   */
  constructor(key, deps = {}) {
    if (!key) throw new Error('ExchangeCard exige uma key de exchange.');
    if (!deps.store) throw new Error('ExchangeCard exige um DataStore.');
    this.key = key;
    this._store = deps.store;
    this._label = (deps.meta && deps.meta.label) || key;
    this._color = (deps.meta && deps.meta.color) || '#888';
    this._premium = (deps.meta && typeof deps.meta.premium === 'number') ? deps.meta.premium : 0;
    this._fmt = deps.fmt || ExchangeCard._defaultFmt;
    this._moedaExib = deps.moedaExibicao || 'BRL'; // moeda em que 'cur' ja vem convertido pelo backend
    this._el = null; // nó DOM, criado no primeiro render
  }

  /**
   * Calcula o modelo de exibição do card para um dado contexto.
   * Entrada EXPLÍCITA: tudo que afeta o resultado é parâmetro, não
   * estado escondido.
   * @param {object} ctx
   * @param {number} ctx.spanMs   - duração da janela do período atual
   * @param {number} [ctx.ret]    - retorno desejado (%), do usuário
   * @param {number} [ctx.weighted] - preço médio ponderado dos lotes
   * @param {number} [ctx.remainingBTC] - BTC em carteira simulada
   * @returns {object|null} modelo pronto para render
   */
  compute(ctx = {}) {
    const store = this._store;
    const last = store.latest();
    if (!last) return null;
    const cur = num(last[this.key]);
    if (cur == null) return null;

    // variação no período: direto do vetor real, à prova de "now"
    const span = +ctx.spanMs || 0;
    const v = span > 0 ? store.variation(this.key, span) : { pct: 0 };
    const varPct = v ? v.pct : 0;

    // conversão USD: 'cur' já vem do backend na moeda de exibição
    // ATIVA (this._moedaExib), entao a taxa usada tem que ser a
    // dessa MESMA moeda para USD - nunca fixa em usd_brl (bug antigo:
    // dividia preco em EUR/GBP/etc pela taxa BRL->USD, dando numero sem sentido).
    const moedaExib = String(this._moedaExib || 'BRL').toUpperCase();
    let usd = null;
    if (moedaExib === 'USD') {
      usd = cur;
    } else {
      const usdRate = num(last['usd_' + moedaExib.toLowerCase()]) || null;
      usd = usdRate ? cur / usdRate : null; // null = taxa nao coletada (ex: JPY/CNY/TRY/RUB hoje)
    }

    // meta e lucro (dependem de entradas do usuário; se ausentes, base neutra)
    const ret = num(ctx.ret) || 0;
    const w = num(ctx.weighted) || 0;
    const remain = num(ctx.remainingBTC) || 0;
    const baseTarget = (w > 0 ? w : cur) * (1 + ret / 100);
    const target = baseTarget * (1 + this._premium);
    const profit = remain > 0 ? remain * (target - (w > 0 ? w : cur)) : 0;

    return {
      key: this.key, label: this._label, color: this._color,
      cur, usd, varPct, target, profit,
    };
  }

  /**
   * Garante o nó DOM do card dentro de um container e o preenche.
   * Idempotente: cria uma vez, depois só atualiza o conteúdo.
   * @param {HTMLElement} container
   * @param {object} ctx  - mesmo contexto de compute()
   * @param {boolean} [isBest] - se este card deve exibir "MAIOR LUCRO"
   */
  render(container, ctx = {}, isBest = false) {
    const m = this.compute(ctx);
    if (!m) return;
    if (!this._el) {
      this._el = document.createElement('div');
      this._el.className = 'card';
      this._el.dataset.exchange = this.key;
      container.appendChild(this._el);
    }
    this._el.classList.toggle('best', !!isBest);
    const f = this._fmt;
    const varClass = m.varPct >= 0 ? 'pos' : 'neg';
    const profClass = m.profit >= 0 ? 'pos' : 'neg';
    const T = window.I18N ? I18N.t.bind(I18N) : (k) => ({
      card_maior_lucro: 'MAIOR LUCRO', card_no_periodo: 'no período',
      card_meta: 'Meta', card_lucro_estimado: 'Lucro estimado',
    }[k] || k);
    this._el.innerHTML =
      (isBest ? '<div class="badge">' + T('card_maior_lucro') + '</div>' : '') +
      `<div class="top"><span class="name" style="background:${m.color};color:#04210f;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;letter-spacing:.4px;">${escapeHtml(m.label)}</span>` +
      `<svg class="spark" viewBox="0 0 34 16"><polyline fill="none" stroke="${m.color}" stroke-width="1.3" points="0,12 6,8 12,10 18,4 24,7 30,3 34,5"/></svg></div>` +
      `<div class="brl">${f.brl(m.cur)}</div>` +
      `<div class="usd">${m.usd != null ? f.usd(m.usd) : '—'}</div>` +
      `<div class="var ${varClass}">${f.pct(m.varPct)} ${T('card_no_periodo')}</div>` +
      `<div class="meta-row">${T('card_meta')}: <b>${f.brl(m.target)}</b><br>${T('card_lucro_estimado')}: <b class="${profClass}">${f.brl(m.profit)}</b></div>`;
  }

  /** Remove o card do DOM (limpeza). */
  destroy() { if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el); this._el = null; }

  static _defaultFmt = {
    brl: n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    usd: n => 'US$ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    pct: n => (n >= 0 ? '+' : '') + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%',
  };
}

function num(v) { if (v == null) return null; const n = +v; return Number.isFinite(n) ? n : null; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

if (typeof module !== 'undefined' && module.exports) module.exports = { ExchangeCard };
if (typeof window !== 'undefined') window.ExchangeCard = ExchangeCard;
