'use strict';
/* ============================================================
 * automatos.js — tela "Autômatos": cadastro e configuração dos
 * robôs de trading da sessão.
 *
 * Este arquivo NÃO decide compra/venda nenhuma — é só a tela de
 * CRUD dos parâmetros do robô (apelido, moeda, valor por operação,
 * retorno desejado, ativo/inativo). O limite de perda diária é
 * fixo em 10% e nunca é editável aqui (decisão de produto).
 *
 * A inteligência de decisão do robô (motor de compra/venda) é um
 * projeto à parte, ainda não implementado.
 * ============================================================ */
(function () {
  function t(k) { return window.I18N ? I18N.t(k) : k; }
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function sessionId() { try { return JSON.parse(localStorage.getItem('gn_session') || '{}').session_id || ''; } catch (_) { return ''; } }
  function brl(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 4 }) + '%'; }

  const MAX_ROBOS = 5;
  let _editandoId = null; // null = criando novo robô

  function moedaAtual() {
    const app = window.GNApp;
    return (app && app.moeda === 'BCH') ? 'BCH' : 'BTC';
  }

  /* Valores default do formulário: espelham o que já está configurado
   * na tela principal (Valor da compra/venda, Retorno desejado) — o
   * usuário pode ajustar antes de salvar. */
  function defaultsDaTelaPrincipal() {
    const app = window.GNApp;
    const opValue = (app && app.panel && typeof app.panel.opValue === 'number') ? app.panel.opValue : 100;
    const ret = (app && app.panel && typeof app.panel.ret === 'number') ? app.panel.ret : 5;
    return { valor_operacao: opValue, retorno_desejado_pct: ret };
  }

  async function carregarRobos() {
    const sid = sessionId();
    if (!sid) return { ok: false, robos: [] };
    const r = await fetch('robos_load.php?session_id=' + encodeURIComponent(sid), { cache: 'no-store' });
    return r.json();
  }

  async function salvarRobo(payload) {
    const r = await fetch('robos_save.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r.json();
  }

  async function apagarRobo(roboId) {
    const sid = sessionId();
    const r = await fetch('robos_delete.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid, robo_id: roboId }),
    });
    return r.json();
  }

  function renderForm(robo) {
    const editando = !!robo;
    _editandoId = editando ? robo.id : null;
    const d = editando ? robo : Object.assign({ apelido: '', moeda: moedaAtual(), ativo: false }, defaultsDaTelaPrincipal());

    const form = document.getElementById('automatosForm');
    if (!form) return;
    form.innerHTML = `
      <h3>${editando ? t('automatos_editar_robo') : t('automatos_novo_robo')}</h3>
      <div class="field">
        <label for="roboApelido">${t('automatos_apelido')}</label>
        <input id="roboApelido" maxlength="60" placeholder="${t('automatos_apelido_placeholder')}" value="${esc(d.apelido)}">
      </div>
      <div class="field">
        <label for="roboMoeda">${t('automatos_moeda')}</label>
        <select id="roboMoeda">
          <option value="BTC" ${d.moeda === 'BTC' ? 'selected' : ''}>BTC</option>
          <option value="BCH" ${d.moeda === 'BCH' ? 'selected' : ''}>BCH</option>
        </select>
      </div>
      <div class="field">
        <label for="roboValor">${t('automatos_valor_operacao')}</label>
        <input id="roboValor" value="${brl(d.valorOperacao ?? d.valor_operacao)}">
        <div class="field-hint">${t('automatos_valor_operacao_hint')}</div>
      </div>
      <div class="field">
        <label for="roboRetorno">${t('automatos_retorno_desejado')}</label>
        <input id="roboRetorno" type="number" step="0.1" min="0.1" value="${Number(d.retornoDesejadoPct ?? d.retorno_desejado_pct).toFixed(1)}">
        <div class="field-hint">${t('automatos_retorno_desejado_hint')}</div>
      </div>
      <div class="field">
        <label>${t('automatos_limite_perda')}</label>
        <input value="10% ${t('automatos_limite_perda_fixo')}" disabled>
        <div class="field-hint">${t('automatos_limite_perda_hint')}</div>
      </div>
      <div class="field field-checkbox">
        <input type="checkbox" id="roboAtivo" ${d.ativo ? 'checked' : ''}>
        <label for="roboAtivo" style="margin:0">${t('automatos_ativo')}</label>
      </div>
      <div class="form-actions">
        <button id="roboSalvar" type="button">${editando ? t('automatos_salvar_alteracoes') : t('automatos_criar_robo')}</button>
        ${editando ? `<button id="roboCancelar" type="button">${t('automatos_cancelar')}</button>` : ''}
      </div>
      <p id="automatosFormStatus" class="opshint"></p>
    `;

    document.getElementById('roboSalvar').addEventListener('click', onSalvarClick);
    if (editando) document.getElementById('roboCancelar').addEventListener('click', () => renderForm(null));
  }

  async function onSalvarClick() {
    const status = document.getElementById('automatosFormStatus');
    const sid = sessionId();
    if (!sid) { if (status) status.textContent = t('falha_backend'); return; }

    const apelido = document.getElementById('roboApelido').value.trim();
    const moeda = document.getElementById('roboMoeda').value;
    const valorTxto = document.getElementById('roboValor').value;
    const valorOperacao = parseBRL ? parseBRL(valorTxto) : parseFloat(String(valorTxto).replace(/[^\d,.-]/g, '').replace(',', '.'));
    const retornoPct = parseFloat(document.getElementById('roboRetorno').value);
    const ativo = document.getElementById('roboAtivo').checked;

    if (!apelido) { if (status) status.textContent = t('automatos_erro_apelido'); return; }
    if (!(valorOperacao > 0)) { if (status) status.textContent = t('automatos_erro_valor'); return; }
    if (!(retornoPct > 0)) { if (status) status.textContent = t('automatos_erro_retorno'); return; }

    if (status) status.textContent = '...';
    const resp = await salvarRobo({
      session_id: sid,
      robo_id: _editandoId || '',
      apelido, moeda,
      valor_operacao: valorOperacao,
      retorno_desejado_pct: retornoPct,
      ativo,
    });

    if (!resp.ok) {
      if (status) status.textContent = resp.error === ('limite de ' + MAX_ROBOS + ' robos atingido')
        ? t('automatos_erro_limite')
        : (resp.error || t('falha_backend'));
      return;
    }

    renderForm(null);
    refresh();
  }

  function cardRobo(r) {
    return `
      <div class="robo-card ${r.ativo ? 'ativo' : ''}" data-id="${esc(r.id)}">
        <h4>${esc(r.apelido)} <span class="robo-badge ${r.ativo ? '' : 'off'}">${r.ativo ? t('automatos_status_ativo') : t('automatos_status_inativo')}</span></h4>
        <dl>
          <span>${t('automatos_moeda')}</span><b>${esc(r.moeda)}</b>
          <span>${t('automatos_valor_operacao')}</span><b>${brl(r.valorOperacao)}</b>
          <span>${t('automatos_retorno_desejado')}</span><b>${pct(r.retornoDesejadoPct)}</b>
          <span>${t('automatos_limite_perda')}</span><b>${pct(r.limitePerdaDiariaPct)}</b>
        </dl>
        <div class="robo-actions">
          <button type="button" class="robo-btn-toggle">${r.ativo ? t('automatos_desativar') : t('automatos_ativar')}</button>
          <button type="button" class="robo-btn-editar">${t('automatos_editar')}</button>
          <button type="button" class="robo-btn-excluir">${t('automatos_excluir')}</button>
        </div>
      </div>`;
  }

  function ligarAcoesCard(el, robo) {
    el.querySelector('.robo-btn-editar')?.addEventListener('click', () => renderForm(robo));
    el.querySelector('.robo-btn-toggle')?.addEventListener('click', async () => {
      await salvarRobo({
        session_id: sessionId(), robo_id: robo.id, apelido: robo.apelido, moeda: robo.moeda,
        valor_operacao: robo.valorOperacao, retorno_desejado_pct: robo.retornoDesejadoPct,
        ativo: !robo.ativo,
      });
      refresh();
    });
    el.querySelector('.robo-btn-excluir')?.addEventListener('click', async () => {
      if (!window.confirm(t('automatos_confirmar_exclusao').replace('{apelido}', robo.apelido))) return;
      await apagarRobo(robo.id);
      if (_editandoId === robo.id) renderForm(null);
      refresh();
    });
  }

  async function refresh() {
    const status = document.getElementById('automatosStatus');
    const grid = document.getElementById('robosGrid');
    if (!grid) return;
    if (status) status.textContent = '...';
    try {
      const j = await carregarRobos();
      if (!j.ok) throw new Error(j.error || 'erro');
      const robos = j.robos || [];
      grid.innerHTML = robos.length
        ? robos.map(cardRobo).join('')
        : `<div class="robos-empty">${t('automatos_sem_robos')}</div>`;
      grid.querySelectorAll('.robo-card').forEach(el => {
        const robo = robos.find(r => r.id === el.getAttribute('data-id'));
        if (robo) ligarAcoesCard(el, robo);
      });
      const contador = document.getElementById('automatosContador');
      if (contador) contador.textContent = robos.length + ' / ' + MAX_ROBOS;
      if (window.I18N) I18N.applyToDom(document.getElementById('automatosView'));
      if (status) status.textContent = new Date().toLocaleTimeString();
    } catch (e) {
      if (status) status.textContent = t('falha_backend');
    }
  }

  function showAutomatos(show) {
    const appMain = document.getElementById('simulatorView');
    const view = document.getElementById('automatosView');
    const btn = document.getElementById('navAutomatos');
    if (appMain) appMain.hidden = !!show;
    if (view) view.hidden = !show;
    if (btn) btn.classList.toggle('active', !!show);
    if (show) { renderForm(null); refresh(); }
  }

  function init() {
    document.getElementById('navAutomatos')?.addEventListener('click', () => showAutomatos(true));
    document.getElementById('automatosBack')?.addEventListener('click', () => showAutomatos(false));
    document.getElementById('automatosRefresh')?.addEventListener('click', refresh);
  }

  window.GNRobos = { init, refresh, showAutomatos };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
