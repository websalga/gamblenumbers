'use strict';
/* ============================================================
 * identity.js — Identificação anônima por fingerprint
 * Fluxo: idioma → fingerprint → modal endereços → terminal verde → SQL
 * Expõe: window.GNIdentity
 * ============================================================ */
(function () {

  /* Versao exibida no badge "chaveiro" no topo dos modais. Atualizar a
   * cada release (ver CHANGELOG.md). */
  const APP_VERSION = '1.7.1';

  /* --- i18n: idioma é a PRIMEIRA coisa perguntada, antes de qualquer
   * outra mensagem. Escolha salva em localStorage (gn_idioma) e usada
   * em toda visita futura, até o usuário trocar (ou apagar tudo). --- */
  const LK = 'gn_idioma';
  function currentLang() { try { return localStorage.getItem(LK) || ''; } catch (e) { return ''; } }
  function saveLang(code) { try { localStorage.setItem(LK, code); } catch (e) { } }
  function t(key, fallback) {
    const s = window.I18N && window.I18N.t ? window.I18N.t(key) : null;
    return (s && s !== key) ? s : fallback;
  }

  /* --- SHA-256 nativo (SubtleCrypto) --- */
  async function sha256(str) {
    const buf  = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2,'0')).join('');
  }

  /* --- Coleta fingerprint do dispositivo --- */
  async function collectFingerprint() {
    const c = {};
    c.ua       = navigator.userAgent  || '';
    c.lang     = navigator.language   || '';
    c.langs    = (navigator.languages || []).join(',');
    c.tz       = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    c.cpu      = navigator.hardwareConcurrency || 0;
    c.mem      = navigator.deviceMemory        || 0;
    c.platform = navigator.platform            || '';
    c.sw       = screen.width;  c.sh = screen.height;
    c.cd       = screen.colorDepth;
    c.dpr      = (window.devicePixelRatio||1).toFixed(2);
    c.avail    = screen.availWidth+'x'+screen.availHeight;
    c.touch    = navigator.maxTouchPoints || 0;
    c.plugins  = (navigator.plugins||[]).length;
    try {
      const cv = document.createElement('canvas'); cv.width=200; cv.height=40;
      const cx = cv.getContext('2d');
      cx.font='14px Arial'; cx.fillStyle='#f60'; cx.fillRect(125,1,62,20);
      cx.fillStyle='#069'; cx.fillText('GN-Identity-FP',2,15);
      cx.fillStyle='rgba(102,204,0,.7)'; cx.fillText('GN-Identity-FP',4,17);
      c.canvas = cv.toDataURL().slice(-64);
    } catch(e){ c.canvas='err'; }
    try {
      const gl  = document.createElement('canvas').getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      c.glv = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   : '';
      c.glr = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    } catch(e){ c.glv=''; c.glr=''; }
    try {
      const ac = new (window.AudioContext||window.webkitAudioContext)();
      c.audio = ac.sampleRate; ac.close();
    } catch(e){ c.audio=0; }
    const hash = await sha256(Object.values(c).join('|'));
    return { hash };
  }

  /* --- Estilos injetados uma vez --- */
  function injectStyles() {
    if (document.getElementById('gn-id-css')) return;
    const s = document.createElement('style'); s.id='gn-id-css';
    s.textContent = `
#gn-overlay{position:fixed;inset:0;background:rgba(4,8,20,.93);display:flex;
  flex-direction:column;gap:16px;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)}

/* --- Badge "chaveiro": placa de metal esmaltado com o nome e a versao,
 * exibida no topo de todo modal/terminal do GambleNumbers. --- */
.gn-badge{display:flex;align-items:center;filter:drop-shadow(0 6px 12px rgba(0,0,0,.55));
  user-select:none;-webkit-user-select:none}
.gn-badge-ring{width:22px;height:22px;border-radius:50%;flex-shrink:0;margin-right:-7px;
  position:relative;z-index:2;border:4px solid #cbd5e1;
  background:linear-gradient(145deg,#f8fafc,#94a3b8 55%,#5b6b82);
  box-shadow:inset 0 1px 1px rgba(255,255,255,.95),inset 0 -2px 3px rgba(0,0,0,.55),
    0 1px 2px rgba(0,0,0,.45)}
.gn-badge-ring::after{content:'';position:absolute;inset:5px;border-radius:50%;
  background:#0a0f1c;box-shadow:inset 0 1px 2px rgba(0,0,0,.8)}
.gn-badge-plate{position:relative;z-index:1;overflow:hidden;display:flex;
  flex-direction:column;align-items:center;justify-content:center;gap:2px;
  padding:9px 24px 8px 28px;border-radius:9px;
  background:linear-gradient(135deg,#1c2c4d,#0a1120 55%,#141f38);
  border:1.5px solid #3a4d78;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -3px 6px rgba(0,0,0,.6),
    0 3px 8px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.4)}
.gn-badge-plate::before{content:'';position:absolute;top:0;left:0;right:0;height:48%;
  background:linear-gradient(to bottom,rgba(255,255,255,.32),rgba(255,255,255,0));
  pointer-events:none}
.gn-badge-title{position:relative;font:800 13px/1.1 Arial,Helvetica,sans-serif;
  letter-spacing:1.8px;color:#22d3ee;white-space:nowrap;
  text-shadow:0 1px 0 rgba(255,255,255,.28),0 -1px 1px rgba(0,0,0,.75),
    0 0 7px rgba(34,211,238,.55)}
.gn-badge-ver{position:relative;font:700 9px/1 'Courier New',monospace;letter-spacing:1.2px;
  color:#93c5fd;opacity:.9;text-shadow:0 1px 1px rgba(0,0,0,.65)}
#gn-modal{background:#0d1424;border:1px solid #1e2a44;border-radius:14px;
  padding:32px 36px;width:480px;max-width:95vw;box-shadow:0 0 60px rgba(34,211,238,.08)}
#gn-modal h2{font-size:17px;font-weight:700;color:#e8edf7;margin-bottom:6px}
#gn-modal .sub{font-size:12px;color:#7d8aa3;margin-bottom:22px;line-height:1.6}
.gn-f{margin-bottom:14px}
.gn-f label{display:block;font-size:11px;font-weight:600;color:#7d8aa3;
  margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px}
.gn-f input{width:100%;background:#070c18;border:1px solid #1e2a44;border-radius:8px;
  padding:10px 12px;color:#e8edf7;font-size:12px;font-family:monospace;outline:none;
  transition:border-color .2s}
.gn-f input:focus{border-color:#22d3ee}
.gn-f input::placeholder{color:#3a4560}
.gn-notice{background:#0a1020;border:1px solid #1e2a44;border-radius:8px;
  padding:11px 13px;font-size:11px;color:#7d8aa3;margin-bottom:20px;line-height:1.7}
.gn-notice b{color:#22d3ee}
.gn-btns{display:flex;gap:10px}
.gn-br{flex:1;background:#22d3ee;color:#04212a;border:none;border-radius:8px;
  padding:11px;font-weight:700;font-size:13px;cursor:pointer;transition:opacity .15s}
.gn-br:hover{opacity:.85} .gn-br:disabled{opacity:.4;cursor:not-allowed}
.gn-bs{background:transparent;color:#7d8aa3;border:1px solid #1e2a44;border-radius:8px;
  padding:11px 14px;font-size:12px;cursor:pointer;transition:border-color .2s,color .2s;white-space:nowrap}
.gn-bs:hover{border-color:#7d8aa3;color:#e8edf7}
#gn-term{background:#050e05;border:1px solid #0f4a0f;border-radius:10px;
  padding:22px 24px;width:520px;max-width:95vw;
  font-family:'Courier New',monospace;font-size:12px;
  box-shadow:0 0 40px rgba(34,197,94,.1)}
.t-title{color:#22c55e;font-size:11px;font-weight:700;margin-bottom:14px;
  border-bottom:1px solid #0f4a0f;padding-bottom:10px;letter-spacing:1px}
.t-line{display:flex;align-items:flex-start;gap:8px;margin-bottom:7px;
  min-height:18px;opacity:0;transition:opacity .15s}
.t-line.vis{opacity:1}
.t-pr{color:#16a34a;flex-shrink:0}
.t-tx{color:#86efac;flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word}
.t-bar{display:inline-flex;gap:1px;flex-shrink:0}
.t-bar span{display:inline-block;width:6px;height:10px;background:#0f4a0f;
  border-radius:1px;transition:background .07s}
.t-bar span.on{background:#22c55e}
.t-st{flex-shrink:0;font-weight:700}
.t-st.ok{color:#22c55e} .t-st.er{color:#ef4444} .t-st.sk{color:#7d8aa3}
.t-foot{margin-top:14px;padding-top:11px;border-top:1px solid #0f4a0f;
  color:#22c55e;font-size:13px;font-weight:700;text-align:center;
  opacity:0;transition:opacity .4s}
.t-foot.vis{opacity:1}
.gn-danger-notice{background:#2a1608;border:1px solid #7c3a12;border-radius:8px;
  padding:12px 14px;font-size:12px;color:#fbbf24;margin-bottom:20px;line-height:1.8}
.gn-danger-notice b{color:#fb923c}
.gn-btn-danger{flex:1;background:#f97316;color:#2a1608;border:none;border-radius:8px;
  padding:11px;font-weight:700;font-size:13px;cursor:pointer;transition:opacity .15s}
.gn-btn-danger:hover{opacity:.85}
#gn-term.gn-term-red{border-color:#7c1d1d;background:#170606;
  box-shadow:0 0 40px rgba(239,68,68,.12)}
.gn-term-red .t-title{color:#ef4444;border-bottom-color:#7c1d1d}
.gn-term-red .t-pr{color:#dc2626}
.gn-term-red .t-tx{color:#fca5a5}
.gn-term-red .t-bar span{background:#4a0f0f}
.gn-term-red .t-bar span.on{background:#ef4444}
.gn-term-red .t-foot{border-top-color:#7c1d1d}
#gn-term.gn-term-amber{border-color:#7c5a12;background:#170f02;
  box-shadow:0 0 40px rgba(245,158,11,.12)}
.gn-term-amber .t-title{color:#f59e0b;border-bottom-color:#7c5a12}
.gn-term-amber .t-pr{color:#d97706}
.gn-term-amber .t-tx{color:#fcd34d}
.gn-term-amber .t-bar span{background:#4a2f02}
.gn-term-amber .t-bar span.on{background:#f59e0b}
.gn-term-amber .t-foot{border-top-color:#7c5a12}
.gn-lang-modal{width:540px;text-align:center}
#gn-modal.gn-modal-blue{border-color:#1e4a7c;box-shadow:0 0 60px rgba(56,131,238,.12)}
.gn-modal-blue h2{color:#5ab0ff}
.gn-modal-blue .gn-br{background:#3883ee;color:#04142a}
.gn-warn-notice{background:#1a1204;border:1px solid #7c5a12;border-radius:8px;
  padding:12px 14px;font-size:12px;color:#fcd34d;margin-bottom:20px;line-height:1.8}
.gn-warn-notice b{color:#f59e0b}

.gn-lang-hint{font-size:12px;color:#7d8aa3;margin-bottom:18px;letter-spacing:.3px}
.gn-lang-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.gn-lang-btn{display:flex;flex-direction:column;align-items:center;gap:6px;background:#070c18;
  border:1px solid #1e2a44;border-radius:10px;padding:14px 8px;cursor:pointer;color:#e8edf7;
  font-size:12px;transition:border-color .2s,background .2s;font-family:inherit}
.gn-lang-btn:hover{border-color:#22d3ee;background:#0d1424}
.gn-lang-flag{font-size:26px;line-height:1}`;
    document.head.appendChild(s);

    if (!window.__gnBadgeObs) {
      window.__gnBadgeObs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.id === 'gn-overlay' && !node.querySelector('.gn-badge')) {
              var b = document.createElement('div');
              b.className = 'gn-badge';
              b.innerHTML = '<span class=\"gn-badge-ring\"></span>' +
                '<span class=\"gn-badge-plate\"><span class=\"gn-badge-title\">GAMBLE NUMBERS</span>' +
                '<span class=\"gn-badge-ver\">v' + APP_VERSION + '</span></span>';
              node.insertBefore(b, node.firstChild);
            }
          }
        }
      });
      window.__gnBadgeObs.observe(document.body, { childList: true });
    }
  }

  /* --- Tela de escolha de idioma: a PRIMEIRA coisa mostrada ao usuário,
   * antes de qualquer outro texto do site. Bandeiras + nomes nativos
   * (já vêm de I18N.IDIOMAS, então não depende de tradução alguma). --- */
  function showLanguagePicker() {
    return new Promise(res => {
      injectStyles();
      const ov = document.createElement('div'); ov.id='gn-overlay';
      const idiomas = (window.I18N && window.I18N.IDIOMAS) || [{codigo:'pt-BR',bandeira:'🇧🇷',nome:'Português'}];
      const btns = idiomas.map(o =>
        `<button class="gn-lang-btn" data-code="${o.codigo}"><span class="gn-lang-flag">${o.bandeira}</span><span>${o.nome}</span></button>`
      ).join('');
      ov.innerHTML = `<div id="gn-modal" class="gn-lang-modal">
        <div class="gn-lang-hint">🌐 Language · Idioma · Langue · Sprache · 言語 · Taal · Язык · Dil · 语言</div>
        <div class="gn-lang-grid">${btns}</div>
      </div>`;
      document.body.appendChild(ov);
      ov.querySelectorAll('.gn-lang-btn').forEach(btn => {
        btn.onclick = () => { const code = btn.getAttribute('data-code'); ov.remove(); res(code); };
      });
    });
  }

  /* --- Garante que o idioma foi escolhido (ou já estava salvo) e que
   * o I18N está carregado com ele ANTES de qualquer outra tela. --- */
  async function ensureLanguage() {
    let lang = currentLang();
    if (!lang) {
      lang = await showLanguagePicker();
      saveLang(lang);
      // Recarrega a pagina uma vez: garante que app.js (que le o idioma
      // no boot, de forma sincrona) e identity.js nasçam consistentes,
      // em vez de identity.js aplicar a traducao so nos seus proprios
      // modais enquanto o app por tras continua no idioma antigo.
      location.reload();
      return new Promise(() => {}); // nunca resolve; a navegacao assume
    }
    if (window.I18N && window.I18N.load) {
      try { await window.I18N.load(lang); } catch (e) { /* segue com fallback pt-BR */ }
    }
    return lang;
  }

  /* --- Modal de endereços --- */
  function showModal() {
    return new Promise(res => {
      injectStyles();
      const ov = document.createElement('div'); ov.id='gn-overlay';
      ov.innerHTML=`<div id="gn-modal">
        <h2>${t('ident_titulo','🔐 Identificação Anônima')}</h2>
        <p class="sub">${t('ident_sub_v2','[PROVISÓRIO] O site vai gerar dois endereços (BTC e BCH) próprios pra você depositar, se quiser operar de verdade. Termos completos em breve.')}</p>
        <div class="gn-btns">
          <button class="gn-br" id="gi-ok">${t('ident_btn_ok_v2','Gerar meus endereços (modo real)')}</button>
          <button class="gn-bs" id="gi-sim">${t('ident_btn_sim','Simular apenas')}</button>
        </div></div>`;
      document.body.appendChild(ov);
      document.getElementById('gi-sim').onclick = () => { ov.remove(); res({mode:'sim'}); };
      document.getElementById('gi-ok').onclick  = () => { ov.remove(); res({mode:'real'}); };
    });
  }

  /* --- Terminal verde (ou vermelho, via opts.danger) --- */
  function showTerminal(steps, opts) {
    opts = opts || {};
    const title = opts.title || t('term_title_default','▶ GAMBLENUMBERS · PROTOCOLO DE IDENTIFICAÇÃO ANÔNIMA');
    return new Promise(res => {
      injectStyles();
      const ov = document.createElement('div'); ov.id='gn-overlay';
      ov.innerHTML=`<div id="gn-term" class="${opts.danger ? 'gn-term-red' : (opts.theme==='amber' ? 'gn-term-amber' : '')}">
        <div class="t-title">${title}</div>
        <div id="t-lines"></div>
        <div class="t-foot" id="t-foot"></div></div>`;
      document.body.appendChild(ov);
      const container = document.getElementById('t-lines');

      async function runStep(step) {
        const ln = document.createElement('div'); ln.className='t-line';
        const bars = Array.from({length:10},()=>'<span></span>').join('');
        ln.innerHTML=`<span class="t-pr">></span>
          <span class="t-tx" id="tx-${step.id}">${step.label}...</span>
          <span class="t-bar" id="bar-${step.id}">${bars}</span>
          <span class="t-st" id="st-${step.id}"></span>`;
        container.appendChild(ln);
        requestAnimationFrame(()=>ln.classList.add('vis'));

        const barEl = document.getElementById('bar-'+step.id);
        const spans = barEl.querySelectorAll('span');
        let fi=0;
        const iv = setInterval(()=>{ if(fi<10){ spans[fi].classList.add('on'); fi++; } }, (step.ms||800)/12);

        let r, excecaoJs = null;
        try { r = await step.fn(); } catch(e){ excecaoJs = e; r={ok:false,text:t('term_erro','ERRO'), detail:String(e && e.message || e)}; }

        console.log('[gn-terminal]', step.id, r);
        if (!r.ok) {
          try {
            fetch('identity.php', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({
                action:'log_cliente', etapa:'terminal_step_falhou',
                dados:{ step_id: step.id, label: step.label, resultado: r, excecao_js: excecaoJs ? String(excecaoJs.stack||excecaoJs.message) : null },
              }),
            }).catch(()=>{});
          } catch(e) {}
        }

        clearInterval(iv); spans.forEach(s=>s.classList.add('on'));
        await new Promise(r2=>setTimeout(r2,80));

        const stEl = document.getElementById('st-'+step.id);
        if (r.skip){ stEl.className='t-st sk'; stEl.textContent=t('term_pulado','PULADO'); }
        else if(r.ok){ stEl.className='t-st ok'; stEl.textContent=r.text||t('term_ok_status','OK'); }
        else { stEl.className='t-st er'; stEl.textContent=r.text||t('term_falhou_status','FALHOU'); }

        if(r.detail) document.getElementById('tx-'+step.id).textContent=step.label+' '+r.detail;
        await new Promise(r2=>setTimeout(r2,180));
        return r;
      }

      (async()=>{
        const results=[];
        for(const step of steps){ const r=await runStep(step); results.push(r); if(r.fatal)break; }
        const ok = results.every(r=>r.ok||r.skip);
        const ft = document.getElementById('t-foot');
        ft.textContent = ok
          ? (opts.okText   || t('term_ok_default','✓ PERFIL APROVADO PARA OPERAÇÕES REAIS'))
          : (opts.failText || t('term_fail_default','✗ VERIFICAÇÃO INCOMPLETA · MODO SIMULAÇÃO'));
        ft.style.color = ok ? '#22c55e' : '#ef4444';
        ft.classList.add('vis');
        await new Promise(r=>setTimeout(r,2200));
        ov.remove(); res({ok,results});
      })();
    });
  }

  /* --- Backend call --- */
  async function api(action, payload) {
    const r = await fetch('/identity.php', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({action,...payload})
    });
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  /* --- Sessão local --- */
  const SK = 'gn_session';
  const loadSess = () => { try{ return JSON.parse(localStorage.getItem(SK)); }catch(e){return null;} };
  const saveSess = d  => { try{ localStorage.setItem(SK,JSON.stringify(d)); }catch(e){} };

  /* --- Init principal --- */
  function showLoginSenha() {
    return new Promise(res => {
      injectStyles();
      const ov = document.createElement('div'); ov.id='gn-overlay';
      ov.innerHTML = `<div id="gn-modal">
        <h2>🔑 Já tem uma senha?</h2>
        <p class="sub">${t('login_senha_sub','Se você já configurou uma senha de acesso em outro navegador ou aparelho, digite ela aqui pra recuperar suas moedas. Primeiro acesso, ou ainda não tem senha? Deixe em branco e clique em Continuar.')}</p>
        <div class="gn-f"><label>${t('login_senha_label','Senha (opcional)')}</label>
          <input id="li-senha" type="password" placeholder="${t('login_senha_placeholder','deixe em branco se não tiver')}" autocomplete="current-password"></div>
        <div class="gn-btns">
          <button class="gn-br" id="li-ok">${t('login_senha_btn','Continuar')}</button>
        </div></div>`;
      document.body.appendChild(ov);
      const btn = document.getElementById('li-ok');
      btn.onclick = async () => {
        const senha = document.getElementById('li-senha').value;
        if (!senha) { ov.remove(); res({status:'blank'}); return; }
        btn.disabled = true; btn.textContent = '...';
        try {
          const r = await api('login_senha', {senha});
          ov.remove();
          if (r.matched) res({status:'matched', session:r});
          else res({status:'no_match'});
        } catch(e) { ov.remove(); res({status:'no_match'}); }
      };
    });
  }

  function avisarSenha(session, loginStatus) {
    if (loginStatus === 'no_match') {
      alert(t('aviso_senha_nao_bateu','A senha digitada não bateu com nenhum perfil. Você entrou como um usuário novo. Se quiser, configure uma senha em Configuração para não perder acesso.'));
    } else if (session && session.tem_senha === false) {
      alert(t('aviso_sem_senha','Você ainda não tem uma senha de acesso configurada. Sem ela, só consegue acessar suas moedas por este navegador/aparelho. Configure uma senha em Configuração pra poder acessar de qualquer lugar.'));
    }
  }

  async function init() {
    // Idioma primeiro: antes de qualquer outra mensagem do site.
    await ensureLanguage();

    // Sessão já existente NESTE navegador? Se sim, entra direto — sem pedir senha de novo.
    const cached = loadSess();
    if (cached && cached.session_id) {
      try {
        const ck = await api('check', {session_id: cached.session_id});
        if (ck.valid) {
          window.GNIdentity.session = ck;
          window.dispatchEvent(new CustomEvent('gn:identity:ready', {detail:ck}));
          avisarSenha(ck, null);
          return;
        }
      } catch(e) { /* continua para o login por senha / modal */ }
    }

    // Sem sessão local válida (primeiro acesso, ou depois de um "Sair"): oferece login por senha.
    const login = await showLoginSenha();
    if (login.status === 'matched') {
      saveSess(login.session);
      window.GNIdentity.session = login.session;
      const idiomaConta = login.session.idioma_preferido;
      if (idiomaConta && idiomaConta !== currentLang()) {
        saveLang(idiomaConta);
        location.reload();
        return new Promise(() => {});
      }
      window.dispatchEvent(new CustomEvent('gn:identity:ready', {detail: login.session}));
      return;
    }

    // Modal de endereços
    const modal = await showModal();
    if (modal.mode === 'sim') {
      const s = {mode:'simulation', btc_habilitado:false, bch_habilitado:false};
      window.GNIdentity.session = s;
      window.dispatchEvent(new CustomEvent('gn:identity:ready', {detail:s}));
      return;
    }

    // Terminal de verificação
    let fpData, sessionData;
    await showTerminal([
      { id:'fp',      label:t('term_step_fp','Coletando impressão digital do dispositivo'), ms:800,
        fn: async()=>{ fpData=await collectFingerprint(); return {ok:true}; } },
      { id:'profile',  label:t('term_step_profile','Gerando seus endereços de depósito'), ms:1200,
        fn: async()=>{
          const r=await api('create_profile',{
            fingerprint_hash: fpData.hash,
            user_agent:  navigator.userAgent,
            idioma: currentLang(),
          });
          if(r.session_id){ saveSess(r); sessionData=r; window.GNIdentity.session=r; }
          return r.session_id
            ? {ok:true, detail:'· BTC + BCH'}
            : {ok:false,text:t('term_erro','ERRO'),fatal:true};
        }},
      { id:'approve',  label:t('term_step_approve','Perfil pronto para operações'), ms:400,
        fn: async()=>{
          return sessionData
            ? {ok:true, detail:'· '+t('term_habilitados','habilitado(s)')}
            : {ok:false, text:t('term_sem_moedas','ERRO')};
        }}
    ]);

    window.dispatchEvent(new CustomEvent('gn:identity:ready',
      {detail: window.GNIdentity.session || {mode:'simulation'}}));
    avisarSenha(window.GNIdentity.session, login.status);

    // Exibição provisória dos endereços gerados (versão mínima, sem download/termos ainda)
    if (sessionData && sessionData.btc_address) {
      injectStyles();
      const ov = document.createElement('div'); ov.id='gn-overlay';
      ov.innerHTML = `<div id="gn-modal">
        <h2>${t('ident_enderecos_titulo','[PROVISÓRIO] Seus endereços de depósito reais')}</h2>
        <div class="gn-f"><label>BTC</label><input readonly value="${sessionData.btc_address}" onclick="this.select()"></div>
        <div class="gn-f"><label>BCH</label><input readonly value="${sessionData.bch_address}" onclick="this.select()"></div>
        <div class="gn-notice">${t('ident_enderecos_aviso','Guarde estes endereços — qualquer valor real enviado a eles passa a valer como seu saldo no site. Tela de termos completos e download ainda em construção.')}</div>
        <div class="gn-btns"><button class="gn-br" id="gi-fechar">OK</button></div></div>`;
      document.body.appendChild(ov);
      document.getElementById('gi-fechar').onclick = () => ov.remove();
    }
  }

  /* --- Reconsulta saldo on-chain dos enderecos ja salvos (botao "atualizar saldo") ---
   * So faz sentido em modo real (ha session_id). Atualiza window.GNIdentity.session,
   * o cache local (localStorage) e dispara 'gn:identity:updated' p/ quem estiver
   * escutando (app.js) recalcular e re-renderizar o saldo. Retorna a sessao
   * atualizada, ou null se nao havia sessao real ou a chamada falhou. */
  async function refresh() {
    const s = window.GNIdentity.session;
    if (!s || !s.session_id) return null;
    try {
      const r = await api('refresh_balance', { session_id: s.session_id });
      if (!r || r.error) return null;
      const merged = Object.assign({}, s, r);
      window.GNIdentity.session = merged;
      saveSess(merged);
      window.dispatchEvent(new CustomEvent('gn:identity:updated', { detail: merged }));
      return merged;
    } catch (e) { return null; }
  }

  /* --- Confirmacao (laranja) antes de apagar tudo --- */
  function showWipeConfirm() {
    return new Promise(res => {
      injectStyles();
      const ov = document.createElement('div'); ov.id='gn-overlay';
      ov.innerHTML=`<div id="gn-modal">
        <h2>${t('wipe_titulo','⚠️ Sair e apagar todos os meus dados')}</h2>
        <div class="gn-danger-notice">${t('wipe_aviso','<b>Essa ação é irreversível.</b> Ao prosseguir, suas informações que você usou no site, incluindo as que você informou; todo o histórico de sessão, ordens e saldos vinculados a este perfil no servidor; e os dados salvos neste navegador (identificação, simulações e preferências) serão esquecidos para sempre.<br><br>Depois disso não restará nenhum registro de que você já usou o gamblenumbers, nem mesmo em modo simulação. Você pode voltar a usar o site normalmente depois, mas começando do zero, como um visitante novo.<br><br><b>IMPORTANTE:</b> Seus endereços informados são seus e permanecem da mesma forma como estão agora, mas não estarão mais registrados aqui no site.')}</div>
        <div class="gn-btns">
          <button class="gn-btn-danger" id="gi-wipe-ok">${t('wipe_btn_ok','Sim, Limpar informações e Sair')}</button>
          <button class="gn-bs" id="gi-wipe-cancel">${t('wipe_btn_cancel','Cancelar')}</button>
        </div></div>`;
      document.body.appendChild(ov);
      document.getElementById('gi-wipe-cancel').onclick = () => { ov.remove(); res(false); };
      document.getElementById('gi-wipe-ok').onclick     = () => { ov.remove(); res(true);  };
    });
  }

  /* --- Apaga todos os bancos IndexedDB do simulador (best-effort) --- */
  async function clearAllIndexedDBs() {
    try {
      if (!('indexedDB' in window)) return;
      let names = [];
      if (indexedDB.databases) {
        const list = await indexedDB.databases();
        names = list.map(d => d.name).filter(n => n === 'btc_simulador' || /^simulador_/.test(n));
      } else {
        names = ['btc_simulador'];
      }
      await Promise.all(names.map(n => new Promise(r => {
        const req = indexedDB.deleteDatabase(n);
        req.onsuccess = req.onerror = req.onblocked = () => r();
      })));
    } catch (e) { /* melhor esforco, nao bloqueia o fluxo */ }
  }

  /* --- Sair e apagar tudo: confirmacao -> terminal vermelho -> reload --- */
  async function wipe() {
    const confirmado = await showWipeConfirm();
    if (!confirmado) return;

    const s = window.GNIdentity.session || {};
    const sid = s.session_id || null;

    const steps = [];
    if (sid) {
      steps.push({ id:'wipe-db', label:t('wipe_step_db','Apagando perfil e histórico no servidor'), ms:900,
        fn: async () => {
          try {
            const r = await api('wipe_profile', { session_id: sid });
            return (r && r.ok) ? {ok:true} : {ok:false, text:t('term_falhou_status','FALHOU')};
          } catch (e) { return {ok:false, text:t('term_falhou_status','FALHOU')}; }
        }});
    }
    steps.push(
      { id:'wipe-local', label:t('wipe_step_local','Apagando identificacao salva neste navegador'), ms:500,
        fn: async () => { try { localStorage.clear(); } catch(e){} return {ok:true}; } },
      { id:'wipe-session', label:t('wipe_step_session','Apagando dados de sessao'), ms:400,
        fn: async () => { try { sessionStorage.clear(); } catch(e){} return {ok:true}; } },
      { id:'wipe-idb', label:t('wipe_step_idb','Apagando simulacoes salvas (IndexedDB)'), ms:700,
        fn: async () => { await clearAllIndexedDBs(); return {ok:true}; } }
    );

    await showTerminal(steps, {
      danger: true,
      title: t('wipe_term_title','▶ GAMBLENUMBERS · PROTOCOLO DE SAIDA E LIMPEZA TOTAL'),
      okText: t('wipe_ok','✓ TODOS OS DADOS FORAM APAGADOS'),
      failText: t('wipe_fail','✗ LIMPEZA CONCLUIDA COM PENDENCIAS')
    });

    window.GNIdentity.session = null;
    location.reload();
  }

  function wireWipeButton() {
    const btn = document.getElementById('btnSairApagar');
    if (btn && !btn._gnWired) { btn._gnWired = true; btn.addEventListener('click', logoutSimples); }
  }

  function logoutSimples() {
    if (!confirm(t('logout_confirm','Sair deste navegador? Suas moedas continuam salvas — use sua senha pra acessar de novo, aqui ou em qualquer outro aparelho.'))) return;
    try { localStorage.removeItem(SK); } catch(e) {}
    location.reload();
  }

  window.GNIdentity = { session: null, init, refresh, wipe, showTerminal, _api: api, _saveSess: saveSess, _injectStyles: injectStyles, logoutSimples };
  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', init);
    document.addEventListener('DOMContentLoaded', wireWipeButton);
  } else { init(); wireWipeButton(); }

})();

