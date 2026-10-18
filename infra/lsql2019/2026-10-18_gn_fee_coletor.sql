-- =============================================================================
-- 2026-10-18 — gn-fee-collector: tempo de confirmação por taxa (BTC e BCH)
-- Banco: bitcoin (SQL Server / lsql2019)
--
-- PT: O coletor (infra/lxbtc01/gn-fee-collector) lê a mempool do node a cada 5 s e grava,
--     para cada transação, a hora em que entrou na fila (campo `time` do próprio node), a taxa
--     paga e a hora/bloco em que saiu. dbo.GN_FeeTempoPorTaxa resume a espera por faixa de taxa
--     nos últimos N blocos. Dados brutos ficam 30 dias.
-- EN: The collector (infra/lxbtc01/gn-fee-collector) reads the node mempool every 5 s and stores,
--     for each transaction, when it entered the queue (the node's own `time` field), the fee paid
--     and when/in which block it left. dbo.GN_FeeTempoPorTaxa summarizes the wait per fee band over
--     the last N blocks. Raw data is kept for 30 days.
--
-- Uso / usage:  EXEC dbo.GN_FeeTempoPorTaxa @coin = 'BTC', @blocos = 144;
-- =============================================================================

CREATE TABLE dbo.GN_FeeMempoolTx (
    coin          char(3)       NOT NULL,
    txid          binary(32)    NOT NULL,
    entrada_utc   datetime2(0)  NOT NULL,
    fee_sats      bigint        NOT NULL,
    tamanho_vb    int           NOT NULL,
    taxa_satvb    decimal(12,3) NOT NULL,
    tem_pais      bit           NOT NULL CONSTRAINT DF_GN_FeeMempoolTx_pais DEFAULT 0,
    saida_utc     datetime2(0)  NULL,
    motivo_saida  varchar(12)   NULL,
    bloco_altura  int           NULL,
    espera_seg    AS DATEDIFF(SECOND, entrada_utc, saida_utc) PERSISTED,
    CONSTRAINT PK_GN_FeeMempoolTx PRIMARY KEY (coin, txid),
    CONSTRAINT CK_GN_FeeMempoolTx_motivo CHECK (motivo_saida IN ('confirmada','removida'))
);
CREATE INDEX IX_GN_FeeMempoolTx_bloco ON dbo.GN_FeeMempoolTx (coin, bloco_altura) INCLUDE (taxa_satvb, espera_seg, tem_pais) WHERE motivo_saida = 'confirmada';
CREATE INDEX IX_GN_FeeMempoolTx_entrada ON dbo.GN_FeeMempoolTx (coin, entrada_utc);
GO

CREATE TABLE dbo.GN_FeeBlocos (
    coin               char(3)       NOT NULL,
    altura             int           NOT NULL,
    hash               binary(32)    NOT NULL,
    hora_bloco_utc     datetime2(0)  NOT NULL,
    visto_utc          datetime2(0)  NOT NULL,
    qtd_tx             int           NOT NULL,
    qtd_tx_vistas      int           NOT NULL,
    taxa_min_satvb     decimal(12,3) NULL,
    taxa_mediana_satvb decimal(12,3) NULL,
    taxa_max_satvb     decimal(12,3) NULL,
    fila_qtd_depois    int           NULL,
    CONSTRAINT PK_GN_FeeBlocos PRIMARY KEY (coin, altura, hash)
);
GO
CREATE OR ALTER PROCEDURE dbo.GN_FeeTempoPorTaxa
    @coin char(3) = 'BTC',
    @blocos int = 144
AS
/* Tempo de espera medido (entrada na fila -> bloco) por faixa de taxa, nos últimos @blocos blocos vistos.
   Ignora transações com pais na fila (CPFP), cuja taxa própria não reflete a taxa efetiva. */
BEGIN
    SET NOCOUNT ON;
    DECLARE @alturaMin int = (SELECT MAX(altura) - @blocos + 1 FROM dbo.GN_FeeBlocos WHERE coin = @coin);

    WITH t AS (
        SELECT taxa_satvb, espera_seg,
               CASE WHEN taxa_satvb < 0.2 THEN 1 WHEN taxa_satvb < 0.5 THEN 2 WHEN taxa_satvb < 1 THEN 3
                    WHEN taxa_satvb < 2 THEN 4 WHEN taxa_satvb < 3 THEN 5 WHEN taxa_satvb < 5 THEN 6
                    WHEN taxa_satvb < 10 THEN 7 WHEN taxa_satvb < 20 THEN 8 ELSE 9 END AS faixa
        FROM dbo.GN_FeeMempoolTx
        WHERE coin = @coin AND motivo_saida = 'confirmada' AND tem_pais = 0
          AND bloco_altura >= @alturaMin AND espera_seg >= 0
    ), p AS (
        SELECT faixa, espera_seg,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY espera_seg) OVER (PARTITION BY faixa) AS p50,
               PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY espera_seg) OVER (PARTITION BY faixa) AS p90
        FROM t
    )
    SELECT faixa,
           CASE faixa WHEN 1 THEN 0 WHEN 2 THEN 0.2 WHEN 3 THEN 0.5 WHEN 4 THEN 1 WHEN 5 THEN 2
                      WHEN 6 THEN 3 WHEN 7 THEN 5 WHEN 8 THEN 10 ELSE 20 END AS taxa_de,
           CASE faixa WHEN 1 THEN 0.2 WHEN 2 THEN 0.5 WHEN 3 THEN 1 WHEN 4 THEN 2 WHEN 5 THEN 3
                      WHEN 6 THEN 5 WHEN 7 THEN 10 WHEN 8 THEN 20 ELSE NULL END AS taxa_ate,
           COUNT(*) AS qtd_tx,
           AVG(CAST(espera_seg AS bigint)) AS espera_media_seg,
           MAX(p50) AS espera_p50_seg,
           MAX(p90) AS espera_p90_seg,
           MAX(espera_seg) AS espera_max_seg
    FROM p
    GROUP BY faixa
    ORDER BY faixa;
END;
GO

-- Login dedicado do coletor (troque a senha; ela fica só em /etc/gn-fee-collector/collector.env, modo 600)
-- Dedicated collector login (set your own password; it lives only in /etc/gn-fee-collector/collector.env, mode 600)
CREATE LOGIN gn_fee_collector WITH PASSWORD = '<defina-uma-senha-forte>', DEFAULT_DATABASE = bitcoin, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
CREATE USER gn_fee_collector FOR LOGIN gn_fee_collector;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.GN_FeeMempoolTx TO gn_fee_collector;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.GN_FeeBlocos TO gn_fee_collector;
GRANT EXECUTE ON dbo.GN_FeeTempoPorTaxa TO gn_fee_collector;
GO