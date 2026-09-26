# Changelog

## [v1.11.0] — 2026-09-26

### English

**New: the chart draws the server forecast as a narrow central band ("core of the bell") with min/max lines**
The forecast cone now shows only the central part of the distribution instead of the full 80% band, whose tails opened too wide. The width is calibrated so that half of the real outcomes fall inside (`forecast.Config`: `faixa_central_*`; measured over 21 days, the real distribution is more concentrated at the center than a normal one). The band edges are drawn as explicit maximum and minimum lines with their values and the "50%" width. At the 24 h horizon the BTC band went from ±2.64% to ±0.97%.

**New: Mimetagem scenario line**
The chart draws the Mimetagem curve (it copies the real future of the past stretch that best matches the latest quotes, scaled to the current price). It is an illustrative, wavy scenario, served from the server and identical for every user; the forecast itself remains the orange line with the band, because in backtests the copied curve errs more than the flat line. It is regenerated every 15 minutes.

**New: past Mimetagem curves continue, dotted, on the real-quote side**
Curves generated 1 h, 3 h and 6 h ago (configurable in `forecast.Config`: `cenario_passado_min`) are cut at "now" and kept as dotted lines over the real history, with a legend comparing, for each, the predicted move vs the real move since it was generated and whether the direction was right.

**Changed: the browser-local projection is no longer drawn when the server forecast is available**
The frozen simulation stored in each browser (IndexedDB) diverged between users and could be stale (one was anchored 13 days ago, making the lines dive after "now"). With the server forecast available the chart no longer draws it nor uses it for the price scale; without the server it falls back to the old behavior. Trades, targets and operations do not depend on it.

**Fixed: price axis stretched by lots that are not on screen**
Every lot price (even old closed lots) entered the chart scale, flattening the chart. Now only lots and pending sells whose marker falls inside the visible time window count.

### Português

**Novo: o gráfico desenha a previsão do servidor como uma faixa central estreita ("miolo do sino") com linhas de mínimo e máximo**
O cone da previsão agora mostra só a parte central da distribuição, em vez da faixa completa de 80%, cujas pontas abriam demais. A largura é calibrada para que metade dos resultados reais caia dentro (`forecast.Config`: `faixa_central_*`; medido em 21 dias, a distribuição real é mais concentrada no centro que uma normal). As bordas da faixa são desenhadas como linhas explícitas de máximo e mínimo, com os valores e a largura "50%". No horizonte de 24 h, a faixa do BTC passou de ±2,64% para ±0,97%.

**Novo: curva de cenário da Mimetagem**
O gráfico desenha a curva da Mimetagem (ela copia o futuro real do trecho passado que melhor se encaixa nas últimas cotações, escalado ao preço atual). É um cenário ilustrativo e ondulado, servido pelo servidor e igual para todos os usuários; a previsão em si continua sendo a linha laranja com a faixa, porque nos backtests a curva copiada erra mais que a linha reta. É regenerada a cada 15 minutos.

**Novo: as curvas anteriores da Mimetagem continuam, pontilhadas, do lado da cotação real**
As curvas geradas 1 h, 3 h e 6 h atrás (configurável em `forecast.Config`: `cenario_passado_min`) são cortadas no "agora" e mantidas como linhas pontilhadas sobre o histórico real, com uma legenda que compara, para cada uma, a variação prevista com a variação real desde que foi gerada e se a direção estava certa.

**Alterado: a projeção local do navegador não é mais desenhada quando a previsão do servidor está disponível**
A simulação congelada guardada em cada navegador (IndexedDB) divergia entre usuários e podia estar velha (uma estava ancorada há 13 dias, fazendo as linhas mergulharem depois do "agora"). Com a previsão do servidor disponível, o gráfico não a desenha nem a usa na escala de preço; sem o servidor, volta ao comportamento antigo. Vendas, alvo e operações não dependem dela.

**Corrigido: eixo de preço esticado por lotes que não estão em tela**
Todos os preços de lotes (mesmo lotes antigos já fechados) entravam na escala do gráfico, achatando a visualização. Agora só contam lotes e vendas pendentes cujo marcador cai dentro da janela de tempo visível.

---

## [v1.10.0] — 2026-09-25

