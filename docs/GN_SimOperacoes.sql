-- =============================================================================
-- GN_SimOperacoes — colunas de sincronizacao das operacoes simuladas (v1.12.0)
-- Banco: bitcoin (SQL Server / lsql2019). O SQL Server e' a fonte de verdade de
-- lotes (GN_SimLotes) e vendas (GN_SimVendas); navegador e robos escrevem nele.
--
--   excluido / excluido_em  exclusao LOGICA (a linha fica para auditoria e o id nunca e' reutilizado;
--                           sim_load.php devolve seq_max incluindo as excluidas)
--   oculto                  icone do olho (esconde a operacao no grafico)
--   versao                  +1 a cada alteracao (navegador ou robo); sim_sync.php recusa escrita com
--                           versao velha (conflito) e devolve o estado atual do banco
-- Protocolo: public/sim_sync.php (eventos com _v) e public/sim_load.php; fila no navegador: public/opssync.js.
-- Toda procedure que altere uma linha (GN_RoboComprar/GN_RoboVender) deve fazer versao = versao + 1
-- e ignorar linhas com excluido = 1.
-- =============================================================================
IF COL_LENGTH('dbo.GN_SimLotes','excluido') IS NULL
    ALTER TABLE dbo.GN_SimLotes ADD excluido BIT NOT NULL CONSTRAINT DF_GN_SimLotes_excluido DEFAULT 0,
                                    excluido_em DATETIME2 NULL,
                                    oculto BIT NOT NULL CONSTRAINT DF_GN_SimLotes_oculto DEFAULT 0,
                                    versao BIGINT NOT NULL CONSTRAINT DF_GN_SimLotes_versao DEFAULT 1;
GO
IF COL_LENGTH('dbo.GN_SimVendas','excluido') IS NULL
    ALTER TABLE dbo.GN_SimVendas ADD excluido BIT NOT NULL CONSTRAINT DF_GN_SimVendas_excluido DEFAULT 0,
                                     excluido_em DATETIME2 NULL,
                                     oculto BIT NOT NULL CONSTRAINT DF_GN_SimVendas_oculto DEFAULT 0,
                                     versao BIGINT NOT NULL CONSTRAINT DF_GN_SimVendas_versao DEFAULT 1;
GO
