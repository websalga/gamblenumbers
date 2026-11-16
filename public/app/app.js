'use strict';
/* GambleNumbers — app (PWA). Arquivo NOVO em /app/. Só BTC.
 * Login: reaproveita identity.php (login_senha). Saque: /app/api.php + digital (WebAuthn). */

const APP = document.getElementById('app');
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
let SID = LS.get('gn_app_sid');
let timer = null;

/* ---------- utilidades ---------- */
const brl = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const btc = s => (s / 1e8).toFixed(8).replace('.', ',');
const mins = m => m == null ? '' : (m < 60 ? '~' + m + ' min' : '~' + Math.round(m / 6) / 10 + ' h');
const sat = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
/* "1.234,56" → 1234.56; "0,001" e "0.001" → 0.001 (com vírgula, o ponto é milhar) */
const numBR = s => { s = String(s == null ? '' : s).replace(/\s+/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); return parseFloat(s); };

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function fill(el, ...kids) { el.replaceChildren(...kids.flat().filter(k => k != null && k !== false)); }
function svg(d, extra) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p);
  return s;
}
const b64uToBuf = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
const bufToB64u = b => { const u = new Uint8Array(b); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

async function api(action, data) {
  const r = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, session_id: SID, ...(data || {}) }) });
  let j; try { j = await r.json(); } catch (e) { throw new Error('Resposta inválida do servidor.'); }
  if (!j.ok) {
    if (r.status === 404 && /sess/.test(j.error || '')) { sair(); }
    const e = new Error(j.error || 'Erro inesperado.'); e.codigo = j.codigo; e.dados = j; throw e;
  }
  return j;
}
function sair() { LS.del('gn_app_sid'); SID = null; location.hash = ''; render(); }
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

/* ---------- som da 1ª confirmação ----------
 * Os navegadores só tocam áudio depois de um toque do usuário: no primeiro toque o som é
 * carregado e "destravado" (play mudo + pause). Cada aviso toca uma vez só (chave no aparelho). */
const SOM = { audio: null };
function liberarSom() {
  if (SOM.audio) return;
  try {
    const a = new Audio('sounds/magic.mp3'); a.preload = 'auto'; a.muted = true; SOM.audio = a;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  } catch (e) {}
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, liberarSom, { capture: true }));
function aviso(texto) {
  const t = h('div', { role: 'status', style: 'position:fixed;left:16px;right:16px;bottom:84px;z-index:50;padding:14px 16px;border-radius:12px;background:var(--okbg);color:var(--ok);font-weight:600;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35)' }, texto);
  document.body.append(t); setTimeout(() => t.remove(), 6000);
}
function avisarConfirmacao(chave, texto) {
  const k = 'gn_app_conf1_' + chave;
  if (LS.get(k)) return;
  LS.set(k, '1');
  try { if (SOM.audio) { SOM.audio.currentTime = 0; SOM.audio.play().catch(() => {}); } } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
  aviso(texto);
}

/* ---------- estrutura comum ---------- */
const ICONS = {
  inicio: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  robos: 'M8 8h8a3 3 0 013 3v5a3 3 0 01-3 3H8a3 3 0 01-3-3v-5a3 3 0 013-3zM12 8V4M9 13h.01M15 13h.01M3 13v2M21 13v2',
  sacar: 'M12 19V5M5 12l7-7 7 7',
  trocar: 'M7 7h13l-4-4M17 17H4l4 4',
  pagar: 'M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M8 9h3v3H8zM13 13h3v3h-3zM13 9h3M8 15h3',
};
/* Versao do app: aparece pequena no topo. Se o servidor tiver uma mais nova (versao.json, sem cache), o selo avisa e atualiza ao tocar. */
const APP_VERSAO = '3.4';
let VERSAO_SERV = null;
function seloVersao() {
  const nova = VERSAO_SERV && VERSAO_SERV !== APP_VERSAO;
  return h('button', { type: 'button', class: 'versao' + (nova ? ' nova' : ''), 'aria-label': 'Versão do app ' + APP_VERSAO,
    onclick: () => { if (nova) atualizarApp(); } }, 'v' + APP_VERSAO + (nova ? ' · atualizar para ' + VERSAO_SERV : ''));
}
async function atualizarApp() {
  try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch (e) {}
  try { const r = await navigator.serviceWorker?.getRegistration(); if (r) await r.update(); } catch (e) {}
  location.reload();
}
fetch('versao.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).then(j => {
  VERSAO_SERV = String(j.versao || ''); document.querySelectorAll('.versao').forEach(e => e.replaceWith(seloVersao()));
}).catch(() => {});
function shell(ativo, ...conteudo) {
  stopTimer();
  APP.replaceChildren(
    h('main', { class: 'main' }, ...conteudo),
    h('nav', { class: 'nav', 'aria-label': 'Navegação principal' },
      ...[['inicio', 'Início'], ['robos', 'Robôs'], ['trocar', 'Trocar'], ['sacar', 'Sacar'], ['pagar', 'Pagar']].map(([id, nome]) =>
        h('a', { href: '#' + id, class: ativo === id ? 'on' : '' }, svg(ICONS[id]), nome))));
}
function carregando(msg) { return h('div', { class: 'mut spin', style: 'padding:24px 0;text-align:center' }, msg || 'Carregando…'); }

/* ---------- login ---------- */
function telaLogin() {
  stopTimer();
  const inp = h('input', { type: 'password', id: 'senha', autocomplete: 'current-password', 'aria-label': 'Senha' });
  const erro = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Entrar');
  async function entrar() {
    const senha = inp.value;
    if (!senha) { erro.textContent = 'Digite a senha da sua conta.'; return; }
    btn.disabled = true; erro.textContent = '';
    try {
      const r = await fetch('/identity.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login_senha', senha }) });
      const j = await r.json();
      if (!j.matched) { erro.textContent = j.bloqueado && j.error ? j.error : 'Senha inválida.'; btn.disabled = false; return; }
      SID = j.session_id; LS.set('gn_app_sid', SID); inp.value = '';
      location.hash = '#inicio'; render();
    } catch (e) { erro.textContent = 'Não foi possível conectar. Verifique a internet.'; btn.disabled = false; }
  }
  btn.addEventListener('click', entrar);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
  APP.replaceChildren(h('div', { class: 'login' },
    h('div', { class: 'col', style: 'gap:16px' },
      h('div', { class: 'logo' }, svg('M4 17l5-6 4 4 7-9M15 6h5v5')),
      h('div', {}, h('h1', { style: 'font-size:28px' }, 'GambleNumbers'),
        h('p', { class: 'mut', style: 'margin:6px 0 0;line-height:22px;font-size:15px' }, 'Entre com a senha da sua conta para ver saldo, robôs e enviar bitcoins.'))),
    h('div', { class: 'col', style: 'gap:16px' },
      h('label', { for: 'senha', style: 'font-size:14px;font-weight:500;color:var(--tx2)' }, 'Senha'), inp, erro, btn),
    h('div', { class: 'mut sm', style: 'text-align:center' }, 'A senha não fica guardada no aparelho. Primeiro acesso? Crie a conta pelo site.')));
}

/* ---------- início ---------- */
async function telaInicio() {
  const conteudo = h('div', { class: 'col', style: 'gap:14px' }, carregando());
  shell('inicio', h('div', { class: 'row' }, h('div', {}, h('div', { class: 'mut sm' }, 'Sua conta'), h('div', { style: 'font-size:20px;font-weight:600' }, 'Olá')),
    seloVersao(),
    h('button', { class: 'btn ghost sm', type: 'button', onclick: sair }, 'Sair')), conteudo);
  let range = '24h';
  try {
    const r = await api('resumo');
    const graf = h('div', {}); const chips = h('div', { class: 'chips' });
    const precoEl = h('div', { class: 'mono', style: 'font-size:22px;font-weight:500' }, brl(r.preco_brl));
    const varEl = h('div', { style: 'font-size:14px;font-weight:600' });
    async function desenhar() {
      chips.replaceChildren(...['1h', '24h', '7d', '30d'].map(k => h('button', { class: 'chip' + (k === range ? ' on' : ''), type: 'button', onclick: () => { range = k; desenhar(); } }, k.replace('h', ' h').replace('d', ' d'))));
      graf.replaceChildren(carregando('Carregando gráfico…'));
      try {
        const c = await api('cotacoes', { range });
        const pts = c.pontos;
        if (pts.length < 2) { graf.replaceChildren(h('div', { class: 'mut sm' }, 'Sem dados suficientes neste período.')); varEl.textContent = ''; return; }
        const W = 342, H = 150, ys = pts.map(p => p[1]), mn = Math.min(...ys), mx = Math.max(...ys), sp = (mx - mn) || 1;
        const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
        const xy = pts.map(p => [((p[0] - t0) / (t1 - t0 || 1)) * W, H - 8 - ((p[1] - mn) / sp) * (H - 24)]);
        const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        const NS = 'http://www.w3.org/2000/svg';
        const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', `0 0 ${W} ${H}`); s.setAttribute('width', '100%'); s.setAttribute('role', 'img');
        s.setAttribute('aria-label', 'Gráfico da cotação do bitcoin no período');
        const area = document.createElementNS(NS, 'path'); area.setAttribute('d', d + ` L${W},${H} L0,${H} Z`); area.setAttribute('fill', '#F5A524'); area.setAttribute('fill-opacity', '0.15');
        const ln = document.createElementNS(NS, 'path'); ln.setAttribute('d', d); ln.setAttribute('fill', 'none'); ln.setAttribute('stroke', '#F5A524'); ln.setAttribute('stroke-width', '2.2'); ln.setAttribute('stroke-linejoin', 'round');
        s.append(area, ln); graf.replaceChildren(s);
        if (c.variacao_pct != null) { varEl.textContent = (c.variacao_pct >= 0 ? '▲ ' : '▼ ') + Math.abs(c.variacao_pct).toFixed(2).replace('.', ',') + '% em ' + range.replace('h', ' h').replace('d', ' d'); varEl.style.color = c.variacao_pct >= 0 ? 'var(--ok)' : 'var(--bad)'; }
      } catch (e) { graf.replaceChildren(h('div', { class: 'err' }, e.message)); }
    }
    conteudo.replaceChildren(
      h('div', { class: 'card', style: 'padding:20px;gap:6px' },
        h('div', { class: 'mut sm' }, 'Saldo em bitcoin'),
        h('div', { class: 'big' }, btc(r.saldo_sats) + ' ', h('span', { style: 'font-size:16px;color:var(--acc)' }, 'BTC')),
        h('div', { style: 'font-size:15px;color:var(--tx2)' }, '≈ ' + brl(r.saldo_brl)),
        r.pendente_sats > 0 ? h('div', { class: 'mut sm' }, 'Pendente: ' + btc(r.pendente_sats) + ' BTC (aguardando confirmação)') : null,
        (r.bch_sats > 0 || r.bch_pendente_sats > 0) ? h('div', { class: 'row', style: 'margin-top:8px;padding-top:10px;border-top:1px solid var(--line)' },
          h('span', { class: 'mut sm' }, 'Bitcoin Cash'), h('span', { class: 'mono' }, btc(r.bch_sats) + ' BCH' + (r.bch_brl > 0 ? ' · ≈ ' + brl(r.bch_brl) : ''))) : null,
        r.bch_pendente_sats > 0 ? h('div', { class: 'mut sm' }, 'Pendente: ' + btc(r.bch_pendente_sats) + ' BCH (aguardando confirmação)') : null,
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('a', { class: 'btn', style: 'flex:1', href: '#sacar' }, 'Sacar bitcoin'),
          h('button', { class: 'btn ghost', style: 'flex:1', type: 'button', onclick: telaInicio }, 'Atualizar saldo'))),
      h('div', { class: 'card' },
        h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', {}, h('div', { class: 'mut sm' }, 'BTC · cotação média'), precoEl), varEl), graf, chips),
      h('div', { class: 'row' },
        h('div', { class: 'card', style: 'flex:1;padding:14px;gap:2px' }, h('div', { class: 'mut xs' }, 'Robôs ativos'), h('div', { style: 'font-size:22px;font-weight:600' }, r.robos_ativos, h('span', { class: 'mut', style: 'font-size:14px;font-weight:400' }, ' de ' + r.robos_total))),
        h('div', { class: 'card', style: 'flex:1;padding:14px;gap:2px' }, h('div', { class: 'mut xs' }, 'Lotes abertos'), h('div', { style: 'font-size:22px;font-weight:600' }, r.lotes_abertos))));
    desenhar();
    // Depósito aguardando confirmação: consulta a cada 15 s (também em segundo plano) e avisa quando confirmar.
    if (r.pendente_sats > 0) {
      timer = setInterval(async () => {
        try {
          const n = await api('resumo');
          if (n.pendente_sats < r.pendente_sats && n.saldo_sats > r.saldo_sats) { avisarConfirmacao('dep_' + n.saldo_sats, 'Depósito confirmado na rede'); telaInicio(); }
          else if (n.pendente_sats !== r.pendente_sats || n.saldo_sats !== r.saldo_sats) telaInicio();
        } catch (e) {}
      }, 15000);
    }
  } catch (e) { conteudo.replaceChildren(h('div', { class: 'err' }, e.message)); }
}