### English

**New: virtual balance stored per session in SQL Server (`GN_SimSaldo`)**
The "Virtual balance available" shown on screen now also exists in the database, per session, so the buy and sell bots can see and move it at all times. Every change on screen (buy, sell, real-balance refresh, manual edit, currency change) is saved via `sim_saldo.php`; buys/sells are sent as deltas so a bot's movement is never overwritten. The page polls the database every few seconds and reflects what the bots did. Every movement is audited in `GN_SimSaldoLog`.

**New: `GN_RoboVender` stored procedure; `GN_RoboComprar` now checks and debits the balance**
The sell procedure handles lots exactly like the front end (FIFO, partial fills, network fee, net PnL) and credits the net value to the balance in a single transaction. `GN_RoboComprar` now debits the balance in the same transaction as the lot and refuses the purchase if the balance is insufficient.

**New: continuous accuracy measurement of the forecast engine**
Every forecast stored by the engine is now scored against the realized quote (`forecast.Coverage`, filled every 5 minutes), with model rankings (`vw_Precisao_Modelos`, `vw_Precisao_Diaria`): error, gain over the "price stays the same" baseline, bias, band coverage and direction.

**New: competing models in shadow mode and automatic promotion**
Six candidate models (SES, damped trend, Theta, AR on returns, empirical-band naive, and a fixed-seed server-side port of the browser simulation) run alongside the published model, are stored and measured, and are never served to the site. A promotion procedure swaps the published model only with statistical evidence (paired comparison, minimum days/runs, margin, daily win rate, t-statistic, band coverage), with a full audit trail. A rolling-origin backtest is stored in `forecast.Backtest_Resumo`.

**Changed: `api.php` serves only the published forecast model**
Shadow models can never reach the chart.

### Português

**Novo: saldo virtual gravado por sessão no SQL Server (`GN_SimSaldo`)**
O "Saldo virtual disponível" da tela agora também existe no banco, por sessão, para os robôs de compra e venda enxergarem e movimentarem o tempo todo. Toda mudança na tela (compra, venda, refresh do saldo real, edição manual, troca de moeda) é gravada via `sim_saldo.php`; compras e vendas vão como delta, então o movimento de um robô nunca é sobrescrito. A página consulta o banco a cada poucos segundos e reflete o que os robôs fizeram. Todo movimento fica auditado em `GN_SimSaldoLog`.

**Novo: procedure `GN_RoboVender`; `GN_RoboComprar` agora valida e debita o saldo**
A procedure de venda cuida dos lotes exatamente como o front (FIFO, execução parcial, taxa de rede, PnL líquido) e credita o valor líquido no saldo numa única transação. A `GN_RoboComprar` agora debita o saldo na mesma transação do lote e recusa a compra se o saldo for insuficiente.

**Novo: medição contínua da precisão do motor de previsão**
Toda previsão gravada pelo motor agora é avaliada contra a cotação realizada (`forecast.Coverage`, preenchida a cada 5 minutos), com ranking de modelos (`vw_Precisao_Modelos`, `vw_Precisao_Diaria`): erro, ganho sobre a linha de base "o preço fica igual", viés, cobertura da faixa e direção.

**Novo: modelos concorrentes em sombra e promoção automática**
Seis modelos candidatos (SES, tendência amortecida, Theta, AR sobre retornos, naive com banda empírica e um porte no servidor, com semente fixa, da simulação do navegador) rodam ao lado do modelo publicado, são gravados e medidos, e nunca são servidos ao site. Uma procedure de promoção só troca o modelo publicado com evidência estatística (comparação pareada, mínimo de dias/execuções, margem, vitória diária, estatística t, cobertura da faixa), com trilha de auditoria completa. Um backtest rolling-origin fica gravado em `forecast.Backtest_Resumo`.

**Alterado: `api.php` serve apenas o modelo de previsão publicado**
Modelos em sombra nunca chegam ao gráfico.

---

## [v1.9.0] — 2026-09-24

### English

