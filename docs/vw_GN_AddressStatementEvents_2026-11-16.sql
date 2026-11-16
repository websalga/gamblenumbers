-- GambleNumbers 16/11/2026: o extrato (vw_GN_AddressStatementEvents) nao conta transacao que nunca confirmou
-- e sumiu da rede (ex.: substituida por outra). Antes, uma tx vista so na mempool ficava com height NULL e o
-- saldo das linhas do extrato ficava acima do real.
-- Regra (so na view, nenhuma linha apagada): conta se tem bloco (height > 0) OU se ainda foi vista na ultima
-- verificacao do endereco (last_seen_utc >= ultima verificacao - 10 min) = pendente de verdade.
USE bitcoin;
GO
CREATE OR ALTER VIEW dbo.vw_GN_AddressStatementEvents AS
WITH cadastro AS (
    SELECT u.session_id, 'BTC' AS asset, u.btc_address AS address, u.criado_em AS observed_at_utc, NULL AS block_height,
           'cadastro_site' AS event_type, CAST(0 AS bigint) AS total_sat, CAST(0 AS bigint) AS prev_total_sat, CAST(0 AS bigint) AS delta_sat,
           CAST(p.media_exchanges_brl AS decimal(18,8)) AS price_brl, CAST(0 AS decimal(38,8)) AS value_brl,
           CAST(0 AS decimal(38,8)) AS delta_value_brl, CAST('gamblenumbers' AS varchar(32)) AS source_host
    FROM dbo.GN_Usuarios u
    OUTER APPLY (SELECT TOP (1) media_exchanges_brl FROM dbo.snapshots WHERE ok=1 AND media_exchanges_brl>0 AND ts_utc <= u.criado_em ORDER BY ts_utc DESC) p
    WHERE u.btc_address IS NOT NULL AND u.btc_address <> ''
    UNION ALL
    SELECT u.session_id, 'BCH' AS asset, u.bch_address AS address, u.criado_em AS observed_at_utc, NULL AS block_height,
           'cadastro_site' AS event_type, CAST(0 AS bigint) AS total_sat, CAST(0 AS bigint) AS prev_total_sat, CAST(0 AS bigint) AS delta_sat,
           CAST(p.media_exchanges_brl AS decimal(18,8)) AS price_brl, CAST(0 AS decimal(38,8)) AS value_brl,
           CAST(0 AS decimal(38,8)) AS delta_value_brl, CAST('gamblenumbers' AS varchar(32)) AS source_host
    FROM dbo.GN_Usuarios u
    OUTER APPLY (SELECT TOP (1) media_exchanges_brl FROM dbo.BCH_Snapshots WHERE ok=1 AND media_exchanges_brl>0 AND ts_utc <= u.criado_em ORDER BY ts_utc DESC) p
    WHERE u.bch_address IS NOT NULL AND u.bch_address <> ''
),
btc_movs AS (
    SELECT m.address, m.tx_hash,
           COALESCE(m.block_time_utc, m.first_seen_utc) AS observed_at_utc,
           m.height AS block_height,
           CAST(m.value_in_sat - m.value_out_sat AS bigint) AS delta_sat
    FROM dbo.GN_BTC_TxMovements m
    WHERE m.height > 0
       OR m.last_seen_utc >= DATEADD(minute, -10, (SELECT MAX(c.last_checked_utc) FROM dbo.GN_BTC_AddressCache c WHERE c.address = m.address))
),
bch_movs AS (
    SELECT m.address, m.tx_hash,
           COALESCE(m.block_time_utc, m.first_seen_utc) AS observed_at_utc,
           m.height AS block_height,
           CAST(m.value_in_sat - m.value_out_sat AS bigint) AS delta_sat
    FROM dbo.GN_BCH_TxMovements m
    WHERE m.height > 0
       OR m.last_seen_utc >= DATEADD(minute, -10, (SELECT MAX(c.last_checked_utc) FROM dbo.GN_BCH_AddressCache c WHERE c.address = m.address))
),
btc_priced AS (
    SELECT 'BTC' AS asset, m.address, m.observed_at_utc, m.block_height, m.delta_sat, m.tx_hash,
           CAST(p.media_exchanges_brl AS decimal(18,8)) AS price_brl
    FROM btc_movs m
    OUTER APPLY (SELECT TOP (1) media_exchanges_brl FROM dbo.snapshots WHERE ok=1 AND media_exchanges_brl>0 AND ts_utc <= m.observed_at_utc ORDER BY ts_utc DESC) p
    WHERE m.observed_at_utc IS NOT NULL
),
bch_priced AS (
    SELECT 'BCH' AS asset, m.address, m.observed_at_utc, m.block_height, m.delta_sat, m.tx_hash,
           CAST(p.media_exchanges_brl AS decimal(18,8)) AS price_brl
    FROM bch_movs m
    OUTER APPLY (SELECT TOP (1) media_exchanges_brl FROM dbo.BCH_Snapshots WHERE ok=1 AND media_exchanges_brl>0 AND ts_utc <= m.observed_at_utc ORDER BY ts_utc DESC) p
    WHERE m.observed_at_utc IS NOT NULL
),
all_priced AS (
    SELECT * FROM btc_priced
    UNION ALL
    SELECT * FROM bch_priced
),
running AS (
    SELECT ap.*,
           SUM(ap.delta_sat) OVER (PARTITION BY ap.asset, ap.address ORDER BY ap.observed_at_utc, ap.tx_hash ROWS UNBOUNDED PRECEDING) AS total_sat
    FROM all_priced ap
    WHERE ap.delta_sat <> 0
),
tx_events AS (
    SELECT u.session_id, r.asset, r.address, r.observed_at_utc, r.block_height,
           CASE WHEN r.delta_sat > 0 THEN 'entrada' ELSE 'saida' END AS event_type,
           r.total_sat, r.total_sat - r.delta_sat AS prev_total_sat, r.delta_sat,
           r.price_brl,
           CAST((r.total_sat / 100000000.0) * r.price_brl AS decimal(38,8)) AS value_brl,
           CAST((r.delta_sat / 100000000.0) * r.price_brl AS decimal(38,8)) AS delta_value_brl,
           CASE WHEN r.asset = 'BTC' THEN 'lxbtc01' ELSE 'lxbch02' END AS source_host
    FROM running r
    JOIN dbo.GN_Usuarios u
      ON (r.asset = 'BTC' AND u.btc_address = r.address)
      OR (r.asset = 'BCH' AND u.bch_address = r.address)
)
SELECT session_id, asset, address, observed_at_utc, block_height, event_type,
       total_sat, prev_total_sat, delta_sat,
       CAST(total_sat / 100000000.0 AS decimal(38,8)) AS total_coin,
       CAST(delta_sat / 100000000.0 AS decimal(38,8)) AS delta_coin,
       price_brl, value_brl, delta_value_brl, source_host
FROM cadastro
UNION ALL
SELECT session_id, asset, address, observed_at_utc, block_height, event_type,
       total_sat, prev_total_sat, delta_sat,
       CAST(total_sat / 100000000.0 AS decimal(38,8)) AS total_coin,
       CAST(delta_sat / 100000000.0 AS decimal(38,8)) AS delta_coin,
       price_brl, value_brl, delta_value_brl, source_host
FROM tx_events;
GO

