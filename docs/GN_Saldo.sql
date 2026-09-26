-- =============================================================================
-- GN_Saldo — saldo virtual da sessao no SQL Server (o "Saldo virtual
-- disponivel" que a tela mostra), para os robos de compra e venda
-- enxergarem e movimentarem, e para a tela refletir o que eles fizeram.
--
-- Criada em: 2026-09-25        Banco: bitcoin (SQL Server / lsql2019)
--
--   dbo.GN_SimSaldo      1 linha por session_id, saldo em BRL + versao
--                        (a versao sobe a cada mudanca; a tela usa para
--                        saber que um robo mexeu).
--   dbo.GN_SimSaldoLog   auditoria de todo movimento (init/set/delta,
--                        origem front|robo|identity|manual, ref = lote/venda).
--   dbo.GN_SaldoDefinir  grava o saldo como valor ABSOLUTO (edicao manual,
--                        refresh do saldo real, conversao de moeda).
--   dbo.GN_SaldoAjustar  debita/credita de forma ATOMICA (trava a linha):
--                        e' o que GN_RoboComprar e GN_RoboVender usam.
--
-- O site grava/le por public/sim_saldo.php + public/saldosync.js.
-- Erros: 50010 session_id, 50011 saldo invalido, 50012 saldo insuficiente,
-- 50013 sessao sem saldo registrado, 50014 delta invalido.
-- =============================================================================

CREATE TABLE dbo.GN_SimSaldo (
    session_id    VARCHAR(64)   NOT NULL CONSTRAINT PK_GN_SimSaldo PRIMARY KEY,
    saldo_brl     DECIMAL(18,2) NOT NULL,
    versao        BIGINT        NOT NULL CONSTRAINT DF_GN_SimSaldo_versao DEFAULT 1,
    origem        VARCHAR(20)   NOT NULL,
    criado_em     DATETIME2     NOT NULL CONSTRAINT DF_GN_SimSaldo_criado DEFAULT SYSUTCDATETIME(),
    atualizado_em DATETIME2     NOT NULL CONSTRAINT DF_GN_SimSaldo_atualizado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_GN_SimSaldo_nao_negativo CHECK (saldo_brl >= 0)
);
GO

CREATE TABLE dbo.GN_SimSaldoLog (
    id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_GN_SimSaldoLog PRIMARY KEY,
    session_id    VARCHAR(64)   NOT NULL,
    evento        VARCHAR(20)   NOT NULL,   -- init | set | delta
    delta_brl     DECIMAL(18,2) NULL,
    saldo_antes   DECIMAL(18,2) NULL,
    saldo_depois  DECIMAL(18,2) NOT NULL,
    origem        VARCHAR(20)   NOT NULL,   -- front | robo | identity | manual
    ref           VARCHAR(40)   NULL,       -- lote/venda que originou o movimento
    criado_em     DATETIME2     NOT NULL CONSTRAINT DF_GN_SimSaldoLog_criado DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_GN_SimSaldoLog_sessao ON dbo.GN_SimSaldoLog (session_id, id DESC);
GO

CREATE OR ALTER PROCEDURE dbo.GN_SaldoDefinir
    @session_id   VARCHAR(64),
    @saldo_brl    DECIMAL(18,2),
    @origem       VARCHAR(20)   = 'front',
    @ref          VARCHAR(40)   = NULL,
    @saldo_depois DECIMAL(18,2) OUTPUT,
    @versao       BIGINT        OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @session_id IS NULL OR LEN(@session_id) <> 64 THROW 50010, 'session_id invalido', 1;
    IF @saldo_brl IS NULL OR @saldo_brl < 0          THROW 50011, 'saldo invalido', 1;

    BEGIN TRAN;

    DECLARE @antes DECIMAL(18,2) = NULL;
    SELECT @antes = saldo_brl FROM dbo.GN_SimSaldo WITH (UPDLOCK, HOLDLOCK) WHERE session_id = @session_id;

    IF @antes IS NULL
        INSERT INTO dbo.GN_SimSaldo (session_id, saldo_brl, versao, origem)
        VALUES (@session_id, @saldo_brl, 1, @origem);
    ELSE
        UPDATE dbo.GN_SimSaldo
           SET saldo_brl = @saldo_brl, versao = versao + 1, origem = @origem, atualizado_em = SYSUTCDATETIME()
         WHERE session_id = @session_id;

    INSERT INTO dbo.GN_SimSaldoLog (session_id, evento, delta_brl, saldo_antes, saldo_depois, origem, ref)
    VALUES (@session_id, CASE WHEN @antes IS NULL THEN 'init' ELSE 'set' END,
            CASE WHEN @antes IS NULL THEN NULL ELSE @saldo_brl - @antes END,
            @antes, @saldo_brl, @origem, @ref);

    SELECT @saldo_depois = saldo_brl, @versao = versao FROM dbo.GN_SimSaldo WHERE session_id = @session_id;

    COMMIT TRAN;
END
GO

CREATE OR ALTER PROCEDURE dbo.GN_SaldoAjustar
    @session_id        VARCHAR(64),
    @delta_brl         DECIMAL(18,2),            -- negativo = debito (compra), positivo = credito (venda)
    @origem            VARCHAR(20)   = 'robo',
    @ref               VARCHAR(40)   = NULL,     -- lote/venda que originou o movimento
    @permitir_zerar    BIT           = 0,        -- 1 = se faltar saldo, zera em vez de recusar (comportamento do navegador)
    @saldo_inicial_brl DECIMAL(18,2) = NULL,     -- so' usado se a sessao ainda nao tem saldo gravado
    @saldo_depois      DECIMAL(18,2) OUTPUT,
    @versao            BIGINT        OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @session_id IS NULL OR LEN(@session_id) <> 64 THROW 50010, 'session_id invalido', 1;
    IF @delta_brl IS NULL                            THROW 50014, 'delta invalido', 1;

    BEGIN TRAN;

    DECLARE @antes DECIMAL(18,2) = NULL, @novo DECIMAL(18,2);
    SELECT @antes = saldo_brl FROM dbo.GN_SimSaldo WITH (UPDLOCK, HOLDLOCK) WHERE session_id = @session_id;

    IF @antes IS NULL
    BEGIN
        IF @saldo_inicial_brl IS NULL OR @saldo_inicial_brl < 0
            THROW 50013, 'sessao sem saldo registrado (abra o site uma vez para gravar o saldo)', 1;

        INSERT INTO dbo.GN_SimSaldo (session_id, saldo_brl, versao, origem)
        VALUES (@session_id, @saldo_inicial_brl, 1, @origem);

        INSERT INTO dbo.GN_SimSaldoLog (session_id, evento, delta_brl, saldo_antes, saldo_depois, origem, ref)
        VALUES (@session_id, 'init', NULL, NULL, @saldo_inicial_brl, @origem, @ref);
    END
    ELSE
    BEGIN
        SET @novo = @antes + @delta_brl;
        IF @novo < 0
        BEGIN
            IF @permitir_zerar = 1 SET @novo = 0;
            ELSE THROW 50012, 'saldo insuficiente', 1;
        END

        UPDATE dbo.GN_SimSaldo
           SET saldo_brl = @novo, versao = versao + 1, origem = @origem, atualizado_em = SYSUTCDATETIME()
         WHERE session_id = @session_id;

        INSERT INTO dbo.GN_SimSaldoLog (session_id, evento, delta_brl, saldo_antes, saldo_depois, origem, ref)
        VALUES (@session_id, 'delta', @novo - @antes, @antes, @novo, @origem, @ref);
    END

    SELECT @saldo_depois = saldo_brl, @versao = versao FROM dbo.GN_SimSaldo WHERE session_id = @session_id;

    COMMIT TRAN;
END
GO

-- GN_RoboVender grava robo_client_id em GN_SimVendas (rastreio, como em GN_SimLotes):
-- ALTER TABLE dbo.GN_SimVendas ADD robo_client_id VARCHAR(20) NULL;
