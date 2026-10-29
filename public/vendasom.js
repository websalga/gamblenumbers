'use strict';
/* vendasom.js - som tocado quando uma venda (manual ou de robo) e' executada com lucro.
 * Os navegadores so' tocam audio depois de um clique/tecla: no primeiro, o som e' carregado e
 * "destravado" (play mudo + pause). Pode ser desligado no Configuracao (localStorage gn_som_vendas = '0'). */
(function () {
  const CHAVE = 'gn_som_vendas';
  let audio = null;
  function ligado() { try { return localStorage.getItem(CHAVE) !== '0'; } catch (e) { return true; } }
  function definir(v) { try { localStorage.setItem(CHAVE, v ? '1' : '0'); } catch (e) {} }
  function liberar() {
    if (audio) return;
    try {
      const a = new Audio('sounds/magic.mp3'); a.preload = 'auto'; a.muted = true; audio = a;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
    } catch (e) {}
  }
  function tocar() {
    if (!ligado() || !audio) return;
    try { audio.currentTime = 0; audio.play().catch(() => {}); } catch (e) {}
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, liberar, { capture: true }));
  window.GNVendaSom = { ligado, definir, tocar };
})();
