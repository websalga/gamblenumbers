'use strict';
/* ============================================================
 * ControlPanel — o formulário de entrada do usuário, isolado.
 *
 * Responsabilidade ÚNICA: ser dono dos controles de interação
 * (valor de compra/venda, stop, retorno desejado). Sabe:
 *   - LER o que o usuário digitou (métodos de alimentação)
 *   - guardar o estado atual desses controles
 *   - EMITIR um evento no bus quando algo muda ("o retorno virou X")
 *
 * NÃO chama cards, gráfico nem cálculos diretamente. Só anuncia.
 * Quem se importa escuta o bus. É o desacoplamento que impede o
 * efeito-dominó do refreshAll() antigo.
 *
 * Recebe um "doc" (document) e um "bus" injetados — no navegador
 * são o document real e o EventBus; em teste, mocks. Assim a peça
 * é validável fora do browser.
 *
 * Eventos emitidos:
 *   'control:ret'     { value }   retorno desejado (%)
 *   'control:opValue' { value }   valor de compra/venda (R$)
 *   'control:stop'    { value }   stop manual (R$)
 * ============================================================ */

class ControlPanel {
  /**
   * @param {object} deps
   * @param {object}   deps.doc  - document (ou mock com getElementById)
   * @param {EventBus} deps.bus
   * @param {object}   [deps.ids] - ids dos elementos no HTML
   * @param {object}   [deps.defaults] - valores iniciais
   * @param {object}   [deps.fmt] - formatadores { brl }
   * @param {object}   [deps.parse] - parsers { brl }
   */
  constructor(deps = {}) {
    if (!deps.doc) throw new Error('ControlPanel exige um document.');
    if (!deps.bus) throw new Error('ControlPanel exige um EventBus.');
    this._doc = deps.doc;
    this._bus = deps.bus;
    this._ids = Object.assign({
      opValue: 'opValue', stop: 'stop', ret: 'ret', retVal: 'retVal', saldo: 'saldoVirtual',
    }, deps.ids || {});
    const d = deps.defaults || {};
    this._state = {
      opValue: d.opValue != null ? d.opValue : (parseFloat(sessionStorage.getItem('gn_opvalue')) || 100),
      stop: d.stop != null ? d.stop : 0,
      ret: d.ret != null ? d.ret : 5.0,
      saldo: d.saldo != null ? d.saldo : (parseFloat(sessionStorage.getItem('gn_saldo')) || 55000),
    };
    this._moedaExib = (deps.moedaExibicao || 'BRL').toUpperCase();
    this._fmt = deps.fmt || { brl: n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
    this._parse = deps.parse || { brl: parseBRL };
  }

  /* ---------- leitura (getters de estado) ---------- */
  get opValue() { return this._state.opValue; }
  get stop() { return this._state.stop; }
  get ret() { return this._state.ret; }
  get saldo() { return this._state.saldo; }
  snapshot() { return { ...this._state }; }

  /* ---------- ligação com o DOM ---------- */

  /**
   * Conecta os listeners aos elementos e escreve os valores iniciais.
   * Idempotente o suficiente para chamar uma vez no boot.
   */
  mount() {
    const el = id => this._doc.getElementById(id);

    const op = el(this._ids.opValue);
    if (op) {
      op.value = this._fmt.brl(this._state.opValue);
      op.addEventListener('change', e => {
        this._state.opValue = this._parse.brl(e.target.value);
        e.target.value = this._fmt.brl(this._state.opValue);
        sessionStorage.setItem('gn_opvalue', this._state.opValue);
        this._bus.emit('control:opValue', { value: this._state.opValue });
      });
    }

    const st = el(this._ids.stop);
    if (st) {
      st.value = this._fmt.brl(this._state.stop);
      st.addEventListener('change', e => {
        this._state.stop = this._parse.brl(e.target.value);
        e.target.value = this._fmt.brl(this._state.stop);
        this._bus.emit('control:stop', { value: this._state.stop });
      });
    }

    const rt = el(this._ids.ret);
    const rtv = el(this._ids.retVal);
    if (rt) {
      rt.value = this._state.ret;
      if (rtv) rtv.textContent = this._state.ret.toFixed(1);
      rt.addEventListener('input', e => {
        this._state.ret = parseFloat(e.target.value);
        if (rtv) rtv.textContent = this._state.ret.toFixed(1);
        this._bus.emit('control:ret', { value: this._state.ret });
      });
    }
    const sd = el(this._ids.saldo);
    if (sd) {
      sd.value = this._fmt.brl(this._state.saldo);
      sd.addEventListener('change', e => {
        this._state.saldo = this._parse.brl(e.target.value);
        e.target.value = this._fmt.brl(this._state.saldo);
        sessionStorage.setItem('gn_saldo', this._state.saldo);
        sessionStorage.setItem('gn_saldo_moeda', this._moedaExib);
        this._bus.emit('control:saldo', { value: this._state.saldo });
      });
    }

    return this;
  }

  /* ---------- alimentação programática (sem passar pelo DOM) ----------
   * Útil para setar valores de fora (ex.: restaurar sessão) já
   * emitindo o evento correspondente. */
  setRet(v) { this._state.ret = +v; this._bus.emit('control:ret', { value: this._state.ret }); return this; }
  setOpValue(v) { this._state.opValue = +v; this._bus.emit('control:opValue', { value: this._state.opValue }); return this; }
  setStop(v) { this._state.stop = +v; this._bus.emit('control:stop', { value: this._state.stop }); return this; }
  setSaldo(v) {
    this._state.saldo = Math.max(0, +v);
    sessionStorage.setItem('gn_saldo', this._state.saldo);
    sessionStorage.setItem('gn_saldo_moeda', this._moedaExib);
    this._bus.emit('control:saldo', { value: this._state.saldo });
    this._renderSaldo();
    return this;
  }
  debitSaldo(amount) { return this.setSaldo(this._state.saldo - amount); }
  creditSaldo(amount) { return this.setSaldo(this._state.saldo + amount); }
  _renderSaldo() {
    const el = this._doc.getElementById(this._ids.saldo);
    if (el) el.value = this._fmt.brl(this._state.saldo);
  }
}

/* parser de moeda BR -> número (mesma lógica do app original) */
function parseBRL(s) {
  const v = parseFloat(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(v) ? 0 : v;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ControlPanel, parseBRL };
if (typeof window !== 'undefined') window.ControlPanel = ControlPanel;
