'use strict';
/* ============================================================
 * GNTheme — temas de cores do site (v1.14.0)
 *   - Cada tema e' so' um conjunto de variaveis CSS (:root[data-theme="id"]). O tema "noite" e' o padrao e vive no :root do index.html.
 *   - Um unico botao redondo (na barra do topo) troca de tema em ciclo; a escolha fica em localStorage (gn_theme).
 *   - Sem escolha salva, respeita prefers-color-scheme (claro -> "claro").
 *   - O canvas do grafico nao le CSS: GNTheme.canvas(nome) devolve a cor da variavel correspondente (PlotArea.color).
 *   - Ao trocar, dispara o evento 'gn:theme' para o app redesenhar.
 * ============================================================ */
(function () {
  var KEY = 'gn_theme';
  var THEMES = [
    { id: 'noite', names: { pt: 'Noite', en: 'Night' }, swatch: ['#070c18', '#22d3ee'], vars: null },
    { id: 'grafite', names: { pt: 'Grafite', en: 'Graphite' }, swatch: ['#0e0e10', '#f5a524'], vars: {
      '--panel3': '#121215', '--muted2': '#6b6b76', '--dim': '#3a3a44', '--edge': '#8d8d98', '--line3': '#55555f', '--txt2': '#d4d4da', '--bg': '#0e0e10', '--panel': '#161619', '--panel2': '#1e1e22', '--border': '#2c2c33', '--txt': '#ececef', '--muted': '#8d8d98',
      '--accent': '#f5a524', '--accent-rgb': '245,165,36', '--accent-ink': '#1a1200',
      '--avg': '#e5e5ea', '--binance': '#f7c948', '--kraken': '#b98bff', '--coinbase': '#5aa2ff', '--morningstar': '#00e5ff',
      '--green': '#22c55e', '--red': '#ef4444', '--yellow': '#f7c948', '--green-ink': '#04210f', '--yellow-ink': '#2a2205', '--green-soft': '#86efac',
      '--forecast': '#fb923c', '--scenario': '#f472b6', '--badge-ink': '#0b0b0d',
      '--btn': '#24242a', '--btn-hover': '#2e2e36', '--line2': '#3a3a44', '--deep': '#08080a',
      '--pos-bg1': '#12241a', '--pos-bg2': '#101c18', '--neg-bg': '#4a1c1c', '--neg-bd': '#7a2b2b', '--neg-bg2': '#1f1213',
      '--tag-buy-fg': '#7fb4ff', '--tag-sell-fg': '#c99bff', '--shadow': 'rgba(0,0,0,.6)',
      '--grid': 'rgba(60,60,70,0.55)', '--now': 'rgba(236,236,239,0.5)', '--now-text': '#ececef', '--trail': 'rgba(236,236,239,0.40)',
      '--proj-bg': 'rgba(245,165,36,0.04)', '--muted-line': 'rgba(141,141,152,0.4)', 'color-scheme': 'dark' } },
    { id: 'claro', names: { pt: 'Claro', en: 'Light' }, swatch: ['#f4f6fa', '#0e7490'], vars: {
      '--panel3': '#f8fafc', '--muted2': '#7b8496', '--dim': '#c3cbdb', '--edge': '#94a3b8', '--line3': '#94a3b8', '--txt2': '#1f2937', '--bg': '#f4f6fa', '--panel': '#ffffff', '--panel2': '#eef1f6', '--border': '#d5dbe6', '--txt': '#111827', '--muted': '#5b6577',
      '--accent': '#0e7490', '--accent-rgb': '14,116,144', '--accent-ink': '#ffffff',
      '--avg': '#334155', '--binance': '#b7791f', '--kraken': '#7c3aed', '--coinbase': '#2563eb', '--morningstar': '#0891b2',
      '--green': '#16a34a', '--red': '#dc2626', '--yellow': '#ca8a04', '--green-ink': '#ffffff', '--yellow-ink': '#1c1500', '--green-soft': '#166534',
      '--forecast': '#ea580c', '--scenario': '#db2777', '--badge-ink': '#ffffff',
      '--btn': '#e5e9f2', '--btn-hover': '#d6dcea', '--line2': '#c3cbdb', '--deep': '#ffffff',
      '--pos-bg1': '#dcfce7', '--pos-bg2': '#d1fae5', '--neg-bg': '#fee2e2', '--neg-bd': '#fca5a5', '--neg-bg2': '#fef2f2',
      '--tag-buy-fg': '#1d4ed8', '--tag-sell-fg': '#7e22ce', '--shadow': 'rgba(15,23,42,.18)',
      '--grid': 'rgba(15,23,42,0.10)', '--now': 'rgba(17,24,39,0.5)', '--now-text': '#111827', '--trail': 'rgba(17,24,39,0.35)',
      '--proj-bg': 'rgba(14,116,144,0.05)', '--muted-line': 'rgba(91,101,119,0.4)', 'color-scheme': 'light' } },
    { id: 'floresta', names: { pt: 'Floresta', en: 'Forest' }, swatch: ['#06120c', '#a3e635'], vars: {
      '--panel3': '#08170f', '--muted2': '#5f8a72', '--dim': '#2a5a3f', '--edge': '#7fa893', '--line3': '#3a7a56', '--txt2': '#cfe8da', '--bg': '#06120c', '--panel': '#0b1c13', '--panel2': '#10261a', '--border': '#1d4631', '--txt': '#e6f4ec', '--muted': '#7fa893',
      '--accent': '#a3e635', '--accent-rgb': '163,230,53', '--accent-ink': '#142000',
      '--avg': '#e2efe8', '--binance': '#f7c948', '--kraken': '#c084fc', '--coinbase': '#60a5fa', '--morningstar': '#22d3ee',
      '--green': '#4ade80', '--red': '#f87171', '--yellow': '#f7c948', '--green-ink': '#062010', '--yellow-ink': '#2a2205', '--green-soft': '#bbf7d0',
      '--forecast': '#fb923c', '--scenario': '#f472b6', '--badge-ink': '#04210f',
      '--btn': '#16301f', '--btn-hover': '#1d3d29', '--line2': '#2a5a3f', '--deep': '#040d08',
      '--pos-bg1': '#10301c', '--pos-bg2': '#0d261f', '--neg-bg': '#4a1f1f', '--neg-bd': '#8b3a3a', '--neg-bg2': '#221012',
      '--tag-buy-fg': '#93c5fd', '--tag-sell-fg': '#d8b4fe', '--shadow': 'rgba(0,0,0,.6)',
      '--grid': 'rgba(29,70,49,0.6)', '--now': 'rgba(230,244,236,0.5)', '--now-text': '#e6f4ec', '--trail': 'rgba(230,244,236,0.40)',
      '--proj-bg': 'rgba(163,230,53,0.035)', '--muted-line': 'rgba(127,168,147,0.4)', 'color-scheme': 'dark' } },
    { id: 'contraste', names: { pt: 'Alto contraste', en: 'High contrast' }, swatch: ['#000000', '#ffe600'], vars: {
      '--panel3': '#050505', '--muted2': '#b0b0b0', '--dim': '#6b6b6b', '--edge': '#cfcfcf', '--line3': '#9a9a9a', '--txt2': '#ffffff', '--bg': '#000000', '--panel': '#0a0a0a', '--panel2': '#151515', '--border': '#6b6b6b', '--txt': '#ffffff', '--muted': '#cfcfcf',
      '--accent': '#ffe600', '--accent-rgb': '255,230,0', '--accent-ink': '#000000',
      '--avg': '#ffffff', '--binance': '#ffa200', '--kraken': '#e08cff', '--coinbase': '#52a8ff', '--morningstar': '#00fff0',
      '--green': '#00ff85', '--red': '#ff5252', '--yellow': '#ffe600', '--green-ink': '#001a0b', '--yellow-ink': '#1a1600', '--green-soft': '#7dffc0',
      '--forecast': '#ff8a3d', '--scenario': '#ff7ac6', '--badge-ink': '#000000',
      '--btn': '#1f1f1f', '--btn-hover': '#333333', '--line2': '#8a8a8a', '--deep': '#000000',
      '--pos-bg1': '#00301a', '--pos-bg2': '#002a2a', '--neg-bg': '#5a0000', '--neg-bd': '#ff5252', '--neg-bg2': '#2a0000',
      '--tag-buy-fg': '#9cc9ff', '--tag-sell-fg': '#e6b3ff', '--shadow': 'rgba(0,0,0,.8)',
      '--grid': 'rgba(255,255,255,0.22)', '--now': 'rgba(255,255,255,0.75)', '--now-text': '#ffffff', '--trail': 'rgba(255,255,255,0.55)',
      '--proj-bg': 'rgba(255,230,0,0.05)', '--muted-line': 'rgba(207,207,207,0.5)', 'color-scheme': 'dark' } }
  ];
  var CANVAS = { avg: '--avg', binance: '--binance', kraken: '--kraken', coinbase: '--coinbase', morningstar: '--morningstar',
    grid: '--grid', axisText: '--muted', target: '--green', now: '--now', nowText: '--now-text', projBg: '--proj-bg',
    forecastRef: '--forecast', scenario: '--scenario', trail: '--trail', pos: '--green', neg: '--red',
    accentRgb: '--accent-rgb', mutedLine: '--muted-line' };
  var doc = document, root = doc.documentElement, cache = {}, current = 'noite', btn = null;

  function byId(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return null; }
  function lang() {
    var l = '';
    try { l = (window.I18N && (I18N.lang || I18N.idioma)) || root.lang || navigator.language || ''; } catch (e) {}
    return /^pt/i.test(l) ? 'pt' : 'en';
  }
  function nameOf(t) { return t.names[lang()] || t.names.en; }

  function injectCss() {
    var css = '';
    THEMES.forEach(function (t) {
      if (!t.vars) return;
      css += ':root[data-theme="' + t.id + '"]{';
      Object.keys(t.vars).forEach(function (k) { css += k + ':' + t.vars[k] + ';'; });
      css += '}\n';
    });
    css += '.topnav .theme-btn{width:26px;height:26px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;' +
           'background:var(--panel2);border:1px solid var(--border);cursor:pointer;flex:none;transition:border-color .15s,transform .15s}\n' +
           '.topnav .theme-btn:hover{border-color:var(--accent);transform:scale(1.08)}\n' +
           '.topnav .theme-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n' +
           '.theme-btn svg{width:18px;height:18px;display:block}\n';
    var s = doc.createElement('style'); s.id = 'gn-themes'; s.textContent = css; (doc.head || root).appendChild(s);
  }

  function refresh() {
    var cs = getComputedStyle(root);
    Object.keys(CANVAS).forEach(function (k) { cache[k] = cs.getPropertyValue(CANVAS[k]).trim(); });
  }

  function paintButton() {
    if (!btn) return;
    var t = byId(current), n = nameOf(t), pre = lang() === 'pt' ? 'Tema: ' : 'Theme: ', post = lang() === 'pt' ? ' — clique para trocar' : ' — click to change';
    btn.title = pre + n + post; btn.setAttribute('aria-label', pre + n);
    btn.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="' + t.swatch[0] + '" stroke="' + t.swatch[1] + '" stroke-width="1.2"/>' +
                    '<path d="M10 1.5a8.5 8.5 0 0 1 0 17z" fill="' + t.swatch[1] + '"/></svg>';
  }

  function apply(id, silent) {
    var t = byId(id) || THEMES[0]; current = t.id;
    if (t.id === 'noite') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t.id);
    refresh(); paintButton();
    if (!silent) { try { window.dispatchEvent(new CustomEvent('gn:theme', { detail: { id: t.id } })); } catch (e) {} }
  }
  function set(id) { apply(id); try { localStorage.setItem(KEY, current); } catch (e) {} }
  function next() { var i = 0; THEMES.forEach(function (t, k) { if (t.id === current) i = k; }); set(THEMES[(i + 1) % THEMES.length].id); }

  function mount() {
    var nav = doc.querySelector('.topnav'); if (!nav || btn) return;
    btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'theme-btn'; btn.id = 'themeBtn';
    btn.addEventListener('click', next); nav.appendChild(btn); paintButton();
  }

  var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (!saved || !byId(saved)) { try { saved = (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'claro' : 'noite'; } catch (e) { saved = 'noite'; } }
  injectCss(); apply(saved, true);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
  window.addEventListener('gn:lang', paintButton);

  window.GNTheme = {
    list: function () { return THEMES.map(function (t) { return { id: t.id, name: nameOf(t) }; }); },
    current: function () { return current; }, set: set, next: next,
    canvas: function (name) { if (!cache.avg) refresh(); var v = cache[name]; return v === '' ? undefined : v; }
  };
})();
