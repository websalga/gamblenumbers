-- 2026-10-14: coluna para inativar perfis (sem apagar dados).
-- identity.php (check, login_senha, configurar_senha, configurar_saida, sacar_externa,
-- refresh_balance) e app/api.php so aceitam perfis com ativo=1.
IF COL_LENGTH('dbo.GN_Usuarios','ativo') IS NULL
    ALTER TABLE dbo.GN_Usuarios ADD
        ativo BIT NOT NULL CONSTRAINT DF_GN_Usuarios_ativo DEFAULT (1),
        inativado_em DATETIME2(3) NULL,
        inativado_motivo VARCHAR(100) NULL;

-- Reativar um perfil:
-- UPDATE dbo.GN_Usuarios SET ativo=1, inativado_em=NULL, inativado_motivo=NULL WHERE session_id='...';
