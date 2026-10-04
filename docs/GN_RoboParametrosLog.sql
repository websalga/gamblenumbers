-- Historico de parametros dos robos (criado em 2026-10-04) / Robot parameter history (created 2026-10-04).
-- Banco/Database: bitcoin. Ver/see: GN_RoboParametrosLog.sql, TR_GN_Robos_ParametrosLog.sql, GN_RoboAjustarParametros.sql
CREATE TABLE dbo.GN_RoboParametrosLog (
    [hist_id] BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_GN_RoboParametrosLog PRIMARY KEY,
    [operacao] CHAR(1) NOT NULL,
    [robo_id] BIGINT NOT NULL,
    [session_id] VARCHAR(64) NOT NULL,
    [seq] INT NOT NULL,
    [robo_client_id] VARCHAR(20) NOT NULL,
    [apelido] NVARCHAR(120) NOT NULL,
    [moeda] CHAR(3) NOT NULL,
    [valor_operacao] DECIMAL(18,2) NOT NULL,
    [retorno_desejado_pct] DECIMAL(9,4) NOT NULL,
    [limite_perda_diaria_pct] DECIMAL(9,4) NOT NULL,
    [ativo] BIT NOT NULL,
    [config_json] NVARCHAR(MAX) NULL,
    [ciclo_segundos] INT NOT NULL,
    [publico] BIT NOT NULL,
    [clonado_de_id] BIGINT NULL,
    [campos_alterados] NVARCHAR(400) NULL,
    [alterado_em] DATETIME2 NOT NULL DEFAULT sysutcdatetime(),
    [origem] VARCHAR(20) NOT NULL,
    [aplicacao] NVARCHAR(128) NULL,
    [host] NVARCHAR(128) NULL,
    [usuario_bd] NVARCHAR(128) NULL,
    [autor] NVARCHAR(100) NULL,
    [motivo] NVARCHAR(1000) NULL
);
GO
CREATE INDEX IX_GN_RoboParametrosLog_robo ON dbo.GN_RoboParametrosLog (robo_id, alterado_em);
CREATE INDEX IX_GN_RoboParametrosLog_sessao ON dbo.GN_RoboParametrosLog (session_id, alterado_em);
GO
