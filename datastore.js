'use strict';
/* ============================================================
 * DataStore — a "cópia em vetor" dos dados reais do banco.
 *
 * Responsabilidade ÚNICA: ser a fonte da verdade dos snapshots
 * reais (bitcoin.dbo.snapshots, via api.php). Ninguém mais no
 * app faz fetch nem guarda cópia de dados. Todos os objetos
 * (cards, séries, gráfico) CONSULTAM esta instância.
 *
 * Princípios:
 *  - Uma fonte da verdade, muitos leitores.
 *  - Entrada e saída explícitas (métodos claros de alimentação
 *    e de consulta).
 *  - Sem estado global escondido; sem efeito colateral em quem
 *    consulta (os getters devolvem cópias/valores, nunca a
 *    referência interna mutável).
 *  - Atualização incremental: a cada ciclo, só busca o que há
 *    de novo (append), não recarrega tudo.
 *
 * Um snapshot tem a forma:
 *   { t, avg, binance, kraken, coinbase, btc_usd, usd_brl }
 * onde t é epoch em milissegundos (UTC).
 * ============================================================ */

class DataStore {
  /**
   * @param {object} opts
   * @param {function} [opts.fetchFn] - função async que busca dados.
   *        Recebe uma URL e devolve o JSON já parseado. Injetável
   *        para permitir teste sem navegador. Default: window.fetch.
   * @param {string}  [opts.apiBase]  - caminho do backend. Default 'api.php'.
   * @param {number}  [opts.maxLen]   - teto do vetor (descarta os mais
   *        antigos além disso). Default 5000.
   */
  constructor(opts = {}) {
    this._rows = [];               // vetor interno, sempre ordenado por t asc
    this._byT = new Set();         // índice de timestamps p/ evitar duplicá-los
    this._apiBase = opts.apiBase || 'api.php';
    this._maxLen = opts.maxLen || 5000;
    this._fetchFn = opts.fetchFn || DataStore._defaultFetch;
    this._listeners = [];          // callbacks avisados quando os dados mudam
    this._lastError = null;
    this._loadedOnce = false;
  }

  /* ---------- alimentação (entrada) ---------- */

  /**
   * Carga inicial. Busca os últimos `limite` snapshots e substitui
   * o conteúdo do vetor. Deve ser chamado uma vez, no boot.
   * @returns {Promise<number>} quantidade de linhas carregadas.
   */
  async load(limite = 1500) {
    const url = `${this._apiBase}?acao=cotacoes&limite=${encodeInt(limite, 1, this._maxLen)}`;
    const j = await this._fetchFn(url);
    if (!j || !j.ok || !Array.isArray(j.data)) {
      throw new Error((j && j.error) || 'Backend não retornou dados válidos.');
    }
    this._rows = [];
    this._byT.clear();
    for (const raw of j.data) this._insert(raw);
    this._sort();
    this._trim();
    this._loadedOnce = true;
    this._lastError = null;
    this._emit('load');
    return this._rows.length;
  }

  /**
   * Atualização incremental. Busca o snapshot mais recente do banco
   * e, se for mais novo que o último que temos, acrescenta ao vetor.
   * Feito para rodar periodicamente (o banco grava a cada ~5-6 min).
   * Não recarrega o histórico; só cresce na ponta.
   * @returns {Promise<boolean>} true se algo novo entrou.
   */
  async refresh() {
    const url = `${this._apiBase}?acao=atual`;
    let j;
    try {
      j = await this._fetchFn(url);
    } catch (e) {
      this._lastError = e;
      return false; // backend fora do ar: mantém o último estado conhecido
    }
    if (!j || !j.ok || !j.data) { this._lastError = new Error('Sem dado atual.'); return false; }
    const row = normalizeRow(j.data);
    if (row == null) return false;
    const last = this.latest();
    if (last && row.t <= last.t) return false; // nada mais novo
    this._insert(row);
    this._trim();
    this._lastError = null;
    this._emit('refresh');
    return true;
  }

  /**
   * Injeta linhas manualmente (usado em teste, ou se outra fonte
   * quiser alimentar o store). Mantém ordenação e unicidade.
   * @param {Array<object>} rows
   * @returns {number} quantas foram efetivamente inseridas.
   */
  ingest(rows) {
    if (!Array.isArray(rows)) return 0;
    let n = 0;
    for (const r of rows) if (this._insert(r)) n++;
    if (n) { this._sort(); this._trim(); this._emit('ingest'); }
    return n;
  }

  /* ---------- consulta (saída) ---------- */

  /** Quantidade de snapshots no vetor. */
  get length() { return this._rows.length; }

  /** true se load() já rodou com sucesso ao menos uma vez. */
  get ready() { return this._loadedOnce; }

  /** Último erro de rede/consulta (ou null). */
  get lastError() { return this._lastError; }

  /** Timestamp (ms) do dado real mais recente, ou null se vazio. */
  latestT() { const r = this._rows; return r.length ? r[r.length - 1].t : null; }

  /** Cópia do snapshot mais recente, ou null. */
  latest() { const r = this._rows; return r.length ? { ...r[r.length - 1] } : null; }

  /** Cópia do snapshot mais antigo, ou null. */
  earliest() { const r = this._rows; return r.length ? { ...r[0] } : null; }

