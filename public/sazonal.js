'use strict';
/* ============================================================
 * sazonal.js - temas de datas comemorativas aplicados sozinhos pela data do aparelho.
 *   halloween: 31/10 (todo ano)
 *   natal:     30/11 ate 01/01 do ano seguinte (inclusive)
 *   - Site: theme.js pergunta GNSazonal.tema() e abre no tema do dia (o visitante ainda pode
 *     trocar; a troca vale ate o fim da temporada e nunca vira a escolha salva).
 *   - App (/app/): aplica as cores direto (html.gn-sazonal-app) e as decoracoes.
 *   - Decoracoes sao SVG/CSS proprios, atras do conteudo, sem capturar cliques;
 *     com "reduzir movimento" ficam paradas.
 *   - Previa em qualquer dia: ?tema=halloween  ou  ?tema=natal
 * ============================================================ */
(function () {
  var doc = document, root = doc.documentElement;
  var d = new Date(), mes = d.getMonth(), dia = d.getDate(), ano = d.getFullYear();
  var q = /[?&]tema=(halloween|natal)\b/.exec(location.search || '');
  var ativo = q ? q[1]
    : (mes === 9 && dia === 31) ? 'halloween'
    : ((mes === 10 && dia === 30) || mes === 11 || (mes === 0 && dia === 1)) ? 'natal'
    : null;
  // temporada: a troca de tema do visitante vale ate ela acabar
  var temporada = ativo === 'natal' ? 'natal-' + (mes === 0 ? ano - 1 : ano) : ativo ? ativo + '-' + ano : '';
  var app = /^\/app\//.test(location.pathname || '');
  var pt = /^pt/i.test(root.lang || navigator.language || '');

  var BASE =
    'html.gn-sazonal-on .app,html.gn-sazonal-on #app{position:relative;z-index:1}\n' +
    '#gn-sazonal{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}\n' +
    '.gn-sazonal-saudacao{display:inline-block;margin:4px 0 2px;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;vertical-align:middle}\n';

  var TEMAS = {
    halloween: {
      saudacao: pt ? '🎃 Feliz Dia das Bruxas!' : '🎃 Happy Halloween!',
      cor: '#0d0716',
      css:
        'html.gn-sazonal-app.gn-t-halloween{--bg:#0d0716;--bg2:#140a1d;--card:#1a0f24;--line:#3d2352;--line2:#4a2a63;' +
        '--tx:#f6ecff;--tx2:#dccbee;--mut:#a990c0;--acc:#ff7a1a;--accbg:#2a1405}\n' +
        'html.gn-t-halloween body{background-image:radial-gradient(circle at 88% 6%,rgba(255,150,50,.16),transparent 38%),' +
        'radial-gradient(circle at 8% 100%,rgba(150,70,210,.16),transparent 45%);background-attachment:fixed}\n' +
        '.gn-t-halloween .gn-sazonal-saudacao{background:rgba(255,122,26,.16);color:#ffb46b}\n' +
        '#gn-sazonal .lua{position:absolute;top:14px;right:22px;width:78px;height:78px;border-radius:50%;' +
        'background:radial-gradient(circle at 38% 38%,#fff7dc,#ffd27a 58%,#e9a23b);box-shadow:0 0 50px 16px rgba(255,190,90,.22);opacity:.42}\n' +
        '#gn-sazonal .morcego{position:absolute;left:102%;width:38px;fill:#05020a;opacity:.75;animation:gnVoa 22s linear infinite}\n' +
        '#gn-sazonal .morcego.b1{top:9%}\n' +
        '#gn-sazonal .morcego.b2{top:22%;width:28px;animation-duration:28s;animation-delay:-9s}\n' +
        '#gn-sazonal .morcego.b3{top:58%;width:22px;animation-duration:34s;animation-delay:-20s;opacity:.55}\n' +
        '@keyframes gnVoa{0%{transform:translate(0,0)}20%{transform:translate(-25vw,3vh)}40%{transform:translate(-50vw,-2vh)}' +
        '60%{transform:translate(-75vw,4vh)}80%{transform:translate(-100vw,0)}100%{transform:translate(-125vw,2vh)}}\n' +
        '#gn-sazonal .teia{position:absolute;top:0;left:0;width:150px;height:150px;opacity:.3;stroke:#dcc8f2;fill:none;stroke-width:1.2}\n' +
        '#gn-sazonal .aranha{position:absolute;top:0;left:96px;width:18px;opacity:.6;animation:gnDesce 6s ease-in-out infinite alternate}\n' +
        '@keyframes gnDesce{from{transform:translateY(40px)}to{transform:translateY(96px)}}\n' +
        '#gn-sazonal .aboboras{position:absolute;left:10px;bottom:6px;width:120px;opacity:.85}\n' +
        'html.gn-sazonal-app #gn-sazonal .aboboras{bottom:calc(78px + env(safe-area-inset-bottom,0px));width:96px;opacity:.6}\n' +
        'html.gn-sazonal-app #gn-sazonal .lua{top:calc(10px + env(safe-area-inset-top,0px));width:56px;height:56px;opacity:.35}\n' +
        '@media (prefers-reduced-motion:reduce){#gn-sazonal .morcego,#gn-sazonal .aranha{animation:none}#gn-sazonal .morcego{left:auto;right:120px}}\n',
      html: function () {
        var morcego = '<svg class="morcego %c" viewBox="0 0 64 28" aria-hidden="true"><path d="M32 10c-2-4-5-5-7-4 1 2 0 4-2 4-3 0-4-3-6-5-3 3-9 4-15 3 6 3 9 8 9 13 3-3 7-3 9 0 2-3 5-4 8-2 1-3 2-4 4-5 2 1 3 2 4 5 3-2 6-1 8 2 2-3 6-3 9 0 0-5 3-10 9-13-6 1-12 0-15-3-2 2-3 5-6 5-2 0-3-2-2-4-2-1-5 0-7 4z"/></svg>';
        var abobora = function (x, s) {
          return '<g transform="translate(' + x + ' ' + (60 - 44 * s) + ') scale(' + s + ')">' +
            '<path d="M22 6c1-4 4-6 7-5-3 1-4 3-4 6z" fill="#3f6b2a"/>' +
            '<ellipse cx="12" cy="26" rx="12" ry="17" fill="#e8650f"/><ellipse cx="32" cy="26" rx="12" ry="17" fill="#e8650f"/>' +
            '<ellipse cx="22" cy="26" rx="12" ry="18" fill="#ff7a1a"/>' +
            '<path d="M12 20l5-5 4 6zM32 20l-5-5-4 6z" fill="#2a0f00"/><path d="M10 31q12 10 24 0l-3 1-2 3-3-3-3 3-3-3-3 3-2-3z" fill="#2a0f00"/></g>';
        };
        return '<div class="lua"></div>' +
          morcego.replace('%c', 'b1') + morcego.replace('%c', 'b2') + morcego.replace('%c', 'b3') +
          '<svg class="teia" viewBox="0 0 150 150" aria-hidden="true"><path d="M0 0L150 40M0 0L120 120M0 0L40 150"/>' +
          '<path d="M38 10q14 18 2 36q-12-10-28-6M76 20q22 34 0 64q-26-20-56-12M112 30q28 50 0 92q-40-30-84-18"/></svg>' +
          '<svg class="aranha" viewBox="0 0 20 40" aria-hidden="true"><path d="M10 0V22" stroke="#cbb7e6" stroke-width=".8"/>' +
          '<circle cx="10" cy="27" r="5" fill="#120818"/><path d="M5 25l-5-3M5 28l-5 1M5 30l-4 4M15 25l5-3M15 28l5 1M15 30l4 4" stroke="#120818" stroke-width="1.2"/></svg>' +
          '<svg class="aboboras" viewBox="0 0 120 64" aria-hidden="true">' + abobora(0, 1) + abobora(50, .78) + abobora(86, .6) + '</svg>';
      }
    },
    natal: {
      saudacao: pt ? '🎄 Boas Festas!' : '🎄 Happy Holidays!',
      cor: '#06101f',
      css:
        'html.gn-sazonal-app.gn-t-natal{--bg:#06101f;--bg2:#0a1729;--card:#0d1d33;--line:#1f3a5c;--line2:#2a4b73;' +
        '--tx:#eef5ff;--tx2:#cddcf2;--mut:#8fa7c7;--acc:#f5c542;--accbg:#2a2208}\n' +
        /* aurora (azul, verde-agua e rosa) no alto da pagina */
        'html.gn-t-natal body{background-image:radial-gradient(ellipse 60% 40% at 20% 0%,rgba(56,189,248,.16),transparent 70%),' +
        'radial-gradient(ellipse 50% 35% at 55% 0%,rgba(45,212,191,.12),transparent 70%),' +
        'radial-gradient(ellipse 40% 30% at 85% 0%,rgba(244,114,182,.10),transparent 70%);background-attachment:fixed}\n' +
        '.gn-t-natal .gn-sazonal-saudacao{background:rgba(245,197,66,.15);color:#ffd977}\n' +
        '#gn-sazonal .floco{position:absolute;top:-12px;border-radius:50%;background:#fff;opacity:.75;animation:gnNeve linear infinite}\n' +
        '@keyframes gnNeve{0%{transform:translate(0,-2vh)}50%{transform:translate(18px,52vh)}100%{transform:translate(-6px,106vh)}}\n' +
        '#gn-sazonal .arvore{position:absolute;left:10px;bottom:4px;width:96px;opacity:.95}\n' +
        '#gn-sazonal .arvore .luz{animation:gnPisca 1.6s ease-in-out infinite alternate}\n' +
        '#gn-sazonal .arvore .luz:nth-child(3n){animation-delay:-.5s}#gn-sazonal .arvore .luz:nth-child(3n+1){animation-delay:-1.1s}\n' +
        '@keyframes gnPisca{from{opacity:.35}to{opacity:1}}\n' +
        '#gn-sazonal .estrela{filter:drop-shadow(0 0 6px rgba(255,220,120,.9))}\n' +
        '#gn-sazonal .chao{position:absolute;left:0;right:0;bottom:0;height:22px;' +
        'background:radial-gradient(ellipse 30% 100% at 15% 100%,rgba(235,244,255,.55),transparent 70%),' +
        'radial-gradient(ellipse 35% 100% at 60% 100%,rgba(235,244,255,.4),transparent 70%),' +
        'radial-gradient(ellipse 30% 100% at 95% 100%,rgba(235,244,255,.5),transparent 70%)}\n' +
        'html.gn-sazonal-app #gn-sazonal .arvore{bottom:calc(76px + env(safe-area-inset-bottom,0px));width:72px;opacity:.7}\n' +
        'html.gn-sazonal-app #gn-sazonal .chao{display:none}\n' +
        '@media (prefers-reduced-motion:reduce){#gn-sazonal .floco{animation:none;top:auto}#gn-sazonal .arvore .luz{animation:none}}\n',
      html: function () {
        var s = '';
        // flocos com posicao, tamanho e ritmo variados (fixos por indice: mesmo desenho em toda carga)
        for (var i = 0; i < 36; i++) {
          var esq = (i * 37) % 100, tam = 2 + (i * 7) % 4, dur = 9 + (i * 13) % 10, atraso = -((i * 29) % 19);
          var alto = (i * 53) % 100;  // usado so' quando o movimento esta reduzido (neve parada)
          s += '<i class="floco" style="left:' + esq + '%;width:' + tam + 'px;height:' + tam + 'px;animation-duration:' + dur +
               's;animation-delay:' + atraso + 's;bottom:' + alto + '%"></i>';
        }
        var cores = ['#ffd24d', '#ff5a5a', '#5ad1ff', '#7dff9b', '#ffffff'], luzes = '';
        var pts = [[50, 30], [42, 44], [58, 46], [36, 62], [50, 58], [64, 64], [30, 80], [44, 76], [58, 80], [70, 82], [40, 96], [56, 94], [26, 98], [74, 98]];
        pts.forEach(function (p, k) { luzes += '<circle class="luz" cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="' + cores[k % cores.length] + '"/>'; });
        return s +
          '<svg class="arvore" viewBox="0 0 100 124" aria-hidden="true">' +
          '<path d="M50 14L30 44h10L22 70h12L12 104h76L66 70h12L60 44h10z" fill="#0f5132"/>' +
          '<path d="M50 14L40 44h6L32 70h8L22 104h28z" fill="#146c43" opacity=".55"/>' +
          '<rect x="44" y="104" width="12" height="14" fill="#5b3a1e"/>' +
          '<path d="M18 92q32 10 64-8M28 66q22 8 44-6M36 42q14 6 28-4" stroke="#ffd977" stroke-width="1.2" fill="none" opacity=".6"/>' +
          luzes +
          '<path class="estrela" d="M50 2l3.5 7.2 7.9 1.1-5.7 5.6 1.3 7.9L50 20l-7 3.8 1.3-7.9-5.7-5.6 7.9-1.1z" fill="#ffd24d"/>' +
          '</svg><div class="chao"></div>';
      }
    }
  };

  function pronto(fn) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn); else fn(); }
  function injetarCss() {
    if (doc.getElementById('gn-sazonal-css')) return;
    var css = BASE;
    Object.keys(TEMAS).forEach(function (k) { css += TEMAS[k].css; });
    var s = doc.createElement('style'); s.id = 'gn-sazonal-css'; s.textContent = css; (doc.head || root).appendChild(s);
  }
  /** Liga as decoracoes do tema `id` (ou desliga tudo com null/false). O site chama ao trocar de tema. */
  function decorar(id) {
    if (id === true) id = ativo;
    var t = id && TEMAS[id];
    injetarCss();
    Object.keys(TEMAS).forEach(function (k) { root.classList.toggle('gn-t-' + k, !!t && k === id); });
    root.classList.toggle('gn-sazonal-on', !!t);
    pronto(function () {
      var el = doc.getElementById('gn-sazonal'), sd = doc.getElementById('gn-sazonal-saudacao');
      if (el && (!t || el.getAttribute('data-tema') !== id)) { el.remove(); el = null; }
      if (sd && (!t || sd.getAttribute('data-tema') !== id)) { sd.remove(); sd = null; }
      if (!t) return;
      if (!el) {
        el = doc.createElement('div'); el.id = 'gn-sazonal'; el.setAttribute('data-tema', id); el.setAttribute('aria-hidden', 'true');
        el.innerHTML = t.html(); doc.body.insertBefore(el, doc.body.firstChild);
      }
      // fica ao lado do titulo do site, nao dentro dele (o site reescreve o texto do h1)
      var h1 = doc.querySelector('header .brand h1');
      if (h1 && !sd) {
        sd = doc.createElement('span'); sd.id = 'gn-sazonal-saudacao'; sd.className = 'gn-sazonal-saudacao';
        sd.setAttribute('data-tema', id); sd.textContent = t.saudacao; h1.parentNode.insertBefore(sd, h1.nextSibling);
      }
    });
  }

  if (ativo && app) {
    root.classList.add('gn-sazonal-app');
    var m = doc.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', TEMAS[ativo].cor);
    decorar(ativo);
  }

  window.GNSazonal = {
    tema: function () { return ativo; },
    /* o visitante trocou de tema nesta temporada: respeitar ate ela acabar */
    recusado: function () { try { return !!temporada && localStorage.getItem('gn_tema_sazonal_fora') === temporada; } catch (e) { return false; } },
    recusar: function () { try { if (temporada) localStorage.setItem('gn_tema_sazonal_fora', temporada); } catch (e) {} },
    decorar: decorar
  };
})();
