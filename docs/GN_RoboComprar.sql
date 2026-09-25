-- =============================================================================
-- GN_RoboComprar — procedure que executa a operacao de COMPRA (abre um lote
-- em dbo.GN_SimLotes) ao preco real "de agora": a ultima media_exchanges_brl
-- (media entre Binance, Kraken e Coinbase) de dbo.snapshots (BTC) ou
-- dbo.BCH_Snapshots (BCH).
--
-- Criada em: 2026-09-24
-- Banco: bitcoin (SQL Server / lsql2019)
--
-- Escopo: SO a mecanica da compra em si (gravar o lote com o preco/qtd
-- corretos). NAO decide quando comprar, nem calcula meta de venda/retorno —
-- isso fica para o motor de decisao dos robos "Automatos", que ainda nao foi
-- construido e vai chamar esta procedure como seu metodo de compra.
--
-- Pre-requisito: coluna dbo.GN_SimLotes.robo_client_id (VARCHAR(20) NULL),
-- adicionada nesta mesma mudanca, para rastrear qual robo (GN_Robos) originou
-- o lote (NULL = compra manual feita pelo usuario no simulador).
-- =============================================================================

ALTER TABLE dbo.GN_SimLotes ADD robo_client_id VARCHAR(20) NULL;
GO

CREATE OR ALTER PROCEDURE dbo.GN_RoboComprar
    @session_id      VARCHAR(64),
    @moeda           CHAR(3),
    @valor           DECIMAL(18,2),
    @robo_client_id  VARCHAR(20)   = NULL,
    @lote_client_id  VARCHAR(20)   OUTPUT,
    @preco           DECIMAL(24,8) OUTPUT,
    @qtd             DECIMAL(24,10) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @session_id IS NULL OR LEN(@session_id) <> 64
    BEGIN
        THROW 50001, 'session_id invalido', 1;
    END

    IF @moeda NOT IN ('BTC','BCH')
    BEGIN
        THROW 50002, 'moeda invalida (use BTC ou BCH)', 1;
    END

    IF @valor IS NULL OR @valor <= 0
    BEGIN
        THROW 50003, 'valor de operacao invalido', 1;
    END

    /* 1) cotacao real "de agora": ultima media_exchanges_brl valida */
    IF @moeda = 'BTC'
        SELECT TOP 1 @preco = media_exchanges_brl
        FROM dbo.snapshots WITH (NOLOCK)
        WHERE media_exchanges_brl IS NOT NULL AND media_exchanges_brl > 0 AND ok = 1
        ORDER BY ts_utc DESC;
    ELSE
        SELECT TOP 1 @preco = media_exchanges_brl
        FROM dbo.BCH_Snapshots WITH (NOLOCK)
        WHERE media_exchanges_brl IS NOT NULL AND media_exchanges_brl > 0 AND ok = 1
        ORDER BY ts_utc DESC;

    IF @preco IS NULL OR @preco <= 0
    BEGIN
        THROW 50004, 'cotacao indisponivel no momento', 1;
    END

    SET @qtd = @valor / @preco;

    BEGIN TRAN;

    DECLARE @seq INT;
    SELECT @seq = ISNULL(MAX(seq), 0) + 1
    FROM dbo.GN_SimLotes WITH (UPDLOCK, HOLDLOCK)
    WHERE session_id = @session_id AND moeda = @moeda;

    SET @lote_client_id = 'LT' + CAST(@seq AS VARCHAR(10));

    DECLARE @agora_ms BIGINT = DATEDIFF_BIG(MILLISECOND, '19700101', SYSUTCDATETIME());

    INSERT INTO dbo.GN_SimLotes
        (session_id, moeda, lote_client_id, seq, moeda_exib, preco, valor, qtd,
         restante, vendido, realizado, status, time_cliente_ms, robo_client_id)
    VALUES
        (@session_id, @moeda, @lote_client_id, @seq, 'BRL', @preco, @valor, @qtd,
         @qtd, 0, 0, 'open', @agora_ms, @robo_client_id);

    INSERT INTO dbo.GN_SimSyncLog (session_id, moeda, reason, payload, ip)
    VALUES (
        @session_id, @moeda, 'buy:robo',
        CONCAT(
            '{"lote_client_id":"', @lote_client_id, '"',
            ',"robo_client_id":', ISNULL('"' + @robo_client_id + '"', 'null'),
            ',"preco":', CAST(@preco AS VARCHAR(40)),
            ',"valor":', CAST(@valor AS VARCHAR(40)),
            ',"qtd":', CAST(@qtd AS VARCHAR(40)),
            ',"time_cliente_ms":', CAST(@agora_ms AS VARCHAR(20)),
            '}'
        ),
        'robo'
    );

    COMMIT TRAN;
END
GO

-- Exemplo de uso:
--
-- DECLARE @lote VARCHAR(20), @preco DECIMAL(24,8), @qtd DECIMAL(24,10);
-- EXEC dbo.GN_RoboComprar
--     @session_id = '<64 hex>',
--     @moeda = 'BTC',
--     @valor = 100.00,
--     @robo_client_id = 'RB1',
--     @lote_client_id = @lote OUTPUT,
--     @preco = @preco OUTPUT,
--     @qtd = @qtd OUTPUT;
-- SELECT @lote, @preco, @qtd;
