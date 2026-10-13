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
    const e = new Error(j.error || 'Erro inesperado.'); e.codigo = j.codigo; throw e;
  }
  return j;
}
function sair() { LS.del('gn_app_sid'); SID = null; location.hash = ''; render(); }
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

/* ---------- estrutura comum ---------- */
const ICONS = {
  inicio: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  robos: 'M8 8h8a3 3 0 013 3v5a3 3 0 01-3 3H8a3 3 0 01-3-3v-5a3 3 0 013-3zM12 8V4M9 13h.01M15 13h.01M3 13v2M21 13v2',
  sacar: 'M12 19V5M5 12l7-7 7 7',
};
function shell(ativo, ...conteudo) {
  stopTimer();
  APP.replaceChildren(
    h('main', { class: 'main' }, ...conteudo),
    h('nav', { class: 'nav', 'aria-label': 'Navegação principal' },
      ...[['inicio', 'Início'], ['robos', 'Robôs'], ['sacar', 'Sacar']].map(([id, nome]) =>
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
        h('div', { class: 'row', style: 'margin-top:10px' },
          h('a', { class: 'btn', style: 'flex:1', href: '#sacar' }, 'Sacar bitcoin'),
          h('button', { class: 'btn ghost', style: 'flex:1', type: 'button', onclick: telaInicio }, 'Atualizar saldo'))),
      h('div', { class: 'card' },
        h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', {}, h('div', { class: 'mut sm' }, 'BTC · cotação média'), precoEl), varEl), graf, chips),
      h('div', { class: 'row' },
        h('div', { class: 'card', style: 'flex:1;padding:14px;gap:2px' }, h('div', { class: 'mut xs' }, 'Robôs ativos'), h('div', { style: 'font-size:22px;font-weight:600' }, r.robos_ativos, h('span', { class: 'mut', style: 'font-size:14px;font-weight:400' }, ' de ' + r.robos_total))),
        h('div', { class: 'card', style: 'flex:1;padding:14px;gap:2px' }, h('div', { class: 'mut xs' }, 'Lotes abertos'), h('div', { style: 'font-size:22px;font-weight:600' }, r.lotes_abertos))));
    desenhar();
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
  const slider = h('input', { type: 'range', min: 1, max: 50, step: 1, value: 1, 'aria-label': 'Taxa personalizada em sat/vB' });
  const sliderVal = h('span', { class: 'mono' }, '');
  const sliderMin = h('span', {}, ''), sliderMax = h('span', {}, '');

  function tipoSet(t) { S.tipo = t; segBrl.className = t === 'brl' ? 'on' : ''; segBtc.className = t === 'btc' ? 'on' : ''; cur.textContent = t === 'brl' ? 'R$' : 'BTC'; cotar(); }
  segBrl.addEventListener('click', () => tipoSet('brl')); segBtc.addEventListener('click', () => tipoSet('btc'));
  const maxBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { S.tipo = 'max'; inp.value = ''; inp.placeholder = 'Tudo (saldo menos a taxa)'; cotar(); } }, 'Tudo');
  let deb = null;
  inp.addEventListener('input', () => { if (S.tipo === 'max') S.tipo = segBtc.className === 'on' ? 'btc' : 'brl'; S.valor = inp.value; clearTimeout(deb); deb = setTimeout(cotar, 450); });

  function pedido() { const p = { tipo: S.tipo, valor: S.valor, nivel: S.nivel }; if (S.nivel === 'custom') p.taxa = S.taxa; return p; }
  function nivelNome(id) { return { min: 'Econômica', normal: 'Normal', rapida: 'Rápida', custom: 'Personalizada' }[id]; }

  function desenharTaxas() {
    const c = S.cot; if (!c) return;
    feesBox.replaceChildren(
      h('div', { class: 'row' }, h('span', { style: 'font-size:14px;font-weight:500;color:var(--tx2)' }, 'Velocidade do envio'),
        h('span', { class: 'mut xs' }, 'taxa mín. ' + sat(c.faixa.min) + ' · máx. ' + c.faixa.max + ' sat/vB')),
      h('div', { class: 'fees' }, ...c.niveis.filter(n => n.id !== 'custom').map(n => h('button', { type: 'button', class: 'fee' + (S.nivel === n.id ? ' on' : ''),
        onclick: () => { S.nivel = n.id; S.taxa = n.taxa_satvb; slider.value = Math.round(n.taxa_satvb); desenharTaxas(); resumoTotal(); } },
        h('span', { class: 't' }, nivelNome(n.id)), h('span', { class: 'v' }, brl(n.fee_brl)), h('span', { class: 's' }, sat(n.taxa_satvb) + ' sat/vB'),
        h('span', { class: 'e' + (n.blocos > 2 ? ' slow' : '') }, mins(n.eta_min))))),
      h('div', { class: 'card', style: 'padding:8px 12px 6px;gap:2px;border-radius:12px' },
        h('div', { class: 'row mut xs' }, h('span', {}, 'Personalizada'), sliderVal),
        slider, h('div', { class: 'row mut', style: 'font-size:11px' }, sliderMin, sliderMax)));
    sliderMin.textContent = sat(c.faixa.min) + ' sat/vB'; sliderMax.textContent = c.faixa.max + ' sat/vB';
    slider.min = Math.ceil(c.faixa.min); slider.max = c.faixa.max;
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
    const msg = h('div', { class: 'err', role: 'alert' });
    const ok = h('button', { class: 'btn', type: 'button' }, 'Continuar');
    const fechar = v => { modal.remove(); resolve(v); };
    let pk = null, chStr = '';
    const recomecar = () => { pk = null; senha.disabled = false; ok.textContent = 'Continuar'; };
    ok.addEventListener('click', async () => {
      ok.disabled = true; msg.textContent = '';
      try {
        if (!pk) {
          /* 1º toque confere a senha; a digital abre só no 2º toque, porque o Safari do iPhone
           * exige que navigator.credentials.create() venha direto de um toque do usuário. */
          const o = await api('passkey_reg_opcoes', { senha: senha.value });
          pk = o.publicKey; chStr = pk.challenge;
          pk.challenge = b64uToBuf(pk.challenge); pk.user.id = b64uToBuf(pk.user.id);
          pk.excludeCredentials = (pk.excludeCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) }));
          senha.value = ''; senha.disabled = true; ok.textContent = 'Usar a digital'; ok.disabled = false;
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
        h('div', { class: 'mut sm', style: 'line-height:20px' }, 'Para proteger seus saques, vamos vincular a digital (ou o desbloqueio) deste celular à sua conta. Confirme com a senha da conta.'),
        senha, msg, ok, h('button', { class: 'btn ghost', type: 'button', onclick: () => fechar(false) }, 'Agora não')));
    document.body.append(modal);
  });
}

