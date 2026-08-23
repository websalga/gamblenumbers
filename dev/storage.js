'use strict';
/* ============================================================
 * storage.js — persistência local no navegador (IndexedDB).
 *
 * Guarda, sem identificar usuário (multiusuário via SQL Server fica
 * para um futuro próximo), numa store chave->valor:
 *   'forecast'   -> linha-mestra congelada (FrozenForecast.toJSON())
 *   'operations' -> { lots, sells, lotSeq, sellSeq }
 *
 * Sobrevive a F5 e a reabrir o navegador (por perfil/máquina).
 * Se IndexedDB faltar ou falhar (aba privada etc.), degrada para um
 * Map em memória: nada quebra, apenas não persiste entre sessões.
 * ============================================================ */
(function () {
  // Nome do banco agora leva a moeda (carteira) para nao misturar
  // operacoes simuladas de BTC e BCH no mesmo IndexedDB.
  // deps.moeda: 'BTC' (default, mantem compatibilidade com dados
  // ja gravados antes dessa mudanca) ou 'BCH' (banco proprio, novo).
  const DB_VERSION = 1;
  const STORE = 'kv';

  function dbNameForMoeda(moeda, moedaExibicao) {
    const m = String(moeda || 'BTC').toUpperCase();
    const e = String(moedaExibicao || 'BRL').toUpperCase();
    // BTC+BRL mantem o nome antigo (compatibilidade com dados ja salvos).
    // Qualquer outra combinacao ganha cofre proprio - simulacoes em
    // moedas diferentes tem escalas de preco diferentes e NAO podem
    // reaproveitar lotes/projecao uns dos outros.
    if (m === 'BTC' && e === 'BRL') return 'btc_simulador';
    return 'simulador_' + m.toLowerCase() + '_' + e.toLowerCase();
  }

  class LocalStore {
    constructor(deps) {
      deps = deps || {};
      this._idb = deps.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
      this._dbName = dbNameForMoeda(deps.moeda, deps.moedaExibicao);
      this._db = null;
      this._mem = new Map();
      this.available = false;
    }

    async open() {
      if (!this._idb) { this.available = false; return this; }
      const self = this;
      try {
        this._db = await new Promise(function (res, rej) {
          const req = self._idb.open(self._dbName, DB_VERSION);
          req.onupgradeneeded = function () {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          };
          req.onsuccess = function () { res(req.result); };
          req.onerror = function () { rej(req.error || new Error('IndexedDB open falhou')); };
          req.onblocked = function () { rej(new Error('IndexedDB bloqueado')); };
        });
        this.available = true;
      } catch (e) {
        this._db = null; this.available = false;
      }
      return this;
    }

    async get(key) {
      if (!this.available) return this._mem.has(key) ? this._mem.get(key) : null;
      const self = this;
      try {
        return await new Promise(function (res, rej) {
          const tx = self._db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = function () { res(req.result === undefined ? null : req.result); };
          req.onerror = function () { rej(req.error); };
        });
      } catch (e) { return null; }
    }

    async set(key, value) {
      if (!this.available) { this._mem.set(key, value); return true; }
      const self = this;
      try {
        await new Promise(function (res, rej) {
          const tx = self._db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = function () { res(); };
          tx.onerror = function () { rej(tx.error); };
          tx.onabort = function () { rej(tx.error || new Error('tx abort')); };
        });
        return true;
      } catch (e) { this._mem.set(key, value); return true; }
    }

    async del(key) {
      this._mem.delete(key);
      if (!this.available) return true;
      const self = this;
      try {
        await new Promise(function (res, rej) {
          const tx = self._db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = function () { res(); };
          tx.onerror = function () { rej(tx.error); };
        });
        return true;
      } catch (e) { return true; }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { LocalStore: LocalStore };
  if (typeof window !== 'undefined') window.LocalStore = LocalStore;
})();
