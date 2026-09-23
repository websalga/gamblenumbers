(function(){
  function t(key, fallback) {
    const s = window.I18N && window.I18N.t ? window.I18N.t(key) : null;
    return (s && s !== key) ? s : fallback;
  }
  const CORES = {
    idle:      {c1:'#bcd6ff', c2:'#3d7bd6', c3:'#123a72', glow:'#3d7bd6'},
    validando: {c1:'#ffe0b0', c2:'#e8790a', c3:'#7a3a03', glow:'#e8790a'},
    confirmar: {c1:'#c8f5cf', c2:'#2f9e52', c3:'#0f4a22', glow:'#2f9e52'}
  };
  let state = 'idle', dir = null, timer = null, countdown = null, blinkTimer = null;
  let currentQuote = null;

  function aplicarCor(lado, estado){
    const g = document.getElementById('swapGrad'+lado);
    if(!g) return;
    const cor = CORES[estado];
    g.children[0].setAttribute('stop-color', cor.c1);
    g.children[1].setAttribute('stop-color', cor.c2);
    g.children[2].setAttribute('stop-color', cor.c3);
    document.getElementById('swapBtn'+lado).style.setProperty('--glow', cor.glow);
  }
  function ligar(lado, ligado){
    document.getElementById('swapBtn'+lado).classList.toggle('on', ligado);
    document.getElementById('swapLente'+lado).style.opacity = ligado ? '1' : '0.35';
  }
  function piscar(lado, estado){
    let ligado = true; ligar(lado, true); aplicarCor(lado, estado);
    blinkTimer = setInterval(()=>{ ligado = !ligado; ligar(lado, ligado); }, 500);
  }
  function pararPiscar(){ clearInterval(blinkTimer); }

  function status(msg, erro){
    const el = document.getElementById('swapStatus');
    if(el) el.innerHTML = erro ? `<span style="color:#e05c5c">${msg}</span>` : msg;
  }

  async function chamarApi(action, params){
    const r = await fetch('sideshift_api.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(Object.assign({action}, params)),
    });
    const j = await r.json();
    if(j.erro) throw new Error(j.erro);
    return j;
  }

  function reset(){
    state = 'idle'; dir = null; currentQuote = null; clearTimeout(timer); clearInterval(countdown); pararPiscar();
    const l = document.getElementById('swapBtnL'), r = document.getElementById('swapBtnR');
    if(l) l.disabled = false; if(r) r.disabled = false;
    aplicarCor('L','idle'); aplicarCor('R','idle'); ligar('L', false); ligar('R', false);
    status(t('swap_escolha_direcao','Escolha uma direção'));
  }

  function abbr(txid){
    return txid ? (txid.slice(0,8) + '...') : '—';
  }

  function sessionId(){
    try { return JSON.parse(localStorage.getItem('gn_session') || '{}').session_id || ''; } catch(_) { return ''; }
  }

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  async function executarComTerminal(fromCoin, toCoin, quote){
    if(!window.GNIdentity || !window.GNIdentity.showTerminal){
      status(t('swap_terminal_indisponivel','Terminal indisponível'), true);
      return;
    }
    const steps = [
      {
        id: 'cotacao', label: t('swap_step_cotacao','Cotação confirmada'), ms: 600,
        fn: async () => ({ ok: true, text: 'OK', detail: `≈ ${quote.settleAmount} ${toCoin}` })
      },
      {
        id: 'envio', label: 'Enviando fundos', ms: 1200,
        fn: async () => {
          try {
            const job = await chamarApi('execute', { fromCoin, toCoin, quoteId: quote.id, amount: quote.depositAmount, sessionId: sessionId() });
            window._lastSwapJob = job;
            return { ok: true, text: 'ENVIADO', detail: abbr(job.depositTxid) };
          } catch(e) {
            return { ok: false, text: 'FALHOU', detail: e.message, fatal: true };
          }
        }
      },
      {
        id: 'recuperacao', label: t('swap_step_recuperacao','Guarde esta informação'), ms: 400,
        fn: async () => {
          const job = window._lastSwapJob;
          if(!job) return { ok: false, text: 'FALHOU', fatal: true };
          const link = `sideshift.ai/orders/${job.jobId}`;
          return {
            ok: true, text: 'ID', skip: false,
            detail: `job ${job.jobId} · tx ${abbr(job.depositTxid)} · destino ${abbr(job.settleAddress)} · status em ${link}`
          };
        }
      },
      {
        id: 'aguardando', label: 'Aguardando entrada confirmada no destino', ms: 2000,
        fn: async () => {
          const job = window._lastSwapJob;
          if(!job) return { ok: false, text: 'FALHOU', fatal: true };
          const MAX_TENTATIVAS = 240;
          for(let i = 0; i < MAX_TENTATIVAS; i++){
            try {
              const st = await chamarApi('status', { jobId: job.jobId });
              if(st.status === 'settled' && st.settleTxid){
                window._lastSwapStatus = st;
                return { ok: true, text: 'CONFIRMADO', detail: abbr(st.settleTxid) };
              }
              if(st.status === 'settled'){
                window._lastSwapStatus = st;
                return { ok: true, text: t('swap_liquidado','LIQUIDADO'), detail: t('swap_aguardando_indexacao','aguardando indexação local') };
              }
              if(st.status === 'refunded' || st.status === 'refund'){
                return { ok: false, text: 'REEMBOLSADO', detail: 'verifique ' + `sideshift.ai/orders/${job.jobId}`, fatal: true };
              }
            } catch(e) { /* rede instável, tenta de novo */ }
            await sleep(7000);
          }
          return { ok: false, text: 'DEMOROU', detail: `verifique sideshift.ai/orders/${job.jobId} depois`, fatal: false };
        }
      },
      {
        id: 'saldo', label: 'Atualizando saldo', ms: 600,
        fn: async () => {
          try {
            if(window.GNStatements && window.GNStatements.refresh) await window.GNStatements.refresh();
            return { ok: true, text: 'OK' };
          } catch(e) {
            return { ok: true, text: 'OK', detail: t('swap_atualize_manualmente','(atualize manualmente se necessário)') };
          }
        }
      }
    ];
    const result = await window.GNIdentity.showTerminal(steps, {
      title: '▶ GAMBLENUMBERS · TRANSFERÊNCIA ' + fromCoin + ' → ' + toCoin,
      theme: 'amber',
      okText: t('swap_ok','✓ TRANSFERÊNCIA CONCLUÍDA E SALDO ATUALIZADO'),
      failText: t('swap_fail','✗ TRANSFERÊNCIA NÃO CONCLUÍDA — DADOS DE RECUPERAÇÃO ACIMA'),
    });
    return result;
  }

  async function clickArrow(which){
    const val = document.getElementById('swapVal');
    const v = parseFloat(val.value);
    const fromCoin = which === 'btc_to_bch' ? 'BTC' : 'BCH';
    const toCoin = which === 'btc_to_bch' ? 'BCH' : 'BTC';
    const lado = which === 'btc_to_bch' ? 'R' : 'L';
    const outroBtnId = which === 'btc_to_bch' ? 'swapBtnL' : 'swapBtnR';

    if(state === 'idle'){
      if(!v || v <= 0){ status('Informe um valor', true); return; }
      if(!sessionId()){ status('Sessão não encontrada. Recarregue a página.', true); return; }
      dir = which; state = 'validating';
      document.getElementById(outroBtnId).disabled = true;
      piscar(lado, 'validando');
      status('Validando com o SideShift...');
      try {
        currentQuote = await chamarApi('quote', {fromCoin, toCoin, amount: String(v)});
      } catch(e) {
        pararPiscar();
        reset();
        status(e.message, true);
        return;
      }
      pararPiscar(); piscar(lado, 'confirmar');
      state = 'confirm'; let t = 30;
      status(`Você vai receber ~${currentQuote.settleAmount} ${toCoin} — confirme (${t}s)`);
      countdown = setInterval(()=>{
        t--; status(`Você vai receber ~${currentQuote.settleAmount} ${toCoin} — confirme (${t}s)`);
        if(t <= 0) reset();
      }, 1000);
    } else if(state === 'confirm' && dir === which){
      clearInterval(countdown); pararPiscar(); ligar(lado, true); aplicarCor(lado, 'confirmar');
      const quote = currentQuote;
      reset();
      await executarComTerminal(fromCoin, toCoin, quote);
    }
  }

  function init(){
    const btnL = document.getElementById('swapBtnL');
    const btnR = document.getElementById('swapBtnR');
    if(!btnL || !btnR) return;
    btnL.addEventListener('click', ()=>clickArrow('bch_to_btc'));
    btnR.addEventListener('click', ()=>clickArrow('btc_to_bch'));
    reset();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
