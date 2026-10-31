-- =============================================================================
-- GN_2FA - verificacao em 2 etapas (TOTP) por sessao. Banco: bitcoin (lsql2019).
-- Usada por private/seguranca_lib.php (site: public/identity.php; app: public/app/api.php).
--
--   segredo_cifrado / pendente_cifrado  chave TOTP cifrada (AES-256-GCM; a chave de cifra fica
--                                       so' em private/seguranca_config.php, fora do banco)
--   ultimo_passo                        ultimo passo de 30 s aceito (cada codigo vale uma vez)
--   recuperacao_json                    hashes dos codigos de recuperacao ainda nao usados
--   ativado_em / endereco_alterado_em   saques liberados 24 h depois do mais recente dos dois
--   bloqueado_admin                     1 = saques bloqueados pelo administrador
-- =============================================================================
IF OBJECT_ID('dbo.GN_2FA') IS NULL
CREATE TABLE dbo.GN_2FA (
    session_id            VARCHAR(64)   NOT NULL CONSTRAINT PK_GN_2FA PRIMARY KEY,
    segredo_cifrado       VARCHAR(200)  NULL,
    pendente_cifrado      VARCHAR(200)  NULL,
    pendente_em           DATETIME2(0)  NULL,
    ativo                 BIT           NOT NULL CONSTRAINT DF_GN_2FA_ativo DEFAULT 0,
    ativado_em            DATETIME2(0)  NULL,
    ultimo_passo          BIGINT        NULL,
    recuperacao_json      VARCHAR(2000) NULL,
    endereco_alterado_em  DATETIME2(0)  NULL,
    bloqueado_admin       BIT           NOT NULL CONSTRAINT DF_GN_2FA_bloqueado DEFAULT 0,
    criado_em             DATETIME2(0)  NOT NULL CONSTRAINT DF_GN_2FA_criado DEFAULT SYSUTCDATETIME(),
    atualizado_em         DATETIME2(0)  NOT NULL CONSTRAINT DF_GN_2FA_atualizado DEFAULT SYSUTCDATETIME()
);
GO

-- -----------------------------------------------------------------------------
-- Liberacao manual pelo administrador (usuario perdeu o celular E os codigos de recuperacao).
-- Confirme antes, por fora do site, que a pessoa e' dona da conta (ex.: um deposito pequeno
-- feito a partir do mesmo endereco). O usuario precisara ativar o 2FA de novo, e a espera de
-- 24 h volta a valer.
--   UPDATE dbo.GN_2FA SET ativo = 0, segredo_cifrado = NULL, pendente_cifrado = NULL,
--          recuperacao_json = NULL, ultimo_passo = NULL, atualizado_em = SYSUTCDATETIME()
--    WHERE session_id = '<session_id>';
-- Bloquear saques de uma conta:   UPDATE dbo.GN_2FA SET bloqueado_admin = 1 WHERE session_id = '<session_id>';
-- -----------------------------------------------------------------------------