/* ============================================================
 * Configuração de saída + Saque para carteira externa
 * ============================================================ */
(function(){
  function t(key, fallback) {
    const s = window.I18N && window.I18N.t ? window.I18N.t(key) : null;
    return (s && s !== key) ? s : fallback;
  }
  function showConfigSaida(atual) {
    window.GNIdentity._injectStyles();
    const ov = document.createElement('div'); ov.id='gn-overlay';
    ov.innerHTML = `<div id="gn-modal" class="gn-modal-blue" style="max-height:88vh;overflow-y:auto">
      <h2>⚙️ ${t('cfg_titulo','Configuração')}</h2>

      <h3 style="font-size:13px;color:#5ab0ff;margin:18px 0 6px">${t('cfg_secao_endereco','Endereço de saída')}</h3>
      <p class="sub">${t('cfg_endereco_sub','Escolha a moeda e o endereço externo pra onde você vai querer transferir tudo, ou usar ao encerrar sua conta. Pode alterar depois, mas só antes de sacar tudo ou fazer o wipe.')}</p>
      <div class="gn-f"><label>${t('cfg_moeda_label','Moeda de saída')}</label>
        <select id="cfg-moeda">
          <option value="BTC" ${atual&&atual.moeda_saida==='BTC'?'selected':''}>BTC</option>
          <option value="BCH" ${atual&&atual.moeda_saida==='BCH'?'selected':''}>BCH</option>
        </select></div>
      <div class="gn-f"><label>${t('cfg_secao_endereco','Endereço de saída')}</label>
        <input id="cfg-endereco" placeholder="${t('cfg_endereco_placeholder','seu endereço externo')}" value="${atual&&atual.endereco_saida?atual.endereco_saida:''}" autocomplete="off" spellcheck="false"></div>
      <div class="gn-warn-notice"><b>${t('aviso_label','Atenção:')}</b> ${t('cfg_endereco_aviso','o endereço informado aqui será usado para escoar (transferir pra fora) o saldo real da sua conta no site. Se você informar um endereço errado, ou não tiver certeza e domínio total sobre ele, o valor enviado pode ser')} <b>${t('perdido_para_sempre','perdido para sempre')}</b>. ${t('cfg_endereco_aviso2','O site não tem como reverter isso e não se responsabiliza por endereço incorreto ou equívoco do usuário.')}</div>
      <div class="gn-btns"><button class="gn-br" id="cfg-ok">${t('cfg_salvar_endereco_btn','Salvar endereço')}</button></div>
      <div id="cfg-msg" style="font-size:12px;min-height:16px;margin-top:6px"></div>

      <hr style="border:none;border-top:1px solid #1e2a44;margin:22px 0">

      <h3 style="font-size:13px;color:#5ab0ff;margin:0 0 6px">🔑 ${t('cfg_secao_senha','Senha de acesso')}</h3>
      <p class="sub">${t('cfg_senha_sub','Permite acessar suas mesmas moedas de qualquer navegador ou aparelho — celular, computador do trabalho, etc. Mínimo 8 caracteres, com maiúscula, minúscula e número.')}</p>
      <div class="gn-f"><label>${t('cfg_senha_label','Senha')}</label>
        <input id="sen-a" type="password" placeholder="${t('cfg_senha_placeholder','Mínimo 8 caracteres')}" autocomplete="new-password" spellcheck="false"></div>
      <div class="gn-f"><label>${t('cfg_confirmar_senha_label','Confirmar senha')}</label>
        <input id="sen-b" type="password" placeholder="${t('cfg_confirmar_senha_placeholder','Digite de novo')}" autocomplete="new-password" spellcheck="false"></div>
      <div class="gn-f"><label style="display:flex;align-items:center;gap:8px;font-weight:400;text-transform:none">
        <input type="checkbox" id="sen-ver" style="width:auto"> ${t('cfg_mostrar_senha','Mostrar senha')}</label></div>
      <div class="gn-warn-notice"><b>${t('aviso_label','Atenção:')}</b> ${t('cfg_senha_aviso','essa senha é a ÚNICA forma de recuperar acesso às suas moedas em outro aparelho. Não existe "esqueci minha senha" — como o site é anônimo, não temos e-mail nem telefone seu pra te ajudar a recuperar.')} <b>${t('cfg_senha_aviso2','Anote em local seguro.')}</b></div>
      <div class="gn-btns"><button class="gn-br" id="sen-ok">${t('cfg_salvar_senha_btn','Salvar senha')}</button></div>
      <div id="sen-msg" style="font-size:12px;min-height:16px;margin-top:6px"></div>

      <hr style="border:none;border-top:1px solid #1e2a44;margin:22px 0">

      <h3 style="font-size:13px;color:#ef4444;margin:0 0 6px">🗑️ ${t('cfg_secao_encerrar','Encerrar conta')}</h3>
      <p class="sub">${t('cfg_encerrar_sub','Apaga todo o seu perfil e histórico deste site permanentemente. Se você tiver saldo real, primeiro transfere tudo pro endereço de saída configurado acima — e só funciona se o saldo estiver concentrado numa moeda só.')}</p>
      <div class="gn-btns"><button class="gn-bs" id="cfg-encerrar" style="border-color:#7c1d1d;color:#fca5a5">${t('cfg_encerrar_btn','Sair e apagar todos os meus dados')}</button></div>

      <div class="gn-btns" style="margin-top:18px"><button class="gn-bs" id="cfg-fechar">${t('fechar_btn','Fechar')}</button></div>
    </div>`;
    document.body.appendChild(ov);
    document.getElementById('cfg-fechar').onclick = () => ov.remove();
    document.getElementById('cfg-encerrar').onclick = () => { ov.remove(); window.GNIdentity.wipe(); };
    document.getElementById('sen-ver').onchange = (e) => {
      const t = e.target.checked ? 'text' : 'password';
      document.getElementById('sen-a').type = t;
      document.getElementById('sen-b').type = t;
    };

    document.getElementById('cfg-ok').onclick = async () => {
      const moeda = document.getElementById('cfg-moeda').value;
      const endereco = document.getElementById('cfg-endereco').value.trim();
      const msg = document.getElementById('cfg-msg');
      if (!endereco) { msg.style.color='#fca5a5'; msg.textContent=t('cfg_endereco_vazio','Informe um endereço.'); return; }
      const s = window.GNIdentity.session;
      try {
        const r = await window.GNIdentity._api('configurar_saida', { session_id: s.session_id, moeda, endereco });
        if (r.ok) {
          const merged = Object.assign({}, s, { moeda_saida: r.moeda_saida, endereco_saida: r.endereco_saida });
          window.GNIdentity.session = merged; window.GNIdentity._saveSess(merged);
          msg.style.color = '#86efac'; msg.textContent = t('cfg_endereco_salvo','Endereço salvo.');
        } else { msg.style.color='#fca5a5'; msg.textContent = t('erro_prefixo','Erro:') + ' ' + (r.error||t('falhou','falhou')); }
      } catch (e) { msg.style.color='#fca5a5'; msg.textContent = t('erro_rede_prefixo','Erro de rede:') + ' ' + e.message; }
    };

    document.getElementById('sen-ok').onclick = async () => {
      const a = document.getElementById('sen-a').value;
      const b = document.getElementById('sen-b').value;
      const msg = document.getElementById('sen-msg');
      if (a !== b) { msg.style.color='#fca5a5'; msg.textContent=t('senha_nao_confere','As duas senhas não são iguais.'); return; }
      if (a.length < 8 || !/[A-Z]/.test(a) || !/[a-z]/.test(a) || !/[0-9]/.test(a)) {
        msg.style.color='#fca5a5'; msg.textContent=t('senha_fraca','Senha fraca: mínimo 8 caracteres, com maiúscula, minúscula e número.'); return;
      }
      const s = window.GNIdentity.session;
      try {
        const r = await window.GNIdentity._api('configurar_senha', { session_id: s.session_id, senha: a });
        if (r.ok) { msg.style.color='#86efac'; msg.textContent=t('senha_configurada','Senha configurada!'); }
        else { msg.style.color='#fca5a5'; msg.textContent = 'Erro: ' + (r.error||'falhou'); }
      } catch (e) { msg.style.color='#fca5a5'; msg.textContent = t('erro_rede_prefixo','Erro de rede:') + ' ' + e.message; }
    };
  }

  function moedaExibicaoAtual() {
    return (window.GNApp && window.GNApp.moedaExibicao) || 'BRL';
  }
  function simboloMoeda(m) {
    const s = {BRL:'R$',USD:'US$',EUR:'€',GBP:'£',JPY:'¥',CNY:'¥',TRY:'₺',RUB:'₽'};
    return s[m] || (m+' ');
  }
  function fmtFiat(v, moedaExib) {
    return simboloMoeda(moedaExib) + ' ' + (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  async function showSacarExterno(session) {
    window.GNIdentity._injectStyles();
    const btcSaldo = parseFloat(session.btc_saldo)||0;
    const bchSaldo = parseFloat(session.bch_saldo)||0;
    const opcoes = [];
    if (btcSaldo > 0) opcoes.push(['BTC', btcSaldo]);
    if (bchSaldo > 0) opcoes.push(['BCH', bchSaldo]);
    if (!opcoes.length) { alert(t('saque_sem_saldo','Sem saldo real disponível ainda.')); return null; }

    const moedaExib = moedaExibicaoAtual();
    const cotacoes = {};
    for (const [m] of opcoes) {
      try {
        cotacoes[m] = await window.GNIdentity._api('cotacao_saque', { moeda: m, moeda_exibicao: moedaExib });
      } catch(e) { cotacoes[m] = null; }
    }

    return new Promise(res => {
      const ov = document.createElement('div'); ov.id='gn-overlay';
      ov.innerHTML = `<div id="gn-modal" class="gn-modal-blue">
        <h2>↗ ${t('sac_titulo','Transferir para carteira externa')}</h2>
        <div class="gn-f"><label>${t('sac_moeda_label','Moeda')}</label>
          <select id="sac-moeda">
            ${opcoes.map(([m,v])=>{
              const c = cotacoes[m];
              const fiat = c && c.ok ? fmtFiat(v * c.preco_unitario, moedaExib) : '';
              return `<option value="${m}">${m} — ${t('sac_saldo_label','saldo:')} ${v}${fiat ? ' ('+fiat+')' : ''}</option>`;
            }).join('')}
          </select></div>
        <div class="gn-f"><label>${t('sac_endereco_label','Endereço de destino')}</label>
          <input id="sac-endereco" placeholder="${t('sac_endereco_placeholder','cole o endereço externo')}" value="${session.endereco_saida||''}" autocomplete="off" spellcheck="false"></div>
        <div class="gn-f"><label style="display:flex;align-items:center;gap:8px;font-weight:400;text-transform:none">
          <input type="checkbox" id="sac-tudo" checked style="width:auto"> ${t('sac_tudo_label','Sacar tudo dessa moeda')}</label></div>
        <div class="gn-f" id="sac-valor-wrap" style="display:none">
          <label>${t('sac_valor_label','Valor (em {moeda})').replace('{moeda}', moedaExib)}</label>
          <input id="sac-valor" placeholder="0,00" inputmode="decimal"></div>
        <div class="gn-f" id="sac-taxa" style="font-size:12px;color:#7d8aa3"></div>
        <div class="gn-warn-notice"><b>${t('aviso_label','Atenção:')}</b> ${t('sac_aviso','essa transferência é real e irreversível. Confira o endereço com cuidado antes de confirmar — se estiver errado, ou você não tiver domínio total sobre ele, o valor pode ser')} <b>${t('perdido_para_sempre','perdido para sempre')}</b>, ${t('sac_aviso2','sem possibilidade de recuperação pelo site.')}</div>
        <div class="gn-btns">
          <button class="gn-br" id="sac-ok">${t('confirmar_btn','Confirmar')}</button>
          <button class="gn-bs" id="sac-cancel">${t('cancelar_btn','Cancelar')}</button>
        </div></div>`;
      document.body.appendChild(ov);

      function atualizarTaxa() {
        const moeda = document.getElementById('sac-moeda').value;
        const c = cotacoes[moeda];
        const taxaEl = document.getElementById('sac-taxa');
        if (c && c.ok) {
          taxaEl.textContent = t('sac_taxa_estimada','Taxa de rede estimada: {fiat} ({cripto} {moeda})')
            .replace('{fiat}', fmtFiat(c.taxa_rede_exib, moedaExib)).replace('{cripto}', c.taxa_rede_cripto).replace('{moeda}', moeda);
        } else {
          taxaEl.textContent = t('sac_taxa_indisponivel','Taxa de rede: indisponível no momento');
        }
      }
      atualizarTaxa();
      document.getElementById('sac-moeda').onchange = atualizarTaxa;

      document.getElementById('sac-tudo').onchange = (e) => {
        document.getElementById('sac-valor-wrap').style.display = e.target.checked ? 'none' : 'block';
      };
      document.getElementById('sac-cancel').onclick = () => { ov.remove(); res(null); };
      document.getElementById('sac-ok').onclick = () => {
        const moeda = document.getElementById('sac-moeda').value;
        const endereco = document.getElementById('sac-endereco').value.trim();
        const tudo = document.getElementById('sac-tudo').checked;
        if (!endereco) { alert(t('saque_sem_endereco','Informe o endereço de destino.')); return; }

        let valorCripto = null;
        if (!tudo) {
          const valorFiatStr = document.getElementById('sac-valor').value.replace(',', '.');
          const valorFiat = parseFloat(valorFiatStr);
          const c = cotacoes[moeda];
          if (!valorFiat || valorFiat <= 0) { alert(t('saque_valor_invalido','Informe um valor válido em {moeda}.').replace('{moeda}', moedaExib)); return; }
          if (!c || !c.ok || !(c.preco_unitario > 0)) { alert(t('saque_cotacao_indisponivel','Cotação indisponível — tente novamente em instantes.')); return; }
          valorCripto = valorFiat / c.preco_unitario;
        }
        ov.remove(); res({moeda, endereco, valor: valorCripto});
      };
    });
  }

  function fluxoConfigSaida() {
    const s = window.GNIdentity.session;
    if (!s || !s.session_id) { alert(t('sessao_nao_encontrada','Sessão não encontrada.')); return; }
    showConfigSaida(s);
  }

  async function fluxoSacarExterno() {
    const s = window.GNIdentity.session;
    if (!s || !s.session_id) { alert(t('sessao_nao_encontrada','Sessão não encontrada.')); return; }
    const pedido = await showSacarExterno(s);
    if (!pedido) return;

    function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
    const steps = [
      { id:'valida', label:t('sac_step_valida','Validando pedido de saque'), ms:500, fn: async()=>({ok:true}) },
      { id:'enviar', label:t('sac_step_enviar','Enviando transação'), ms:1200,
        fn: async()=>{
          const r = await window.GNIdentity._api('sacar_externa', {
            session_id: s.session_id, moeda: pedido.moeda,
            endereco_destino: pedido.endereco, valor: pedido.valor,
          });
          if (!r.ok) {
            const msg = r.error || t('falhou','falhou');
            return { ok:false, text: r.precisa_consolidar ? t('sac_consolide_primeiro','CONSOLIDE PRIMEIRO') : t('term_falhou_status','FALHOU'), detail: msg, fatal:true };
          }
          window._lastSaque = r;
          return { ok:true, text: r.foi_total ? t('sac_total','TOTAL') : t('sac_parcial','PARCIAL'), detail: (r.txid||'').slice(0,10)+'...' };
        }},
      { id:'recuperacao', label:t('sac_step_recuperacao','Guarde esta informação'), ms:400,
        fn: async()=>{
          const r = window._lastSaque;
          if (!r) return { ok:false, text:t('term_falhou_status','FALHOU'), fatal:true };
          return { ok:true, text:'TXID', detail: `${pedido.moeda} · ${r.txid} · ${t('sac_destino_label','destino')} ${pedido.endereco}` };
        }},
      { id:'confirmando', label:t('sac_step_confirmando','Aguardando confirmação na rede'), ms:2000,
        fn: async()=>{
          const r = window._lastSaque;
          if (!r) return { ok:false, text:t('term_falhou_status','FALHOU'), fatal:true };
          const MAX_TENTATIVAS = 240;
          for (let i=0;i<MAX_TENTATIVAS;i++){
            try {
              const st = await window.GNIdentity._api('status_saque', { txid:r.txid, moeda:pedido.moeda });
              if (st.ok && st.confirmations > 0) {
                return { ok:true, text:t('sac_confirmado','CONFIRMADO'), detail: st.confirmations + ' ' + t('sac_confirmacoes','confirmação(ões)') };
              }
            } catch(e) {}
            await sleep(7000);
          }
          return { ok:false, text:t('sac_demorou','DEMOROU'), detail:t('sac_ainda_nao_confirmou','ainda não confirmou — o TXID acima continua válido pra checar depois'), fatal:false };
        }},
      { id:'atualiza', label:t('sac_step_atualiza','Atualizando saldo'), ms:500,
        fn: async()=>{
          const r = window._lastSaque;
          if (r) {
            const merged = Object.assign({}, window.GNIdentity.session, {
              btc_saldo: r.btc_saldo, bch_saldo: r.bch_saldo, modo_real: r.modo_real,
            });
            window.GNIdentity.session = merged;
            window.GNIdentity._saveSess(merged);
            window.dispatchEvent(new CustomEvent('gn:identity:updated', { detail: merged }));
          }
          return { ok:true };
        }}
    ];
    await window.GNIdentity.showTerminal(steps, {
      title: t('sac_term_titulo','▶ GAMBLENUMBERS · SAQUE PARA CARTEIRA EXTERNA'),
      theme: 'amber',
      okText: t('sac_term_ok','✓ SAQUE CONFIRMADO NA REDE'),
      failText: t('sac_term_fail','✗ SAQUE NÃO CONCLUÍDO — DADOS DE RECUPERAÇÃO ACIMA'),
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    const bc = document.getElementById('btnConfigSaida');
    const bs = document.getElementById('btnSacarExterno');
    const bp = document.getElementById('btnConfigSenha');
    if (bc) bc.addEventListener('click', fluxoConfigSaida);
    if (bs) bs.addEventListener('click', fluxoSacarExterno);
    if (bp) bp.addEventListener('click', fluxoConfigSenha);
  });
})();
