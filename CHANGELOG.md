# Changelog

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
