-- =============================================================================
-- F07 (02/11/2026): etiqueta da senha para o login achar a conta direto, sem testar a senha contra todas.
-- senha_tag = PBKDF2-SHA256(senha, senha_pepper, 100000) em hex (ver seg_senha_tag em private/seguranca_lib.php).
-- A chave senha_pepper fica so' em private/seguranca_config.php (fora do banco e do git).
-- Contas antigas ficam com NULL e ganham a etiqueta no proximo login certo.
-- =============================================================================
IF COL_LENGTH('dbo.GN_Usuarios', 'senha_tag') IS NULL
    ALTER TABLE dbo.GN_Usuarios ADD senha_tag CHAR(64) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GN_Usuarios_senha_tag' AND object_id = OBJECT_ID('dbo.GN_Usuarios'))
    CREATE INDEX IX_GN_Usuarios_senha_tag ON dbo.GN_Usuarios (senha_tag) WHERE senha_tag IS NOT NULL;
GO
