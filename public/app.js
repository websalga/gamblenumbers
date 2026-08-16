'use strict';

(function () {
  const MEDIA_POR_IDIOMA = { 'pt-BR': 'Média', 'en-US': 'Average', 'es-ES': 'Promedio' };
  const EXCH = (idioma) => ({ avg: MEDIA_POR_IDIOMA[idioma] || 'Média', binance: 'Binance', kraken: 'Kraken', coinbase: 'Coinbase' });
  const COL = { avg: '#22d3ee', binance: '#f7c948', kraken: '#a855f7', coinbase: '#3b82f6' };
  const PREMIUM = { avg: 0, binance: 0.0015, kraken: -0.0020, coinbase: 0.0008 };
  const PERIODS = [
    { id: '5M', label: '5M', points: 60, stepMs: 5 * 60 * 1000 / 60 },
    { id: '10M', label: '10M', points: 60, stepMs: 10 * 60 * 1000 / 60 },
    { id: '20M', label: '20M', points: 60, stepMs: 20 * 60 * 1000 / 60 },
    { id: '30M', label: '30M', points: 60, stepMs: 30 * 60 * 1000 / 60 },
    { id: '1H', label: '1H', points: 60, stepMs: 60 * 60 * 1000 / 60 },
    { id: '6H', label: '6H', points: 72, stepMs: 6 * 3600 * 1000 / 72 },
    { id: '1D', label: '1D', points: 96, stepMs: 24 * 3600 * 1000 / 96 },
    { id: '7D', label: '7D', points: 84, stepMs: 7 * 86400 * 1000 / 84 },
    { id: '30D', label: '30D', points: 90, stepMs: 30 * 86400 * 1000 / 90 },
    { id: '60D', label: '60D', points: 90, stepMs: 60 * 86400 * 1000 / 90 },
    { id: '90D', label: '90D', points: 90, stepMs: 90 * 86400 * 1000 / 90 },
    { id: '120D', label: '120D', points: 96, stepMs: 120 * 86400 * 1000 / 96 },
    { id: '180D', label: '180D', points: 96, stepMs: 180 * 86400 * 1000 / 96 },
    { id: '220D', label: '220D', points: 96, stepMs: 220 * 86400 * 1000 / 96 },
    { id: '1Y', label: '1Y', points: 96, stepMs: 365 * 86400 * 1000 / 96 },
    { id: '2Y', label: '2Y', points: 104, stepMs: 2 * 365 * 86400 * 1000 / 104 },
    { id: '3Y', label: '3Y', points: 108, stepMs: 3 * 365 * 86400 * 1000 / 108 },
    { id: '5Y', label: '5Y', points: 120, stepMs: 5 * 365 * 86400 * 1000 / 120 },
  ];
  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const pad = n => String(n).padStart(2, '0');
  const MOEDA_SIMBOLO = { BRL: 'R$ ', USD: 'US$ ', EUR: '€ ', GBP: '£ ', JPY: '¥ ', CNY: '元 ', TRY: '₺ ', RUB: '₽ ' };
  let _simboloAtivo = 'R$ '; // ajustado pelo App no boot, conforme moeda_exibicao da URL
  const BRL = n => _simboloAtivo + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const BTC = n => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 8, maximumFractionDigits: 8 });
  const PCT = n => (n >= 0 ? '+' : '') + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  const fmtUTC = d => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

  function timeLabel(t, periodId) {
    const d = new Date(t);
    if (['5M', '10M', '20M', '30M', '1H'].includes(periodId)) return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    if (['6H', '1D'].includes(periodId)) return pad(d.getUTCHours()) + 'h';
    if (['7D', '30D', '60D', '90D', '120D', '180D', '220D'].includes(periodId)) return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1);
    if (['2Y', '3Y', '5Y'].includes(periodId)) return MES[d.getUTCMonth()] + '/' + String(d.getUTCFullYear()).slice(2);
    return MES[d.getUTCMonth()];
  }

  class App {
    constructor(doc) {
      this.doc = doc;
      this.bus = new EventBus();

      // Fase 2: carteira (BTC/BCH) e moeda de exibicao (BRL/USD/EUR/GBP).
      // Por enquanto le da URL (?moeda=BCH&moeda_exibicao=USD); o combo
      // visual fica para o proximo passo. Default mantem o comportamento
      // de sempre (BTC/BRL).
      const qs = new URLSearchParams(location.search);
      // Whitelists espelham as do backend (api.php / textos.php) — evitam
      // valores arbitrários chegando ao DataStore e ao I18N sem validação.
      const _MOEDAS_OK    = ['BTC', 'BCH'];
      const _EXIB_OK      = ['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'TRY', 'RUB'];
      const _IDIOMAS_OK   = ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE',
                             'it-IT', 'ja-JP', 'nl-NL', 'ru-RU', 'tr-TR', 'zh-CN'];
      const _rawMoeda     = (qs.get('moeda') || '').toUpperCase();
      const _rawExib      = (qs.get('moeda_exibicao') || '').toUpperCase();
      const _rawIdioma    = qs.get('idioma') || '';
      this.moeda          = _MOEDAS_OK.includes(_rawMoeda)  ? _rawMoeda  : 'BTC';
      this.moedaExibicao  = _EXIB_OK.includes(_rawExib)     ? _rawExib   : 'BRL';
      this.idioma         = _IDIOMAS_OK.includes(_rawIdioma) ? _rawIdioma : 'pt-BR';
      _simboloAtivo = MOEDA_SIMBOLO[this.moedaExibicao] || 'R$ ';
      {
        const sym = _simboloAtivo.trim();
        const opValueEl = doc.getElementById('opValue');
        const stopEl = doc.getElementById('stop');
        if (opValueEl) opValueEl.value = sym + ' 55.000,00';
        if (stopEl) stopEl.value = sym + ' 0,00';
      }

      this.store = new DataStore({ moeda: this.moeda, moedaExibicao: this.moedaExibicao });
      this.chartConfig = null; // preenchido por _loadChartConfig()
      this.periodId = sessionStorage.getItem('gn_period') || '1H';
      this.real = new RealSeries({ store: this.store });
      // Projeção CONGELADA: nasce uma vez e só cresce pela borda direita.
      // Trocar de escala não regenera nada — as vendas marcadas sobre ela
      // continuam coerentes no tempo e no preço.
      this.frozen = new FrozenForecast({ forecast: window.Forecast, premium: PREMIUM });
      this.projected = new ProjectedSeries({
        real: this.real, forecast: window.Forecast, premium: PREMIUM, frozen: this.frozen,
      });
      // Persistência local (IndexedDB) da projeção e das operações.
      this.localStore = new LocalStore({ moeda: this.moeda, moedaExibicao: this.moedaExibicao });
      // cofre das OPERACOES: separado so por carteira (moeda), nao por
      // moeda de exibicao - trocar R$/US$/etc nao esconde as operacoes.
      this.opsStore = new LocalStore({ moeda: this.moeda, soOperacoes: true });
      this._saveTimer = null;
      // ---- Pan / rolagem horizontal ----
      // Deslocamento (ms) da janela visível em relação ao "agora" real.
      // 0 = janela ancorada no agora (comportamento padrão).
      // >0 = olhando para o FUTURO (projeção); <0 = olhando para o PASSADO.
      this.panMs = 0;
      this._drag = null;
      const fmtCards = {
        brl: BRL,
        usd: n => 'US$ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
        pct: PCT,
      };
      const exchLabels = EXCH(this.idioma);
      this.cards = Object.keys(exchLabels).map(k => new ExchangeCard(k, {
        store: this.store, meta: { label: exchLabels[k], color: COL[k], premium: PREMIUM[k] }, fmt: fmtCards,
      }));

      this.canvas = doc.getElementById('chart');
      this.plot = new PlotArea({
        canvas: this.canvas,
        colors: Object.assign({}, COL, { trail: 'rgba(232,237,247,0.40)' }),
      });
      this.renderers = {
        projBg: new ProjectionBgRenderer(), priceAxis: new PriceAxisRenderer({ lines: 4 }),
        timeAxis: new TimeAxisRenderer({ ticks: 6 }), series: new SeriesRenderer(),
        target: new TargetLineRenderer(), now: new NowDividerRenderer(),
        lots: new LotMarkerRenderer(), sells: new SellMarkerRenderer(), cursor: new CursorRenderer(),
        trail: new TrailRenderer(),
        spreadBand: new SpreadBandRenderer(),
      };
      this.panel = new ControlPanel({ doc, bus: this.bus, defaults: {}, fmt: { brl: BRL }, moedaExibicao: this.moedaExibicao });
      this.operations = new OperationsController({
        doc, bus: this.bus, canvas: this.canvas, plot: this.plot, panel: this.panel,
        now: () => this.store.latestT() || 0,
        getSeries: () => this.seriesData(), getPeriod: () => this.period(),
        getFrozen: () => this.frozen,
        isClickVetoed: () => { const v = this._suppressClick; this._suppressClick = false; return !!v; },
        fmt: { brl: BRL, btc: BTC },
        moeda: this.moeda,
        moedaExibicao: this.moedaExibicao,
        getRates: () => this.store.latestRates(),
      });
      this.operationsTable = new OperationsTable({
        doc, operations: this.operations, now: () => this.store.latestT() || 0,
        getPeriod: () => this.period(), fmt: { brl: BRL, btc: BTC, pct: PCT, utc: fmtUTC },
      });
      this.mouse = this.operations.mouse;
      this._wire();
      // Carregar calibração do par e aplicar nos módulos
      await this._loadChartConfig();
      this._applyChartConfig();
    }

    period() { return PERIODS.find(p => p.id === this.periodId); }
    spanMs() { const p = this.period(); return p.points * p.stepMs; }

    /**
     * Garante que o store cobre a janela do período atual, buscando sob
     * demanda (lazy) o intervalo necessário. A âncora final é o "agora"
     * real (último dado). Pede ao backend ~ (points) pontos já reduzidos
     * por bucket, então faixas longas vêm com dado espalhado, não platô.
     * Idempotente: só busca o que ainda falta cobrir.
     */
    async ensureData() {
      // Sempre busca o intervalo da faixa selecionada. loadRange é idempotente
      // (ingest deduplica por timestamp), então rebuscar é barato e garante que
      // a janela fique DENSAMENTE coberta — nada de adivinhar cobertura por um
      // ponto esparso antigo, que era o que deixava o histórico achatado.
      const ate = this.store.latestT() || Date.now();
      const desde = ate - this.spanMs();
      // pede pontos suficientes para a resolução do período (2x os pontos da grade)
      const maxPts = Math.min(4000, Math.max(200, (this.period().points | 0) * 2));
      const n = await this.store.loadRange(desde, ate, maxPts);
      return n > 0;
    }

    /** Troca de período com carga lazy e re-render. */
    async selectPeriod(id) {
      this.periodId = id;
      sessionStorage.setItem('gn_period', id);
      this.panMs = 0; // nova escala começa ancorada no AGORA
      try { await this.ensureData(); } catch (e) { /* mantém o que já há */ }
      this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render();
      // a troca de escala pode ter COMPLEMENTADO a borda da projeção
      this._persist();
    }
    /**
     * Janela de tempo visível: [fim - span, fim], onde `fim` é o agora real
     * deslocado pelo pan. É isto que o usuário está olhando.
     */
    viewWindow() {
      const nowT = this.store.latestT();
      if (nowT == null) return null;
      const span = this.spanMs();
      // A janela cobre `span` de passado + `span` de futuro em torno do AGORA
      // (é o que o gráfico sempre mostrou). O pan desliza esse conjunto.
      const foco = nowT + this.panMs;
      return { tMin: foco - span, tMax: foco + span, nowT: nowT };
    }

    seriesData() {
      const endT = this.store.latestT();
      if (endT == null) return { hist: [], fut: [] };
      // As séries continuam ancoradas no AGORA real (o histórico termina nele
      // e a projeção começa nele). O pan não muda os dados, só a janela pela
      // qual olhamos — por isso as marcas nunca "descolam" ao rolar.
      return { hist: this.real.points(this.period(), endT), fut: this.projected.points(this.period(), endT) };
    }

    /** Move a janela em N pixels de tela (converte px -> tempo). */
    panByPixels(px) {
      const r = this.plot.plotRect;
      if (!r || r.w <= 0) return;
      const span = this.plot.tMax - this.plot.tMin;
      this.panMs -= (px / r.w) * span;
      this._clampPan();
      this.renderChart();
    }

    /** Move a janela por uma fração do span visível (roda/botões). */
    panByFraction(frac) {
      const span = this.plot.tMax - this.plot.tMin;
      this.panMs += frac * span;
      this._clampPan();
      this.renderChart();
    }

    /** Recentraliza no AGORA. */
    resetPan() { this.panMs = 0; this.renderChart(); }

    /**
     * Limita a rolagem ao que existe: para trás, o início do histórico real;
     * para frente, a borda da projeção congelada. Evita rolar para o vazio.
     */
    _clampPan() {
      const nowT = this.store.latestT();
      if (nowT == null) return;
      const span = this.spanMs();
      const firstT = this.store.coverageStartT();
      const edgeT = this.frozen && this.frozen.edgeT;
      // limite à esquerda: não passar do começo do histórico
      if (firstT != null) {
        const minPan = (firstT + span) - nowT;
        if (this.panMs < minPan) this.panMs = minPan;
      }
      // limite à direita: não passar da borda da projeção
      if (edgeT != null) {
        const maxPan = edgeT - nowT;
        if (this.panMs > maxPan) this.panMs = maxPan;
      }
    }

    /** Salva projeção congelada + operações no IndexedDB (debounced). */
    _persist() {
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(async () => {
        try {
          await this.localStore.set('forecast', Object.assign({}, this.frozen.toJSON(), { moedaExib: this.moedaExibicao }));
          await this.opsStore.set('operations', {
            lots: this.operations.lots, sells: this.operations.sells,
            lotSeq: this.operations.lotSeq, sellSeq: this.operations.sellSeq,
          });
        } catch (e) { /* persistência é best-effort */ }
      }, 400);
    }

    /** Recupera projeção congelada + operações salvas (se houver). */
    async _restore() {
      try {
        const fc = await this.localStore.get('forecast');
        if (fc && Array.isArray(fc.master) && fc.master.length && (fc.moedaExib || 'BRL') === this.moedaExibicao) this.frozen.fromJSON(fc);
        const ops = await this.opsStore.get('operations');
        if (ops) {
          if (Array.isArray(ops.lots)) this.operations.lots = ops.lots;
          if (Array.isArray(ops.sells)) this.operations.sells = ops.sells;
          if (ops.lotSeq != null) this.operations.lotSeq = ops.lotSeq;
          if (ops.sellSeq != null) this.operations.sellSeq = ops.sellSeq;
        }
      } catch (e) { /* sem persistência, segue em memória */ }
    }

    /**
     * Liga a navegação horizontal: arrastar com o mouse, roda e teclado.
     * IMPORTANTE: o canvas já tem clique para marcar venda (operations.js).
     * Por isso o arraste só "vira pan" depois de passar de um limiar de
     * pixels — e, quando isso acontece, o clique seguinte é suprimido para
     * o usuário não marcar uma venda sem querer ao terminar de rolar.
     */
    _wirePan() {
      const cv = this.canvas; if (!cv || !cv.addEventListener) return;
      const LIMIAR = 4; // px

      cv.addEventListener('mousedown', e => {
        this._drag = { x0: e.clientX, lastX: e.clientX, moved: false };
      });

      cv.addEventListener('mousemove', e => {
        if (!this._drag) return;
        const dx = e.clientX - this._drag.lastX;
        if (!this._drag.moved && Math.abs(e.clientX - this._drag.x0) < LIMIAR) return;
        this._drag.moved = true;
        this._drag.lastX = e.clientX;
        if (cv.style) cv.style.cursor = 'grabbing';
        this.panByPixels(dx);
      });

      const soltar = () => {
        if (this._drag && this._drag.moved) this._suppressClick = true;
        this._drag = null;
        if (cv.style) cv.style.cursor = '';
      };
      cv.addEventListener('mouseup', soltar);
      cv.addEventListener('mouseleave', soltar);

      // roda do mouse = rolagem horizontal no tempo
      cv.addEventListener('wheel', e => {
        const d = (e.deltaX !== 0) ? e.deltaX : e.deltaY;
        if (!d) return;
        if (e.preventDefault) e.preventDefault();
        this.panByFraction(d > 0 ? 0.08 : -0.08);
      }, { passive: false });

      // clique-duplo volta ao AGORA
      cv.addEventListener('dblclick', () => this.resetPan());

      // botão "voltar ao AGORA"
      const btn = this.doc.getElementById('backNow');
      if (btn) btn.onclick = () => this.resetPan();

      // setas do teclado
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('keydown', e => {
          if (e.key === 'ArrowLeft') this.panByFraction(-0.15);
          else if (e.key === 'ArrowRight') this.panByFraction(0.15);
          else if (e.key === 'Home') this.resetPan();
        });
      }
    }

    /** Botões de limpeza em massa da lista de operações. */
    _wireClear() {
      const liga = (id, scope, pergunta) => {
        const b = this.doc.getElementById(id);
        if (!b) return;
        b.onclick = () => {
          const confirmar = (typeof window !== 'undefined' && window.confirm)
            ? window.confirm(pergunta) : true;
          if (!confirmar) return;
          this.operations.clearOperations(scope);
        };
      };
      const T = (k) => window.I18N ? I18N.t(k) : k;
      liga('clearSells', 'sells', T('confirm_limpar_vendas'));
      liga('clearLots', 'lots', T('confirm_limpar_compras'));
      liga('clearAll', 'all', T('confirm_limpar_tudo'));

      // Botão "Resetar previsão"
      const resetBtn = this.doc.getElementById('resetForecastBtn');
      if (resetBtn) {
        resetBtn.onclick = () => {
          const hasPendingSells = this.operations &&
            this.operations.sells &&
            this.operations.sells.some(s => s.status === 'pending');
          const msg = hasPendingSells
            ? T('confirm_reset_forecast_sells')
            : T('confirm_reset_forecast');
          if (!window.confirm(msg)) return;
          // Reset do frozen forecast + localStore
          if (this.frozen) this.frozen.reset();
          if (this.localStore && this.localStore.available) {
            this.localStore.del('forecast').catch(() => {});
          }
          // Força re-render imediato para gerar nova previsão
          this._render();
        };
      }
    }

    /** Reaplica os textos que dependem da moeda ativa + idioma carregado.
     * Chamado 2x: uma vez de imediato (fallback/pt-BR), e de novo depois
     * que I18N.load() resolve (para corrigir caso o idioma nao seja o
     * default). Tambem chamado sempre que a moeda muda. */
    _aplicarTraducoesTopo() {
      const h1 = this.doc.querySelector('.brand h1');
      const _tituloSim = (window.I18N ? I18N.t('simulador') : 'Simulador');
      if (h1) h1.textContent = (this.moeda === 'BCH' ? 'BCH' : 'BTC') + ' ' + _tituloSim;
      document.title = (this.moeda === 'BCH' ? 'BCH' : 'BTC') + ' ' + _tituloSim;
      const lblBtcAvail = this.doc.getElementById('lblBtcAvail');
      if (lblBtcAvail) lblBtcAvail.textContent = window.I18N ? I18N.t('simulado_disponivel', { moeda: this.moeda }) : (this.moeda + ' simulado disponível');
      const thBtc = this.doc.getElementById('thBtc');
      if (thBtc) thBtc.textContent = this.moeda;
      const lblStop = this.doc.getElementById('lblStop');
      if (lblStop) lblStop.textContent = (window.I18N ? I18N.t('lbl_stop_manual') : 'Stop manual') + ' (' + _simboloAtivo.trim() + ')';
      const sym2 = _simboloAtivo.trim();
      const thPreco = this.doc.getElementById('thPreco');
      if (thPreco) thPreco.textContent = (window.I18N ? I18N.t('th_preco') : 'Preço') + ' (' + sym2 + ')';
      const thValor = this.doc.getElementById('thValor');
      if (thValor) thValor.textContent = (window.I18N ? I18N.t('th_valor') : 'Valor') + ' (' + sym2 + ')';
      if (window.I18N) I18N.applyToDom(this.doc);
    }

    /** Busca o vetor de calibração do par atual (Chart_Config) e armazena. */
    async _loadChartConfig() {
      try {
        const qs = new URLSearchParams({
          acao: 'config', moeda: this.moeda, moeda_exibicao: this.moedaExibicao,
        });
        const r = await fetch(`api.php?${qs}`);
        const j = await r.json();
        if (j.ok && j.config) {
          this.chartConfig = {
            fonte:             j.config.fonte              || 'crypto_btc',
            priceDecimals:     parseInt(j.config.price_decimals,   10) || 2,
            yPaddingPct:       parseFloat(j.config.y_padding_pct)      || 3.0,
            forecastMinAmpPct: parseFloat(j.config.forecast_min_amp_pct) || 0.5,
            showSpread:        j.config.show_spread   === '1' || j.config.show_spread === true,
            showExchanges:     j.config.show_exchanges === '1' || j.config.show_exchanges === true,
            defaultPeriodo:    j.config.default_periodo || '1D',
          };
        }
      } catch (_) { /* silencioso — usa defaults dos módulos */ }
    }

    /** Distribui chartConfig para os módulos visuais. */
    _applyChartConfig() {
      const cfg = this.chartConfig;
      if (!cfg) return;
      if (this.plot      && this.plot.applyConfig)      this.plot.applyConfig(cfg);
      if (this.frozen    && this.frozen.applyConfig)    this.frozen.applyConfig(cfg);
      if (this.projected && this.projected.applyConfig) this.projected.applyConfig(cfg);
      // SpreadBandRenderer: liga/desliga conforme showSpread
      if (this.renderers && this.renderers.spreadBand && this.renderers.spreadBand.applyConfig)
        this.renderers.spreadBand.applyConfig(cfg);
      // Forecast global: atualizar minAmpPct
      if (window.Forecast && window.Forecast.applyConfig) window.Forecast.applyConfig(cfg);
      // Cards de exchange: ocultar para pares fiat×fiat e crypto×crypto
      const exCards = this.doc.querySelectorAll('.exchange-card');
      exCards.forEach(el => { el.style.display = cfg.showExchanges ? '' : 'none'; });
    }

    _wireSeletores() {
      const selMoeda = this.doc.getElementById('selMoeda');
      const selExib = this.doc.getElementById('selMoedaExibicao');
      const selIdioma = this.doc.getElementById('selIdioma');
      if (!selMoeda || !selExib) return;

      selMoeda.value = this.moeda;
      selExib.value = this.moedaExibicao;
      if (selIdioma) selIdioma.value = this.idioma;

      this._aplicarTraducoesTopo();

      const recarregar = () => {
        // Bloquear par inválido (mesmo ativo e cotação)
        if (selMoeda.value === selExib.value) {
          selExib.value = selMoeda.value === 'BRL' ? 'USD' : 'BRL';
        }
        sessionStorage.setItem('gn_period', this.periodId);
        const qs = new URLSearchParams(location.search);
        qs.set('moeda', selMoeda.value);
        qs.set('moeda_exibicao', selExib.value);
        qs.set('idioma', selIdioma ? selIdioma.value : this.idioma);
        location.search = qs.toString();
      };
      selMoeda.addEventListener('change', recarregar);
      selExib.addEventListener('change', recarregar);
      if (selIdioma) selIdioma.addEventListener('change', recarregar);
    }

    _wire() {
      this._wireSeletores();
      this.store.onChange(() => {
        this.operations.processPending();
        this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render(); this.updateStatus();
      });
      this.bus.on('control:ret', () => { this.renderCards(); this.renderChart(); this.renderSidePanel(); });
      this.bus.on('control:opValue', () => {});
      this.bus.on('control:stop', () => {});
      this.bus.on('operations:changed', () => {
        this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render();
        this._persist();
      });
      this.bus.on('chart:mouse', mouse => { this.mouse = mouse; this.renderChart(); });
      this.bus.on('toast', data => this.toast(data.type, data.message));
    }

    renderCards() {
      const container = this.doc.getElementById('cards'); if (!container) return;
      const ctx = {
        spanMs: this.spanMs(), ret: this.panel.ret,
        weighted: this.operations.weightedAvg(), remainingBTC: this.operations.totalRemainingBTC(),
      };
      const models = this.cards.map(c => ({ c, m: c.compute(ctx) })).filter(x => x.m);
      let bestKey = null, bestProfit = -Infinity;
      for (const { m } of models) if (m.profit > bestProfit) { bestProfit = m.profit; bestKey = m.key; }
      const hasLots = ctx.remainingBTC > 0;
      for (const c of this.cards) c.render(container, ctx, hasLots && c.key === bestKey);
    }

    renderChart() {
      const endT = this.store.latestT(); if (endT == null) return;
      const { hist, fut } = this.seriesData(), all = hist.concat(fut);
      const target = this.operations.targetPrice();
      const extraPrices = [target]
        .concat(this.operations.lots.map(l => this.operations.precoOp(l)))
        .concat(this.operations.sells.filter(s => s.status === 'pending').map(s => this.operations.precoOp(s)));
      this.plot.resize();
      // Janela visível (com pan). Quando panMs = 0 o comportamento é o de
      // sempre; com pan, o eixo X passa a mostrar o trecho navegado e o
      // AGORA acompanha naturalmente (os renderers usam plot.X(nowT)).
      const win = this.viewWindow();
      if (win) this.plot.setTimeWindow(win.tMin, win.tMax); else this.plot.clearTimeWindow();
      // O eixo de preço deve refletir o que está VISÍVEL: ao rolar, a escala
      // vertical acompanha o trecho em tela em vez de ficar presa ao conjunto
      // inteiro (que deixaria a curva achatada num canto).
      const visiveis = win ? all.filter(p => p.t >= win.tMin && p.t <= win.tMax) : all;
      this.plot.setBoundsFromPoints(visiveis.length ? visiveis : all, { extraPrices });
      this.plot.clear();
      const data = {
        points: all, hist, fut, nowT: endT, target, fmtBRL: BRL,
        labelFor: t => timeLabel(t, this.periodId),
        // marcadores desenhados com preco ja convertido para a moeda de
        // exibicao atual (uma operacao pode ter sido feita numa moeda
        // diferente da que esta selecionada agora).
        lots: this.operations.lots.map(l => Object.assign({}, l, { price: this.operations.precoOp(l) })),
        sells: this.operations.sells.map(s => Object.assign({}, s, {
          markPrice: this.operations.converterPreco(s.markPrice, s.moedaExib),
          execPrice: s.execPrice != null ? this.operations.converterPreco(s.execPrice, s.moedaExib) : s.execPrice,
        })),
        mouse: this.mouse,
        // rastro: o que a projeção previu para o trecho que já virou passado
        trail: this.frozen ? this.frozen.pastTrail(endT, this.period().stepMs) : [],
        // faixa de spread: min/max entre exchanges no ponto mais recente do histórico
        ...((() => {
          const last = hist && hist.length ? hist[hist.length - 1] : null;
          if (!last) return {};
          const vals = ['binance','kraken','coinbase'].map(k => last[k]).filter(v => v != null && Number.isFinite(+v));
          if (vals.length < 2) return {};
          return { spreadLow: Math.min(...vals), spreadHigh: Math.max(...vals) };
        })()),
      };
      this.renderers.projBg.draw(this.plot, data);
      this.renderers.priceAxis.draw(this.plot, data);
      this.renderers.timeAxis.draw(this.plot, data);
      this.renderers.spreadBand.draw(this.plot, data);   // faixa de spread entre exchanges
      this.renderers.trail.draw(this.plot, data);   // por baixo das séries
      this.renderers.series.draw(this.plot, data);
      this.renderers.target.draw(this.plot, data);
      this.renderers.now.draw(this.plot, data);
      this.renderers.lots.draw(this.plot, data);
      this.renderers.sells.draw(this.plot, data);
      this.renderers.cursor.draw(this.plot, data);
      this._updatePanUI();
    }

    /** Mostra o botão de voltar só quando a visão está deslocada. */
    _updatePanUI() {
      const btn = this.doc.getElementById('backNow');
      if (!btn) return;
      const deslocado = Math.abs(this.panMs) > 1;
      if ('hidden' in btn) btn.hidden = !deslocado;
      if (btn.style) btn.style.display = deslocado ? '' : 'none';
    }

    renderSidePanel() {
      const setText = (id, value) => { const el = this.doc.getElementById(id); if (el) el.textContent = value; };
      if (this.panel && this.panel._renderSaldo) this.panel._renderSaldo();
      const weighted = this.operations.weightedAvg();
      const remain = this.operations.totalRemainingBTC();
      const target = this.operations.targetPrice();
      const targetEl = this.doc.getElementById('target'); if (targetEl) targetEl.value = BRL(target);
      setText('openLots', this.operations.openLots().length);
      setText('avgPrice', weighted > 0 ? BRL(weighted) : '—');
      setText('projProfit', remain > 0 ? BRL(remain * (target - weighted)) : '—');
      setText('btcAvail', BTC(remain));
      const realized = this.operations.lots.reduce((sum, l) => sum + l.realized, 0);
      const current = this.operations.currentAvg();
      const unreal = this.operations.openLots().reduce((sum, l) => sum + l.remaining * (current - this.operations.precoOp(l)), 0);
      const pnl = realized + unreal;
      const pnlEl = this.doc.getElementById('pnl');
      if (pnlEl) { pnlEl.textContent = BRL(pnl); pnlEl.className = ''; pnlEl.style.color = pnl >= 0 ? '#22c55e' : '#ef4444'; }
      const cost = this.operations.openLots().reduce((sum, l) => sum + l.remaining * this.operations.precoOp(l), 0);
      const ret = cost > 0 ? unreal / cost * 100 : 0;
      const retEl = this.doc.getElementById('retNow');
      if (retEl) { retEl.textContent = PCT(ret); retEl.style.color = ret >= 0 ? '#22c55e' : '#ef4444'; }
    }

    toast(type, message) {
      const box = this.doc.getElementById('toasts'); if (!box) return;
      const el = this.doc.createElement('div'); el.className = 'toast ' + type; el.textContent = message;
      box.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 4200);
    }

    buildPeriods() {
      const wrap = this.doc.getElementById('periods'); if (!wrap) return;
      wrap.innerHTML = '';
      for (const p of PERIODS) {
        const b = this.doc.createElement('button'); b.textContent = p.label;
        if (p.id === this.periodId) b.className = 'active';
        b.onclick = () => {
          Array.from(wrap.children).forEach(c => c.classList.remove('active'));
          b.classList.add('active');
          this.selectPeriod(p.id);
        };
        wrap.appendChild(b);
      }
    }

    updateStatus() {
      const upd = this.doc.getElementById('updated');
      if (upd) upd.textContent = this.store.latestT() ? (window.I18N ? I18N.t('dados_atualizados') : 'Dados atualizados') : (window.I18N ? I18N.t('sem_dados') : 'Sem dados');
      this._updateTrailStats();
    }

    /**
     * Compara a projeção já vencida com o que de fato aconteceu e mostra o
     * desvio médio. É a leitura prática do rastro: quanto a forecast errou.
     */
    _updateTrailStats() {
      const el = this.doc.getElementById('trailStat');
      if (!el || !this.frozen) return;
      const nowT = this.store.latestT();
      const err = this.frozen.trailError(nowT, t => {
        const snap = this.store.nearest(t);
        return snap ? snap.avg : null;
      });
      if (!err || err.n < 3) {
        if ('hidden' in el) el.hidden = true;
        if (el.style) el.style.display = 'none';
        return;
      }
      if ('hidden' in el) el.hidden = false;
      if (el.style) { el.style.display = ''; el.style.color = err.mape < 2 ? '#22c55e' : (err.mape < 5 ? '#f7c948' : '#ef4444'); }
      const sinalKey = err.bias >= 0 ? 'sinal_acima' : 'sinal_abaixo';
      const sinal = window.I18N ? I18N.t(sinalKey) : (err.bias >= 0 ? 'acima' : 'abaixo');
      el.textContent = window.I18N
        ? I18N.t('desvio_projecao', { pct: err.mape.toFixed(2), sinal: sinal, n: err.n })
        : `Desvio da projeção: ${err.mape.toFixed(2)}% (${sinal} do real) • ${err.n} pontos`;
    }
    startClock() {
      const tick = () => {
        const el = this.doc.getElementById('clock');
        if (el) { const d = new Date(); el.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`; }
      };
      tick(); setInterval(tick, 1000);
    }

    async init() {
      if (window.I18N) {
        await I18N.load(this.idioma);
        this._aplicarTraducoesTopo();
      }
      this.buildPeriods(); this.panel.mount(); this.operations.mount(); this.startClock();
      this._wirePan();
      this._wireClear();
      // Carga inicial: primeiro o "agora" (para ancorar o tempo), depois o
      // intervalo do período atual (lazy, já reduzido no servidor). Sem número
      // fixo de linhas — a faixa selecionada define a janela buscada.
      try {
        await this.store.refresh();               // pega o snapshot mais recente
        await this.ensureData();                  // cobre a janela do período atual
        if (!this.store.ready || this.store.length === 0) {
          // fallback: se o intervalo veio vazio, tenta a janela padrão do período
          const ate = this.store.latestT() || Date.now();
          await this.store.loadRange(ate - this.spanMs(), ate, 1500);
        }
      }
      catch (e) { const upd = this.doc.getElementById('updated'); if (upd) upd.textContent = window.I18N ? I18N.t('falha_backend') : 'Falha ao conectar ao backend'; return; }
      // Persistência: abre o IndexedDB e recupera projeção/operações salvas.
      try { await this.localStore.open(); await this.opsStore.open(); await this._restore(); } catch (e) { /* segue sem persistir */ }
      // Converter saldo se o usuário trocou de moeda desde a última sessão
      { const _sm = sessionStorage.getItem('gn_saldo_moeda') || 'BRL';
        if (_sm !== this.moedaExibicao) {
          const _sc = this.operations.converterPreco(this.panel.saldo, _sm);
          if (_sc > 0) this.panel.setSaldo(_sc);
        } }
      this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render(); this.updateStatus();
      // Rerender defensivo: em alguns casos (ex: taxas de cambio ainda nao
      // totalmente assentadas no primeiro ciclo) o painel lateral pode
      // calcular lucro/prejuizo com fallback incorreto na primeira pintura.
      // Uma segunda passada, idempotente, corrige sem custo perceptivel.
      setTimeout(() => { this.renderSidePanel(); this.renderChart(); }, 600);
      setInterval(() => { this.store.refresh(); }, 8000);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', () => this.renderChart());
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { App, PERIODS, timeLabel };
  if (typeof window !== 'undefined') {
    if (typeof window.addEventListener === 'function' && typeof document !== 'undefined') {
      window.addEventListener('DOMContentLoaded', async () => {
        const _app = new App(document);
        await _app.init();
        // Remove construtores registrados como globais após a inicialização —
        // eles só são necessários durante a construção do App. I18N é mantido
        // pois é acessado dinamicamente pelas traduções em toda a vida do app.
        ['DataStore', 'EventBus', 'ControlPanel', 'OperationsController',
         'OperationsTable', 'LocalStore', 'FrozenForecast', 'RealSeries',
         'ProjectedSeries', 'PlotArea', 'ExchangeCard', 'Forecast'].forEach(function (k) {
          try { delete window[k]; } catch (_) {}
        });
      });
    }
  }
})();
