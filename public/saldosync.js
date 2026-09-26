'use strict';
/* ============================================================
 * SaldoSync — espelha o "Saldo virtual disponível" da tela no SQL Server
 * (dbo.GN_SimSaldo, por session_id) e traz de volta o que os robôs fizeram.
 *
 * Tela -> banco: toda vez que o saldo da tela muda (compra, venda, botão de
 *   refresh do saldo real, edição manual, conversão de moeda), envia para
 *   sim_saldo.php. Compra/venda vão como DELTA (o banco soma sobre o valor
 *   dele, então não sobrescreve o que um robô tenha movimentado); o resto vai
 *   como valor ABSOLUTO. O banco sempre guarda em BRL.
 *
 * Banco -> tela: ao abrir o site e a cada poucos segundos lê o saldo do banco;
 *   se um robô comprou/vendeu (versão mudou), atualiza o campo na tela SEM
 *   reenviar (senão daria eco).
 *
 * Best-effort: nunca lança nem bloqueia a UI; se o envio falhar, o próximo
 * ciclo regrava o valor atual da tela.
 * ============================================================ */
class SaldoSync {
  constructor(deps = {}) {
    if (!deps.bus || !deps.panel || !deps.operations) throw new Error('SaldoSync exige bus, panel e operations.');
    this._bus = deps.bus;
    this._panel = deps.panel;
    this._ops = deps.operations;
    this._getMoedaExib = deps.getMoedaExib || (() => 'BRL');
    this._getSessionId = deps.getSessionId || (() => {
      try { const s = window.GNIdentity && window.GNIdentity.session; return (s && s.session_id) || null; }
      catch (e) { return null; }
    });
    this._url = deps.url || 'sim_saldo.php';
    this._pollMs = deps.pollMs || 4000;
    this._fetch = deps.fetch || ((...a) => fetch(...a));
    this._versao = null;      // última versão do saldo conhecida (do banco)
    this._sid = null;
    this._bootOk = false;     // já sincronizou uma vez com o banco nesta sessão
    this._pendentes = 0;      // envios ainda na fila
    this._envios = 0;         // contador de envios (detecta escrita durante um poll)
    this._fila = Promise.resolve();
    this._sujo = false;       // um envio falhou: regravar o valor da tela no próximo ciclo
    this._started = false;
  }

  /* ---- conversão tela <-> BRL (o banco guarda BRL) ---- */
  toBrl(v) {
    const de = String(this._getMoedaExib() || 'BRL').toUpperCase();
    if (de === 'BRL') return v;
    const r = this._ops.converterValor(v, de, 'BRL');
    return (r == null || !isFinite(r)) ? null : r;
  }
  fromBrl(v) {
    const para = String(this._getMoedaExib() || 'BRL').toUpperCase();
    if (para === 'BRL') return v;
    const r = this._ops.converterValor(v, 'BRL', para);
    return (r == null || !isFinite(r)) ? null : r;
  }

  start() {
    if (this._started) return this;
    this._started = true;
    this._bus.on('control:saldo', e => this._onSaldo(e));
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('gn:identity:ready', () => this._bootstrap());
    }
    setInterval(() => this._poll(), this._pollMs);
    this._bootstrap();
    return this;
  }

  /* ---- tela -> banco ---- */
  _onSaldo(e) {
    if (!e || e.semSync) return;
    const sid = this._getSessionId();
    if (!sid) return;
    const saldoBrl = this.toBrl(e.value);
    if (saldoBrl == null) return;              // sem cotação de câmbio ainda: o ciclo seguinte regrava
    const body = { session_id: sid, saldo_brl: saldoBrl, origem: e.origem || 'front', ref: e.ref || null };
    if (e.delta != null && isFinite(e.delta)) {
      const d = this.toBrl(Math.abs(e.delta));
      if (d == null) return;
      body.evento = 'delta';
      body.delta_brl = e.delta < 0 ? -d : d;
    } else {
      body.evento = 'set';
    }
    this._enfileirar(body);
  }

  _enfileirar(body) {
    this._envios++; this._pendentes++;
    this._fila = this._fila
      .then(() => this._enviar(body))
      .catch(() => { this._sujo = true; })
      .then(() => { this._pendentes--; });
  }

  async _enviar(body) {
    const resp = await this._fetch(this._url, {
      method: 'POST', body: JSON.stringify(body), keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    });
    const j = await resp.json();
    if (!j || !j.ok) throw new Error('sim_saldo recusou');
    this._sujo = false;
    this._versao = j.versao;
    // O banco pode ter um valor diferente do que a tela calculou (um robô
    // mexeu no meio): se este é o último envio da fila, a tela adota o do banco.
    if (this._pendentes <= 1) this._adotar(j.saldo_brl);
  }

  /* ---- banco -> tela ---- */
  _adotar(saldoBrl) {
    const local = this.toBrl(this._panel.saldo);
    if (local == null || !(saldoBrl >= 0)) return;
    if (Math.abs(local - saldoBrl) <= 0.009) return;
    const v = this.fromBrl(saldoBrl);
    if (v == null) return;
    this._panel.setSaldo(v, { semSync: true, origem: 'servidor' });
  }

  async _ler() {
    const sid = this._getSessionId();
    if (!sid) return null;
    const resp = await this._fetch(this._url + '?session_id=' + encodeURIComponent(sid), { cache: 'no-store' });
    const j = await resp.json();
    return (j && j.ok) ? j : null;
  }

  /** 1ª sincronização da sessão: se o banco já tem saldo, ele manda (robôs podem ter operado); senão grava o da tela. */
  async _bootstrap() {
    try {
      const sid = this._getSessionId();
      if (!sid || (sid === this._sid && this._bootOk)) return;
      this._sid = sid; this._bootOk = false;
      const j = await this._ler();
      if (!j) return;
      this._bootOk = true;
      if (j.existe) { this._versao = j.versao; this._adotar(j.saldo_brl); }
      else this._onSaldo({ value: this._panel.saldo, origem: 'front' });
    } catch (e) { /* best-effort */ }
  }

  async _poll() {
    try {
      if (!this._getSessionId()) return;
      if (!this._bootOk) return this._bootstrap();
      if (this._pendentes > 0) return;
      if (this._sujo) { this._sujo = false; this._onSaldo({ value: this._panel.saldo, origem: 'front' }); return; }
      const envios = this._envios;
      const j = await this._ler();
      if (!j || !j.existe) return;
      if (this._pendentes > 0 || this._envios !== envios) return;   // houve escrita durante a leitura: descarta
      if (j.versao !== this._versao) { this._versao = j.versao; this._adotar(j.saldo_brl); }
    } catch (e) { /* best-effort */ }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { SaldoSync };
if (typeof window !== 'undefined') window.SaldoSync = SaldoSync;
