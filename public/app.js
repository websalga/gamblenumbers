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
      const _MOEDAS_OK    = ['BTC', 'BCH', 'BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'TRY', 'RUB'];
      const _EXIB_OK      = ['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'TRY', 'RUB'];
      const _IDIOMAS_OK   = ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE',
                             'it-IT', 'ja-JP', 'nl-NL', 'ru-RU', 'tr-TR', 'zh-CN'];
      const _rawMoeda     = (qs.get('moeda') || '').toUpperCase();
      const _rawExib      = (qs.get('moeda_exibicao') || '').toUpperCase();
      // Preferencia de idioma escolhida na tela inicial (identity.js) fica
      // salva em localStorage (gn_idioma) e vale para toda a navegacao,
      // mesmo sem ?idioma= na URL. A URL, quando presente, ainda manda
      // (permite compartilhar link num idioma especifico).
      let _storedIdioma = '';
      try { _storedIdioma = localStorage.getItem('gn_idioma') || ''; } catch (e) { /* ignore */ }
      const _rawIdioma    = qs.get('idioma') || _storedIdioma || '';
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
      this._forecastReady = false;
      this._forecastHistory = [];
      this._calibrationStore = new DataStore({ moeda: this.moeda, moedaExibicao: this.moedaExibicao });
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
      // Traço de referência: previsão ESTATÍSTICA real do motor (backend em
      // lsql2019, validação cruzada rolling-origin). Só informativo - não
      // participa da simulação client-side nem de nenhuma venda.
      this.backendForecast = (typeof BackendForecast !== 'undefined')
        ? new BackendForecast({ moeda: this.moeda }) : null;
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
      // Zoom de lupa: estado independente do período.
      // level=1 = 100% (sem zoom). Duplica a cada clique com 🔍+ ativo.
      this._zoom = { level: 1, tCenter: null, pCenter: null, baseTSpan: null, basePSpan: null };
      this._zoomToolActive = false;
      const fmtCards = {
        brl: BRL,
        usd: n => 'US$ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
        pct: PCT,
      };
      const exchLabels = EXCH(this.idioma);
      this.cards = Object.keys(exchLabels).map(k => new ExchangeCard(k, {
        store: this.store, meta: { label: exchLabels[k], color: COL[k], premium: PREMIUM[k] }, fmt: fmtCards, moedaExibicao: this.moedaExibicao,
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
        forecastRef: new ForecastRefLineRenderer(),
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
        getFee:   (t) => this.store.feeAt(t),
      });
      this.operationsTable = new OperationsTable({
        doc, operations: this.operations, now: () => this.store.latestT() || 0,
        getPeriod: () => this.period(), fmt: { brl: BRL, btc: BTC, pct: PCT, utc: fmtUTC },
      });
      this.mouse = this.operations.mouse;
      this._wire();
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
      this._resetZoom(); // zoom reset ao trocar de escala
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
      if (this._forecastReady) this.frozen.ensure(this._forecastHistory, endT + this.spanMs());
      return { hist: this.real.points(this.period(), endT), fut: this._forecastReady ? this.projected.points(this.period(), endT) : [] };
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
        if (fc && fc.version !== 2) await this.localStore.set('forecast_legacy_v1', fc);
        if (fc && fc.version === 2 && Array.isArray(fc.master) && fc.master.length && (fc.moedaExib || 'BRL') === this.moedaExibicao) this.frozen.fromJSON(fc);
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
     * Busca no SQL Server operações simuladas (compra/venda) que ainda não
     * estão neste navegador - por exemplo, um INSERT/UPDATE manual feito
     * direto no banco, uma operação gerada por um robô, ou sincronizada de
     * outro navegador/aparelho - e mescla no estado em memória.
     *
     * Registros que já existiam aqui ANTES desta função existir, ou que
     * foram criados pelo próprio usuário nesta aba (clique de compra/
     * venda), NUNCA são sobrescritos por esta função - eles não carregam a
     * marca `_remote`, e esta aba continua sendo a única responsável por
     * decidir o ciclo de vida deles (aberto→fechado, pendente→executado/
     * expirado). Só um registro que já chegou aqui via merge (`_remote:
     * true`) pode ser atualizado numa leitura seguinte - assim uma
     * operação de um robô ou de outro aparelho tem seu status corrigido
     * (ex.: de "pending" pra "executed") quando a mudança é gravada no
     * banco, sem essa aba nunca decidir sozinha por um registro alheio.
     *
     * Chamada tanto no carregamento da página quanto por um polling
     * periódico (ver init()), pra refletir na tela operações de um robô
     * quase em tempo real. Best-effort: qualquer falha aqui é silenciosa e
     * nunca deve atrapalhar quem está operando no gráfico.
     */
    async _mergeServerOps() {
      try {
        const sid = window.GNIdentity && window.GNIdentity.session && window.GNIdentity.session.session_id;
        if (!sid) return false;
        const url = 'sim_load.php?session_id=' + encodeURIComponent(sid) + '&moeda=' + encodeURIComponent(this.moeda);
        const resp = await fetch(url, { cache: 'no-store' });
        const j = await resp.json();
        if (!j || !j.ok) return false;

        let mudou = false;
        const lotById = new Map(this.operations.lots.map(l => [l.id, l]));
        for (const lot of (j.lots || [])) {
          const existente = lotById.get(lot.id);
          if (!existente) {
            lot._remote = true;
            this.operations.lots.push(lot);
            lotById.set(lot.id, lot);
            mudou = true;
          } else if (existente._remote) {
            const antes = JSON.stringify(existente);
            Object.assign(existente, lot);
            existente._remote = true;
            if (JSON.stringify(existente) !== antes) mudou = true;
          }
          if (lot.seq > this.operations.lotSeq) this.operations.lotSeq = lot.seq;
        }
        const sellById = new Map(this.operations.sells.map(s => [s.id, s]));
        for (const sell of (j.sells || [])) {
          const existente = sellById.get(sell.id);
          if (!existente) {
            sell._remote = true;
            this.operations.sells.push(sell);
            sellById.set(sell.id, sell);
            mudou = true;
          } else if (existente._remote) {
            const antes = JSON.stringify(existente);
            Object.assign(existente, sell);
            existente._remote = true;
            if (JSON.stringify(existente) !== antes) mudou = true;
          }
          if (sell.seq > this.operations.sellSeq) this.operations.sellSeq = sell.seq;
        }
        return mudou;
      } catch (e) { return false; /* mescla é best-effort */ }
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
        if (this._zoomToolActive) return; // zoom tool ativo: não iniciar pan
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
          // Ignorar setas quando foco está em input/select (ex: slider de retorno)
          const tag = document.activeElement ? document.activeElement.tagName : '';
          if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
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
        resetBtn.onclick = async () => {
          const hasPendingSells = this.operations &&
            this.operations.sells &&
            this.operations.sells.some(s => s.status === 'pending');
          const msg = hasPendingSells
            ? T('confirm_reset_forecast_sells')
            : T('confirm_reset_forecast');
          if (!window.confirm(msg)) return;
          await this._loadForecastHistory();
          // Reset do frozen forecast + localStore
          if (this.frozen) this.frozen.reset();
          if (this.localStore && this.localStore.available) {
            this.localStore.del('forecast').catch(() => {});
          }
          // Força re-render imediato para gerar nova previsão
          this.renderCards(); this.renderChart(); this.renderSidePanel();
          this._persist();
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
        if (selIdioma) {
          try { localStorage.setItem('gn_idioma', selIdioma.value); } catch (e) { /* ignore */ }
          try {
            const sess = window.GNIdentity && window.GNIdentity.session;
            if (sess && sess.session_id) {
              const blob = new Blob([JSON.stringify({action:'salvar_idioma', session_id: sess.session_id, idioma: selIdioma.value})], {type:'application/json'});
              navigator.sendBeacon('identity.php', blob);
            }
          } catch (e) { /* ignore */ }
        }
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

    /* ============================================================
     * Identidade anonima (GNIdentity) <-> saldo total exibido.
     *
     * Modo simulacao (nenhum endereco informado): campo #saldoVirtual
     * continua editavel pelo usuario, exatamente como sempre foi.
     *
     * Modo real (BTC e/ou BCH informado e habilitado): campo fica
     * bloqueado (readOnly) e o valor mostrado passa a ser CALCULADO -
     * saldo on-chain (BTC e/ou BCH) convertido para USD e depois para
     * a moeda de exibicao atual (this.moedaExibicao), reaproveitando
     * this.operations.converterPreco (mesma logica de USD-pivot usada
     * em todo o resto do app). O botao #btnAtualizarSaldo permite ao
     * usuario forcar uma nova leitura on-chain sem recarregar a pagina.
     * ============================================================ */
    _wireIdentity() {
      const apply = (session) => { this._applyIdentity(session); };
      window.addEventListener('gn:identity:ready', e => apply(e.detail));
      window.addEventListener('gn:identity:updated', e => apply(e.detail));

      const btn = this.doc.getElementById('btnAtualizarSaldo');
      if (btn) {
        btn.addEventListener('click', async () => {
          if (!window.GNIdentity || typeof window.GNIdentity.refresh !== 'function') return;
          const original = btn.innerHTML;
          btn.disabled = true; btn.innerHTML = '&hellip;';
          try {
            const s = await window.GNIdentity.refresh();
            this.toast(s ? 'ok' : 'warn', s
              ? ('Saldo atualizado a partir da blockchain.')
              : ('Não foi possível atualizar o saldo agora.'));
          } finally {
            btn.disabled = false; btn.innerHTML = original;
          }
        });
      }
      // A sessao pode ja ter resolvido (cache local) antes deste listener existir.
      if (window.GNIdentity && window.GNIdentity.session) apply(window.GNIdentity.session);
    }

    /** Aplica o estado de identidade (real/simulacao) ao campo de saldo. */
    async _applyIdentity(session) {
      const input = this.doc.getElementById('saldoVirtual');
      const btn   = this.doc.getElementById('btnAtualizarSaldo');
      const modo  = this.doc.getElementById('saldoModo');
      const btnSacar = this.doc.getElementById('btnSacarExterno');
      const btnConfig = this.doc.getElementById('btnConfigSaida');
      if (!input) return;
      const real = !!(session && session.modo_real);
      this._saldoReal = real;
      input.readOnly = real;
      input.title = real
        ? ('Saldo calculado a partir dos seus endereços. Use o botão para atualizar.')
        : ('Seu saldo virtual para operar. Edite para alterar.');
      if (btn) btn.hidden = !real;
      if (btnConfig) btnConfig.hidden = !(session && session.session_id);
      const btnSair = this.doc.getElementById('btnSairApagar');
      if (btnSair) btnSair.hidden = !(session && session.session_id);
      const btcSaldo = parseFloat(session && session.btc_saldo) || 0;
      const bchSaldo = parseFloat(session && session.bch_saldo) || 0;
      if (btnSacar) btnSacar.hidden = !(real && (btcSaldo > 0 || bchSaldo > 0));
      if (!real) { if (modo) modo.textContent = 'Modo simulação'; return; }

      const totalUsd = await this._saldoRealEmUsd(session);
      if (totalUsd != null) {
        const valorExib = this.operations.converterPreco(totalUsd, 'USD');
        if (valorExib >= 0) this.panel.setSaldo(valorExib);
      }

      if (modo) {
        modo.textContent = 'Modo real · BTC + BCH';
        const btcPend = parseFloat(session.btc_pendente) || 0;
        const bchPend = parseFloat(session.bch_pendente) || 0;
        if (btcPend > 0 || bchPend > 0) {
          const pendUsd = await this._saldoPendenteEmUsd(session);
          if (pendUsd != null && pendUsd > 0) {
            const pendExib = this.operations.converterPreco(pendUsd, 'USD');
            const simb = this._simboloMoedaExib();
            modo.textContent += ` · +${simb}${pendExib.toFixed(2)} aguardando confirmação`;
          } else {
            modo.textContent += ' · saldo adicional aguardando confirmação';
          }
        }
      }
    }

    _simboloMoedaExib() {
      const s = {BRL:'R$ ',USD:'US$ ',EUR:'€',GBP:'£',JPY:'¥',CNY:'¥',TRY:'₺',RUB:'₽'};
      return s[this.moedaExibicao] || (this.moedaExibicao+' ');
    }

    async _saldoPendenteEmUsd(session) {
      try {
        const [btcUsd, bchUsd] = await Promise.all([this._precoCryptoUsd('BTC'), this._precoCryptoUsd('BCH')]);
        let total = 0, obtido = false;
        if (btcUsd > 0) { total += (parseFloat(session.btc_pendente) || 0) * btcUsd; obtido = true; }
        if (bchUsd > 0) { total += (parseFloat(session.bch_pendente) || 0) * bchUsd; obtido = true; }
        return obtido ? total : null;
      } catch (e) { return null; }
    }

    /** Soma (BTC*preco_usd + BCH*preco_usd) das carteiras habilitadas. Retorna null se nao conseguiu nenhum preco. */
    async _saldoRealEmUsd(session) {
      try {
        const [btcUsd, bchUsd] = await Promise.all([
          this._precoCryptoUsd('BTC'),
          this._precoCryptoUsd('BCH'),
        ]);
        let total = 0, obtido = false;
        if (btcUsd > 0) { total += (parseFloat(session.btc_saldo) || 0) * btcUsd; obtido = true; }
        if (bchUsd > 0) { total += (parseFloat(session.bch_saldo) || 0) * bchUsd; obtido = true; }
        return obtido ? total : null;
      } catch (e) { return null; }
    }

    /** Preco USD atual de BTC ou BCH (independe da moeda_exibicao do site). */
    async _precoCryptoUsd(moedaCrypto) {
      if (moedaCrypto === this.moeda) {
        const l = this.store.latest();
        if (l && l.btc_usd > 0) return l.btc_usd;
      }
      try {
        const r = await fetch(`api.php?acao=atual&moeda=${moedaCrypto}`, { cache: 'no-store' });
        const j = await r.json();
        return (j && j.ok && j.data && j.data.btc_usd > 0) ? j.data.btc_usd : null;
      } catch (e) { return null; }
    }

    _wire() {
      this._wireZoom();
      this._wireSeletores();
      this._wireIdentity();
      this.store.onChange(async () => {
        this.operations.processPending();
        // Calibração do par — aplicada depois dos dados (garante que cfg
      // influencia o primeiro render, e que o constructor ficou sync).
      await this._loadChartConfig();
      this._applyChartConfig();
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
      // Só considera cards VISÍVEIS para eleger o "MAIOR LUCRO".
      // Se showExchanges=false (BCH) as exchanges ficam ocultas e o badge
      // deve recair no card visível com maior lucro (geralmente avg).
      const showExch = !this.chartConfig || this.chartConfig.showExchanges !== false;
      let bestKey = null, bestProfit = -Infinity;
      for (const { c, m } of models) {
        const visivel = c.key === 'avg' || showExch;
        if (visivel && m.profit > bestProfit) { bestProfit = m.profit; bestKey = m.key; }
      }
      const hasLots = ctx.remainingBTC > 0;
      for (const c of this.cards) c.render(container, ctx, hasLots && c.key === bestKey);
    }

    renderChart() {
      const endT = this.store.latestT(); if (endT == null) return;
      const { hist, fut } = this.seriesData(), all = hist.concat(fut);
      const target = this.operations.targetPrice();
      const extraPrices = []
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
      // Zoom de lupa: sobrescreve os limites com janela reduzida centrada no ponto clicado.
      if (this._zoom.level > 1 && this._zoom.tCenter != null && this._zoom.baseTSpan) {
        const tSpan = this._zoom.baseTSpan / this._zoom.level;
        const pSpan = this._zoom.basePSpan / this._zoom.level;
        this.plot.setBounds(
          this._zoom.tCenter - tSpan / 2,
          this._zoom.tCenter + tSpan / 2,
          this._zoom.pCenter - pSpan / 2,
          this._zoom.pCenter + pSpan / 2
        );
      }
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
        // linha de referência: previsão estatística real do backend (até 24h)
        refForecast: (this.backendForecast && this.backendForecast.ready) ? this.backendForecast.pontos : [],
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
      this.renderers.forecastRef.draw(this.plot, data);
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
      // realized: sell._pnl já é líquido de taxas (sell fee + fração proporcional de buy fee).
      // Usar diretamente evita dupla contagem que ocorreria ao somar pnl e subtrair totalFees.
      const realized = this.operations.sells
        .filter(s => s.status === 'executed')
        .reduce((sum, s) => sum + this.operations.converterPreco(s._pnl || 0, s.moedaExib), 0);
      const current = this.operations.currentAvg();
      const unreal = this.operations.openLots().reduce((sum, l) => sum + l.remaining * (current - this.operations.precoOp(l)), 0);
      // Taxas pagas: exibidas separadamente para transparência (não subtraídas do pnl — já estão em _pnl)
      const totalBuyFees  = this.operations.lots.reduce((s, l) => s + this.operations.converterPreco(l.fee_brl || 0, l.moedaExib), 0);
      const totalSellFees = this.operations.sells.filter(s => s.status === 'executed').reduce((s, v) => s + this.operations.converterPreco(v.fee_brl || 0, v.moedaExib), 0);
      const totalFees = totalBuyFees + totalSellFees;
      const feeTotalEl = this.doc.getElementById('feeTotal');
      if (feeTotalEl) feeTotalEl.textContent = BRL(totalFees);
      const netPnl = realized + unreal;
      const pnlEl = this.doc.getElementById('pnl');
      if (pnlEl) { pnlEl.textContent = BRL(netPnl); pnlEl.className = ''; pnlEl.style.color = netPnl >= 0 ? '#22c55e' : '#ef4444'; }
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


    /** Zoom de lupa — botões 🔍+ e 🔍- na barra de períodos. */
    _wireZoom() {
      const cv = this.canvas;
      if (!cv) return;
      // Listener na FASE DE CAPTURA: dispara antes do click de venda do canvas.
      // stopImmediatePropagation impede que o OperationsController processe o clique.
      cv.addEventListener('click', e => {
        if (!this._zoomToolActive) return;
        e.stopImmediatePropagation();
        // Na primeira aplicação de zoom: salvar os spans base atuais do PlotArea.
        if (this._zoom.level === 1) {
          this._zoom.baseTSpan = this.plot.tMax - this.plot.tMin;
          this._zoom.basePSpan = this.plot.pMax - this.plot.pMin;
        }
        const rect = cv.getBoundingClientRect();
        this._zoom.tCenter = this.plot.invX(e.clientX - rect.left);
        this._zoom.pCenter = this.plot.invY(e.clientY - rect.top);
        this._zoom.level   = Math.min(this._zoom.level * 2, 64); // máximo 64x
        this.renderChart();
      }, true /* capture */);
    }

    /** Reseta zoom para 100% e desativa a ferramenta de lupa. */
    _resetZoom() {
      this._zoom = { level: 1, tCenter: null, pCenter: null, baseTSpan: null, basePSpan: null };
      this._zoomToolActive = false;
      const btn = this.doc.getElementById('zoomInBtn');
      if (btn) btn.classList.remove('active');
      if (this.canvas && this.canvas.style) this.canvas.style.cursor = '';
      // Só re-renderiza se o gráfico já foi inicializado
      if (this.store && this.store.ready) this.renderChart();
    }

    /** Adiciona botões 🔍+ e 🔍– após os botões de período. */
    _buildZoomControls() {
      const wrap = this.doc.getElementById('periods');
      if (!wrap || wrap.querySelector('#zoomInBtn')) return; // idempotente
      const T = (k) => window.I18N ? I18N.t(k) : k;

      // Separador visual
      const sep = this.doc.createElement('span');
      sep.style.cssText = 'display:inline-block;width:1px;background:rgba(255,255,255,.1);height:22px;margin:0 4px;align-self:center;';
      wrap.appendChild(sep);

      // Botão zoom in
      const zoomIn = this.doc.createElement('button');
      zoomIn.id = 'zoomInBtn';
      zoomIn.textContent = '🔍+';
      zoomIn.title = T('zoom_in_hint') || 'Zoom in — clique na área do gráfico para aproximar (2× por clique)';
      zoomIn.style.cssText = 'font-size:14px;padding:4px 10px;';
      zoomIn.onclick = () => {
        this._zoomToolActive = !this._zoomToolActive;
        zoomIn.classList.toggle('active', this._zoomToolActive);
        if (this.canvas && this.canvas.style)
          this.canvas.style.cursor = this._zoomToolActive ? 'zoom-in' : '';
      };
      wrap.appendChild(zoomIn);

      // Botão zoom reset
      const zoomOut = this.doc.createElement('button');
      zoomOut.id = 'zoomOutBtn';
      zoomOut.textContent = '🔍–';
      zoomOut.title = T('zoom_out_hint') || 'Resetar zoom para 100%';
      zoomOut.style.cssText = 'font-size:14px;padding:4px 10px;';
      zoomOut.onclick = () => this._resetZoom();
      wrap.appendChild(zoomOut);
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
      this._buildZoomControls();
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

    async _loadForecastHistory() {
      const end = this.store.latestT();
      if (end == null) return;
      await this._calibrationStore.loadRange(end - 7 * 86400000, end, 4000);
      this._forecastHistory = this._calibrationStore.between(end - 7 * 86400000, end);
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
      // Calibration has a stable seven-day window, separate from the viewport.
      await this._loadForecastHistory();
      // Persistência: abre o IndexedDB e recupera projeção/operações salvas.
      try {
        await this.localStore.open(); await this.opsStore.open(); await this._restore();
        await this._mergeServerOps();
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !this._mergeOpsListenerLigado) {
          this._mergeOpsListenerLigado = true;
          window.addEventListener('gn:identity:ready', () => {
            this._mergeServerOps().then(mudou => { if (mudou) { this.renderChart(); this.renderSidePanel(); this.operationsTable.render(); this._persist(); } });
          });
        }
      } catch (e) { /* segue sem persistir */ }
      this._forecastReady = true;
      // Converter saldo se o usuário trocou de moeda desde a última sessão
      { const _sm = sessionStorage.getItem('gn_saldo_moeda') || 'BRL';
        if (_sm !== this.moedaExibicao) {
          const _sc = this.operations.converterPreco(this.panel.saldo, _sm);
          if (_sc > 0) this.panel.setSaldo(_sc);
        } }
      // Converter valor de operação (opValue) se a moeda mudou desde a última sessão
      { const _om = sessionStorage.getItem('gn_opvalue_moeda') || 'BRL';
        if (_om !== this.moedaExibicao) {
          const _oc = this.operations.converterPreco(this.panel.opValue, _om);
          if (_oc > 0) this.panel.setOpValue(_oc);
        } }
      // Calibração do par — aplicada depois dos dados (garante que cfg
      // influencia o primeiro render, e que o constructor ficou sync).
      await this._loadChartConfig();
      this._applyChartConfig();
      this.renderCards(); this.renderChart(); this.renderSidePanel(); this.operationsTable.render(); this.updateStatus();
      this._persist();
      // Rerender defensivo: em alguns casos (ex: taxas de cambio ainda nao
      // totalmente assentadas no primeiro ciclo) o painel lateral pode
      // calcular lucro/prejuizo com fallback incorreto na primeira pintura.
      // Uma segunda passada, idempotente, corrige sem custo perceptivel.
      setTimeout(() => { this.renderSidePanel(); this.renderChart(); }, 600);
      setInterval(() => { this.store.refresh(); }, 8000);
      // Espelho quase em tempo real de operações gravadas por fora desta
      // aba (robô, outro navegador, INSERT/UPDATE manual no SQL Server) -
      // ver _mergeServerOps() para as regras de o que pode ser atualizado.
      setInterval(() => {
        this._mergeServerOps().then(mudou => {
          if (mudou) { this.renderChart(); this.renderSidePanel(); this.operationsTable.render(); this._persist(); }
        });
      }, 4000);
      // Previsão estatística real (backend): atualiza pouco depois de cada
      // ciclo de geração do motor (a cada 5min em lsql2019) - 60s é
      // suficiente e barato (uma única consulta leve por atualização).
      if (this.backendForecast) {
        this.backendForecast.refresh().then(() => this.renderChart());
        setInterval(() => { this.backendForecast.refresh().then(() => this.renderChart()); }, 60000);
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', () => this.renderChart());
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { App, PERIODS, timeLabel };
  if (typeof window !== 'undefined') {
    if (typeof window.addEventListener === 'function' && typeof document !== 'undefined') {
      window.addEventListener('DOMContentLoaded', async () => {
        const _app = new App(document);
        await _app.init();
        window.GNApp = _app;
        // Remove construtores registrados como globais após a inicialização —
        // eles só são necessários durante a construção do App. I18N é mantido
        // pois é acessado dinamicamente pelas traduções em toda a vida do app.
        ['DataStore', 'EventBus', 'ControlPanel', 'OperationsController',
         'OperationsTable', 'LocalStore', 'FrozenForecast', 'RealSeries',
         'ProjectedSeries', 'PlotArea', 'ExchangeCard', 'Forecast', 'BackendForecast'].forEach(function (k) {
          try { delete window[k]; } catch (_) {}
        });
      });
    }
  }
})();
