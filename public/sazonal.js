'use strict';
/* ============================================================
 * sazonal.js - temas de datas comemorativas aplicados sozinhos pela data do aparelho.
 *   Hoje: Dia das Bruxas (31/10, todo ano).
 *   - Site: theme.js pergunta GNSazonal.tema() e abre no tema "halloween" nesse dia
 *     (o visitante ainda pode trocar no botao de tema; no dia seguinte volta ao tema dele).
 *   - App (/app/): aplica as cores direto (html.gn-sazonal-app) e as decoracoes.
 *   - Decoracoes (lua, morcegos, teia, aboboras) sao SVG/CSS proprios, atras do conteudo,
 *     sem capturar cliques; com "reduzir movimento" os morcegos ficam parados.
 *   - Previa em qualquer dia: ?tema=halloween
 * ============================================================ */
(function () {
  var doc = document, root = doc.documentElement;
  var q = /[?&]tema=(halloween)\b/.exec(location.search || '');
  var d = new Date();
  var ativo = q ? q[1] : (d.getMonth() === 9 && d.getDate() === 31 ? 'halloween' : null);
  var app = /^\/app\//.test(location.pathname || '');
  var hoje = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();

  var CSS =
    /* cores do app (o site usa o tema "halloween" do theme.js) */
    'html.gn-sazonal-app{--bg:#0d0716;--bg2:#140a1d;--card:#1a0f24;--line:#3d2352;--line2:#4a2a63;' +
    '--tx:#f6ecff;--tx2:#dccbee;--mut:#a990c0;--acc:#ff7a1a;--accbg:#2a1405}\n' +
    'html.gn-halloween-on body{background-image:radial-gradient(circle at 88% 6%,rgba(255,150,50,.16),transparent 38%),' +
    'radial-gradient(circle at 8% 100%,rgba(150,70,210,.16),transparent 45%);background-attachment:fixed}\n' +
    'html.gn-halloween-on .app,html.gn-halloween-on #app{position:relative;z-index:1}\n' +
    '#gn-halloween{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}\n' +
    '#gn-halloween .lua{position:absolute;top:14px;right:22px;width:78px;height:78px;border-radius:50%;' +
    'background:radial-gradient(circle at 38% 38%,#fff7dc,#ffd27a 58%,#e9a23b);box-shadow:0 0 50px 16px rgba(255,190,90,.22);opacity:.42}\n' +
    '#gn-halloween .morcego{position:absolute;left:102%;width:38px;fill:#05020a;opacity:.75;animation:gnVoa 22s linear infinite}\n' +
    '#gn-halloween .morcego.b2{top:22%;width:28px;animation-duration:28s;animation-delay:-9s}\n' +
    '#gn-halloween .morcego.b3{top:58%;width:22px;animation-duration:34s;animation-delay:-20s;opacity:.55}\n' +
    '#gn-halloween .morcego.b1{top:9%}\n' +
    '@keyframes gnVoa{0%{transform:translate(0,0)}20%{transform:translate(-25vw,3vh)}40%{transform:translate(-50vw,-2vh)}' +
    '60%{transform:translate(-75vw,4vh)}80%{transform:translate(-100vw,0)}100%{transform:translate(-125vw,2vh)}}\n' +
    '#gn-halloween .teia{position:absolute;top:0;left:0;width:150px;height:150px;opacity:.3;stroke:#dcc8f2;fill:none;stroke-width:1.2}\n' +
    '#gn-halloween .aranha{position:absolute;top:0;left:96px;width:18px;opacity:.6;animation:gnDesce 6s ease-in-out infinite alternate}\n' +
    '@keyframes gnDesce{from{transform:translateY(40px)}to{transform:translateY(96px)}}\n' +
    '#gn-halloween .aboboras{position:absolute;left:10px;bottom:6px;width:120px;opacity:.85}\n' +
    'html.gn-sazonal-app #gn-halloween .aboboras{bottom:calc(78px + env(safe-area-inset-bottom,0px));width:96px;opacity:.6}\n' +
    'html.gn-sazonal-app #gn-halloween .lua{top:calc(10px + env(safe-area-inset-top,0px));width:56px;height:56px;opacity:.35}\n' +
    '.gn-halloween-saudacao{display:inline-block;margin:4px 0 2px;padding:2px 10px;border-radius:999px;' +
    'background:rgba(255,122,26,.16);color:#ffb46b;font-size:12px;font-weight:600;vertical-align:middle}\n' +
    '@media (prefers-reduced-motion:reduce){#gn-halloween .morcego,#gn-halloween .aranha{animation:none}#gn-halloween .morcego{left:auto;right:120px}}\n';

  var MORCEGO = '<svg class="morcego %c" viewBox="0 0 64 28" aria-hidden="true"><path d="M32 10c-2-4-5-5-7-4 1 2 0 4-2 4-3 0-4-3-6-5-3 3-9 4-15 3 6 3 9 8 9 13 3-3 7-3 9 0 2-3 5-4 8-2 1-3 2-4 4-5 2 1 3 2 4 5 3-2 6-1 8 2 2-3 6-3 9 0 0-5 3-10 9-13-6 1-12 0-15-3-2 2-3 5-6 5-2 0-3-2-2-4-2-1-5 0-7 4z"/></svg>';
  var ABOBORA = function (x, s) {
    return '<g transform="translate(' + x + ' ' + (60 - 44 * s) + ') scale(' + s + ')">' +
      '<path d="M22 6c1-4 4-6 7-5-3 1-4 3-4 6z" fill="#3f6b2a"/>' +
      '<ellipse cx="12" cy="26" rx="12" ry="17" fill="#e8650f"/><ellipse cx="32" cy="26" rx="12" ry="17" fill="#e8650f"/>' +
      '<ellipse cx="22" cy="26" rx="12" ry="18" fill="#ff7a1a"/>' +
      '<path d="M12 20l5-5 4 6zM32 20l-5-5-4 6z" fill="#2a0f00"/><path d="M10 31q12 10 24 0l-3 1-2 3-3-3-3 3-3-3-3 3-2-3z" fill="#2a0f00"/></g>';
  };
  var SVG =
    '<div class="lua"></div>' +
    MORCEGO.replace('%c', 'b1') + MORCEGO.replace('%c', 'b2') + MORCEGO.replace('%c', 'b3') +
    '<svg class="teia" viewBox="0 0 150 150" aria-hidden="true"><path d="M0 0L150 40M0 0L120 120M0 0L40 150"/>' +
    '<path d="M38 10q14 18 2 36q-12-10-28-6M76 20q22 34 0 64q-26-20-56-12M112 30q28 50 0 92q-40-30-84-18"/></svg>' +
    '<svg class="aranha" viewBox="0 0 20 40" aria-hidden="true"><path d="M10 0V22" stroke="#cbb7e6" stroke-width=".8"/>' +
    '<circle cx="10" cy="27" r="5" fill="#120818"/><path d="M5 25l-5-3M5 28l-5 1M5 30l-4 4M15 25l5-3M15 28l5 1M15 30l4 4" stroke="#120818" stroke-width="1.2"/></svg>' +
    '<svg class="aboboras" viewBox="0 0 120 64" aria-hidden="true">' + ABOBORA(0, 1) + ABOBORA(50, .78) + ABOBORA(86, .6) + '</svg>';

  function pronto(fn) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn); else fn(); }
  function injetarCss() {
    if (doc.getElementById('gn-sazonal-css')) return;
    var s = doc.createElement('style'); s.id = 'gn-sazonal-css'; s.textContent = CSS; (doc.head || root).appendChild(s);
  }
  function saudacao() {
    var l = root.lang || navigator.language || '';
    return /^pt/i.test(l) ? '🎃 Feliz Dia das Bruxas!' : '🎃 Happy Halloween!';
  }
  /** Liga/desliga as decoracoes (o site chama ao trocar de tema). */
  function decorar(on) {
    injetarCss();
    pronto(function () {
      var el = doc.getElementById('gn-halloween'), sd = doc.getElementById('gn-halloween-saudacao');
      if (!on) { if (el) el.remove(); if (sd) sd.remove(); root.classList.remove('gn-halloween-on'); return; }
      root.classList.add('gn-halloween-on');
      if (!el) { el = doc.createElement('div'); el.id = 'gn-halloween'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = SVG; doc.body.insertBefore(el, doc.body.firstChild); }
      var h1 = doc.querySelector('header .brand h1');
      // fica ao lado do titulo, nao dentro dele (o site reescreve o texto do h1)
      if (h1 && !sd) { sd = doc.createElement('span'); sd.id = 'gn-halloween-saudacao'; sd.className = 'gn-halloween-saudacao'; sd.textContent = saudacao(); h1.parentNode.insertBefore(sd, h1.nextSibling); }
    });
  }

  if (ativo && app) {
    injetarCss(); root.classList.add('gn-sazonal-app');
    var m = doc.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', '#0d0716');
    decorar(true);
  }

  window.GNSazonal = {
    tema: function () { return ativo; },
    /* o visitante trocou de tema hoje: respeitar ate o dia seguinte */
    recusado: function () { try { return localStorage.getItem('gn_tema_sazonal_fora') === hoje; } catch (e) { return false; } },
    recusar: function () { try { localStorage.setItem('gn_tema_sazonal_fora', hoje); } catch (e) {} },
    decorar: decorar
  };
})();
