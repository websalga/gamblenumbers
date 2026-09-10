# Changelog

All notable changes to GambleNumbers are documented here, in English and Portuguese.

Todas as mudanças relevantes do GambleNumbers são documentadas aqui, em inglês e português.

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