/* ---------- robôs ---------- */
async function telaRobos() {
  const lista = h('div', { class: 'col', style: 'gap:14px' }, carregando());
  async function pausarTodos() {
    if (!confirm('Pausar todos os robôs?')) return;
    try {
      const r = await fetch('/robos_pause_all.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: SID }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) alert('Não foi possível pausar os robôs. Tente de novo.');
    } catch (e) { alert('Sem conexão. Os robôs não foram pausados.'); }
    telaRobos();
  }
  shell('robos', h('div', { class: 'row' }, h('h1', {}, 'Robôs'), h('button', { class: 'btn ghost sm', type: 'button', onclick: pausarTodos }, 'Pausar todos')), lista);
  try {
    const r = await api('robos');
    if (!r.robos.length) { lista.replaceChildren(h('div', { class: 'mut' }, 'Nenhum robô configurado. Crie robôs pelo site.')); return; }
    lista.replaceChildren(...r.robos.map(b => {
      const t = pct => pct.toFixed(2).replace('.', ',') + '%';
      return h('div', { class: 'card' },
        h('div', { class: 'row' }, h('div', { style: 'font-size:17px;font-weight:600' }, b.apelido), h('span', { class: 'pill ' + (b.ativo ? 'ok' : 'off') }, b.ativo ? 'ATIVO' : 'PAUSADO')),
        h('div', { class: 'row', style: 'align-items:flex-start' },
          ...[['Compra', t(b.compra_pct)], ['Venda', t(b.venda_pct)], ['Lotes', String(b.lotes)]].map(([k, v]) =>
            h('div', { style: 'flex:1' }, h('div', { class: 'mut xs' }, k), h('div', { style: 'font-size:15px;font-weight:500;margin-top:2px' }, v)))),
        b.decisao ? h('div', { class: 'sm', style: 'padding:10px 12px;border-radius:10px;background:var(--bg2);color:#A9B4CF;line-height:19px' }, 'Última decisão: ' + b.decisao) : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: async ev => {
          ev.target.disabled = true;
          try { await api('robo_alternar', { robo_id: b.id, ativo: !b.ativo }); } catch (e) { alert(e.message); }
          telaRobos();
        } }, b.ativo ? 'Pausar' : 'Ativar'));
    }));
  } catch (e) { lista.replaceChildren(h('div', { class: 'err' }, e.message)); }
}

/* ---------- sacar ---------- */
function telaSacar() {
  const S = { tipo: 'brl', valor: '', nivel: 'min', taxa: 1, cot: null, passkeys: 0, ocupado: false, seq: 0 };
  const inp = h('input', { id: 'valor', type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off', 'aria-label': 'Valor do saque' });
  const cur = h('span', { class: 'cur' }, 'R$');
  const eq = h('div', { class: 'mut sm' }, ' ');
  const disp = h('span', { class: 'mut sm' }, '');
  const segBrl = h('button', { type: 'button', class: 'on' }, 'R$'), segBtc = h('button', { type: 'button' }, 'BTC');
  const feesBox = h('div', { class: 'col' }), tipBox = h('div'), totalEl = h('span', { class: 'mono', style: 'font-size:17px;font-weight:600;color:var(--acc)' }, '—');
  const destEl = h('div', { class: 'mono', style: 'font-size:14px' }, '—');
  const erro = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'button', disabled: true }, 'Confirmar com a digital');
  const recentes = h('div', { class: 'col' });
  const slider = h('input', { type: 'range', min: 0.1, max: 50, step: 0.1, value: 1, 'aria-label': 'Taxa personalizada em sat/vB' });
  const sliderVal = h('span', { class: 'mono' }, '');
  const sliderMin = h('span', {}, ''), sliderMax = h('span', {}, '');
  const sliderTempo = h('div', { class: 'mut xs', style: 'padding-top:2px' }, '');

  function tipoSet(t) { S.tipo = t; segBrl.className = t === 'brl' ? 'on' : ''; segBtc.className = t === 'btc' ? 'on' : ''; cur.textContent = t === 'brl' ? 'R$' : 'BTC'; cotar(); }
  segBrl.addEventListener('click', () => tipoSet('brl')); segBtc.addEventListener('click', () => tipoSet('btc'));
  const maxBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.tipo = 'max'; inp.value = ''; inp.placeholder = 'Tudo (saldo menos a taxa)'; cotar(); } }, 'Tudo');
  let deb = null;
  inp.addEventListener('input', () => { if (S.tipo === 'max') S.tipo = segBtc.className === 'on' ? 'btc' : 'brl'; S.valor = inp.value; clearTimeout(deb); deb = setTimeout(cotar, 450); });

  function pedido() { const p = { tipo: S.tipo, valor: S.valor, nivel: S.nivel }; if (S.nivel === 'custom') p.taxa = S.taxa; return p; }
  // Tempo medido nas últimas 24 h (média · 90%); sem dados suficientes, usa a previsão pelos blocos do mempool.
  function tempoTxt(n) { return n.medido ? mins(n.medido.media_min) : mins(n.eta_min); }
  function lento(n) { return n.medido ? n.medido.p90_min > 60 : n.blocos > 2; }
  function nivelNome(id) { return { min: 'Econômica', normal: 'Normal', rapida: 'Rápida', custom: 'Personalizada' }[id]; }

  function desenharTaxas() {
    const c = S.cot; if (!c) return;
    feesBox.replaceChildren(
      h('div', { class: 'row' }, h('span', { style: 'font-size:14px;font-weight:500;color:var(--tx2)' }, 'Velocidade do envio'),
        h('span', { class: 'mut xs' }, 'taxa mín. ' + sat(c.faixa.min) + ' · máx. ' + c.faixa.max + ' sat/vB')),
      h('div', { class: 'fees' }, ...c.niveis.filter(n => n.id !== 'custom').map(n => h('button', { type: 'button', class: 'fee' + (S.nivel === n.id ? ' on' : ''),
        onclick: () => { S.nivel = n.id; S.taxa = n.taxa_satvb; slider.value = n.taxa_satvb; desenharTaxas(); resumoTotal(); } },
        h('span', { class: 't' }, nivelNome(n.id)), h('span', { class: 'v' }, brl(n.fee_brl)), h('span', { class: 's' }, sat(n.taxa_satvb) + ' sat/vB'),
        h('span', { class: 'e' + (lento(n) ? ' slow' : '') }, tempoTxt(n)),
        n.medido ? h('span', { class: 'p' }, '90% até ' + mins(n.medido.p90_min)) : null))),
      h('div', { class: 'card', style: 'padding:8px 12px 6px;gap:2px;border-radius:12px' },
        h('div', { class: 'row mut xs' }, h('span', {}, 'Personalizada'), sliderVal),
        slider, h('div', { class: 'row mut', style: 'font-size:11px' }, sliderMin, sliderMax), sliderTempo));
    const cu = S.nivel === 'custom' ? c.niveis.find(n => n.id === 'custom') : null;
    sliderTempo.className = 'mut xs' + (cu && lento(cu) ? ' slow' : '');
    sliderTempo.textContent = !cu ? 'Mova para escolher a taxa e ver o tempo de espera.'
      : cu.medido ? 'Tempo medido nas últimas 24 h: ' + mins(cu.medido.media_min) + ' em média · 90% em até ' + mins(cu.medido.p90_min)
      : 'Previsão: ' + mins(cu.eta_min) + ' (poucos dados medidos para esta taxa)';
    sliderMin.textContent = sat(c.faixa.min) + ' sat/vB'; sliderMax.textContent = c.faixa.max + ' sat/vB';
    slider.min = Math.ceil(c.faixa.min * 10) / 10; slider.max = c.faixa.max;
    sliderVal.textContent = (S.nivel === 'custom' ? sat(S.taxa) : '—') + ' sat/vB';
    fill(tipBox, c.dica && c.dica.economia_pct ? h('div', { class: 'tip' }, 'Dica: a carteira de saque usa endereço de formato antigo. Um endereço SegWit nativo (bc1q) reduziria a taxa em cerca de ' + c.dica.economia_pct + '%.') : null);
  }
  slider.addEventListener('input', () => { S.nivel = 'custom'; S.taxa = Number(slider.value); sliderVal.textContent = sat(S.taxa) + ' sat/vB'; clearTimeout(deb); deb = setTimeout(cotar, 350); });

  function atual() { const c = S.cot; return c ? (c.niveis.find(n => n.id === S.nivel) || c.niveis[0]) : null; }
  function resumoTotal() {
    const n = atual(), c = S.cot;
    if (!n) { totalEl.textContent = '—'; btn.disabled = true; return; }
    totalEl.textContent = brl(n.debitado_brl);
    eq.textContent = '≈ ' + (S.tipo === 'btc' ? brl(n.recebido_sats / 1e8 * c.preco_brl) : btc(n.recebido_sats) + ' BTC') + ' chegam ao destino · taxa ' + brl(n.fee_brl);
    btn.disabled = S.ocupado;
  }
  async function cotar() {
    erro.textContent = '';
    if (S.tipo !== 'max' && !(numBR(S.valor) > 0)) { eq.textContent = ' '; btn.disabled = true; if (!S.cot) await cotarBase(); return; }
    await cotarBase();
  }
  async function cotarBase() {
    const mySeq = ++S.seq;
    try {
      const p = pedido(); if (S.tipo !== 'max' && !(numBR(S.valor) > 0)) { p.tipo = 'brl'; p.valor = '10'; }
      const c = await api('saque_cotar', p);
      if (mySeq !== S.seq) return;
      S.cot = c; destEl.textContent = c.destino; disp.textContent = 'Disponível: ' + brl(c.saldo_sats / 1e8 * c.preco_brl);
      desenharTaxas();
      if (S.tipo === 'max' || numBR(S.valor) > 0) resumoTotal();
    } catch (e) {
      if (mySeq !== S.seq) return;
      btn.disabled = true;
      erro.textContent = e.codigo === 'sem_destino' ? 'Configure no site o endereço Bitcoin de destino (conta → saída) para poder sacar.' : e.message;
    }
  }

  async function confirmar() {
    erro.textContent = ''; S.ocupado = true; btn.disabled = true;
    try {
      const r = await api('resumo'); S.passkeys = r.passkeys;
      if (!S.passkeys) { const ok = await cadastrarDigital(); if (!ok) { S.ocupado = false; btn.disabled = false; return; } }
      const d = await api('saque_desafio', pedido());
      abrirConfirmacao(d);
    } catch (e) { erro.textContent = e.message; }
    S.ocupado = false; resumoTotal();
  }
  btn.addEventListener('click', confirmar);

  function abrirConfirmacao(d) {
    const rs = d.resumo;
    const msg = h('div', { class: 'err' });
    const usar = h('button', { class: 'btn', type: 'button' }, 'Usar a digital');
    const fechar = () => modal.remove();
    usar.addEventListener('click', async () => {
      usar.disabled = true; msg.textContent = '';
      try {
        const cred = await navigator.credentials.get({ publicKey: { challenge: b64uToBuf(d.challenge), rpId: d.rpId, timeout: 60000, userVerification: 'required',
          allowCredentials: d.allowCredentials.map(c => ({ type: 'public-key', id: b64uToBuf(c.id) })) } });
        const a = cred.response;
        const r = await api('saque_confirmar', { challenge: d.challenge, assertion: { id: cred.id, clientDataJSON: bufToB64u(a.clientDataJSON), authenticatorData: bufToB64u(a.authenticatorData), signature: bufToB64u(a.signature) } });
        fechar(); location.hash = '#saque/' + r.txid;
      } catch (e) { msg.textContent = e.name === 'NotAllowedError' ? 'Confirmação cancelada ou expirada.' : e.message; usar.disabled = false; }
    });
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Confirmar saque' },
      h('div', { class: 'sheet' },
        h('h1', {}, 'Confirmar saque'),
        h('div', { class: 'sum' }, h('span', { class: 'mut' }, 'Destino'), h('b', {}, rs.destino)),
        h('div', { class: 'sum' }, h('span', { class: 'mut' }, 'Chega ao destino'), h('b', {}, btc(rs.recebido_sats) + ' BTC')),
        h('div', { class: 'sum' }, h('span', { class: 'mut' }, 'Taxa de rede (' + sat(rs.taxa_satvb) + ' sat/vB)'), h('b', {}, brl(rs.fee_brl))),
        h('div', { class: 'sum', style: 'font-size:16px;font-weight:600' }, h('span', {}, 'Total debitado'), h('b', { style: 'color:var(--acc)' }, brl(rs.debitado_brl))),
        h('div', { class: 'mut xs' }, 'O envio na rede Bitcoin não pode ser desfeito.'), msg, usar,
        h('button', { class: 'btn ghost', type: 'button', onclick: fechar }, 'Cancelar')));
    document.body.append(modal);
  }

  shell('sacar',
    h('h1', {}, 'Sacar bitcoin'),
    h('div', { class: 'col', style: 'gap:6px' },
      h('div', { class: 'row' }, h('label', { for: 'valor', style: 'font-size:14px;font-weight:500;color:var(--tx2);white-space:nowrap' }, 'Valor do saque'), disp),
      h('div', { class: 'amount' }, cur, inp, h('div', { class: 'seg' }, segBrl, segBtc)),
      h('div', { class: 'row' }, eq, maxBtn)),
    h('div', { class: 'card', style: 'padding:10px 14px;gap:2px;border-radius:12px' }, h('div', { class: 'mut xs' }, 'Destino (configurado na sua conta)'), destEl),
    feesBox, tipBox,
    h('div', { class: 'row', style: 'padding:0 2px' }, h('span', { class: 'mut', style: 'font-size:14px' }, 'Total debitado (valor + taxa)'), totalEl),
    erro, btn,
    h('div', { class: 'mut xs', style: 'text-align:center' }, 'O envio na rede Bitcoin não pode ser desfeito.'),
    h('h2', { style: 'font-size:16px;margin:10px 0 0' }, 'Saques recentes'), recentes);
  cotarBase();
  api('saques_lista').then(r => {
    recentes.replaceChildren(...(r.saques.length ? r.saques.map(s => h('a', { href: '#saque/' + s.txid, class: 'card', style: 'text-decoration:none;color:inherit;padding:12px;gap:2px' },
      h('div', { class: 'row' }, h('span', { class: 'mono' }, btc(s.valor_sats) + ' BTC'), h('span', { class: 'pill ' + (s.confirmacoes > 0 ? 'ok' : 'off') }, s.confirmacoes > 0 ? s.confirmacoes + ' conf.' : 'pendente')),
      h('div', { class: 'mut xs' }, s.destino + ' · ' + new Date(s.criado_em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')))) : [h('div', { class: 'mut sm' }, 'Nenhum saque ainda.')]));
  }).catch(() => {});
}

/* ---------- cadastro da digital (passkey) ---------- */
function nomeAparelho() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  return (navigator.userAgentData && navigator.userAgentData.platform) || 'Meu celular';
}
function cadastrarDigital() {
  return new Promise(resolve => {
    if (!window.PublicKeyCredential) { alert('Este navegador não suporta digital/biometria para confirmar saques.'); resolve(false); return; }
    const senha = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Senha da conta' });
    /* com a verificação em 2 etapas ativa, o servidor pede também o código do app autenticador */
    const codigo = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '11', placeholder: 'Código do app autenticador', 'aria-label': 'Código do app autenticador', style: 'display:none' });
    const msg = h('div', { class: 'err', role: 'alert' });
    const ok = h('button', { class: 'btn', type: 'button' }, 'Continuar');
    const fechar = v => { modal.remove(); resolve(v); };
    let pk = null, chStr = '';
    const recomecar = () => { pk = null; senha.disabled = false; codigo.disabled = false; ok.textContent = 'Continuar'; };
    ok.addEventListener('click', async () => {
      ok.disabled = true; msg.textContent = '';
      try {
        if (!pk) {
          /* 1º toque confere a senha; a digital abre só no 2º toque, porque o Safari do iPhone
           * exige que navigator.credentials.create() venha direto de um toque do usuário. */
          let o;
          try { o = await api('passkey_reg_opcoes', { senha: senha.value, codigo_2fa: codigo.value.trim() }); }
          catch (e) {
            if (e.codigo === 'precisa_codigo_2fa') {
              codigo.style.display = ''; codigo.focus();
              msg.textContent = codigo.value ? e.message : 'Digite também o código de 6 dígitos do seu app autenticador.';
              codigo.value = ''; ok.disabled = false; return;
            }
            throw e;
          }
          pk = o.publicKey; chStr = pk.challenge;
          pk.challenge = b64uToBuf(pk.challenge); pk.user.id = b64uToBuf(pk.user.id);
          pk.excludeCredentials = (pk.excludeCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) }));
          senha.value = ''; senha.disabled = true; codigo.value = ''; codigo.disabled = true; ok.textContent = 'Usar a digital'; ok.disabled = false;
          msg.textContent = '';
          return;
        }
        const cred = await navigator.credentials.create({ publicKey: pk });
        await api('passkey_reg_verificar', { challenge: chStr, clientDataJSON: bufToB64u(cred.response.clientDataJSON), attestationObject: bufToB64u(cred.response.attestationObject), apelido: nomeAparelho() });
        fechar(true);
      } catch (e) {
        if (e.name === 'NotAllowedError') msg.textContent = 'Cadastro cancelado. Toque em "Usar a digital" para tentar de novo.';
        else { msg.textContent = e.message; if (pk) recomecar(); }
        ok.disabled = false;
      }
    });
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cadastrar digital' },
      h('div', { class: 'sheet' }, h('h1', {}, 'Cadastrar a digital deste aparelho'),
        h('div', { class: 'mut sm', style: 'line-height:20px' }, 'Para proteger seus saques, vamos vincular a digital (ou o desbloqueio) deste celular à sua conta. Confirme com a senha da conta. Por segurança, os saques pelo app ficam liberados 24 h depois de cadastrar uma digital nova.'),
        senha, codigo, msg, ok, h('button', { class: 'btn ghost', type: 'button', onclick: () => fechar(false) }, 'Agora não')));
    document.body.append(modal);
  });
}

