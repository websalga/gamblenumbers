-- =============================================================================
-- GN_Morningstar — cotacao BTC/USD Morningstar no historico de snapshots (v1.13.1)
-- Banco: bitcoin (SQL Server / lsql2019)
--
-- Objetivo
--   Adicionar a Morningstar como QUARTA cotacao do BTC. O site le os valores historicos de
--   dbo.snapshots; a serie Media (media_exchanges_*) e' a media das 4 cotacoes (Binance,
--   Kraken, Coinbase e Morningstar) e alimenta tambem o motor de previsao, os robos e os extratos.
--
-- Fonte operacional
--   A cotacao e o BTC/USD exibido pelo Google Finance. O disclaimer do Google
--   identifica a Morningstar como fonte de precos de moedas/cripto no Google
--   Finance, e CoinMarketCap como fonte de metadados de criptomoedas. Como nao ha
--   API publica oficial do Google Finance para este uso, o coletor deve tratar a
--   leitura como best-effort, com cache, timeout curto e falha silenciosa.
--
-- Colunas em producao confirmadas em 2026-09-26
--   dbo.snapshots.price_usd_morningstar decimal(19,6) NULL
--   dbo.snapshots.price_brl_morningstar decimal(19,6) NULL
--
-- Cobertura em 2026-09-26
--   Ate 2026-09-26 ~15:10 UTC (26/01 em diante) o Morningstar foi ESTIMADO, nao medido: leitura unica
--   em 2026-09-26 mostrou -0,0922% em relacao a media das 3 exchanges e esse percentual foi aplicado a
--   todo o historico (Morningstar acompanha o Coinbase: 0,0000% de diferenca na mesma leitura).
--   Dali em diante o coletor (lsql2019: /root/coletar_morningstar.py, coletar-morningstar.timer, 1 min)
--   grava a leitura REAL na linha de snapshot mais recente ainda sem valor (janela de 8 min).
--
-- Contrato com o site
--   public/api.php seleciona price_*_morningstar para pares BTC/fiat e expõe o
--   campo JSON `morningstar`. Para moedas calculadas (JPY/CNY/TRY/RUB), o valor
--   deriva de price_usd_morningstar multiplicado pela taxa FX vigente. Se a linha
--   mais recente ainda nao tiver Morningstar, api.php pode completar apenas esse
--   ultimo ponto via cache/scrape do Google Finance; esse overlay nao altera a
--   Media e nao substitui o historico do banco.
--
-- Contrato do coletor
--   1. Coletar BTC/USD Morningstar/Google Finance com timeout curto.
--   2. Gravar price_usd_morningstar no snapshot BTC correspondente.
--   3. Gravar price_brl_morningstar = price_usd_morningstar * usd_brl da mesma
--      linha ou da taxa FX aplicada no ciclo.
--   4. Recalcular media_exchanges_{usd,brl,eur,gbp} da linha como media de 4: multiplicar a media
--      de 3 por (3 + Morningstar/Media3)/4, UMA unica vez por linha (controle: dbo.snapshots_media3,
--      que guarda a media de 3 original — auditoria e reversao).
--   5. Em falha de rede, markup alterado, captcha ou valor invalido, deixar NULL
--      e nao bloquear o coletor principal de Binance/Kraken/Coinbase.
-- =============================================================================

IF COL_LENGTH('dbo.snapshots', 'price_usd_morningstar') IS NULL
BEGIN
    ALTER TABLE dbo.snapshots
        ADD price_usd_morningstar DECIMAL(19,6) NULL;
END;
GO

IF COL_LENGTH('dbo.snapshots', 'price_brl_morningstar') IS NULL
BEGIN
    ALTER TABLE dbo.snapshots
        ADD price_brl_morningstar DECIMAL(19,6) NULL;
END;
GO

-- Backfill idempotente para BRL quando USD e a taxa usd_brl ja existem na linha.
-- Nao altera linhas ja preenchidas e nao toca na media das exchanges.
UPDATE dbo.snapshots
SET price_brl_morningstar = price_usd_morningstar * usd_brl
WHERE price_brl_morningstar IS NULL
  AND price_usd_morningstar IS NOT NULL
  AND usd_brl IS NOT NULL
  AND usd_brl > 0;
GO

-- Consulta de auditoria rapida: cobertura e ultimos pontos.
SELECT
    MIN(ts_utc) AS min_morningstar_utc,
    MAX(ts_utc) AS max_morningstar_utc,
    COUNT(*) AS rows_with_morningstar
FROM dbo.snapshots
WHERE price_usd_morningstar IS NOT NULL
   OR price_brl_morningstar IS NOT NULL;
GO

SELECT TOP (20)
    ts_utc,
    price_usd_morningstar,
    price_brl_morningstar,
    media_exchanges_usd,
    media_exchanges_brl
FROM dbo.snapshots
WHERE price_usd_morningstar IS NOT NULL
   OR price_brl_morningstar IS NOT NULL
ORDER BY ts_utc DESC;
GO

-- Media de 4 (2026-09-26): tabela de controle/reversao e conversao unica do historico.
IF OBJECT_ID('dbo.snapshots_media3') IS NULL
    CREATE TABLE dbo.snapshots_media3 (
        id BIGINT NOT NULL PRIMARY KEY,
        media_exchanges_usd DECIMAL(19,6) NULL, media_exchanges_brl DECIMAL(19,6) NULL,
        media_exchanges_eur DECIMAL(19,6) NULL, media_exchanges_gbp DECIMAL(19,6) NULL,
        convertido_em DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
-- Reversao: UPDATE s SET media_exchanges_usd = m.media_exchanges_usd, ... FROM dbo.snapshots s JOIN dbo.snapshots_media3 m ON m.id = s.id;
GO
