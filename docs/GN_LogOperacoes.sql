-- =============================================================================
-- GN_LogOperacoes (S05, 02/11/2026): log das operacoes criticas no SQL, em vez de arquivo.
-- Saque no site (sacar_externa), saque no app (saque_app), transferencia (transferencia), swap,
-- encerramento de conta (encerramento) e erros de status_saque.
-- Banco: bitcoin (lsql2019). Gravado por private/seguranca_lib.php (seg_log).
--
-- So' campos permitidos. NUNCA: sessao, codigo do 2FA, codigo de recuperacao, senha, corpo do pedido.
--   perfil_hash / ip_hash: HMAC-SHA256 (chave senha_pepper de private/seguranca_config.php), 16 hex.
--                          Liga os registros de um mesmo perfil/IP sem guardar o valor real.
--   destino: endereco de destino completo (e' o endereco salvo, publico na blockchain).
-- Retencao: guardar para sempre (decisao do dono em 02/11/2026); nao ha limpeza automatica.
-- O usuario do site so' pode INSERT e SELECT (UPDATE e DELETE negados): o log e' so' de acrescimo.
-- =============================================================================
IF OBJECT_ID('dbo.GN_LogOperacoes') IS NULL
CREATE TABLE dbo.GN_LogOperacoes (
    id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_GN_LogOperacoes PRIMARY KEY,
    criado_em    DATETIME2(3)   NOT NULL CONSTRAINT DF_GN_LogOperacoes_criado DEFAULT SYSUTCDATETIME(),
    origem       VARCHAR(20)    NOT NULL,      -- site, app, importado (historico do debug.log)
    operacao     VARCHAR(40)    NOT NULL,      -- sacar_externa, saque_app, transferencia, swap, encerramento, status_saque
    etapa        VARCHAR(60)    NOT NULL,      -- aprovado, enviado, transmitida, recusado, erro, erro_pos_envio, apagado
    perfil_hash  CHAR(16)       NULL,
    moeda        VARCHAR(5)     NULL,
    valor        DECIMAL(18,8)  NULL,
    taxa         DECIMAL(18,8)  NULL,          -- sat/vB escolhido (BTC), quando houver
    destino      VARCHAR(120)   NULL,
    txid         CHAR(64)       NULL,
    resultado    VARCHAR(20)    NULL,          -- em_andamento, ok, recusado, erro, erro_pos_envio
    motivo       NVARCHAR(400)  NULL,
    ip_hash      CHAR(16)       NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GN_LogOperacoes_data' AND object_id = OBJECT_ID('dbo.GN_LogOperacoes'))
    CREATE INDEX IX_GN_LogOperacoes_data ON dbo.GN_LogOperacoes (criado_em);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GN_LogOperacoes_perfil' AND object_id = OBJECT_ID('dbo.GN_LogOperacoes'))
    CREATE INDEX IX_GN_LogOperacoes_perfil ON dbo.GN_LogOperacoes (perfil_hash, criado_em);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GN_LogOperacoes_txid' AND object_id = OBJECT_ID('dbo.GN_LogOperacoes'))
    CREATE INDEX IX_GN_LogOperacoes_txid ON dbo.GN_LogOperacoes (txid) WHERE txid IS NOT NULL;
GO
GRANT INSERT, SELECT ON dbo.GN_LogOperacoes TO gamblenumbers;
DENY UPDATE, DELETE ON dbo.GN_LogOperacoes TO gamblenumbers;
GO