  /**
   * Snapshot real mais próximo de um instante t (busca binária).
   * Devolve uma CÓPIA para o chamador não mexer no vetor interno.
   * @param {number} t epoch ms
   * @returns {object|null}
   */
  nearest(t) {
    const r = this._rows;
    if (!r.length) return null;
    if (t <= r[0].t) return { ...r[0] };
    if (t >= r[r.length - 1].t) return { ...r[r.length - 1] };
    let lo = 0, hi = r.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (r[m].t < t) lo = m + 1; else hi = m;
    }
    const a = r[Math.max(0, lo - 1)], b = r[lo];
    return (Math.abs(a.t - t) <= Math.abs(b.t - t)) ? { ...a } : { ...b };
  }

  /**
   * Todos os snapshots reais dentro de [t0, t1], inclusive.
   * Devolve cópias.
   * @returns {Array<object>}
   */
  between(t0, t1) {
    if (t1 < t0) { const s = t0; t0 = t1; t1 = s; }
    const out = [];
    for (const row of this._rows) {
      if (row.t < t0) continue;
      if (row.t > t1) break;
      out.push({ ...row });
    }
    return out;
  }

  /**
   * Reamostra a série real numa grade uniforme de `points` pontos
   * terminando em `endT` e recuando `points*stepMs`. Cada ponto pega
   * o snapshot real mais próximo do instante da grade. É o que os
   * objetos de série (real) e os cards consomem.
   *
   * Repare: a âncora temporal é EXPLÍCITA (endT vem de quem chama),
   * então este método não depende de nenhum "now" global — o que
   * elimina o acoplamento que causava a variação zerada.
   *
   * @param {object} p período { points, stepMs }
   * @param {number} [endT] instante final; default = último dado real.
   * @returns {Array<object>} pontos {t, avg, binance, kraken, coinbase}
   */
  resample(p, endT) {
    const n = Math.max(2, p.points | 0);
    const step = +p.stepMs;
    const end = (endT == null) ? this.latestT() : endT;
    if (end == null) return [];
    const start = end - n * step;
    const out = [];
    let prev = null;
    for (let i = 0; i < n; i++) {
      const t = start + i * step;
      const snap = this.nearest(t);
      if (snap) {
        const pt = { t, avg: snap.avg, binance: snap.binance, kraken: snap.kraken, coinbase: snap.coinbase };
        out.push(pt); prev = pt;
      } else if (prev) {
        out.push({ ...prev, t });
      } else {
        out.push({ t, avg: 0, binance: 0, kraken: 0, coinbase: 0 });
      }
    }
    return out;
  }

  /**
   * Variação percentual de uma exchange ao longo de uma janela de
   * tempo real de duração `spanMs`, ancorada no último dado real.
   * Calculada DIRETO sobre o vetor real (não sobre série reamostrada
   * nem sobre "now" global) — é a fonte à prova de falhas para o
   * número que hoje zera.
   * @param {string} ex 'avg'|'binance'|'kraken'|'coinbase'
   * @param {number} spanMs duração da janela (ex.: 24h em ms)
   * @returns {{first:number,last:number,pct:number}|null}
   */
  variation(ex, spanMs) {
    const last = this.latest();
    if (!last) return null;
    const firstSnap = this.nearest(last.t - spanMs);
    if (!firstSnap) return null;
    const a = num(firstSnap[ex]), b = num(last[ex]);
    if (a == null || b == null || a <= 0) return { first: a, last: b, pct: 0 };
    return { first: a, last: b, pct: (b - a) / a * 100 };
  }

  /* ---------- notificação ---------- */

  /**
   * Assina mudanças no store. O callback recebe o nome do evento
   * ('load'|'refresh'|'ingest'). Devolve função para cancelar.
   */
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  }

  /* ---------- internos ---------- */

  _emit(evt) { for (const fn of this._listeners) { try { fn(evt); } catch (_) {} } }

  _insert(raw) {
    const row = normalizeRow(raw);
    if (row == null) return false;
    if (this._byT.has(row.t)) return false; // já temos esse instante
    this._byT.add(row.t);
    // inserção mantendo ordem: na carga usamos push+sort; no refresh
    // o novo é o mais recente, então push direto já preserva a ordem.
    const r = this._rows;
    if (!r.length || row.t >= r[r.length - 1].t) r.push(row);
    else { r.push(row); this._needSort = true; }
    return true;
  }

  _sort() { this._rows.sort((a, b) => a.t - b.t); this._needSort = false; }

  _trim() {
    const over = this._rows.length - this._maxLen;
    if (over > 0) {
      const removed = this._rows.splice(0, over);
      for (const row of removed) this._byT.delete(row.t);
    }
  }

  static _defaultFetch(url) {
    return fetch(url, { cache: 'no-store' }).then(r => r.json());
  }
}

/* ---------- helpers de saneamento ---------- */

function num(v) {
  if (v == null) return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

function encodeInt(v, min, max) {
  v = v | 0;
  if (v < min) v = min;
  if (v > max) v = max;
  return v;
}

/**
 * Converte uma linha crua do backend numa linha canônica do store.
 * Descarta linhas sem timestamp ou sem preço médio válido.
 * Preenche exchanges ausentes com o preço médio (mesmo critério do
 * api.php), para nenhum consumidor receber null inesperado.
 */
function normalizeRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = num(raw.t);
  const avg = num(raw.avg);
  if (t == null || avg == null || avg <= 0) return null;
  const binance = num(raw.binance); const kraken = num(raw.kraken); const coinbase = num(raw.coinbase);
  return {
    t,
    avg,
    binance: binance != null ? binance : avg,
    kraken:  kraken  != null ? kraken  : avg,
    coinbase: coinbase != null ? coinbase : avg,
    btc_usd: num(raw.btc_usd),
    usd_brl: num(raw.usd_brl),
  };
}

/* Export universal: funciona com <script> no navegador (window.DataStore)
   e com require() no Node (para os testes). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DataStore, normalizeRow };
}
if (typeof window !== 'undefined') {
  window.DataStore = DataStore;
}