/* ---------- acompanhamento do saque ---------- */
function telaSaque(txid) {
  const corpo = h('div', { class: 'col', style: 'gap:14px' }, carregando('Carregando…'));
  shell('sacar', corpo);
  let confAnterior = null, ritmo = 0;
  // Esperando a 1ª confirmação: a cada 15 s, também em segundo plano. Depois: a cada 60 s, só com a tela visível.
  function ajustarRitmo(esperando) {
    const ms = esperando ? 15000 : 60000;
    if (ms === ritmo && timer) return;
    ritmo = ms; stopTimer();
    timer = setInterval(() => { if (esperando || !document.hidden) atualizar(); }, ms);
  }
  async function atualizar() {
    try {
      const s = await api('saque_status', { txid });
      if (confAnterior === 0 && s.confirmacoes >= 1) avisarConfirmacao(txid, '1ª confirmação recebida');
      confAnterior = s.confirmacoes;
      const feito = s.estado === 'concluido';
      const passos = [];
      const passo = (ok, agora, texto, extra) => h('div', { class: 'step' + (ok || agora ? '' : ' todo') },
        h('span', { class: 'dot' + (ok ? ' ok' : agora ? ' now' : '') }, ok ? '✓' : ''), texto, extra ? h('span', { class: 'mut xs mono' }, extra) : null);
      passos.push(passo(true, false, 'Transmitido para a rede'));
      passos.push(passo(s.visto_no_destino, !s.visto_no_destino, 'Valor visto no destino', s.visto_no_destino ? s.destino : ''));
      for (let i = 1; i <= s.alvo; i++) {
        const ok = s.confirmacoes >= i, agora = s.confirmacoes === i - 1 && s.estado !== 'substituida' && (i > 1 || s.visto_no_destino);
        const prev = ok ? (i === 1 && s.bloco ? 'bloco ' + s.bloco : '') : (agora ? 'previsão ' + mins(i === s.confirmacoes + 1 ? s.eta_proxima_min : (s.eta_alvo_min != null ? s.eta_alvo_min - (s.alvo - i) * 10 : null)) : '');
        passos.push(passo(ok, agora, i + 'ª confirmação', prev));
      }
      const barra = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': s.alvo, 'aria-valuenow': Math.min(s.confirmacoes, s.alvo), 'aria-label': 'Confirmações na rede Bitcoin' },
        ...Array.from({ length: s.alvo }, (_, i) => h('i', { class: s.confirmacoes > i ? 'on' : '' })));
      const brlVal = s.preco_brl ? ' · ' + brl(s.recebido_sats / 1e8 * s.preco_brl) : '';
      fill(corpo, 
        h('div', { class: 'col', style: 'align-items:center;text-align:center;gap:10px;padding-top:4px' },
          h('div', { style: 'width:64px;height:64px;border-radius:50%;background:var(--okbg);color:var(--ok);display:flex;align-items:center;justify-content:center;font-size:32px' }, feito ? '✓' : '↗'),
          h('h1', {}, feito ? 'Saque concluído' : 'Saque enviado'),
          h('div', { class: 'mut sm' }, btc(s.recebido_sats) + ' BTC' + brlVal + (s.fee_sats != null ? ' · taxa ' + btc(s.fee_sats) + ' BTC (' + sat(s.taxa_satvb) + ' sat/vB)' : ''))),
        s.estado === 'substituida' ? h('div', { class: 'warn' }, 'Esta transação foi substituída ou descartada pela rede. Confira o saldo e o histórico antes de tentar de novo.') : null,
        !s.sync_ok && !feito ? h('div', { class: 'warn' }, 'O acompanhamento está atrasado no servidor. O saque continua válido na rede; o número abaixo pode estar desatualizado.') : null,
        s.estado === 'desconhecida' ? h('div', { class: 'warn' }, 'Não foi possível consultar a transação agora. Tente novamente em instantes.') : null,
        h('div', { class: 'card', style: 'gap:14px' },
          h('div', { class: 'row' }, h('span', { style: 'font-size:15px;font-weight:600' }, 'Confirmações'), h('span', { class: 'mono', style: 'font-size:15px;color:var(--ok)' }, (s.confirmacoes < s.alvo ? s.confirmacoes + ' de ' + s.alvo : s.confirmacoes.toLocaleString('pt-BR')))),
          barra, h('div', { class: 'steps' }, ...passos),
          !feito && s.eta_alvo_min != null ? h('div', { class: 'mut xs' }, 'Previsão para a ' + s.alvo + 'ª confirmação: ' + mins(s.eta_alvo_min) + '. O tempo de cada bloco varia; é uma estimativa.') : null),
        h('div', { class: 'card' }, h('div', { class: 'mut sm' }, 'TXID da transação'),
          h('div', { class: 'mono', style: 'font-size:13px;line-height:20px;word-break:break-all' }, s.txid),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', style: 'flex:1', type: 'button', onclick: async ev => { try { await navigator.clipboard.writeText(s.txid); ev.target.textContent = 'Copiado!'; } catch (e) { ev.target.textContent = 'Copie manualmente'; } } }, 'Copiar TXID'),
            h('a', { class: 'btn ghost', style: 'flex:1', href: s.explorer, target: '_blank', rel: 'noopener noreferrer' }, 'Ver no explorador'))),
        !feito && s.atualizado_ha_seg != null ? h('div', { class: 'mut xs', style: 'text-align:center' }, 'Atualizado ' + (s.atualizado_ha_seg < 90 ? 'agora há pouco' : 'há ' + Math.round(s.atualizado_ha_seg / 60) + ' min') + (s.confirmacoes < 1 ? ' · verificando a cada 15 s' : ' · a rede é checada a cada 5 min')) : null,
        h('a', { class: 'btn', href: '#inicio' }, 'Voltar ao início'));
      if (feito || s.estado === 'substituida') stopTimer(); else ajustarRitmo(s.confirmacoes < 1);
    } catch (e) { fill(corpo, h('div', { class: 'err' }, e.message), h('a', { class: 'btn ghost', href: '#sacar' }, 'Voltar')); stopTimer(); }
  }
  atualizar(); ajustarRitmo(true);
}


