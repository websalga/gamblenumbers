'use strict';
/* ============================================================
 * painelbtn.js - botao "Meu painel" no topo do simulador (ao lado do botao dos robos).
 * Abre /painel/ em nova aba. So' aparece quando ha sessao (nao em modo simulacao).
 * Arquivo proprio: nao altera nenhum JS existente do site.
 * ============================================================ */
(function () {
  var NOMES = {
    'pt-BR': 'Meu painel', 'en-US': 'My dashboard', 'es-ES': 'Mi panel', 'fr-FR': 'Mon tableau de bord',
    'de-DE': 'Mein Dashboard', 'it-IT': 'La mia dashboard', 'ja-JP': 'マイダッシュボード',
    'nl-NL': 'Mijn dashboard', 'ru-RU': 'Моя панель', 'tr-TR': 'Panelim', 'zh-CN': '我的面板'
  };
  function lang() {
    var l = '';
    try { l = localStorage.getItem('gn_idioma') || ''; } catch (e) { /* sem storage */ }
    if (NOMES[l]) return l;
    var n = String(navigator.language || 'en-US').slice(0, 2);
    for (var k in NOMES) if (k.slice(0, 2) === n) return k;
    return 'en-US';
  }
  function css() {
    if (document.getElementById('gn-painelbtn-css')) return;
    var st = document.createElement('style');
    st.id = 'gn-painelbtn-css';
    st.textContent =
      '.topnav .painel-btn{width:26px;height:26px;border-radius:50%;border:1px solid var(--border);background:var(--panel2);' +
      'color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex:none;' +
      'text-decoration:none;transition:color .15s,border-color .15s,transform .15s}' +
      '.topnav .painel-btn:hover{color:var(--txt);border-color:var(--accent);transform:scale(1.08)}' +
      '.topnav .painel-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
      '.topnav .painel-btn[hidden]{display:none}' +
      '.painel-btn svg{width:15px;height:15px;display:block}';
    document.head.appendChild(st);
  }
  function mostrar(s) {
    var a = document.getElementById('painelBtn');
    if (!a) return;
    var ok = !!(s && s.session_id);
    a.hidden = !ok;
    if (ok) { var n = NOMES[lang()]; a.title = n; a.setAttribute('aria-label', n); }
  }
  css();
  window.addEventListener('gn:identity:ready', function (e) { mostrar(e.detail); });
  window.addEventListener('gn:identity:updated', function (e) { mostrar(e.detail); });
  function inicial() { mostrar(window.GNIdentity && window.GNIdentity.session); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicial); else inicial();
})();