/* ---------- acompanhamento do saque ---------- */
function telaSaque(txid) {
  const corpo = h('div', { class: 'col', style: 'gap:14px' }, carregando('Carregando…'));
  shell('sacar', corpo);
  async function atualizar() {
    try {
      const s = await api('saque_status', { txid });
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
          h('div', { class: 'row' }, h('span', { style: 'font-size:15px;font-weight:600' }, 'Confirmações'), h('span', { class: 'mono', style: 'font-size:15px;color:var(--ok)' }, Math.min(s.confirmacoes, s.alvo) + ' de ' + s.alvo)),
          barra, h('div', { class: 'steps' }, ...passos),
          !feito && s.eta_alvo_min != null ? h('div', { class: 'mut xs' }, 'Previsão para a ' + s.alvo + 'ª confirmação: ' + mins(s.eta_alvo_min) + '. O tempo de cada bloco varia; é uma estimativa.') : null),
        h('div', { class: 'card' }, h('div', { class: 'mut sm' }, 'TXID da transação'),
          h('div', { class: 'mono', style: 'font-size:13px;line-height:20px;word-break:break-all' }, s.txid),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', style: 'flex:1', type: 'button', onclick: async ev => { try { await navigator.clipboard.writeText(s.txid); ev.target.textContent = 'Copiado!'; } catch (e) { ev.target.textContent = 'Copie manualmente'; } } }, 'Copiar TXID'),
            h('a', { class: 'btn ghost', style: 'flex:1', href: s.explorer, target: '_blank', rel: 'noopener noreferrer' }, 'Ver no explorador'))),
        !feito && s.atualizado_ha_seg != null ? h('div', { class: 'mut xs', style: 'text-align:center' }, 'Atualizado ' + (s.atualizado_ha_seg < 90 ? 'agora há pouco' : 'há ' + Math.round(s.atualizado_ha_seg / 60) + ' min') + ' · a rede é checada a cada 5 min') : null,
        h('a', { class: 'btn', href: '#inicio' }, 'Voltar ao início'));
      if (feito || s.estado === 'substituida') stopTimer();
    } catch (e) { fill(corpo, h('div', { class: 'err' }, e.message), h('a', { class: 'btn ghost', href: '#sacar' }, 'Voltar')); stopTimer(); }
  }
  atualizar(); timer = setInterval(() => { if (!document.hidden) atualizar(); }, 60000);
}

/* ---------- roteador ---------- */
function render() {
  if (!SID) { telaLogin(); return; }
  const hsh = (location.hash || '#inicio').slice(1);
  if (hsh.startsWith('saque/')) { telaSaque(hsh.slice(6)); return; }
  ({ inicio: telaInicio, robos: telaRobos, sacar: telaSacar }[hsh] || telaInicio)();
}
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=20261013-1').catch(() => {});
render();