/* ================= TROCAS: vender BTC → USDC/USDT e comprar BTC/BCH com USDC/USDT (THORChain) ================= */
const usd = n => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const pct = n => (Math.round(n * 10) / 10).toString().replace('.', ',') + '%';
// Ampulheta animada (desenho proprio em SVG; vira a cada 1,6 s) para trocas em andamento
function ampulheta() {
  const e = document.createElement('span'); e.className = 'ampulheta'; e.setAttribute('aria-hidden', 'true');
  e.innerHTML = '<svg viewBox="0 0 12 16" width="11" height="14"><path d="M1.5 1h9M1.5 15h9M2.5 1c0 4 3.5 5 3.5 7s-3.5 3-3.5 7M9.5 1c0 4-3.5 5-3.5 7s3.5 3 3.5 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4.2 4.2h3.6L6 7z" fill="currentColor"/><path class="areia" d="M3.8 14.2h4.4L6 11.6z" fill="currentColor"/></svg>';
  return e;
}
let SUG = null;   // sugestao dos robos em aprovacao: { id, valor } (valor em R$)
const SWAP_FINAIS = ['concluido', 'reembolsado', 'erro', 'cancelado', 'expirado'];
function situacaoPill(s) { const ok = s.status === 'concluido'; const ruim = ['erro', 'cancelado', 'expirado', 'reembolsado'].includes(s.status);
  if (!SWAP_FINAIS.includes(s.status)) return h('span', { class: 'pill wait' }, ampulheta(), s.situacao);
  return h('span', { class: 'pill ' + (ok ? 'ok' : 'off'), style: ruim ? 'color:var(--bad)' : '' }, s.situacao); }
// Quantidade de um ativo com as casas certas (BTC/BCH 8, ETH ate 6, dolar digital 2)
function qtdAtivo(v, a) { return (a === 'BTC' || a === 'BCH' ? btc(Math.round(v * 1e8)) : a === 'ETH' ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : usd(v)) + ' ' + a; }
function mmss(seg) { seg = Math.max(0, Math.round(seg)); const h2 = Math.floor(seg / 3600), m = Math.floor(seg % 3600 / 60), x = seg % 60;
  return (h2 ? String(h2).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); }
function listaTrocas(box) {
  api('swaps_lista').then(r => {
    box.replaceChildren(...(r.swaps.length ? r.swaps.map(s => h('a', { href: '#troca/' + s.id, class: 'card', style: 'text-decoration:none;color:inherit;padding:12px;gap:2px' },
      h('div', { class: 'row' }, h('span', { class: 'mono' }, qtdAtivo(s.valor, s.de) + ' → ' + (s.para === 'SAIDA' ? 'saída' : s.para)), situacaoPill(s)),
      h('div', { class: 'mut xs' }, new Date(String(s.criado_em).replace(' ', 'T') + 'Z').toLocaleString('pt-BR')))) : [h('div', { class: 'mut sm' }, 'Nenhuma troca ainda.')]));
  }).catch(() => {});
}

const SUG_ROTULO = { pendente: 'aguardando você', aprovada: 'aprovada', ignorada: 'ignorada', expirada: 'expirada' };
function restoSug(expira) { const m = Math.round((new Date(String(expira).replace(' ', 'T') + 'Z') - Date.now()) / 60000);
  return m <= 0 ? 'expirando' : m < 60 ? 'expira em ' + m + ' min' : 'expira em ' + (Math.round(m / 6) / 10) + ' h'; }