**New: `GN_RoboComprar` stored procedure — the buy mechanism bots will use**
Added a SQL Server stored procedure (`dbo.GN_RoboComprar`) that performs the actual buy operation: it opens a new lot in `GN_SimLotes` using the real, current average cross-exchange quote (`media_exchanges_brl`, the same "Average" line shown on the chart) as the price, sized by the amount in BRL it receives as a parameter. It only does the mechanics of the purchase — it does not decide when to buy or what the sell target should be; that decision logic is the separate, not-yet-built bot engine, which will call this procedure once it exists. Lots opened this way are tagged with the originating bot's id (new nullable `robo_client_id` column on `GN_SimLotes`) for traceability, and also logged to `GN_SimSyncLog` for auditing, same as manual purchases.

### Português

**Novo: stored procedure `GN_RoboComprar` — o mecanismo de compra que os robôs vão usar**
Adicionada uma stored procedure no SQL Server (`dbo.GN_RoboComprar`) que executa a operação de compra em si: ela abre um novo lote em `GN_SimLotes` usando a cotação real média entre as exchanges (`media_exchanges_brl`, a mesma linha "Média" mostrada no gráfico) como preço, dimensionado pelo valor em BRL recebido como parâmetro. Ela só cuida da mecânica da compra — não decide quando comprar nem qual deveria ser a meta de venda; essa lógica de decisão é o motor dos robôs, ainda não construído, que vai chamar essa procedure quando existir. Lotes abertos assim ficam marcados com o id do robô de origem (nova coluna `robo_client_id`, opcional, em `GN_SimLotes`) para rastreabilidade, e também são registrados em `GN_SimSyncLog` para auditoria, igual às compras manuais.

---

## [v1.8.1] — 2026-09-24

### English

**New: robot status/kill-switch icon on the main screen**
Added a small robot icon button right under the "Bots" (Autômatos) button, at the top of the main screen. It has three states: gray and disabled when the account has no bots configured; white and static when bots exist but none are active; and green and blinking when at least one bot is active. Clicking it (when enabled) immediately pauses every bot on the account at once — their configurations are kept, only the active/inactive switch is turned off, and they can be reactivated individually later from the Bots screen. Backed by a new `robos_pause_all.php` endpoint.

### Português

**Novo: ícone de status/kill-switch dos robôs na tela principal**
Adicionado um pequeno botão com ícone de robô logo abaixo do botão "Autômatos", no topo da tela principal. Ele tem três estados: cinza e desabilitado quando a conta não tem nenhum robô configurado; branco e parado quando há robôs mas nenhum está ativo; e verde piscando quando pelo menos um robô está ativo. Clicar nele (quando habilitado) pausa imediatamente todos os robôs da conta de uma só vez — as configurações são mantidas, só o interruptor ativo/inativo é desligado, e cada um pode ser reativado individualmente depois na tela de Autômatos. Sustentado por um novo endpoint `robos_pause_all.php`.

---

All notable changes to GambleNumbers are documented here, in English and Portuguese.

Todas as mudanças relevantes do GambleNumbers são documentadas aqui, em inglês e português.

---

## [v1.8.0] — 2026-09-23

### English

**New: "Bots" screen — bot creation and configuration**
Added a "Bots" (Autômatos) button next to "Statements" that opens a dedicated screen for creating and configuring trading bots. Each bot has a nickname, currency (BTC/BCH), amount per trade and desired return percentage (both defaulting from the main screen's own fields, editable per bot), and an active/inactive toggle. The daily loss limit is fixed at 10% and cannot be edited — the bot shuts itself down after accumulating that much loss since it started, matching the agreed decision rules. Up to 5 bots per account for now (the cap that opens up when a bot is published to the marketplace, per the product plan, isn't implemented yet). Backed by a new `GN_Robos` table and three endpoints (`robos_load.php`, `robos_save.php`, `robos_delete.php`); the bot's own buy/sell decision engine is a separate project, not built yet — this release is only the configuration screen. All UI strings ship in the site's 11 supported languages.

### Português

