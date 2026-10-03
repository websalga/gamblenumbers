'use strict';
/* ============================================================
 * sessionbadge.js - mostra o identificador publico da sessao (GN-XXXXXX)
 * ao lado do titulo do site. O codigo vem pronto do servidor (identity.php);
 * o session_id real nunca e' exibido. Cor: azul = sessao antiga,
 * verde = sessao nova (criada nas ultimas 24 h). Clique copia o codigo.
 * ============================================================ */
(function () {
  const TXT = {
    pt: { tip: 'Identificador da sua sessão. Clique para copiar.', nova: 'Sessão NOVA (criada nas últimas 24 h). Clique para copiar.', ok: 'Copiado!' },
    en: { tip: 'Your session identifier. Click to copy.', nova: 'NEW session (created in the last 24 h). Click to copy.', ok: 'Copied!' },
    es: { tip: 'Identificador de tu sesión. Haz clic para copiar.', nova: 'Sesión NUEVA (creada en las últimas 24 h). Haz clic para copiar.', ok: '¡Copiado!' },
    fr: { tip: 'Identifiant de votre session. Cliquez pour copier.', nova: 'NOUVELLE session (créée ces dernières 24 h). Cliquez pour copier.', ok: 'Copié !' },
    de: { tip: 'Kennung Ihrer Sitzung. Zum Kopieren klicken.', nova: 'NEUE Sitzung (in den letzten 24 h erstellt). Zum Kopieren klicken.', ok: 'Kopiert!' },
    it: { tip: 'Identificativo della tua sessione. Clicca per copiare.', nova: 'NUOVA sessione (creata nelle ultime 24 h). Clicca per copiare.', ok: 'Copiato!' }
  };
  function lang() {
    var l = (window.I18N && window.I18N.idioma) || document.documentElement.lang || 'en';
    return String(l).slice(0, 2).toLowerCase();
  }
  function txt() { return TXT[lang()] || TXT.en; }

  function injectCss() {
    if (document.getElementById('gn-sess-badge-css')) return;
    var st = document.createElement('style');
    st.id = 'gn-sess-badge-css';
    st.textContent =
      '#gn-sess-badge{display:none;margin-left:10px;padding:2px 9px;border-radius:999px;border:1px solid;' +
      'font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.5px;' +
      'vertical-align:middle;cursor:pointer;user-select:all;white-space:nowrap}' +
      '#gn-sess-badge[data-estado="antiga"]{color:#60a5fa;background:rgba(96,165,250,.12);border-color:rgba(96,165,250,.45)}' +
      '#gn-sess-badge[data-estado="nova"]{color:#22c55e;background:rgba(34,197,94,.14);border-color:rgba(34,197,94,.55)}' +
      '#gn-sess-badge:focus-visible{outline:2px solid currentColor;outline-offset:2px}';
    document.head.appendChild(st);
  }

  var timer = null;
  function getEl() {
    var el = document.getElementById('gn-sess-badge');
    if (el) return el;
    var h = document.querySelector('.brand h1');
    if (!h) return null;
    injectCss();
    el = document.createElement('span');
    el.id = 'gn-sess-badge';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.addEventListener('click', copiar);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copiar(); } });
    h.appendChild(el);
    return el;
  }

  function render(s) {
    var el = getEl();
    if (!el) return;
    var codigo = s && typeof s.codigo === 'string' && /^GN-[0-9A-F]{6}$/.test(s.codigo) ? s.codigo : '';
    if (!codigo) { el.style.display = 'none'; el.textContent = ''; return; }
    var nova = !!s.nova;
    el.dataset.codigo = codigo;
    el.dataset.estado = nova ? 'nova' : 'antiga';
    el.textContent = codigo;
    el.title = nova ? txt().nova : txt().tip;
    el.setAttribute('aria-label', codigo + ' - ' + (nova ? txt().nova : txt().tip));
    el.style.display = 'inline-block';
  }

  function copiar() {
    var el = document.getElementById('gn-sess-badge');
    if (!el || !el.dataset.codigo) return;
    var c = el.dataset.codigo;
    function feito() {
      el.textContent = txt().ok;
      clearTimeout(timer);
      timer = setTimeout(function () { el.textContent = c; }, 1200);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(c).then(feito, function () { fallback(c, feito); });
        return;
      }
    } catch (e) { /* cai no fallback */ }
    fallback(c, feito);
  }
  function fallback(c, cb) {
    try {
      var ta = document.createElement('textarea');
      ta.value = c; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      cb();
    } catch (e) { /* sem clipboard: o codigo continua selecionavel (user-select:all) */ }
  }

  window.addEventListener('gn:identity:ready', function (e) { render(e.detail); });
  window.addEventListener('gn:identity:updated', function (e) { render(e.detail); });
  function inicial() { if (window.GNIdentity && window.GNIdentity.session) render(window.GNIdentity.session); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicial); else inicial();
})();