function listaSugestoes(box) {
  api('sugestoes_lista').then(r => {
    const pend = r.sugestoes.filter(x => x.status === 'pendente'), hist = r.sugestoes.filter(x => x.status !== 'pendente');
    box.replaceChildren(
      ...pend.map(x => h('div', { class: 'card', style: 'gap:8px;border-color:var(--acc)' },
        h('div', { class: 'row' }, h('b', {}, '🤖 Sugestão dos robôs'), h('span', { class: 'pill wait' }, ampulheta(), 'aguardando você')),
        h('div', { class: 'sm' }, 'Os robôs (' + (x.robos || '—') + ') realizaram ', h('b', {}, brl(x.lucro_brl)), ' de lucro em ' + x.n_vendas + ' venda' + (x.n_vendas === 1 ? '' : 's') + '. Quer travar esse lucro em dólar digital (USDC)?'),
        h('div', { class: 'mut xs' }, 'Converter ' + brl(x.valor_brl) + ' · ' + restoSug(x.expira_em) + ' · a cotação e o custo aparecem na próxima tela'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', style: 'flex:1;height:44px;font-size:15px', type: 'button', onclick: () => { SUG = { id: x.id, valor: x.valor_brl }; location.hash = '#vender'; } }, 'Ver cotação e aprovar'),
          h('button', { class: 'btn ghost', style: 'flex:1;height:44px;font-size:15px', type: 'button', onclick: async e => { e.target.disabled = true; try { await api('sugestao_ignorar', { id: x.id }); } catch (er) {} listaSugestoes(box); } }, 'Ignorar')))),
      hist.length ? h('details', { class: 'mut sm' }, h('summary', {}, 'Histórico de sugestões (' + hist.length + ')'),
        ...hist.map(x => h('div', { class: 'row xs', style: 'padding:4px 0' },
          h('span', {}, new Date(String(x.criado_em).replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR') + ' · ' + brl(x.valor_brl)),
          x.swap_id ? h('a', { href: '#troca/' + x.swap_id, style: 'color:var(--acc)' }, SUG_ROTULO[x.status]) : h('span', {}, SUG_ROTULO[x.status])))) : null);
  }).catch(() => {});
}

async function telaTrocar() {
  const saldos = h('div', { class: 'card', style: 'gap:6px' }, carregando());
  const lista = h('div', { class: 'col' });
  const sugestoes = h('div', { class: 'col' });
  shell('trocar',
    h('h1', {}, 'Trocar'),
    sugestoes,
    h('div', { class: 'mut sm' }, 'Proteja seus ganhos em dólar digital (USDC) ou volte para o bitcoin quando quiser. As trocas são feitas pela THORChain, sem cadastro.'),
    saldos,
    h('a', { class: 'btn', href: '#vender' }, 'Vender BTC/BCH  →  USDC'),
    h('a', { class: 'btn ghost', href: '#comprar', style: 'height:50px;font-size:16px' }, 'Comprar BTC/BCH com USDC'),
    h('a', { class: 'btn ghost', href: '#sacareth', style: 'height:50px;font-size:16px' }, 'Sacar ETH  →  carteira de saída'),
    h('h2', { style: 'font-size:16px;margin:10px 0 0' }, 'Minhas trocas'), lista);
  try {
    const s = await api('swap_saldos');
    fill(saldos,
      h('div', { class: 'row' }, h('span', { class: 'mut sm' }, 'Bitcoin'), h('span', { class: 'mono' }, btc(s.btc_sats) + ' BTC')),
      h('div', { class: 'row' }, h('span', { class: 'mut sm' }, 'USDC (dólar digital)'), h('span', { class: 'mono' }, usd(s.usdc) + ' USDC')),
      s.usdt > 0 ? h('div', { class: 'row' }, h('span', { class: 'mut sm' }, 'USDT'), h('span', { class: 'mono' }, usd(s.usdt) + ' USDT')) : null,
      s.bch_sats > 0 ? h('div', { class: 'row' }, h('span', { class: 'mut sm' }, 'Bitcoin Cash'), h('span', { class: 'mono' }, btc(s.bch_sats) + ' BCH')) : null,
      s.eth > 0 ? h('div', { class: 'row' }, h('span', { class: 'mut sm' }, 'Ethereum (ETH)'), h('span', { class: 'mono' }, qtdAtivo(s.eth, 'ETH'))) : null,
      h('div', { class: 'mut xs' }, '≈ ' + brl(s.btc_sats / 1e8 * s.preco_btc_brl + (s.bch_sats || 0) / 1e8 * (s.preco_bch_brl || 0) + (s.usdc + s.usdt + s.eth * (s.eth_usd || 0)) * s.usd_brl) + ' no total · endereço Ethereum ' + (s.eth_address || '—')));
  } catch (e) { fill(saldos, h('div', { class: 'err' }, e.message)); }
  listaTrocas(lista);
  listaSugestoes(sugestoes);
}

/* Tela comum de cotação + confirmação com a digital. cfg: { lado, titulo, montar(form) → {campos, pedido()}, resumo(cot) → linhas } */
function telaTroca(cfg) {
  const S = { cot: null, seq: 0, ocupado: false };
  const erro = h('div', { class: 'err', role: 'alert' });
  const res = h('div', { class: 'card', style: 'gap:6px' }, h('div', { class: 'mut sm' }, 'Informe o valor para ver a cotação.'));
  const ss = h('div', { class: 'card', style: 'gap:6px;display:none' });   // comparacao com a SideShift
  const btn = h('button', { class: 'btn', type: 'button', disabled: true }, 'Confirmar com a digital');
  const form = cfg.montar(() => { clearTimeout(S.deb); S.deb = setTimeout(cotar, 500); });
  async function cotar() {
    const mySeq = ++S.seq; erro.textContent = ''; btn.disabled = true; S.cot = null;
    const p = form.pedido(); if (!p) { fill(res, h('div', { class: 'mut sm' }, 'Informe o valor para ver a cotação.')); ss.style.display = 'none'; return; }
    fill(res, esperando('Consultando a THORChain…', 'Buscando o melhor preço agora. Leva alguns segundos.'));
    ss.style.display = ''; fill(ss, esperando('Fazendo cotação na SideShift…', 'Comparando o preço com outro serviço.'));
    try {
      const r = await api('swap_cotar', { lado: cfg.lado, ...p });
      if (mySeq !== S.seq) return;
      S.cot = r.cot; fill(res, ...cfg.resumo(r.cot, form.moeda()));
      if (r.cot.custo_pct != null && r.cot.custo_pct > 3) res.append(h('div', { class: 'warn' }, 'O custo desta troca é ' + pct(r.cot.custo_pct) + ' do valor. Em valores maiores ele cai bastante (parte das taxas é fixa).'));
      btn.disabled = false;
      if (r.cot.lado === 'sacar_eth') ss.style.display = 'none'; else compararSideShift(r.cot, mySeq);
    } catch (e) {
      if (mySeq !== S.seq) return;
      ss.style.display = 'none';
      if (e.codigo === 'abaixo_minimo' && e.dados && e.dados.min_brl && form.usarValor) {
        // Minimo da THORChain: explica e oferece o valor minimo (com 5% de folga, porque o minimo varia com a rede)
        const sug = Math.ceil(e.dados.min_brl * 1.05);
        fill(res, h('div', { class: 'warn', style: 'margin:0' }, 'O valor mínimo agora é ' + brl(e.dados.min_brl) + '. Abaixo disso, as taxas da rede ficariam maiores que a troca.'),
          h('button', { class: 'btn ghost', type: 'button', style: 'height:44px;font-size:15px', onclick: () => form.usarValor(sug) }, 'Usar ' + brl(sug)));
      } else fill(res, h('div', { class: 'err', style: 'margin:0' }, e.message));
    }
  }
  // Compara com a SideShift so para informar; a troca e feita pela THORChain (sem cadastro e sem identificar o usuario)
  async function compararSideShift(c, mySeq) {
    const m = form.moeda();
    const de = c.lado === 'vender' ? (c.de || 'BTC') : c.de, origem = c.lado === 'vender' ? c.envia_sats / 1e8 : c.envia;
    try {
      const { ss: x } = await api('swap_sideshift', { de, para: c.para, origem });
      if (mySeq !== S.seq) return;
      const qtd = qtdAtivo(x.recebe, c.para);
      const dif = c.recebe_brl - x.recebe_brl;
      const nota = x.abaixo_min ? 'Valor abaixo do mínimo da SideShift.' : x.acima_max ? 'Valor acima do máximo da SideShift.'
        : Math.abs(dif) < 0.01 ? 'Mesmo valor nos dois serviços.'
        : dif > 0 ? 'A THORChain paga ' + fiat(dif, m, c.usd_brl) + ' a mais. Você está no melhor preço.'
        : 'A SideShift pagaria ' + fiat(-dif, m, c.usd_brl) + ' a mais, mas exige identificar o seu IP. Seguimos com a THORChain pelo anonimato.';
      fill(ss, h('div', { class: 'row' }, h('b', { style: 'font-size:14px' }, 'SideShift (comparação)'), h('span', { class: 'pill ' + (dif >= 0 ? 'ok' : 'off') }, dif >= 0 ? 'THORChain melhor' : 'SideShift maior')),
        linhaF('Você receberia (aprox.)', fiat(x.recebe_brl, m, c.usd_brl), qtd), h('div', { class: 'mut xs' }, nota));
    } catch (e) { if (mySeq !== S.seq) return; fill(ss, h('div', { class: 'mut sm' }, 'SideShift: sem cotação agora (' + e.message + ').')); }
  }
  btn.addEventListener('click', async () => {
    erro.textContent = ''; S.ocupado = true; btn.disabled = true; comAmpulheta(btn, 'Preparando…');
    const volta = () => { btn.textContent = 'Confirmar com a digital'; };
    try {
      const r = await api('resumo');
      if (!r.passkeys) { const ok = await cadastrarDigital(); if (!ok) { volta(); btn.disabled = false; return; } }
      comAmpulheta(btn, 'Conferindo a cotação…');
      const d = await api('swap_desafio', { lado: cfg.lado, ...form.pedido() });
      volta(); abrir(d);
    } catch (e) { volta(); erro.textContent = e.message; btn.disabled = false; }
  });
  function abrir(d) {
    const msg = h('div', { class: 'err' }), usar = h('button', { class: 'btn', type: 'button' }, 'Usar a digital');
    const fechar = () => modal.remove();
    usar.addEventListener('click', async () => {
      usar.disabled = true; msg.textContent = ''; comAmpulheta(usar, 'Aguardando a digital…');
      try {
        const cred = await navigator.credentials.get({ publicKey: { challenge: b64uToBuf(d.challenge), rpId: d.rpId, timeout: 60000, userVerification: 'required',
          allowCredentials: d.allowCredentials.map(c => ({ type: 'public-key', id: b64uToBuf(c.id) })) } });
        const a = cred.response; comAmpulheta(usar, 'Enviando a troca…');
        const r = await api('swap_confirmar', { sugestao_id: (SUG && cfg.lado === 'vender') ? SUG.id : undefined, challenge: d.challenge, assertion: { id: cred.id, clientDataJSON: bufToB64u(a.clientDataJSON), authenticatorData: bufToB64u(a.authenticatorData), signature: bufToB64u(a.signature) } });
        fechar(); location.hash = '#troca/' + r.id;
      } catch (e) { msg.textContent = e.name === 'NotAllowedError' ? 'Confirmação cancelada ou expirada.' : e.message; usar.textContent = 'Usar a digital'; usar.disabled = false; }
    });
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Confirmar troca' },
      h('div', { class: 'sheet' }, h('h1', {}, 'Confirmar troca'), ...cfg.resumo(d.cot, form.moeda()),
        h('div', { class: 'mut xs' }, 'Se o preço piorar além do mínimo garantido, a THORChain não troca e devolve o valor para a sua conta (menos as taxas de rede). O envio não pode ser desfeito.'),
        msg, usar, h('button', { class: 'btn ghost', type: 'button', onclick: fechar }, 'Cancelar')));
    document.body.append(modal);
  }
  shell('trocar', h('a', { href: '#trocar', class: 'mut sm', style: 'text-decoration:none' }, '‹ Trocar'), h('h1', {}, cfg.titulo), ...form.campos, res, ss, erro, btn,
    h('div', { class: 'mut xs', style: 'text-align:center' }, 'Troca feita pela THORChain, sem cadastro e sem intermediário.'));
}
// Resumo em moeda corrente (R$ ou US$, a mesma que o usuario digitou); a cripto aparece pequena, como detalhe
function fiat(vBrl, moeda, usdBrl) { return moeda === 'USD' ? 'US$ ' + usd(vBrl / usdBrl) : brl(vBrl); }
const linhaF = (k, v, det, forte) => h('div', { class: 'sum', style: forte ? 'font-size:16px;font-weight:600' : '' }, h('span', { class: forte ? '' : 'mut' }, k),
  h('b', { style: forte ? 'color:var(--acc)' : '' }, v, det ? h('span', { class: 'mut xs', style: 'display:block;font-weight:400' }, det) : null));
// Bloco de espera com a ampulheta grande, para o usuario saber que algo esta acontecendo
function esperando(titulo, sub) {
  const a = ampulheta(); a.classList.add('grande');
  return h('div', { class: 'esperando', role: 'status' }, a, h('div', { class: 'col', style: 'gap:2px' }, h('b', {}, titulo), sub ? h('span', { class: 'mut xs' }, sub) : null));
}
const comAmpulheta = (btn, txt) => { btn.replaceChildren(ampulheta(), ' ' + txt); };
const linha = (k, v, forte) => h('div', { class: 'sum', style: forte ? 'font-size:16px;font-weight:600' : '' }, h('span', { class: forte ? '' : 'mut' }, k), h('b', { style: forte ? 'color:var(--acc)' : '' }, v));

function telaVender() {
  telaTroca({ lado: 'vender', titulo: 'Vender BTC/BCH',
    montar(mudou) {
      const S = { tipo: 'brl', para: 'USDC', de: 'BTC' };
      if (SUG) setTimeout(() => { inp.value = String(SUG.valor).replace('.', ','); mudou(); }, 0);   // abre ja com o valor sugerido (voce pode mudar)
      const inp = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off', 'aria-label': 'Valor a vender' });
      const cur = h('span', { class: 'cur' }, 'R$');
      const segBrl = h('button', { type: 'button', class: 'on' }, 'R$'), segBtc = h('button', { type: 'button' }, 'BTC');
      const t = x => { S.tipo = x; segBrl.className = x === 'brl' ? 'on' : ''; segBtc.className = x === 'btc' ? 'on' : ''; cur.textContent = x === 'brl' ? 'R$' : S.de; inp.placeholder = '0,00'; mudou(); };
      segBrl.onclick = () => t('brl'); segBtc.onclick = () => t('btc');
      inp.oninput = () => { if (S.tipo === 'max') { inp.placeholder = '0,00'; t('brl'); } else mudou(); };
      const tudo = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.tipo = 'max'; inp.value = ''; inp.placeholder = 'Tudo'; mudou(); } }, 'Tudo');
      const chU = h('button', { type: 'button', class: 'chip on' }, 'USDC'), chT = h('button', { type: 'button', class: 'chip' }, 'USDT');
      const chS = h('button', { type: 'button', class: 'chip', style: 'display:none' }, 'BTC na saída');   // so ao vender BCH
      const chE = h('button', { type: 'button', class: 'chip' }, 'ETH na saída');                          // vira ETH e vai para a carteira de saida ETH
      const p = x => { S.para = x; chU.className = 'chip' + (x === 'USDC' ? ' on' : ''); chT.className = 'chip' + (x === 'USDT' ? ' on' : '');
        chS.className = 'chip' + (x === 'BTC' ? ' on' : ''); chE.className = 'chip' + (x === 'ETH' ? ' on' : ''); mudou(); };
      chU.onclick = () => p('USDC'); chT.onclick = () => p('USDT'); chS.onclick = () => p('BTC'); chE.onclick = () => p('ETH');
      const chBtc = h('button', { type: 'button', class: 'chip on' }, 'BTC'), chBch = h('button', { type: 'button', class: 'chip' }, 'BCH');
      const d = x => { S.de = x; chBtc.className = 'chip' + (x === 'BTC' ? ' on' : ''); chBch.className = 'chip' + (x === 'BCH' ? ' on' : ''); segBtc.textContent = x;
        chS.style.display = x === 'BCH' ? '' : 'none'; if (x !== 'BCH' && S.para === 'BTC') { S.para = 'USDC'; chU.className = 'chip on'; chS.className = 'chip'; }
        if (S.tipo === 'btc') cur.textContent = x; mudou(); };
      chBtc.onclick = () => d('BTC'); chBch.onclick = () => d('BCH');
      return { campos: [h('div', { class: 'mut sm' }, 'Vender'), h('div', { class: 'chips' }, chBtc, chBch),
          h('div', { class: 'row' }, h('span', { class: 'mut sm' }, 'Quanto vender'), tudo), h('div', { class: 'amount' }, cur, inp, h('div', { class: 'seg' }, segBrl, segBtc)),
          h('div', { class: 'mut sm' }, 'Receber em'), h('div', { class: 'chips', style: 'flex-wrap:wrap' }, chU, chT, chS, chE)],
        moeda: () => 'BRL',
        usarValor: v => { t('brl'); inp.value = String(v).replace('.', ','); mudou(); },
        pedido: () => (S.tipo === 'max' || numBR(inp.value) > 0) ? { tipo: S.tipo, valor: inp.value, para: S.para, de: S.de } : null };
    },
    // Voce paga = BTC enviado a THORChain + taxa de mineracao da sua transacao; assim paga - recebe = taxas
    resumo: (c, m) => { const fee = (c.fee_est_sats || 0) / 1e8 * c.preco_brl, paga = c.entrada_brl + fee, tx = Math.max(0, paga - c.recebe_brl); return [
      linhaF('Você paga', fiat(paga, m, c.usd_brl), btc(c.envia_sats + (c.fee_est_sats || 0)) + ' ' + (c.de || 'BTC') + ' (com a taxa de rede)'),
      linhaF('Você vai receber', fiat(c.recebe_brl, m, c.usd_brl), qtdAtivo(c.recebe, c.para), true),
      linhaF('Taxas', fiat(tx, m, c.usd_brl) + ' · ' + pct(paga > 0 ? tx / paga * 100 : 0)),
      linhaF('Mínimo garantido', fiat(c.minimo_brl != null ? c.minimo_brl : c.minimo * c.usd_brl, m, c.usd_brl), qtdAtivo(c.minimo, c.para)),
      linha('Tempo estimado', mins(Math.round(c.tempo_s / 60) + 5)),
      linha('Destino', c.repasse ? 'carteira de saída ETH (' + String(c.saida_eth).slice(0, 8) + '…' + String(c.saida_eth).slice(-6) + ')'
        : c.saida ? 'sua carteira de saída (' + String(c.destino).slice(0, 8) + '…' + String(c.destino).slice(-6) + ')' : 'sua conta (Ethereum)'),
      c.repasse ? h('div', { class: 'mut xs' }, 'O ETH chega no seu perfil e o app o envia em seguida, numa transferência comum, para a carteira de saída (os saques ficam liberados 24 h depois de cadastrá-la).') : null]; } });
}

function telaComprar() {
  telaTroca({ lado: 'comprar', titulo: 'Comprar BTC/BCH',
    montar(mudou) {
      const S = { de: 'USDC', para: 'BTC', tipo: 'usd' };
      const inp = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off', 'aria-label': 'Valor em dólar digital' });
      const cur = h('span', { class: 'cur' }, 'US$');
      const segU = h('button', { type: 'button', class: 'on' }, 'US$'), segR = h('button', { type: 'button' }, 'R$');
      const t = x => { S.tipo = x; segU.className = x === 'usd' ? 'on' : ''; segR.className = x === 'brl' ? 'on' : ''; cur.textContent = x === 'usd' ? 'US$' : 'R$'; mudou(); };
      segU.onclick = () => t('usd'); segR.onclick = () => t('brl'); inp.oninput = () => { if (S.tipo === 'max') t('usd'); else mudou(); };
      const tudo = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.tipo = 'max'; inp.value = ''; inp.placeholder = 'Tudo'; mudou(); } }, 'Tudo');
      const mk = (lista, chave) => { const bs = lista.map(v => h('button', { type: 'button', class: 'chip' + (S[chave] === v ? ' on' : '') }, v));
        bs.forEach((b, i) => b.onclick = () => { S[chave] = lista[i]; bs.forEach((x, j) => x.className = 'chip' + (j === i ? ' on' : '')); mudou(); }); return bs; };
      return { campos: [h('div', { class: 'mut sm' }, 'Usar'), h('div', { class: 'chips' }, ...mk(['USDC', 'USDT', 'ETH'], 'de')),
          h('div', { class: 'row' }, h('span', { class: 'mut sm' }, 'Quanto investir'), tudo), h('div', { class: 'amount' }, cur, inp, h('div', { class: 'seg' }, segU, segR)),
          h('div', { class: 'mut sm' }, 'Comprar'), h('div', { class: 'chips' }, ...((bs) => { bs[2].textContent = 'ETH na saída'; return bs; })(mk(['BTC', 'BCH', 'ETH'], 'para')))],
        moeda: () => S.tipo === 'brl' ? 'BRL' : 'USD',
        pedido: () => (S.tipo === 'max' || numBR(inp.value) > 0) ? { tipo: S.tipo, valor: inp.value, de: S.de, para: S.para } : null };
    },
    resumo: (c, m) => [linhaF('Você paga', fiat(c.entrada_brl, m, c.usd_brl), qtdAtivo(c.envia, c.de) + (c.de === 'ETH' ? ' (fica 0,0002 ETH para o gás)' : '')),
      linhaF('Você vai receber', fiat(c.recebe_brl, m, c.usd_brl), qtdAtivo(c.recebe_sats / 1e8, c.para), true),
      linhaF('Taxas', fiat(Math.max(0, c.entrada_brl - c.recebe_brl), m, c.usd_brl) + ' · ' + pct(c.entrada_brl > 0 ? Math.max(0, c.entrada_brl - c.recebe_brl) / c.entrada_brl * 100 : 0)),
      linhaF('Mínimo garantido', fiat(c.recebe_sats > 0 ? c.recebe_brl * c.minimo_sats / c.recebe_sats : 0, m, c.usd_brl), qtdAtivo(c.minimo_sats / 1e8, c.para)),
      linha('Tempo estimado', '~2 a 5 min'),
      linha('Destino', c.repasse ? 'carteira de saída ETH (' + String(c.saida_eth).slice(0, 8) + '…' + String(c.saida_eth).slice(-6) + ')' : 'sua conta (' + c.para + ')')] });
}

