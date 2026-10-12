-- Migracao 2026-10-12 / Migration: percentual de COMPRA separado da meta de venda
-- Separate BUY percentage, independent of the sell profit target. Banco/Database: bitcoin
-- Depois de rodar, aplique (CREATE OR ALTER): GN_RoboOrquestrador.sql, GN_RoboAjustarParametros.sql, TR_GN_Robos_ParametrosLog.sql
IF COL_LENGTH('dbo.GN_Robos', 'queda_compra_pct') IS NULL
    ALTER TABLE dbo.GN_Robos ADD queda_compra_pct DECIMAL(9,4) NULL;
IF COL_LENGTH('dbo.GN_RoboParametrosLog', 'queda_compra_pct') IS NULL
    ALTER TABLE dbo.GN_RoboParametrosLog ADD queda_compra_pct DECIMAL(9,4) NULL;
GO
-- robos existentes mantem o comportamento de compra anterior (limiar de 1.5% + taxas)
UPDATE dbo.GN_Robos SET queda_compra_pct = 1.5 WHERE queda_compra_pct IS NULL;
GO