**Novo: tela "Autômatos" — criação e configuração de robôs**
Adicionado um botão "Autômatos" ao lado de "Extratos" que abre uma tela dedicada para criar e configurar robôs de negociação. Cada robô tem apelido, moeda (BTC/BCH), valor por operação e retorno desejado (%) — ambos pré-preenchidos a partir dos campos da tela principal, editáveis por robô — e um interruptor ativo/inativo. O limite de perda diária é fixo em 10% e não pode ser editado: o robô se desliga sozinho ao acumular essa perda desde o início, conforme as regras já combinadas. Por enquanto, até 5 robôs por conta (o limite que se abre ao publicar um robô no marketplace, conforme o plano de produto, ainda não foi implementado). Sustentado por uma nova tabela `GN_Robos` e três endpoints (`robos_load.php`, `robos_save.php`, `robos_delete.php`); o motor de decisão de compra/venda do robô é um projeto à parte, ainda não construído — este release é só a tela de configuração. Todos os textos da interface já saem nos 11 idiomas suportados pelo site.

---

## [v1.7.2] — 2026-09-23

### English

**New: near real-time mirror + upsert for server-side operations**
`app.js` now polls `sim_load.php` every 4 seconds (in addition to page load) so buy/sell operations created directly in SQL Server — by a bot, another device, or a manual `INSERT`/`UPDATE` — appear on screen within a few seconds, with no page reload needed. `_mergeServerOps()` was changed from add-only to an upsert: any record already merged from the server (flagged `_remote`) can now have its fields refreshed on a later poll (e.g. a scheduled sell moving from `pending` to `executed`). Records that predate this feature, or were created by the user clicking in this same tab, are never touched by the merge — this tab stays the sole authority over their lifecycle.

### Português

**Novo: espelho quase em tempo real + upsert de operações vindas do servidor**
O `app.js` agora consulta o `sim_load.php` a cada 4 segundos (além do carregamento da página), então operações de compra/venda criadas direto no SQL Server — por um robô, outro aparelho, ou um `INSERT`/`UPDATE` manual — aparecem na tela em poucos segundos, sem precisar recarregar a página. O `_mergeServerOps()` deixou de só adicionar e passou a fazer upsert: um registro que já veio do servidor (marcado `_remote`) agora pode ter seus campos atualizados numa leitura seguinte (ex.: uma venda agendada passando de `pending` pra `executed`). Registros anteriores a essa funcionalidade, ou criados pelo próprio usuário clicando nesta mesma aba, nunca são tocados pelo merge — essa aba continua sendo a única responsável pelo ciclo de vida deles.

---

## [v1.7.1] — 2026-09-23

### English

**Fixed: stale JS served after deploy (cache-busting)**
`app.js`'s cache-busting query string in `index.html` was not bumped when the `sim_load.php` sync feature (v1.7.0) shipped, so browsers and the Cloudflare edge kept serving the previous, cached copy indefinitely (`Cache-Control: public, max-age=31536000, immutable`), even after a hard refresh. Bumped `app.js` and `identity.js` query versions; both are now cache-busted per release going forward.

**New: "Gamble Numbers" enamel keychain badge**
A metal-and-enamel keychain-tag badge — brushed-metal ring, glossy plate, embossed "GAMBLE NUMBERS" title and current version number — now appears at the top of every modal/overlay (login by password, language picker, verification terminal, etc.), via a single `MutationObserver` in `identity.js` so no existing modal template had to be touched individually.

### Português

**Corrigido: JS antigo servido após deploy (cache-busting)**
A query string de cache-busting do `app.js` no `index.html` não foi atualizada quando a sincronização via `sim_load.php` (v1.7.0) foi publicada, então navegadores e a borda da Cloudflare continuaram servindo a cópia antiga em cache indefinidamente (`Cache-Control: public, max-age=31536000, immutable`), mesmo com hard refresh. As versões de `app.js` e `identity.js` foram incrementadas; ambas agora levam cache-busting a cada release.

**Novo: selo "Gamble Numbers" estilo chaveiro esmaltado**
Um selo estilo placa de chaveiro em metal esmaltado — anel de metal escovado, placa brilhante, título "GAMBLE NUMBERS" em relevo e a versão atual — agora aparece no topo de todo modal/overlay do site (login por senha, seleção de idioma, terminal de verificação, etc.), via um único `MutationObserver` no `identity.js`, sem precisar alterar cada template de modal individualmente.

---

## [v1.7.0] — 2026-09-22

### English