/* Sacar ETH: ETH do perfil -> carteira de saida ETH cadastrada no site (transferencia comum). */
function telaSacarEth() {
  telaTroca({ lado: 'sacar_eth', titulo: 'Sacar ETH',
    montar(mudou) {
      const S = { tipo: 'brl' };
      const inp = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off', 'aria-label': 'Valor a sacar' });
      const cur = h('span', { class: 'cur' }, 'R$');
      const segR = h('button', { type: 'button', class: 'on' }, 'R$'), segU = h('button', { type: 'button' }, 'US$');
      const t = x => { S.tipo = x; segR.className = x === 'brl' ? 'on' : ''; segU.className = x === 'usd' ? 'on' : ''; cur.textContent = x === 'usd' ? 'US$' : 'R$'; inp.placeholder = '0,00'; mudou(); };
      segR.onclick = () => t('brl'); segU.onclick = () => t('usd'); inp.oninput = () => { if (S.tipo === 'max') t('brl'); else mudou(); };
      const tudo = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.tipo = 'max'; inp.value = ''; inp.placeholder = 'Tudo'; mudou(); } }, 'Tudo');
      return { campos: [h('div', { class: 'mut sm' }, 'Envia o ETH do seu perfil para a carteira de saída ETH cadastrada no site (⚙ Configuração). Só ETH puro, numa transferência comum que bancos e corretoras reconhecem.'),
          h('div', { class: 'row' }, h('span', { class: 'mut sm' }, 'Quanto sacar'), tudo), h('div', { class: 'amount' }, cur, inp, h('div', { class: 'seg' }, segR, segU))],
        moeda: () => S.tipo === 'usd' ? 'USD' : 'BRL',
        pedido: () => (S.tipo === 'max' || numBR(inp.value) > 0) ? { tipo: S.tipo, valor: inp.value } : null };
    },
    resumo: (c, m) => [linhaF('Você envia', fiat(c.entrada_brl, m, c.usd_brl), qtdAtivo(c.envia, 'ETH')),
      linhaF('Chega na carteira de saída', fiat(c.recebe_brl, m, c.usd_brl), qtdAtivo(c.recebe, 'ETH'), true),
      linhaF('Taxa de rede (≈)', fiat(c.custo_brl, m, c.usd_brl), 'paga com o ETH do perfil'),
      linha('Destino', 'carteira de saída ETH (' + String(c.destino).slice(0, 8) + '…' + String(c.destino).slice(-6) + ')'),
      h('div', { class: 'mut xs' }, 'Confira que o banco aceita ETH na rede Ethereum. Saques liberados 24 h depois de cadastrar ou trocar a carteira.')] });
}

function telaTrocaStatus(id) {
  const corpo = h('div', { class: 'col' }, carregando());
  shell('trocar', h('a', { href: '#trocar', class: 'mut sm', style: 'text-decoration:none' }, '‹ Trocar'), h('h1', {}, 'Troca #' + id), corpo);
  async function atualizar() {
    try {
      const { swap: s } = await api('swap_status', { id: Number(id) });
      const e = s.etapas || {};
      const saque = s.para === 'SAIDA';
      const passos = saque ? [['Pedido registrado', true], ['Enviado à carteira de saída ETH', s.status === 'concluido']]
        : [['Pedido registrado', true], ['Enviado à THORChain', ['trocando', 'concluída', 'devolvida'].includes(s.situacao)], ['Depósito confirmado', !!e.confirmado], ['Troca feita', !!e.trocado],
           [s.repasse ? 'ETH entregue no seu perfil' : 'Valor entregue no destino', s.status === 'concluido']];
      if (s.repasse && s.status !== 'reembolsado') passos.push(['Repassado à carteira de saída ETH', !!s.tx_repasse]);
      const final = SWAP_FINAIS.includes(s.status) && !(s.repasse && s.status === 'concluido' && !s.tx_repasse), atual = final ? -1 : passos.findIndex(([, ok]) => !ok);
      fim = s.faltam_seg != null ? Date.now() + s.faltam_seg * 1000 : null;
      inicio = Date.parse(String(s.criado_em).replace(' ', 'T') + 'Z');
      relogio = final ? null : h('span', { class: 'contador' }, '');
      fill(corpo,
        h('div', { class: 'card', style: 'gap:6px' }, h('div', { class: 'row' }, h('span', { class: 'mono' }, qtdAtivo(s.valor, s.de) + ' → ' + (s.para === 'SAIDA' ? 'saída' : s.para)), situacaoPill(s)),
          s.para !== 'SAIDA' && s.esperado != null ? h('div', { class: 'mut sm' }, 'Estimado: ' + qtdAtivo(s.esperado, s.para) + ' · mínimo ' + qtdAtivo(s.minimo, s.para)) : null),
        relogio ? h('div', { class: 'card relogio-card' }, h('span', { class: 'giro' }), h('div', { class: 'col', style: 'gap:0' }, relogio, h('span', { class: 'mut xs' }, 'atualiza sozinho a cada 15 s'))) : null,
        h('div', { class: 'steps' }, ...passos.map(([t, ok], i) => i === atual
          ? h('div', { class: 'step agora' }, h('span', { class: 'dot wait' }, ampulheta()), t, h('span', { class: 'pill wait', style: 'margin-left:auto' }, 'Pendente'))
          : h('div', { class: 'step' + (ok ? '' : ' todo') }, h('span', { class: 'dot' + (ok ? ' ok' : '') }, ok ? '✓' : ''), t))),
        s.erro ? h('div', { class: 'warn' }, s.erro) : null,
        s.status === 'reembolsado' ? h('div', { class: 'warn' }, 'O preço mudou além do mínimo garantido e a THORChain devolveu o valor para a sua conta (menos as taxas de rede).') : null,
        s.tx_envio || s.tx_recebido ? h('div', { class: 'card', style: 'gap:8px' },
          s.tx_envio ? h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'mut sm' }, 'Saída da sua conta (' + s.de + ')'),
            h('a', { href: s.tx_envio_link, target: '_blank', rel: 'noopener', class: 'mono sm', style: 'word-break:break-all' }, s.tx_envio)) : null,
          s.tx_recebido ? h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'mut sm' }, (s.status === 'reembolsado' ? 'Devolução (' + s.de + ')' : 'Entrada no destino (' + s.para + ')')),
            h('a', { href: s.tx_recebido_link, target: '_blank', rel: 'noopener', class: 'mono sm', style: 'word-break:break-all' }, s.tx_recebido)) : null,
          s.tx_repasse ? h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'mut sm' }, 'Envio à carteira de saída ETH'),
            h('a', { href: s.tx_repasse_link, target: '_blank', rel: 'noopener', class: 'mono sm', style: 'word-break:break-all' }, s.tx_repasse)) : null) : null,
        s.link ? h('a', { href: s.link, target: '_blank', rel: 'noopener', class: 'btn ghost' }, 'Ver na THORChain') : null);
      mostrar();
      if (final) stopTimer();
    } catch (e) { fill(corpo, h('div', { class: 'err' }, e.message)); stopTimer(); }
  }
  let fim = null, inicio = null, relogio = null, tick = 0;
  function mostrar() {
    if (!relogio) return;
    if (fim) relogio.textContent = 'Faltam ≈ ' + mmss((fim - Date.now()) / 1000);
    else if (inicio) relogio.textContent = 'Em andamento há ' + mmss((Date.now() - inicio) / 1000);
  }
  atualizar(); timer = setInterval(() => { tick++; mostrar(); if (tick % 15 === 0) atualizar(); }, 1000);
}

/* ================= PAGAR: transferência para qualquer endereço (BTC, BCH, ETH, USDC na Ethereum) =================
 * 1) destino por QR (câmera), colar ou digitar; 2) o servidor lê a moeda, o endereço e o valor;
 * 3) o app mostra as opções com os saldos da conta (direto na mesma moeda ou convertendo pela THORChain);
 * 4) a pessoa escolhe a origem e confirma com a digital; 5) acompanhamento com os TXIDs. */
