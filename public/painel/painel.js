'use strict';
/* ============================================================
 * painel.js - Painel do usuario (/painel/). SOMENTE LEITURA.
 *  - Usa a sessao que o simulador ja guarda neste navegador (localStorage gn_session); nao ha tela de login.
 *  - Pede os dados a /painel_api.php por POST (o session_id nunca vai na URL).
 *  - Todo texto vindo do servidor entra na tela como TEXTO (textContent), nunca como HTML.
 *  - Textos: chaves "painel_*" em painel_i18n.js; as demais vem de textos.php (11 idiomas do site).
 * ============================================================ */
(function () {
  var API = '/painel_api.php';
  var REFRESH_MS = 30000;
  var LANGS = ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'ja-JP', 'nl-NL', 'ru-RU', 'tr-TR', 'zh-CN'];
  var D = window.GNPainelI18n || {};

  var st = { moeda: 'ALL', robo: '', pausado: false, busy: false, timer: null, data: null, sid: '', lang: 'pt-BR', site: {} };

  /* ---------- utilitarios ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, props) {
    var n = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else if (k === 'on') for (var ev in props.on) n.addEventListener(ev, props.on[ev]);
      else if (k === 'data') for (var d in props.data) n.dataset[d] = props.data[d];
      else n.setAttribute(k, props[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function detectLang() {
    var l = '';
    try { l = localStorage.getItem('gn_idioma') || ''; } catch (e) { /* sem storage */ }
    if (LANGS.indexOf(l) >= 0) return l;
    var n = String(navigator.language || 'en-US').slice(0, 2);
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].slice(0, 2) === n) return LANGS[i];
    return 'en-US';
  }

  /* chaves painel_* : dicionario proprio (idioma -> en-US -> pt-BR); demais: textos.php do site, com fallback */
  function T(key, vars) {
    var own = (D[st.lang] || {})[key];
    var s;
    if (key.indexOf('painel_') === 0) {
      s = own !== undefined ? own : (D['en-US'] || {})[key];
      if (s === undefined) s = (D['pt-BR'] || {})[key];
    } else {
      s = st.site[key];
      if (s === undefined) s = own;
    }
    if (s === undefined) s = key;
    return vars ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; }) : String(s);
  }

  function nf(opts) { try { return new Intl.NumberFormat(st.lang, opts); } catch (e) { return new Intl.NumberFormat('en-US', opts); } }
  function money(v, cur) {
    if (v === null || v === undefined) return '—';
    try { return nf({ style: 'currency', currency: cur || 'BRL' }).format(v); } catch (e) { return nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v); }
  }
  function qty(v) { return v === null || v === undefined ? '—' : nf({ maximumFractionDigits: 8 }).format(v); }
  function pct(v, d) { return v === null || v === undefined ? '—' : nf({ minimumFractionDigits: d === undefined ? 1 : d, maximumFractionDigits: d === undefined ? 1 : d }).format(v) + '%'; }
  function when(e) {
    if (!e) return '—';
    try { return new Date(e * 1000).toLocaleString(st.lang, { dateStyle: 'short', timeStyle: 'medium' }); } catch (x) { return new Date(e * 1000).toLocaleString(); }
  }
  function rel(e) {
    if (!e) return '—';
    var diff = e - Math.floor(Date.now() / 1000), a = Math.abs(diff);
    var unit = a < 60 ? 'second' : a < 3600 ? 'minute' : a < 86400 ? 'hour' : 'day';
    var v = unit === 'second' ? diff : unit === 'minute' ? Math.round(diff / 60) : unit === 'hour' ? Math.round(diff / 3600) : Math.round(diff / 86400);
    try { return new Intl.RelativeTimeFormat(st.lang, { numeric: 'auto' }).format(v, unit); } catch (x) { return when(e); }
  }
  /* sinal do resultado, arredondado a 2 casas (igual ao simulador: 0,00 = neutro) */
  function sign(v) { var r = Math.round((Number(v) || 0) * 100) / 100; return r > 0 ? 'pos' : r < 0 ? 'neg' : 'zero'; }

  /* ---------- sessao ---------- */
  function sessionId() {
    try {
      var s = JSON.parse(localStorage.getItem('gn_session'));
      var id = s && typeof s.session_id === 'string' ? s.session_id : '';
      return /^[0-9a-fA-F]{64}$/.test(id) ? id : '';
    } catch (e) { return ''; }
  }

  /* ---------- selo GN-XXXXXX ---------- */
  var copyTimer = null;
  function paintBadge(s) {
    var b = $('sessCode');
    var ok = s && /^GN-[0-9A-F]{6}$/.test(s.codigo || '');
    if (!ok) { b.hidden = true; return; }
    b.hidden = false;
    b.dataset.estado = s.nova ? 'nova' : 'antiga';
    b.dataset.codigo = s.codigo;
    b.textContent = s.codigo;
    b.title = s.nova ? T('painel_session_tip_new') : T('painel_session_tip');
    b.setAttribute('role', 'button'); b.tabIndex = 0;
  }
  function copyBadge() {
    var b = $('sessCode'); if (!b || !b.dataset.codigo) return;
    var c = b.dataset.codigo;
    function done() { b.textContent = T('painel_copied'); clearTimeout(copyTimer); copyTimer = setTimeout(function () { b.textContent = c; }, 1200); }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(c).then(done, function () { }); return; } } catch (e) { /* sem clipboard */ }
  }

  /* ---------- blocos de tela ---------- */
  function kpi(label, value, cls, sub) {
    return el('div', { class: 'kpi' }, el('div', { class: 'l', text: label }), el('div', { class: 'v ' + (cls || ''), text: value }), sub ? el('div', { class: 's', text: sub }) : null);
  }

  function renderKpis(k, real) {
    var box = el('div', { class: 'kpis' });
    box.appendChild(kpi(T('painel_kpi_saldo'), money(k.saldo_virtual), ''));
    box.appendChild(kpi(T('painel_kpi_hoje'), money(k.pnl_hoje), sign(k.pnl_hoje)));
    box.appendChild(kpi(T('painel_kpi_7d'), money(k.pnl_7d), sign(k.pnl_7d)));
    box.appendChild(kpi(T('painel_kpi_total'), money(k.pnl_total), sign(k.pnl_total)));
    box.appendChild(kpi(T('painel_kpi_vendas'), String(k.vendas), '', k.taxa_acerto === null ? '' : T('painel_kpi_acerto', { pct: nf({ maximumFractionDigits: 1 }).format(k.taxa_acerto) })));
    box.appendChild(kpi(T('painel_kpi_lotes'), String(k.lotes_abertos), '', T('painel_kpi_custo', { valor: money(k.custo_aberto) })));
    box.appendChild(kpi(T('painel_kpi_robos'), k.robos_ativos + ' / ' + k.robos_total, k.robos_ativos > 0 ? 'pos' : ''));
    if (real) {
      box.appendChild(kpi(T('painel_kpi_btc_real'), qty(k.btc_real) + ' BTC', ''));
      box.appendChild(kpi(T('painel_kpi_bch_real'), qty(k.bch_real) + ' BCH', ''));
    }
    return box;
  }

  function lbl(k) { return T(k).replace(/\s*\(%\)\s*$/, ''); }   // o valor ja traz o %

  function actionLabel(a) { return a === 'compra' ? T('op_compra') : a === 'venda' ? T('op_venda') : a; }

  function roboCard(r) {
    var yn = r.taxas_reais ? T('painel_p_taxas_sim') : T('painel_p_taxas_nao');
    var dl = el('dl', { class: 'params' },
      el('dt', { text: T('automatos_valor_operacao') }), el('dd', { text: money(r.valor_operacao) }),
      el('dt', { text: lbl('automatos_retorno_desejado') }), el('dd', { text: pct(r.retorno_pct, 2) }),
      el('dt', { text: lbl('automatos_queda_crash_pct') }), el('dd', { text: pct(r.queda_crash_pct, 1) }),
      el('dt', { text: T('automatos_taxas_reais') }), el('dd', { text: yn }),
      el('dt', { text: T('automatos_limite_perda') }), el('dd', { text: pct(r.limite_perda_pct, 0) }),
      el('dt', { text: T('painel_p_ciclo') }), el('dd', { text: r.ciclo_s ? T('painel_p_ciclo_val', { s: r.ciclo_s }) : '—' }),
      el('dt', { text: T('painel_p_proxima') }), el('dd', { text: r.ativo ? rel(r.proxima) : '—' })
    );
    var stats = el('div', { class: 'stats' },
      el('div', null, T('painel_p_vendas'), el('b', { text: String(r.vendas.n) })),
      el('div', null, T('painel_p_resultado'), el('b', { class: sign(r.vendas.pnl), text: money(r.vendas.pnl) })),
      el('div', null, T('painel_p_lotes'), el('b', { text: r.lotes.n + ' · ' + money(r.lotes.custo) }))
    );
    var dec = el('div', { class: 'dec' });
    if (r.decisao) {
      dec.appendChild(el('b', { text: T('painel_p_ultima') + ' · ' + when(r.decisao.e) }));
      dec.appendChild(document.createElement('br'));
      dec.appendChild(document.createTextNode(r.decisao.texto || actionLabel(r.decisao.acao)));
      dec.title = T('painel_decisao_nota');
    } else {
      dec.textContent = T('painel_p_sem_decisao');
    }
    return el('div', { class: 'robo' + (r.ativo ? ' ativo' : '') },
      el('div', { class: 'top' },
        el('div', null, el('span', { class: 'nome', text: r.apelido }), el('span', { class: 'id', text: r.id })),
        el('div', null, el('span', { class: 'badge coin', text: r.moeda }), ' ',
          el('span', { class: 'badge ' + (r.ativo ? 'on' : 'off'), text: r.ativo ? T('automatos_status_ativo') : T('automatos_status_inativo') }))),
      dl, stats, dec);
  }

  function renderRobos(d) {
    var sec = el('section', { class: 'card' }, el('h2', { text: T('painel_sec_robos') }));
    if (!d.robos.length) { sec.appendChild(el('p', { class: 'empty', text: T('painel_sem_robos') })); return sec; }
    var g = el('div', { class: 'robos' });
    d.robos.forEach(function (r) { g.appendChild(roboCard(r)); });
    sec.appendChild(g);
    return sec;
  }

  function statusLabel(o) {
    if (o.tipo === 'venda') return T('painel_st_executed');
    return o.status === 'open' ? T('painel_st_open') : T('painel_st_closed');
  }

  function renderOps(d) {
    var sel = el('select', { 'aria-label': T('painel_col_origem'), on: { change: function (e) { st.robo = e.target.value; load(true); } } });
    sel.appendChild(el('option', { value: '', text: T('painel_robo_todos') }));
    sel.appendChild(el('option', { value: 'MANUAL', text: T('painel_robo_manual') }));
    (st.robosAll || d.robos).forEach(function (r) { sel.appendChild(el('option', { value: r.id, text: r.apelido + ' (' + r.id + ')' })); });
    sel.value = st.robo;
    var sec = el('section', { class: 'card' }, el('h2', null, el('span', { text: T('painel_sec_ops') }), sel));
    if (!d.operacoes.length) { sec.appendChild(el('p', { class: 'empty', text: T('painel_sem_ops') })); return sec; }
    var head = el('tr', null,
      el('th', { text: T('painel_col_quando') }), el('th', { text: T('painel_col_tipo') }), el('th', { text: T('painel_col_moeda') }),
      el('th', { text: T('painel_col_origem') }), el('th', { class: 'num', text: T('painel_col_preco') }), el('th', { class: 'num', text: T('painel_col_qtd') }),
      el('th', { class: 'num', text: T('painel_col_valor') }), el('th', { class: 'num', text: T('painel_col_resultado') }), el('th', { text: T('painel_col_status') }));
    var body = document.createElement('tbody');
    d.operacoes.forEach(function (o) {
      var tipoCls = o.tipo === 'compra' ? 'tag-compra' : 'tag-venda ' + sign(o.pnl);
      var res = o.tipo === 'venda' && o.pnl !== null ? money(o.pnl, o.exib) + (o.ret_pct !== null ? ' (' + pct(o.ret_pct, 2) + ')' : '') : '—';
      body.appendChild(el('tr', null,
        el('td', { text: when(o.e) }),
        el('td', { class: tipoCls, text: o.tipo === 'compra' ? T('op_compra') : T('op_venda') }),
        el('td', { text: o.moeda }),
        el('td', { text: o.origem === 'robo' ? T('painel_origem_robo') + ' ' + o.robo : T('painel_origem_manual') }),
        el('td', { class: 'num', text: money(o.preco, o.exib) }),
        el('td', { class: 'num', text: qty(o.qtd) }),
        el('td', { class: 'num', text: money(o.valor, o.exib) }),
        el('td', { class: 'num ' + (o.tipo === 'venda' ? sign(o.pnl) : ''), text: res }),
        el('td', { class: 'muted', text: statusLabel(o) })));
    });
    sec.appendChild(el('div', { class: 'tablewrap' }, el('table', null, el('thead', null, head), body)));
    return sec;
  }

  function renderAtividade(d) {
    var sec = el('section', { class: 'card' }, el('h2', { text: T('painel_sec_atividade') }));
    if (!d.atividade.length) { sec.appendChild(el('p', { class: 'empty', text: T('painel_sem_atividade') })); return sec; }
    var f = el('div', { class: 'feed' });
    d.atividade.forEach(function (a) {
      f.appendChild(el('div', { class: 'it', title: T('painel_decisao_nota') },
        el('span', { class: 'when', text: when(a.e) }),
        el('span', { class: a.acao === 'compra' ? 'tag-compra' : 'tag-venda', text: actionLabel(a.acao) + (a.robo ? ' · ' + a.robo : '') }),
        el('span', { class: 'muted', text: a.preco !== null ? money(a.preco) : '' }),
        el('span', { class: 'txt', text: a.texto })));
    });
    sec.appendChild(f);
    return sec;
  }

  function renderSaques(d) {
    var sec = el('section', { class: 'card' }, el('h2', { text: T('painel_sec_saques') }));
    if (!d.saques.length) { sec.appendChild(el('p', { class: 'empty', text: T('painel_sem_saques') })); return sec; }
    var head = el('tr', null, el('th', { text: T('painel_col_quando') }), el('th', { text: T('painel_col_moeda') }), el('th', { class: 'num', text: T('painel_col_valor') }),
      el('th', { text: T('painel_wd_destino') }), el('th', { text: T('painel_col_status') }));
    var body = document.createElement('tbody');
    d.saques.forEach(function (s) {
      var stt = s.confirmado ? T('painel_wd_conf') : T('painel_wd_pend');
      if (s.confs !== null) stt += ' · ' + T('painel_wd_confs', { n: s.confs });
      body.appendChild(el('tr', null, el('td', { text: when(s.e) }), el('td', { text: s.moeda }),
        el('td', { class: 'num', text: qty(s.valor) + (s.total ? ' (' + T('painel_wd_total') + ')' : '') }),
        el('td', { class: 'muted', text: s.destino || '—' }), el('td', { text: stt })));
    });
    sec.appendChild(el('div', { class: 'tablewrap' }, el('table', null, el('thead', null, head), body)));
    return sec;
  }

  function renderChips() {
    var box = $('coinChips'); clear(box);
    [['ALL', T('painel_coin_all')], ['BTC', 'BTC'], ['BCH', 'BCH']].forEach(function (c) {
      box.appendChild(el('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.moeda === c[0]), text: c[1],
        on: { click: function () { if (st.moeda !== c[0]) { st.moeda = c[0]; st.robo = ''; renderChips(); load(true); } } } }));
    });
  }

  function message(text, err, link) {
    var v = $('view'); clear(v);
    var m = el('p', { class: 'msg' + (err ? ' err' : '') }, text);
    if (link) { m.appendChild(document.createElement('br')); m.appendChild(el('a', { href: '/', text: T('painel_back') })); }
    v.appendChild(m);
  }

  function render(d) {
    st.data = d;
    if (!st.robosAll || st.moeda === 'ALL') st.robosAll = d.robos;
    paintBadge(d.sessao);
    var v = $('view'); clear(v);
    v.appendChild(renderKpis(d.kpis, d.sessao.modo_real));
    v.appendChild(renderRobos(d));
    v.appendChild(renderOps(d));
    v.appendChild(renderAtividade(d));
    v.appendChild(renderSaques(d));
    $('bar').hidden = false;
  }

  /* ---------- textos fixos da pagina ---------- */
  function paintStatic() {
    document.documentElement.lang = st.lang;
    document.title = T('painel_title') + ' · BTC Simulador';
    $('subtitle').textContent = T('painel_subtitle');
    $('navBack').textContent = T('painel_back');
    $('btnRefresh').textContent = T('painel_refresh');
    $('btnPause').textContent = st.pausado ? T('painel_resume') : T('painel_pause');
    $('foot').textContent = '';
    $('foot').appendChild(document.createTextNode(T('painel_readonly') + ' '));
    $('foot').appendChild(el('a', { href: '/', text: T('automatos_voltar') }));
    try { window.dispatchEvent(new CustomEvent('gn:lang')); } catch (e) { /* tema */ }
  }

  function setStatus(kind, text) {
    var dot = $('dot'); dot.className = 'dot' + (kind === 'off' ? ' off' : kind === 'err' ? ' err' : '');
    $('statusTxt').textContent = text;
  }

  /* ---------- carga ---------- */
  function load(force) {
    if (st.busy || (!force && (st.pausado || document.hidden))) return;
    if (!st.sid) return;
    st.busy = true;
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* padrao no servidor */ }
    fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ session_id: st.sid, moeda: st.moeda, robo: st.robo, tz: tz }), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; });
    }).then(function (x) {
      if (x.status === 200 && x.j && x.j.ok) {
        render(x.j);
        setStatus('ok', T('painel_updated', { hora: new Date().toLocaleTimeString(st.lang) }));
      } else if (x.status === 404) {
        message(T('painel_session_invalid'), true, true); setStatus('err', ''); stopTimer();
      } else if (x.status === 429) {
        setStatus('err', T('painel_rate_error'));
      } else {
        if (!st.data) message(T('painel_load_error'), true); setStatus('err', T('painel_load_error'));
      }
    }).catch(function () {
      if (!st.data) message(T('painel_load_error'), true); setStatus('err', T('painel_load_error'));
    }).then(function () { clearTimeout(to); st.busy = false; });
  }

  function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = null; } }
  function startTimer() { stopTimer(); st.timer = setInterval(function () { load(false); }, REFRESH_MS); }

  /* ---------- inicio ---------- */
  function loadSiteTexts() {
    return fetch('/textos.php?idioma=' + encodeURIComponent(st.lang), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok && j.textos) st.site = j.textos; })
      .catch(function () { /* usa os textos de reserva */ });
  }

  function init() {
    st.lang = detectLang();
    st.sid = sessionId();
    paintStatic();
    renderChips();
    $('sessCode').addEventListener('click', copyBadge);
    $('sessCode').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyBadge(); } });
    $('btnRefresh').addEventListener('click', function () { load(true); });
    $('btnPause').addEventListener('click', function () {
      st.pausado = !st.pausado; paintStatic();
      setStatus(st.pausado ? 'off' : 'ok', st.pausado ? T('painel_paused') : '');
      if (!st.pausado) load(true);
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(false); });

    $('loading').textContent = T('painel_loading');
    if (!st.sid) { message(T('painel_no_session') + ' ' + T('painel_no_session_hint'), false, true); setStatus('err', ''); return; }

    loadSiteTexts().then(function () {
      paintStatic(); renderChips();
      load(true); startTimer();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
