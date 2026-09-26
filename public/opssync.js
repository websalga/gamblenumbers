'use strict';
/* ============================================================
 * OpsOutbox — fila de envio CONFIAVEL das operacoes (lotes e vendas) para o SQL Server, que e' a fonte de verdade.
 *
 * Toda acao do usuario que altera uma operacao vira um evento nesta fila. O evento so' sai da fila depois que o
 * servidor CONFIRMA (sim_sync.php); se a rede cair ou o servidor falhar (HTTP 5xx), ele continua na fila —
 * guardada em localStorage, entao sobrevive a fechar a aba — e e' reenviado com espera crescente, na ordem.
 *   ok          o navegador registra a versao de cada item (usada para detectar edicao concorrente de um robo)
 *   conflito    o banco tem uma versao mais recente (robo/outro navegador): o navegador adota o estado do banco
 *   permanente  o banco recusou (4xx): descartado, nao adianta reenviar
 * ============================================================ */
class OpsOutbox {
  constructor(deps = {}) {
    this._url = deps.url || 'sim_sync.php';
    this._chave = deps.storageKey || 'gn_ops_outbox';
    this._getSessionId = deps.getSessionId || (() => {
      try { const s = window.GNIdentity && window.GNIdentity.session; return (s && s.session_id) || null; } catch (e) { return null; }
    });
    this._fetch = deps.fetch || ((...a) => fetch(...a));
    this._resolve = deps.resolveItem || (() => null);        // (moeda, 'lote'|'venda', id) -> item vivo na tela
    this._onResult = deps.onResult || (() => {});             // ({ tipo:'ok'|'conflito'|'permanente', evento, resposta })
    this._setTimeout = deps.setTimeout || ((f, ms) => setTimeout(f, ms));
    this._storage = deps.storage !== undefined ? deps.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    this._fila = this._carregar();
    this._n = this._fila.reduce((m, e) => Math.max(m, e.n || 0), 0);
    this._rodando = false;
    this._falhas = 0;
    this._marca = 0;                                          // +1 a cada envio/confirmacao: a mescla descarta leituras "velhas"
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', () => this.kick());
      window.addEventListener('gn:identity:ready', () => this.kick());
    }
  }

  get marca() { return this._marca; }
  get tamanho() { return this._fila.length; }

  _carregar() {
    try {
      const raw = this._storage && this._storage.getItem(this._chave);
      const a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  _salvar() {
    try { if (this._storage) this._storage.setItem(this._chave, JSON.stringify(this._fila)); } catch (e) { /* cheio/bloqueado: segue em memoria */ }
  }

  static _tipoDoSubject(reason) {
    if (reason === 'buy' || (reason || '').startsWith('lot:')) return 'lote';
    if ((reason || '').startsWith('sell:')) return 'venda';
    return null;
  }

  /* itens que o evento toca (para saber se ha envio pendente de um item) */
  static _ids(ev) {
    const out = [];
    const t = OpsOutbox._tipoDoSubject(ev.reason);
    if (t && ev.subject && ev.subject.id) out.push({ t, id: ev.subject.id });
    for (const l of (ev.lots || [])) if (l && l.id) out.push({ t: 'lote', id: l.id });
    if (ev.removed) {
      for (const id of (ev.removed.lots || [])) out.push({ t: 'lote', id });
      for (const id of (ev.removed.sells || [])) out.push({ t: 'venda', id });
    }
    return out;
  }

  /** Coloca um evento na fila e tenta enviar. ev = { moeda, moeda_exib, reason, subject, lots?, removed?, force? } */
  enqueue(ev) {
    const e = Object.assign({}, ev);
    e.n = ++this._n;
    e.sid = e.sid || this._getSessionId() || null;      // sem sessao ainda: o envio espera ela existir
    e.ids = OpsOutbox._ids(e);
    this._fila.push(e);
    this._marca++;
    this._salvar();
    this.kick();
    return e.n;
  }

  /** ha algum evento na fila que toque este item? */
  temPendente(moeda, tipo, id) {
    for (const e of this._fila) {
      if (e.moeda !== moeda) continue;
      for (const x of (e.ids || [])) if (x.t === tipo && x.id === id) return true;
    }
    return false;
  }

  _corpo(ev) {
    const atualizaV = (tipo, item) => {
      const it = Object.assign({}, item);
      const vivo = this._resolve(ev.moeda, tipo, it.id);
      if (vivo && vivo._v !== undefined && vivo._v !== null) it._v = vivo._v;   // a versao mais recente conhecida, no momento do envio
      return it;
    };
    const tipo = OpsOutbox._tipoDoSubject(ev.reason);
    const b = { session_id: ev.sid, moeda: ev.moeda, moeda_exib: ev.moeda_exib, reason: ev.reason,
                subject: tipo ? atualizaV(tipo, ev.subject) : ev.subject, force: !!ev.force };
    if (ev.lots) b.lots = ev.lots.map(l => atualizaV('lote', l));
    if (ev.removed) b.removed = ev.removed;
    return b;
  }

  _agendar() {
    this._falhas++;
    const espera = Math.min(60000, 2000 * Math.pow(2, this._falhas - 1));
    this._setTimeout(() => this.kick(), espera);
  }

  /** Envia os eventos, um por vez e em ordem, ate esvaziar a fila ou algo falhar (entao reagenda). */
  async kick() {
    if (this._rodando) return;
    this._rodando = true;
    try {
      while (this._fila.length) {
        const ev = this._fila[0];
        const sid = ev.sid || this._getSessionId();
        if (!sid) break;                                   // ainda sem sessao: 'gn:identity:ready' chama kick() de novo
        ev.sid = sid;
        let http = 0, resp = null;
        try {
          const r = await this._fetch(this._url, { method: 'POST', body: JSON.stringify(this._corpo(ev)), keepalive: true,
                                                   headers: { 'Content-Type': 'application/json' } });
          http = r.status;
          resp = await r.json().catch(() => null);
        } catch (e) { this._agendar(); break; }             // sem rede: continua na fila
        if (http >= 500 || resp == null) { this._agendar(); break; }
        this._fila.shift();
        this._marca++;
        this._falhas = 0;
        this._salvar();
        let tipo = 'permanente';
        if (resp.ok) tipo = 'ok'; else if (resp.conflito) tipo = 'conflito';
        try { this._onResult({ tipo, evento: ev, resposta: resp }); } catch (e) { /* o retorno nao pode travar a fila */ }
      }
    } finally { this._rodando = false; }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { OpsOutbox };
if (typeof window !== 'undefined') window.OpsOutbox = OpsOutbox;
