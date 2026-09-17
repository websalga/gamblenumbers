# Changelog

All notable changes to GambleNumbers are documented here, in English and Portuguese.

Todas as mudanças relevantes do GambleNumbers são documentadas aqui, em inglês e português.

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
