-- =============================================================================
-- GambleNumbers — Chart_Config: calibração de gráfico por par ativo/cotacao
-- Gerado em: 2026-08-16
-- Execute no banco bitcoin (SQL Server / lsql2019)
-- Idempotente: usa MERGE para não duplicar linhas
-- =============================================================================

MERGE dbo.Chart_Config AS tgt
USING (VALUES
  -- defaults por categoria (fallback quando par exato não existe)
  ('_DEFAULT_BTC','_','crypto_btc',2,3.00,0.8000,1,1,'1D'),
  ('_DEFAULT_BCH','_','crypto_bch',2,4.00,1.0000,1,1,'1D'),
  ('_DEFAULT_FIAT','_','fiat',     4,1.00,0.3000,0,0,'1D'),
  -- BTC como ativo
  ('BTC','BRL','crypto_btc',2,3.00,0.8000,1,1,'1D'),
  ('BTC','USD','crypto_btc',2,3.00,0.8000,1,1,'1D'),
  ('BTC','EUR','crypto_btc',2,3.00,0.8000,1,1,'1D'),
  ('BTC','GBP','crypto_btc',2,3.00,0.8000,1,1,'1D'),
  ('BTC','JPY','crypto_btc',0,3.00,0.8000,1,1,'1D'),
  ('BTC','CNY','crypto_btc',2,3.00,0.8000,1,1,'1D'),
  ('BTC','TRY','crypto_btc',0,3.00,0.8000,1,1,'1D'),
  ('BTC','RUB','crypto_btc',0,3.00,0.8000,1,1,'1D'),
  -- BCH como ativo
  ('BCH','BRL','crypto_bch',2,4.00,1.0000,1,1,'1D'),
  ('BCH','USD','crypto_bch',2,4.00,1.0000,1,1,'1D'),
  ('BCH','EUR','crypto_bch',2,4.00,1.0000,1,1,'1D'),
  ('BCH','GBP','crypto_bch',2,4.00,1.0000,1,1,'1D'),
  ('BCH','JPY','crypto_bch',0,4.00,1.0000,1,1,'1D'),
  ('BCH','CNY','crypto_bch',2,4.00,1.0000,1,1,'1D'),
  ('BCH','TRY','crypto_bch',0,4.00,1.0000,1,1,'1D'),
  ('BCH','RUB','crypto_bch',0,4.00,1.0000,1,1,'1D'),
  -- Crypto x Crypto
  ('BTC','BCH','crypto_btc',4,3.00,0.8000,0,0,'1D'),
  ('BCH','BTC','crypto_bch',6,4.00,1.0000,0,0,'1D')
) AS src(ativo,cotacao,fonte,price_decimals,y_padding_pct,forecast_min_amp_pct,
         show_spread,show_exchanges,default_periodo)
ON tgt.ativo = src.ativo AND tgt.cotacao = src.cotacao
WHEN NOT MATCHED THEN INSERT
  (ativo,cotacao,fonte,price_decimals,y_padding_pct,forecast_min_amp_pct,
   show_spread,show_exchanges,default_periodo)
  VALUES (src.ativo,src.cotacao,src.fonte,src.price_decimals,src.y_padding_pct,
          src.forecast_min_amp_pct,src.show_spread,src.show_exchanges,src.default_periodo)
WHEN MATCHED THEN UPDATE SET
  fonte=src.fonte, price_decimals=src.price_decimals,
  y_padding_pct=src.y_padding_pct, forecast_min_amp_pct=src.forecast_min_amp_pct,
  show_spread=src.show_spread, show_exchanges=src.show_exchanges,
  default_periodo=src.default_periodo, updated_at=GETUTCDATE();

-- Pares fiat×fiat: gerados automaticamente via _DEFAULT_FIAT como fallback.
-- Para customizar um par específico, adicione uma linha aqui.

SELECT COUNT(*) AS total_configs FROM dbo.Chart_Config;
