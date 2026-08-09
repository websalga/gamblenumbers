'use strict';
/* ============================================================
 * i18n.js - carrega textos de textos.php e aplica no DOM.
 *
 * Uso:
 *   await I18N.load('pt-BR');      // busca e guarda os textos
 *   I18N.t('btn_comprar')          // -> string traduzida
 *   I18N.t('desvio_projecao', {pct: '3.04', sinal: 'acima', n: 32})
 *   I18N.applyToDom(document);     // aplica em elementos [data-i18n]
 *
 * No HTML: <button data-i18n="btn_comprar">Iniciar compra simulada</button>
 * (o texto atual no HTML fica como fallback caso o fetch falhe)
 * ============================================================ */
(function () {
  const IDIOMAS = [
    { codigo: 'pt-BR', bandeira: '🇧🇷', nome: 'Português' },
    { codigo: 'fr-FR', bandeira: '🇫🇷', nome: 'Français' },
    { codigo: 'de-DE', bandeira: '🇩🇪', nome: 'Deutsch' },
    { codigo: 'it-IT', bandeira: '🇮🇹', nome: 'Italiano' },
    { codigo: 'ja-JP', bandeira: '🇯🇵', nome: '日本語' },
    { codigo: 'nl-NL', bandeira: '🇳🇱', nome: 'Nederlands' },
    { codigo: 'ru-RU', bandeira: '🇷🇺', nome: 'Русский' },
    { codigo: 'tr-TR', bandeira: '🇹🇷', nome: 'Türkçe' },
    { codigo: 'en-US', bandeira: '🇺🇸', nome: 'English' },
    { codigo: 'es-ES', bandeira: '🇪🇸', nome: 'Español' },
  ];

  let _textos = {};
  let _idioma = 'pt-BR';

  async function load(idioma) {
    idioma = idioma || 'pt-BR';
    try {
      const r = await fetch(`textos.php?idioma=${encodeURIComponent(idioma)}`, { cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok && j.textos) {
        _textos = j.textos;
        _idioma = j.idioma || idioma;
        return true;
      }
    } catch (e) { /* segue com fallback do HTML/chaves */ }
    return false;
  }

  function t(chave, vars) {
    let s = _textos[chave];
    if (s == null) return chave; // fallback visivel se a chave nao existir
    if (vars) {
      for (const k in vars) {
        s = s.split('{' + k + '}').join(vars[k]);
      }
    }
    return s;
  }

  function applyToDom(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      const chave = el.getAttribute('data-i18n');
      if (_textos[chave] != null) el.textContent = _textos[chave];
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const chave = el.getAttribute('data-i18n-title');
      if (_textos[chave] != null) el.title = _textos[chave];
    });
  }

  window.I18N = { IDIOMAS, load, t, applyToDom, get idioma() { return _idioma; } };
})();
