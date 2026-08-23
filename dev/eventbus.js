'use strict';
/* ============================================================
 * EventBus — o orquestrador mínimo.
 *
 * Três verbos, nada mais:
 *   on(evento, cb)   -> assina; devolve função para cancelar
 *   emit(evento, d)  -> avisa todos os assinantes daquele evento
 *   off(evento, cb)  -> cancela manualmente
 *
 * É como os objetos se avisam SEM se conhecerem. O card não chama
 * o gráfico; ambos escutam "dados:mudaram" e reagem por conta
 * própria. O ControlPanel não chama ninguém; emite "retorno:mudou"
 * e quem se importa escuta.
 *
 * Deliberadamente pequeno: se crescer, vira framework e a
 * complexidade que tiramos do app.js volta pela porta dos fundos.
 * Um erro num assinante não derruba os outros (cada callback é
 * isolado num try).
 * ============================================================ */

class EventBus {
  constructor() { this._map = new Map(); }

  /**
   * Assina um evento.
   * @param {string} evt
   * @param {function} cb
   * @returns {function} cancelador
   */
  on(evt, cb) {
    if (typeof cb !== 'function') return () => {};
    if (!this._map.has(evt)) this._map.set(evt, new Set());
    this._map.get(evt).add(cb);
    return () => this.off(evt, cb);
  }

  /** Cancela uma assinatura específica. */
  off(evt, cb) {
    const set = this._map.get(evt);
    if (set) { set.delete(cb); if (!set.size) this._map.delete(evt); }
  }

  /**
   * Dispara um evento. Cada assinante roda isolado: um erro em um
   * não impede os demais.
   * @param {string} evt
   * @param {*} data
   */
  emit(evt, data) {
    const set = this._map.get(evt);
    if (!set) return;
    for (const cb of Array.from(set)) {
      try { cb(data); } catch (e) {
        if (typeof console !== 'undefined') console.error('[EventBus] erro em', evt, e);
      }
    }
  }

  /** Remove todos os assinantes (limpeza / teardown). */
  clear() { this._map.clear(); }

  /** Quantidade de assinantes de um evento (diagnóstico/teste). */
  count(evt) { const s = this._map.get(evt); return s ? s.size : 0; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { EventBus };
if (typeof window !== 'undefined') window.EventBus = EventBus;