**New: real statistical price forecast (backend)**
A reference trace on the chart now shows the engine's real statistical forecast (rolling-origin cross-validation, computed on lsql2019), refreshed roughly every 5 minutes. It is informational only — it never feeds the client-side simulation or any sell logic.

**New: simulated operations sync endpoint**
Buy/sell operations made in the chart (previously kept only in the browser's IndexedDB) are now also synced to SQL Server (`GN_SimLotes`/`GN_SimVendas`) via a best-effort `sendBeacon`/`fetch(keepalive)` call, for backup and auditing purposes.

**Fixed: XSS hardening on dynamic text**
Text originating from i18n/database content and rendered via `innerHTML` (operations table, statements) is now HTML-escaped.

**Added: more currency symbols**
JPY, CNY, TRY and RUB symbols added to the display-currency formatter.

**New: confirmation reconciliation script**
`reconciliar_confirmacoes.py` added under `private/scripts/` to reconcile pending on-chain confirmations.

### Português

**Novo: previsão estatística real de preço (backend)**
Um traço de referência no gráfico agora mostra a previsão estatística real do motor (validação cruzada rolling-origin, calculada no lsql2019), atualizado a cada ~5 minutos. É apenas informativo — nunca alimenta a simulação client-side nem qualquer lógica de venda.

**Novo: endpoint de sincronização das operações simuladas**
Operações de compra/venda feitas no gráfico (antes mantidas só no IndexedDB do navegador) agora também são sincronizadas com o SQL Server (`GN_SimLotes`/`GN_SimVendas`) via `sendBeacon`/`fetch(keepalive)` best-effort, para backup e auditoria.

**Corrigido: reforço contra XSS em textos dinâmicos**
Textos vindos de i18n/banco e renderizados via `innerHTML` (tabela de operações, extratos) agora passam por escape de HTML.

**Adicionado: mais símbolos de moeda**
Símbolos de JPY, CNY, TRY e RUB adicionados ao formatador de moeda de exibição.

**Novo: script de reconciliação de confirmações**
`reconciliar_confirmacoes.py` adicionado em `private/scripts/` para reconciliar confirmações on-chain pendentes.

---

## [v1.6.0] — 2026-09-17

### English

**New: real custody mode — auto-generated deposit addresses**
Visitors can now opt into "real mode": the site generates a dedicated BTC and BCH deposit address for them straight from the node wallets, so operations can move real funds instead of only simulated ones.

**New: optional password for cross-device access**
Visitors can set a password to recover their session — and the funds tied to it — from another browser or device. Without a password, access stays tied to the browser that created the session.

**New: BTC↔BCH transfer bridge**
A "Transfer" widget was added to the Statements screen, letting a real BTC↔BCH conversion be requested directly from the account's own on-chain balance through a third-party swap provider (SideShift): quote confirmation, execution, and on-chain status tracking are shown live in a terminal-style log.

**Improved: client-side error reporting**
Failures during the account-setup and transfer flows are now also logged server-side (including the JS exception, when there is one), making issues easier to diagnose after the fact.

### Português

**Novo: modo de custódia real — endereços de depósito gerados automaticamente**
Visitantes agora podem optar pelo "modo real": o site gera um endereço de depósito dedicado em BTC e BCH pra eles direto a partir das wallets dos nós, permitindo que as operações movimentem fundos reais em vez de só simulados.

**Novo: senha opcional para acesso multi-dispositivo**
Visitantes podem definir uma senha para recuperar a sessão — e os fundos ligados a ela — a partir de outro navegador ou aparelho. Sem senha, o acesso fica preso ao navegador que criou a sessão.

**Novo: ponte de transferência BTC↔BCH**
Foi adicionado um widget de "Transferência" na tela de Extratos, permitindo solicitar uma conversão real BTC↔BCH direto do saldo on-chain da própria conta, através de um provedor de swap terceirizado (SideShift): confirmação de cotação, execução e acompanhamento do status on-chain aparecem ao vivo num log estilo terminal.

**Melhorado: registro de erros do lado do cliente**
Falhas durante os fluxos de configuração de conta e de transferência agora também são registradas no servidor (incluindo a exceção JS, quando houver), facilitando o diagnóstico posterior.

---

## [v1.5.0] — 2026-09-10

### English

**New: Account Statements ("Extratos")**
A new "Statements" screen shows the full BTC/BCH history for your session: every deposit and withdrawal, the running coin balance, and the total portfolio value — all converted live into the currency you have selected (BRL, USD, EUR, GBP, JPY, CNY, TRY or RUB). Open it from the new "Extratos" button in the top navigation.

**Fixed: real balance lookups on BTC/BCH addresses**
Real balance checks against BTC/BCH addresses were silently failing. The backend now decodes P2PKH, P2SH and native SegWit (Bech32/Bech32m) addresses locally into the scripthash format the node's Electrum-compatible server (Fulcrum) actually expects, instead of the legacy address-based method it no longer supports.

**New: "Delete my data" control**
A trash-can button was added next to the balance field. It walks you through a clear, red-highlighted confirmation before permanently deleting every record tied to your anonymous session (trades, deposits, payments, orders, and the session profile itself) from the database.

**Improved: language is asked first, and remembered everywhere**
Instead of defaulting silently to Portuguese, the site now asks for your preferred language as the very first screen, with a flag picker. That choice is saved on your device and applied across the whole site on every future visit, not only through the top-bar dropdown.

**Improved: price forecast accuracy across zoom levels**
The forecast/projection engine was reworked to calibrate only from real recorded prices — never from the smoothed data used just to draw the chart — and to use finer time resolution for the near term and coarser resolution when you zoom out to months or years, so the shape of the projection no longer changes just because you changed the zoom. It also no longer invents data across gaps when the price collector was briefly offline. When your target price falls outside the visible chart, an arrow at the edge now points to it instead of the marker simply vanishing.

**Housekeeping**
Removed 13 leftover timestamped `.bak_*` debug backups from the production web root and added the pattern to `.gitignore` so it doesn't happen again.

### Português

**Novo: Extratos por sessão**
Uma nova tela de "Extratos" mostra o histórico completo de BTC/BCH da sua sessão: cada entrada e saída, o saldo corrente em moeda e o valor total da carteira — tudo convertido ao vivo para a moeda escolhida (BRL, USD, EUR, GBP, JPY, CNY, TRY ou RUB). Acesse pelo novo botão "Extratos" no topo do site.

**Corrigido: consulta de saldo real de endereços BTC/BCH**
As consultas de saldo real em endereços BTC/BCH vinham falhando silenciosamente. O backend agora decodifica endereços P2PKH, P2SH e SegWit nativo (Bech32/Bech32m) localmente para o formato scripthash que o servidor compatível com Electrum (Fulcrum) realmente espera, em vez do método antigo baseado em endereço, que não é mais suportado.

**Novo: botão "Apagar meus dados"**
Foi adicionado um botão de lixeira ao lado do campo de saldo. Ele conduz o usuário por uma confirmação clara, destacada em vermelho, antes de apagar definitivamente todos os registros ligados à sua sessão anônima (operações, depósitos, pagamentos, ordens e o próprio perfil) do banco de dados.

**Melhorado: idioma é perguntado primeiro e vale para o site todo**
Em vez de assumir português silenciosamente, o site agora pergunta o idioma preferido logo na primeira tela, com seleção por bandeiras. Essa escolha fica salva no dispositivo e passa a valer em todo o site, em qualquer visita futura — não só no seletor do topo.

**Melhorado: precisão da previsão de preço em qualquer nível de zoom**
O motor de previsão/projeção foi reescrito para se calibrar apenas com preços reais registrados — nunca com os dados suavizados usados só para desenhar o gráfico — e para usar resolução de tempo mais fina no curto prazo e mais grossa ao afastar o zoom para meses ou anos, de forma que o formato da projeção não muda mais só porque o zoom mudou. Também deixou de inventar dados durante períodos em que o coletor de preços ficou fora do ar. Quando o preço-alvo fica fora da área visível do gráfico, uma seta na borda agora aponta para ele em vez de o marcador simplesmente sumir.

**Faxina**
Removidos 13 backups de depuração `.bak_*` com timestamp que ficaram esquecidos na webroot de produção, e o padrão foi adicionado ao `.gitignore` para não voltar a acontecer.

---
