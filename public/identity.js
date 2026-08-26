'use strict';
/* ============================================================
 * identity.js — Identificação anônima por fingerprint
 * Fluxo: fingerprint → modal endereços → terminal verde → SQL
 * Expõe: window.GNIdentity
 * ============================================================ */
(function () {

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
  align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px)}
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
.t-line{display:flex;align-items:center;gap:8px;margin-bottom:7px;
  min-height:18px;opacity:0;transition:opacity .15s}
.t-line.vis{opacity:1}
.t-pr{color:#16a34a;flex-shrink:0}
.t-tx{color:#86efac;flex:1}
.t-bar{display:inline-flex;gap:1px;flex-shrink:0}
.t-bar span{display:inline-block;width:6px;height:10px;background:#0f4a0f;
  border-radius:1px;transition:background .07s}
.t-bar span.on{background:#22c55e}
.t-st{flex-shrink:0;font-weight:700}
.t-st.ok{color:#22c55e} .t-st.er{color:#ef4444} .t-st.sk{color:#7d8aa3}
.t-foot{margin-top:14px;padding-top:11px;border-top:1px solid #0f4a0f;
  color:#22c55e;font-size:13px;font-weight:700;text-align:center;
  opacity:0;transition:opacity .4s}
.t-foot.vis{opacity:1}`;
    document.head.appendChild(s);
  }

  /* --- Modal de endereços --- */
  function showModal() {
    return new Promise(res => {
      injectStyles();
      const ov = document.createElement('div'); ov.id='gn-overlay';
      ov.innerHTML=`<div id="gn-modal">
        <h2>🔐 Identificação Anônima</h2>
        <p class="sub">Informe seus endereços para operar de verdade.<br>
          Sem endereços, você entra em <b style="color:#f7c948">modo simulação</b>.</p>
        <div class="gn-f"><label>Endereço Bitcoin (BTC)</label>
          <input id="gi-btc" placeholder="bc1q... ou 1... ou 3..." autocomplete="off" spellcheck="false"></div>
        <div class="gn-f"><label>Endereço Bitcoin Cash (BCH)</label>
          <input id="gi-bch" placeholder="bitcoincash:q... ou q..." autocomplete="off" spellcheck="false"></div>
        <div class="gn-notice"><b>Privacidade:</b> seus endereços são públicos na blockchain e compõem
          seu identificador anônimo. Nenhum dado pessoal é coletado. Os endereços são usados para
          verificação de saldo e como destino de saques.</div>
        <div class="gn-btns">
          <button class="gn-br" id="gi-ok">Verificar e Ativar Modo Real</button>
          <button class="gn-bs" id="gi-sim">Simular apenas</button>
        </div></div>`;
      document.body.appendChild(ov);
      document.getElementById('gi-sim').onclick = () => { ov.remove(); res({mode:'sim',btc:'',bch:''}); };
      document.getElementById('gi-ok').onclick  = () => {
        const btc = document.getElementById('gi-btc').value.trim();
        const bch = document.getElementById('gi-bch').value.trim();
        if (!btc && !bch) { alert('Informe ao menos um endereço.'); return; }
        ov.remove(); res({mode:'real',btc,bch});
      };
    });
  }

  /* --- Terminal verde --- */
  function showTerminal(steps) {
    return new Promise(res => {
      injectStyles();
      const ov = document.createElement('div'); ov.id='gn-overlay';
      ov.innerHTML=`<div id="gn-term">
        <div class="t-title">▶ GAMBLENUMBERS · PROTOCOLO DE IDENTIFICAÇÃO ANÔNIMA</div>
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

        let r;
        try { r = await step.fn(); } catch(e){ r={ok:false,text:'ERRO'}; }

        clearInterval(iv); spans.forEach(s=>s.classList.add('on'));
        await new Promise(r2=>setTimeout(r2,80));

        const stEl = document.getElementById('st-'+step.id);
        if (r.skip){ stEl.className='t-st sk'; stEl.textContent='PULADO'; }
        else if(r.ok){ stEl.className='t-st ok'; stEl.textContent=r.text||'OK'; }
        else { stEl.className='t-st er'; stEl.textContent=r.text||'FALHOU'; }

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
          ? '✓ PERFIL APROVADO PARA OPERAÇÕES REAIS'
          : '✗ VERIFICAÇÃO INCOMPLETA · MODO SIMULAÇÃO';
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
  async function init() {
    // Sessão já existente?
    const cached = loadSess();
    if (cached && cached.session_id) {
      try {
        const ck = await api('check', {session_id: cached.session_id});
        if (ck.valid) {
          window.GNIdentity.session = ck;
          window.dispatchEvent(new CustomEvent('gn:identity:ready', {detail:ck}));
          return;
        }
      } catch(e) { /* continua para modal */ }
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
      { id:'fp',      label:'Coletando impressão digital do dispositivo', ms:800,
        fn: async()=>{ fpData=await collectFingerprint(); return {ok:true}; } },
      { id:'val-btc', label:'Validando endereço BTC na rede', ms:1400,
        fn: async()=>{
          if(!modal.btc) return {ok:true,skip:true};
          const r=await api('validate_address',{moeda:'BTC',address:modal.btc});
          return r.valid
            ? {ok:true, detail:'· '+r.balance+' BTC'}
            : {ok:false, text:'INVÁLIDO'};
        }},
      { id:'val-bch', label:'Validando endereço BCH na rede', ms:1400,
        fn: async()=>{
          if(!modal.bch) return {ok:true,skip:true};
          const r=await api('validate_address',{moeda:'BCH',address:modal.bch});
          return r.valid
            ? {ok:true, detail:'· '+r.balance+' BCH'}
            : {ok:false, text:'INVÁLIDO'};
        }},
      { id:'profile',  label:'Criando perfil anônimo', ms:600,
        fn: async()=>{
          const r=await api('create_profile',{
            fingerprint_hash: fpData.hash,
            btc_address: modal.btc,
            bch_address: modal.bch,
            user_agent:  navigator.userAgent
          });
          if(r.session_id){ saveSess(r); sessionData=r; window.GNIdentity.session=r; }
          return r.session_id ? {ok:true} : {ok:false,text:'ERRO',fatal:true};
        }},
      { id:'approve',  label:'Aprovando perfil para operações', ms:400,
        fn: async()=>{
          const s=window.GNIdentity.session||{};
          const parts=[];
          if(s.btc_habilitado) parts.push('BTC');
          if(s.bch_habilitado) parts.push('BCH');
          return parts.length
            ? {ok:true, detail:'· '+parts.join(' + ')+' habilitado(s)'}
            : {ok:false, text:'SEM MOEDAS VÁLIDAS'};
        }}
    ]);

    window.dispatchEvent(new CustomEvent('gn:identity:ready',
      {detail: window.GNIdentity.session || {mode:'simulation'}}));
  }

  window.GNIdentity = { session: null, init };
  if (document.readyState==='loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();

})();