const PAG_FINAIS = ['confirmado', 'erro', 'reembolsado'];
const NOME_REDE = { BTC: 'Bitcoin', BCH: 'Bitcoin Cash', ETH: 'Ethereum (ETH)', USDC: 'USDC (rede Ethereum)' };
const tempoTxt = s => s == null ? '' : (s < 3600 ? '~' + Math.max(1, Math.round(s / 60)) + ' min' : '~' + (Math.round(s / 360) / 10).toString().replace('.', ',') + ' h');
// Endereço completo com o começo e o fim em destaque (é o que a pessoa deve conferir)
function enderecoForte(a) {
  a = String(a || ''); const pre = a.startsWith('bitcoincash:') ? 'bitcoincash:' : ''; const b = a.slice(pre.length);
  return h('span', { class: 'mono sm', style: 'word-break:break-all' }, pre, h('b', { style: 'color:var(--acc)' }, b.slice(0, 6)), b.slice(6, -6), h('b', { style: 'color:var(--acc)' }, b.slice(-6)));
}
function pagPill(p) {
  if (!PAG_FINAIS.includes(p.status)) return h('span', { class: 'pill wait' }, ampulheta(), p.situacao);
  return h('span', { class: 'pill ' + (p.status === 'confirmado' ? 'ok' : 'off'), style: p.status !== 'confirmado' ? 'color:var(--bad)' : '' }, p.situacao);
}
function listaPagamentos(box) {
  api('pagamentos_lista').then(r => {
    box.replaceChildren(...(r.pagamentos.length ? r.pagamentos.map(p => h('a', { href: '#pagamento/' + p.id, class: 'card', style: 'text-decoration:none;color:inherit;gap:4px' },
      h('div', { class: 'row' }, h('b', { class: 'mono' }, p.valor + ' ' + p.destino_ativo), pagPill(p)),
      h('div', { class: 'mut xs' }, brl(p.valor_brl) + ' · para ' + p.destino + ' · de ' + p.origem_ativo + (p.referencia ? ' · ' + p.referencia : '')))) : [h('div', { class: 'mut sm' }, 'Nenhum pagamento ainda.')]));
  }).catch(e => { box.replaceChildren(h('div', { class: 'mut sm' }, e.message)); });
}
// ---- Leitura de QR: leitor nativo do navegador quando existe (Android/Chrome) ou o leitor próprio (qr_leitor.js),
//      que roda em segundo plano (Web Worker) para não travar a tela. Nenhuma biblioteca de fora.
let QRW = null, QRID = 0; const QRPEND = new Map();
function qrWorker() {
  if (!QRW) {
    QRW = new Worker('qr_leitor.js?v=20261115-1');
    QRW.onmessage = e => { const f = QRPEND.get(e.data.id); if (f) { QRPEND.delete(e.data.id); f(e.data.txt); } };
    QRW.onerror = () => { for (const f of QRPEND.values()) f(null); QRPEND.clear(); QRW = null; };
  }
  return QRW;
}
function qrDecodificar(img, rapido) {
  return new Promise(res => { const id = ++QRID; QRPEND.set(id, res); qrWorker().postMessage({ id, w: img.width, h: img.height, buf: img.data.buffer, rapido }, [img.data.buffer]); });
}
async function qrNativo() {
  try { if (!('BarcodeDetector' in window)) return null; const f = await BarcodeDetector.getSupportedFormats(); return f.includes('qr_code') ? new BarcodeDetector({ formats: ['qr_code'] }) : null; } catch (e) { return null; }
}
function qrQuadro(fonte, lw, lh, max) {
  const esc = Math.min(1, max / Math.max(lw, lh)), w = Math.max(1, Math.round(lw * esc)), hh = Math.max(1, Math.round(lh * esc));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(fonte, 0, 0, w, hh);
  return g.getImageData(0, 0, w, hh);
}
// Foto (câmera do sistema ou galeria): lê com o leitor completo
async function lerQRFoto(arquivo) {
  const bmp = await createImageBitmap(arquivo);
  try {
    const nat = await qrNativo();
    if (nat) { try { const c = await nat.detect(bmp); if (c && c.length && c[0].rawValue) return c[0].rawValue; } catch (e) {} }
    for (const max of [1200, 800, 1800]) { const txt = await qrDecodificar(qrQuadro(bmp, bmp.width, bmp.height, max), false); if (txt) return txt; }
    return null;
  } finally { try { bmp.close(); } catch (e) {} }
}
// Câmera ao vivo
function lerQR(onLido, aoFalhar) {
  if (!navigator.mediaDevices?.getUserMedia) { aoFalhar('Este navegador não libera a câmera para o app. Use "Foto do QR".'); return; }
  const video = h('video', { playsinline: true, muted: true, autoplay: true, style: 'width:100%;border-radius:12px;background:#000;aspect-ratio:1/1;object-fit:cover' });
  const mira = h('div', { 'aria-hidden': 'true', style: 'position:absolute;inset:18%;border:3px solid var(--acc);border-radius:14px;box-shadow:0 0 0 999px rgba(0,0,0,.25);pointer-events:none' });
  const msg = h('div', { class: 'mut sm', style: 'text-align:center' }, 'Aponte para o QR code do pagamento.');
  let stream = null, vivo = true;
  const fechar = () => { vivo = false; try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {} modal.remove(); };
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ler QR code' },
    h('div', { class: 'sheet' }, h('h1', {}, 'Ler QR code'), h('div', { style: 'position:relative;overflow:hidden;border-radius:12px' }, video, mira), msg,
      h('button', { class: 'btn ghost', type: 'button', onclick: fechar }, 'Cancelar')));
  document.body.append(modal);
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (!vivo) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream; await video.play();
      const nat = await qrNativo(); let n = 0;
      while (vivo) {
        let txt = null;
        if (video.readyState >= 2 && video.videoWidth) {
          n++;
          if (nat) { try { const c = await nat.detect(video); if (c && c.length) txt = c[0].rawValue; } catch (e) {} }
          else { const completo = n % 4 === 0; txt = await qrDecodificar(qrQuadro(video, video.videoWidth, video.videoHeight, completo ? 960 : 640), !completo); }
        }
        if (txt && vivo) { fechar(); try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} onLido(txt); return; }
        await new Promise(r => setTimeout(r, nat ? 250 : 60));
      }
    } catch (e) {
      msg.className = 'err';
      msg.textContent = e.name === 'NotAllowedError' ? 'A câmera foi bloqueada. Permita o uso da câmera para o app ou use "Foto do QR".' : 'Não foi possível abrir a câmera (' + e.message + '). Use "Foto do QR".';
    }
  })();
}
function telaPagar() {
  const S = { lido: null, ops: null, escolhida: null, seq: 0, tipo: 'brl', ativo: null };
  const campo = h('textarea', { rows: 3, placeholder: 'Cole aqui o endereço ou o link de pagamento (bitcoin:…, bitcoincash:…, ethereum:… ou 0x…)', autocomplete: 'off', spellcheck: 'false',
    style: 'width:100%;box-sizing:border-box;padding:12px;border-radius:12px;background:var(--bg2);color:var(--tx);border:1px solid var(--line2);font-family:inherit;font-size:14px;resize:vertical' });
  const btQR = h('button', { class: 'btn', type: 'button', style: 'flex:1;height:46px;font-size:15px' }, '📷 Ler QR code');
  const arqFoto = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const btFoto = h('button', { class: 'btn ghost', type: 'button', style: 'flex:1' }, '🖼️ Foto do QR');
  const btColar = h('button', { class: 'btn ghost', type: 'button', style: 'flex:1' }, 'Colar');
  const lido = h('div', { class: 'col', style: 'gap:10px' });
  const opcoes = h('div', { class: 'col', style: 'gap:10px' });
  const erro = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'button', style: 'display:none' }, 'Confirmar com a digital');
  const recentes = h('div', { class: 'col' }, carregando());
  const valorIn = h('input', { inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off',
    style: 'flex:1;min-width:0;height:46px;padding:0 12px;border-radius:12px;background:var(--bg2);color:var(--tx);border:1px solid var(--line2);font-size:18px' });
  const tipoBt = h('button', { class: 'btn ghost', type: 'button', style: 'width:96px' }, 'R$');
  const pedido = () => {
    const p = { destino: campo.value.trim() };
    if (S.ativo) p.ativo = S.ativo;
    if (S.lido && !S.lido.travado) { p.valor = valorIn.value.trim(); p.tipo = S.tipo; }
    return p;
  };
  let deb = null;
  const agendar = (ms) => { clearTimeout(deb); deb = setTimeout(ler, ms ?? 500); };
  campo.addEventListener('input', () => { S.ativo = null; agendar(); });
  valorIn.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(cotar, 700); });
  tipoBt.addEventListener('click', () => { S.tipo = S.tipo === 'brl' ? 'cripto' : 'brl'; tipoBt.textContent = S.tipo === 'brl' ? 'R$' : (S.lido?.ativo || 'moeda'); valorIn.value = ''; limparOpcoes(); });
  btQR.addEventListener('click', () => { erro.textContent = ''; lerQR(v => { campo.value = v; S.ativo = null; ler(); }, m => { erro.textContent = m; }); });
  btFoto.addEventListener('click', () => { erro.textContent = ''; arqFoto.value = ''; arqFoto.click(); });
  arqFoto.addEventListener('change', async () => {
    const f = arqFoto.files && arqFoto.files[0]; if (!f) return;
    comAmpulheta(btFoto, 'Lendo a foto…'); btFoto.disabled = true;
    try { const v = await lerQRFoto(f); if (v) { campo.value = v; S.ativo = null; ler(); } else erro.textContent = 'Não encontrei um QR code legível nesta foto. Tente mais perto, com o QR inteiro e boa luz.'; }
    catch (e) { erro.textContent = 'Não consegui abrir a foto (' + e.message + ').'; }
    finally { btFoto.textContent = '🖼️ Foto do QR'; btFoto.disabled = false; }
  });
  btColar.addEventListener('click', async () => { try { campo.value = (await navigator.clipboard.readText()).trim(); S.ativo = null; ler(); } catch (e) { erro.textContent = 'Não consegui ler a área de transferência. Toque e segure no campo para colar.'; } });
  function limparOpcoes() { S.ops = null; S.escolhida = null; opcoes.replaceChildren(); btn.style.display = 'none'; }
  async function ler() {
    const mySeq = ++S.seq; erro.textContent = ''; limparOpcoes();
    if (!campo.value.trim()) { lido.replaceChildren(); S.lido = null; return; }
    lido.replaceChildren(esperando('Lendo o código…', 'Conferindo a moeda, o endereço e o valor.'));
    try {
      const r = await api('pagar_ler', pedido());
      if (mySeq !== S.seq) return;
      S.lido = r.lido; desenharLido(r);
      if (r.lido.ativo && r.lido.valor != null) cotar();
    } catch (e) { if (mySeq !== S.seq) return; S.lido = null; lido.replaceChildren(h('div', { class: 'err', style: 'margin:0' }, e.message)); }
  }
  function desenharLido(r) {
    const l = r.lido;
    const partes = [];
    if (l.precisa_ativo) {
      partes.push(h('div', { class: 'card', style: 'gap:8px' }, h('b', {}, 'Esse endereço da rede Ethereum vai receber o quê?'),
        h('div', { class: 'row', style: 'gap:8px' }, ...l.escolher.map(a => h('button', { class: 'btn ghost', type: 'button', style: 'flex:1', onclick: () => { S.ativo = a; ler(); } }, a === 'USDC' ? 'USDC (dólar digital)' : 'ETH'))),
        h('div', { class: 'mut xs' }, 'Confira com quem vai receber. Mandar a moeda errada pode fazer o valor se perder.')));
      lido.replaceChildren(...partes); return;
    }
    partes.push(h('div', { class: 'card', style: 'gap:6px' },
      h('div', { class: 'row' }, h('b', {}, 'Destino · ' + (NOME_REDE[l.ativo] || l.ativo)), l.novo_destino ? h('span', { class: 'pill off', style: 'color:var(--warn,#fcd34d)' }, 'primeira vez') : h('span', { class: 'pill ok' }, 'já usado')),
      enderecoForte(l.endereco),
      l.referencia ? h('div', { class: 'mut xs' }, 'Referência: ' + l.referencia) : null,
      l.novo_destino ? h('div', { class: 'mut xs' }, 'Primeiro pagamento para este endereço: confira os caracteres em destaque com quem vai receber.') : null));
    if (l.travado) {
      partes.push(h('div', { class: 'card', style: 'gap:4px' }, h('span', { class: 'mut sm' }, 'Valor do pagamento (definido no QR code)'),
        h('b', { style: 'font-size:22px' }, l.valor_txt.replace('.', ',') + ' ' + l.ativo), h('span', { class: 'mut sm' }, '≈ ' + brl(l.valor_brl))));
    } else {
      tipoBt.textContent = S.tipo === 'brl' ? 'R$' : l.ativo;
      partes.push(h('div', { class: 'card', style: 'gap:8px' }, h('span', { class: 'mut sm' }, 'Quanto o destino deve receber?'),
        h('div', { class: 'row', style: 'gap:8px' }, valorIn, tipoBt),
        l.valor != null ? h('span', { class: 'mut sm' }, '= ' + l.valor_txt.replace('.', ',') + ' ' + l.ativo + ' ≈ ' + brl(l.valor_brl)) : h('span', { class: 'mut xs' }, 'Toque em "' + tipoBt.textContent + '" para digitar em ' + (S.tipo === 'brl' ? l.ativo : 'reais') + '.')));
    }
    lido.replaceChildren(...partes);
  }
  async function cotar() {
    const mySeq = ++S.seq; erro.textContent = ''; limparOpcoes();
    if (!S.lido || (!S.lido.travado && !valorIn.value.trim())) return;
    opcoes.replaceChildren(esperando('Montando as opções…', 'Conferindo os seus saldos e, quando precisa converter, cotando na THORChain. Pode levar alguns segundos.'));
    try {
      const r = await api('pagar_opcoes', pedido());
      if (mySeq !== S.seq) return;
      if (!S.lido.travado) { S.lido = r.lido; desenharLido({ lido: r.lido }); }
      S.ops = r.opcoes; desenharOpcoes(r);
    } catch (e) { if (mySeq !== S.seq) return; opcoes.replaceChildren(h('div', { class: 'err', style: 'margin:0' }, e.message)); }
  }
  function desenharOpcoes(r) {
    const l = r.lido, lim = r.limites; const itens = [];
    if (r.acima_unit || r.acima_dia) itens.push(h('div', { class: 'warn' }, r.acima_unit
      ? 'Este valor passa do seu limite por pagamento (' + brl(lim.por_pagamento) + '). Para aumentar, use o site, em ⚙ Configuração (o aumento vale 24 h depois).'
      : 'Este valor passa do que resta do seu limite de 24 h (' + brl(lim.disponivel_24h) + ' de ' + brl(lim.por_dia) + '). Você pode alterar no site, em ⚙ Configuração.'));
    itens.push(h('div', { class: 'row' }, h('b', {}, 'De qual saldo vai sair?'), h('span', { class: 'mut xs' }, 'limite: ' + brl(lim.disponivel_24h) + ' nas próximas 24 h')));
    for (const o of r.opcoes) {
      const cartao = h('button', { type: 'button', class: 'card', disabled: !o.disponivel || r.acima_unit || r.acima_dia,
        style: 'text-align:left;gap:4px;font:inherit;color:inherit;cursor:pointer;' + (o.disponivel ? '' : 'opacity:.55;cursor:default') },
        h('div', { class: 'row' }, h('b', {}, 'Pagar com ' + o.origem), o.selo ? h('span', { class: 'pill ok' }, o.selo) : null),
        h('span', { class: 'mut xs' }, 'Saldo: ' + o.saldo.replace('.', ',') + ' ' + o.origem + ' (' + brl(o.saldo_brl) + ')'),
        o.disponivel ? [
          h('div', { class: 'sum' }, h('span', { class: 'mut' }, 'Você paga'), h('b', {}, brl(o.total_brl), h('span', { class: 'mut xs', style: 'display:block;font-weight:400' }, o.paga.replace('.', ',') + ' ' + o.origem + ' + taxa de rede ' + o.taxa_rede.replace('.', ',')))),
          h('div', { class: 'sum' }, h('span', { class: 'mut' }, 'Custo'), h('b', {}, brl(o.custo_brl))),
          h('div', { class: 'mut xs' }, o.modo === 'direto' ? 'Envio direto do valor exato · ' + tempoTxt(o.tempo_s) + ' até confirmar'
            : 'Converte pela THORChain e entrega no destino · ' + tempoTxt(o.tempo_s) + ' · destino recebe ≈ ' + o.recebe.replace('.', ',') + ' ' + l.ativo + (o.folga_pct > 0 ? ' (+' + pct(o.folga_pct) + ')' : '') + ', nunca menos que ' + o.minimo.replace('.', ','))
        ] : h('div', { class: 'mut xs' }, o.motivo || 'Indisponível.'));
      if (o.disponivel) cartao.addEventListener('click', () => {
        S.escolhida = o.origem; opcoes.querySelectorAll('.card').forEach(c => { c.style.borderColor = ''; c.style.boxShadow = ''; });
        cartao.style.borderColor = 'var(--acc)'; cartao.style.boxShadow = '0 0 0 1px var(--acc)';
        btn.style.display = ''; btn.disabled = false; btn.textContent = 'Pagar com ' + o.origem + ' · confirmar com a digital';
      });
      itens.push(cartao);
    }
    if (!r.opcoes.some(o => o.disponivel)) itens.push(h('div', { class: 'warn' }, 'Nenhum saldo da sua conta pode pagar este valor agora.'));
    else if (r.opcoes.some(o => o.disponivel && o.modo !== 'direto')) itens.push(h('div', { class: 'mut xs' }, 'Na conversão o destino pode receber um pouco a mais (até 2%): é a margem que garante que nunca chegue menos que o pedido. Se o preço piorar além disso, a THORChain devolve o valor para a sua conta.'));
    opcoes.replaceChildren(...itens);
  }
  btn.addEventListener('click', async () => {
    if (!S.escolhida) return;
    erro.textContent = ''; btn.disabled = true; comAmpulheta(btn, 'Preparando…');
    const volta = () => { btn.textContent = 'Pagar com ' + S.escolhida + ' · confirmar com a digital'; };
    try {
      const r = await api('resumo');
      if (!r.passkeys) { const ok = await cadastrarDigital(); if (!ok) { volta(); btn.disabled = false; return; } }
      comAmpulheta(btn, 'Conferindo de novo valores e taxas…');
      const d = await api('pagar_desafio', { ...pedido(), origem: S.escolhida });
      volta(); abrir(d);
    } catch (e) { volta(); erro.textContent = e.message; btn.disabled = false; }
  });
  function abrir(d) {
    const o = d.opcao, l = d.lido;
    const msg = h('div', { class: 'err' }), usar = h('button', { class: 'btn', type: 'button' }, 'Usar a digital');
    const fechar = () => { modal.remove(); btn.disabled = false; };
    usar.addEventListener('click', async () => {
      usar.disabled = true; msg.textContent = ''; comAmpulheta(usar, 'Aguardando a digital…');
      try {
        const cred = await navigator.credentials.get({ publicKey: { challenge: b64uToBuf(d.challenge), rpId: d.rpId, timeout: 60000, userVerification: 'required',
          allowCredentials: d.allowCredentials.map(c => ({ type: 'public-key', id: b64uToBuf(c.id) })) } });
        const a = cred.response; comAmpulheta(usar, 'Enviando o pagamento…');
        const r = await api('pagar_confirmar', { challenge: d.challenge, assertion: { id: cred.id, clientDataJSON: bufToB64u(a.clientDataJSON), authenticatorData: bufToB64u(a.authenticatorData), signature: bufToB64u(a.signature) } });
        modal.remove(); location.hash = '#pagamento/' + r.id;
      } catch (e) { msg.textContent = e.name === 'NotAllowedError' ? 'Confirmação cancelada ou expirada.' : e.message; usar.textContent = 'Usar a digital'; usar.disabled = false; }
    });
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Confirmar pagamento' },
      h('div', { class: 'sheet' }, h('h1', {}, 'Confirmar pagamento'),
        h('div', { class: 'sum', style: 'font-size:16px;font-weight:600' }, h('span', {}, 'Destino recebe'), h('b', { style: 'color:var(--acc)' }, l.valor_txt.replace('.', ',') + ' ' + l.ativo, h('span', { class: 'mut xs', style: 'display:block;font-weight:400' }, '≈ ' + brl(l.valor_brl) + (o.modo !== 'direto' ? ' (no mínimo)' : '')))),
        h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'mut sm' }, 'Para'), enderecoForte(l.endereco)),
        linhaF('Você paga', brl(o.total_brl), o.paga.replace('.', ',') + ' ' + o.origem + ' + taxa ' + o.taxa_rede.replace('.', ',') + ' ' + o.origem),
        linha('Custo', brl(o.custo_brl)),
        linha('Tempo estimado', tempoTxt(o.tempo_s)),
        h('div', { class: 'mut xs' }, (o.modo === 'direto' ? 'O valor exato vai direto para o endereço acima. ' : 'A THORChain converte e entrega no endereço acima; se o preço piorar além do mínimo, devolve o valor para a sua conta (menos as taxas de rede). ') + 'Pagamento em cripto não pode ser desfeito: confira o destino.'),
        msg, usar, h('button', { class: 'btn ghost', type: 'button', onclick: fechar }, 'Cancelar')));
    document.body.append(modal);
  }
  shell('pagar', h('h1', {}, 'Pagar'),
    h('p', { class: 'mut sm' }, 'Pague qualquer pessoa ou fornecedor que aceite Bitcoin, Bitcoin Cash, ETH ou USDC (rede Ethereum). O app mostra de qual saldo sai mais barato.'),
    campo, h('div', { class: 'row', style: 'gap:8px' }, btQR, btFoto, btColar), arqFoto, lido, opcoes, erro, btn,
    h('h2', { style: 'font-size:15px;margin:12px 0 0' }, 'Últimos pagamentos'), recentes);
  listaPagamentos(recentes);
}
function telaPagamento(id) {
  const corpo = h('div', { class: 'col' }, carregando());
  shell('pagar', h('a', { href: '#pagar', class: 'mut sm', style: 'text-decoration:none' }, '‹ Pagar'), h('h1', {}, 'Pagamento #' + id), corpo);
  let inicio = null, fim = null, relogio = null, tick = 0;
  async function atualizar() {
    try {
      const { pagamento: p } = await api('pagar_status', { id: Number(id) });
      const e = p.etapas || {}; const direto = p.modo === 'direto';
      const passos = direto
        ? [['Pagamento registrado', true], ['Enviado à rede ' + (NOME_REDE[p.origem_ativo] || p.origem_ativo), !!p.tx_envio], ['Confirmado na rede', p.status === 'confirmado']]
        : [['Pagamento registrado', true], ['Enviado à THORChain', !!p.tx_envio], ['Depósito confirmado', !!e.confirmado], ['Conversão feita', !!e.trocado], ['Entregue no destino', p.status === 'confirmado']];
      const final = PAG_FINAIS.includes(p.status), atual = final ? -1 : passos.findIndex(([, ok]) => !ok);
      inicio = Date.parse(String(p.criado_em).replace(' ', 'T') + 'Z'); fim = p.faltam_seg != null ? Date.now() + p.faltam_seg * 1000 : null;
      relogio = final ? null : h('span', { class: 'contador' }, '');
      if (p.status === 'confirmado') avisarConfirmacao('pag' + p.id, 'Pagamento confirmado: ' + p.valor + ' ' + p.destino_ativo);
      fill(corpo,
        h('div', { class: 'card', style: 'gap:6px' }, h('div', { class: 'row' }, h('b', { class: 'mono' }, p.valor + ' ' + p.destino_ativo), pagPill(p)),
          h('div', { class: 'mut sm' }, '≈ ' + brl(p.valor_brl) + ' · pago com ' + p.origem_ativo + (p.pago ? ' (' + p.pago + ' + taxa ' + p.taxa_rede + ')' : '')),
          h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'mut xs' }, 'Destino'), enderecoForte(p.destino_completo)),
          p.referencia ? h('div', { class: 'mut xs' }, 'Referência: ' + p.referencia) : null),
        relogio ? h('div', { class: 'card relogio-card' }, h('span', { class: 'giro' }), h('div', { class: 'col', style: 'gap:0' }, relogio, h('span', { class: 'mut xs' }, 'atualiza sozinho a cada 15 s'))) : null,
        h('div', { class: 'steps' }, ...passos.map(([t, ok], i) => i === atual
          ? h('div', { class: 'step agora' }, h('span', { class: 'dot wait' }, ampulheta()), t, h('span', { class: 'pill wait', style: 'margin-left:auto' }, 'Pendente'))
          : h('div', { class: 'step' + (ok ? '' : ' todo') }, h('span', { class: 'dot' + (ok ? ' ok' : '') }, ok ? '✓' : ''), t))),
        p.erro ? h('div', { class: 'warn' }, p.erro) : null,
        p.status === 'reembolsado' ? h('div', { class: 'warn' }, 'O preço mudou além do mínimo garantido: a THORChain não pagou e devolveu o valor para a sua conta (menos as taxas de rede). O destino não recebeu.') : null,
        p.tx_envio || p.tx_entrega ? h('div', { class: 'card', style: 'gap:8px' },
          p.tx_envio ? h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'mut sm' }, 'Saída da sua conta (' + p.origem_ativo + ')' + (direto && p.confirmacoes != null ? ' · ' + p.confirmacoes + ' confirmação(ões)' : '')),
            h('a', { href: p.tx_envio_link, target: '_blank', rel: 'noopener', class: 'mono sm', style: 'word-break:break-all' }, p.tx_envio)) : null,
          p.tx_entrega ? h('div', { class: 'col', style: 'gap:2px' }, h('span', { class: 'mut sm' }, p.status === 'reembolsado' ? 'Devolução (' + p.origem_ativo + ')' : 'Entrada no destino (' + p.destino_ativo + ')'),
            h('a', { href: p.tx_entrega_link, target: '_blank', rel: 'noopener', class: 'mono sm', style: 'word-break:break-all' }, p.tx_entrega)) : null,
          h('button', { class: 'btn ghost', type: 'button', onclick: async ev => { try { await navigator.clipboard.writeText(p.tx_entrega || p.tx_envio); ev.target.textContent = 'Copiado!'; } catch (x) {} } }, 'Copiar TXID (comprovante)')) : null,
        p.link_thor ? h('a', { href: p.link_thor, target: '_blank', rel: 'noopener', class: 'btn ghost' }, 'Ver na THORChain') : null,
        h('a', { class: 'btn', href: '#pagar' }, 'Novo pagamento'));
      mostrar();
      if (final) stopTimer();
    } catch (x) { fill(corpo, h('div', { class: 'err' }, x.message)); stopTimer(); }
  }
  function mostrar() {
    if (!relogio) return;
    if (fim) relogio.textContent = 'Faltam ≈ ' + mmss((fim - Date.now()) / 1000);
    else if (inicio) relogio.textContent = 'Em andamento há ' + mmss((Date.now() - inicio) / 1000);
  }
  atualizar(); timer = setInterval(() => { tick++; mostrar(); if (tick % 15 === 0) atualizar(); }, 1000);
}

/* ---------- roteador ---------- */
function render() {
  if (!SID) { telaLogin(); return; }
  const hsh = (location.hash || '#inicio').slice(1);
  if (hsh !== 'vender') SUG = null;           // a sugestao so vale enquanto voce esta na tela de venda que ela abriu
  if (hsh.startsWith('saque/')) { telaSaque(hsh.slice(6)); return; }
  if (hsh.startsWith('troca/')) { telaTrocaStatus(hsh.slice(6)); return; }
  if (hsh.startsWith('pagamento/')) { telaPagamento(hsh.slice(10)); return; }
  ({ inicio: telaInicio, robos: telaRobos, sacar: telaSacar, trocar: telaTrocar, vender: telaVender, comprar: telaComprar, sacareth: telaSacarEth, pagar: telaPagar }[hsh] || telaInicio)();
}
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=20261029-1').catch(() => {});
render();
