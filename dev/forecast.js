/* ============================================================
 * forecast.js — modelo de projeção estatística
 * Estuda o histórico REAL e projeta cenários plausíveis usando:
 *  - drift (tendência): média dos retornos log
 *  - volatilidade: desvio-padrão dos retornos (base do GBM)
 *  - ciclos: autocorrelação para achar periodicidade recorrente
 *  - reversão à média: puxa o preço de volta à média móvel
 * IMPORTANTE: cenário estatístico, não previsão garantida.
 * ============================================================ */
window.Forecast = (function(){
  function logReturns(prices){
    const r=[];
    for(let i=1;i<prices.length;i++){
      if(prices[i-1]>0 && prices[i]>0) r.push(Math.log(prices[i]/prices[i-1]));
    }
    return r;
  }
  function mean(a){ return a.reduce((x,y)=>x+y,0)/(a.length||1); }
  function std(a){ const m=mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))); }

  // autocorrelação: acha o lag (período cíclico) com maior correlação
  function dominantCycle(returns, maxLag){
    const m=mean(returns);
    const dev=returns.map(x=>x-m);
    const denom=dev.reduce((s,x)=>s+x*x,0)||1;
    let bestLag=0, bestAC=0;
    maxLag=Math.min(maxLag, Math.floor(returns.length/2));
    for(let lag=2; lag<maxLag; lag++){
      let num=0;
      for(let i=0;i<dev.length-lag;i++) num+=dev[i]*dev[i+lag];
      const ac=num/denom;
      if(ac>bestAC){ bestAC=ac; bestLag=lag; }
    }
    return {lag:bestLag, strength:bestAC};
  }

  // gera nPontos futuros a partir do histórico (array de {avg,...})
  function project(hist, nPontos, premium){
    const prices=hist.map(h=>h.avg).filter(v=>v>0);
    if(prices.length<8){
      // histórico insuficiente: repete último valor
      const last=prices[prices.length-1]||0;
      return Array.from({length:nPontos},()=>last);
    }
    const rets=logReturns(prices);
    const drift=mean(rets);
    const vol=std(rets);
    const cycle=dominantCycle(rets, Math.min(48, rets.length-2));
    const last=prices[prices.length-1];
    // média móvel para reversão
    const win=Math.min(20, prices.length);
    const sma=mean(prices.slice(-win));
    const reversion=0.02; // força de reversão à média por passo

    // amplitude do ciclo detectado (baseada na volatilidade real).
    // Exige lag>=6: ciclos mais curtos que isso tendem a ser ruido/alias
    // (poucos pontos por periodo para a autocorrelacao ser confiavel),
    // e nesse caso o seno oscila quase a cada passo, produzindo um
    // zigue-zague caotico em vez de um ciclo plausivel - mais visivel
    // em janelas longas (120D/220D) onde cada passo vale dezenas de horas.
    const cycAmp = (cycle.strength>0.1 && cycle.lag>=6) ? vol*cycle.strength*2.2 : 0;
    const cycLag = cycle.lag>=6 ? cycle.lag : 12;

    // gerador pseudo-aleatório determinístico (mesma projeção entre frames)
    let seed=Math.floor(last)%99991 + rets.length;
    const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; };
    // normal via Box-Muller
    const gauss=()=>{ let u=rnd()||1e-9,v=rnd()||1e-9; return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };

    const out=[]; let p=last;
    for(let i=0;i<nPontos;i++){
      // 1) tendência real
      let step=drift;
      // 2) ciclo detectado no passado, projetado adiante
      step += cycAmp*Math.sin(2*Math.PI*(i+1)/cycLag);
      // 3) choque aleatório com a volatilidade real (GBM)
      step += vol*gauss();
      // 4) reversão à média móvel
      step += reversion*Math.log((sma||p)/p);
      p *= Math.exp(step);
      if(!isFinite(p)||p<=0) p=last;
      out.push(p);
    }
    return out;
  }

  return { project };
})();
