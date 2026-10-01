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
-- isso fica para o motor de decisao dos robos (GN_RoboOrquestrador).
--
-- ATUALIZADA em 2026-09-25: passou a debitar o saldo virtual da sessao
-- (dbo.GN_SimSaldo, ver GN_Saldo.sql) na MESMA transacao que grava o lote, e a
-- recusar a compra sem saldo suficiente (erro 50012) ou sem saldo registrado
-- (50013). Nada mais mudou na mecanica da compra.
--
-- Pre-requisito: coluna dbo.GN_SimLotes.robo_client_id (VARCHAR(20) NULL),
-- adicionada nesta mesma mudanca, para rastrear qual robo (GN_Robos) originou
-- o lote (NULL = compra manual feita pelo usuario no simulador).
--
-- ATUALIZADA em 2026-10-01 (correcao do calculo de lucro liquido dos robos):
-- passou a calcular e gravar fee_valor/feerate no lote (mesma formula/fonte
-- que a compra manual ja usa no front-end: feerate * tamanho_tx * preco /
-- 1e8), e a debitar (@valor + essa taxa) do saldo virtual em vez de so'
-- @valor. Antes, lotes comprados pelo robo ficavam com fee_valor/feerate
-- NULL, entao GN_RoboVender nunca conseguia alocar taxa de compra
-- proporcional nas vendas desses lotes. O custo do lote (coluna valor/preco)
-- continua sem incluir a taxa -- ela fica separada, igual ao modelo manual,
-- pra ser alocada proporcionalmente na venda (ver GN_RoboVender.sql).
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
    /* ============================================================
     * GN_RoboComprar — executa UMA compra simulada (abre um novo
     * "lote" em dbo.GN_SimLotes), ao preco real "de agora": a
     * ultima linha de media_exchanges_brl (media entre Binance,
     * Kraken e Coinbase) das tabelas de cotacao (dbo.snapshots
     * para BTC, dbo.BCH_Snapshots para BCH).
     *
     * SALDO: a compra debita (@valor + taxa de rede da compra) do
     * saldo virtual da sessao (dbo.GN_SimSaldo, o mesmo "Saldo
     * virtual disponivel" da tela) na MESMA transacao que grava o
     * lote. Sem saldo suficiente a compra e' recusada (erro 50012)
     * e nada e' gravado. O site le esse saldo por polling, entao a
     * tela reflete a compra do robo.
     *
     * TAXA DE COMPRA (fee_valor/feerate em GN_SimLotes): mesma
     * formula/fonte que a compra manual ja usa no front-end
     * (operations.js doBuy: feerate * tamanho_tx * preco / 1e8,
     * BTC = est_6_satvb do ultimo snapshot/tx 140 vB, BCH = 1
     * sat/byte fixo/tx 225 bytes) -- 2026-10-01: antes desta
     * correcao essas colunas ficavam NULL nos lotes comprados pelo
     * robo, entao GN_RoboVender nunca conseguia alocar taxa de
     * compra proporcional nas vendas (correcao do calculo de lucro
     * liquido dos robos). O CUSTO do lote (coluna valor/preco) nao
     * inclui a taxa -- ela fica separada, igual ao modelo manual,
     * pra ser alocada proporcionalmente na venda (GN_RoboVender).
     *
     * NAO decide QUANDO comprar nem calcula meta de venda/retorno
     * -- isso e' responsabilidade de quem chama (o motor de decisao
     * do robo). Esta procedure so' executa a compra em si, recebendo
     * os parametros prontos.
     *
     * Parametros:
     *   @session_id     sessao dona do lote (64 hex)
     *   @moeda          'BTC' ou 'BCH'
     *   @valor          valor em BRL a aplicar nesta compra (nao inclui a taxa)
     *   @robo_client_id opcional: qual robo (GN_Robos.robo_client_id)
     *                   originou a compra, so' para auditoria/relatorio
     *
     * Saida (OUTPUT):
     *   @lote_client_id id do lote criado (ex: 'LT7')
     *   @preco          preco medio usado na compra
     *   @qtd            quantidade da moeda comprada (valor/preco)
     *
     * Erros (THROW, nada e' gravado): 50001 session_id invalido,
     * 50002 moeda invalida, 50003 valor invalido, 50004 cotacao
     * indisponivel, 50012 saldo insuficiente, 50013 sessao sem
     * saldo registrado.
     * ============================================================ */
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

    /* 1) cotacao real "de agora" e taxa de rede da compra (mesma fonte/formula do GN_RoboVender) */
    DECLARE @feerate DECIMAL(18,4) = 1.0, @txsize INT = CASE WHEN @moeda = 'BCH' THEN 225 ELSE 140 END;
    IF @moeda = 'BTC'
        SELECT TOP 1 @preco = media_exchanges_brl,
                     @feerate = CASE WHEN est_6_satvb > 0 THEN est_6_satvb ELSE 1.0 END
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
    DECLARE @fee_brl DECIMAL(18,2) = CAST(@feerate * @txsize * (@preco / 100000000.0) AS DECIMAL(18,2));

    BEGIN TRAN;

    DECLARE @seq INT;
    SELECT @seq = ISNULL(MAX(seq), 0) + 1
    FROM dbo.GN_SimLotes WITH (UPDLOCK, HOLDLOCK)
    WHERE session_id = @session_id AND moeda = @moeda;

    SET @lote_client_id = 'LT' + CAST(@seq AS VARCHAR(10));

    /* 2) debita o saldo virtual da sessao: valor da compra + taxa de rede (recusa se nao houver saldo) */
    DECLARE @saldo_depois DECIMAL(18,2), @versao_saldo BIGINT, @delta DECIMAL(18,2) = -(@valor + @fee_brl);
    EXEC dbo.GN_SaldoAjustar
        @session_id   = @session_id,
        @delta_brl    = @delta,
        @origem       = 'robo',
        @ref          = @lote_client_id,
        @saldo_depois = @saldo_depois OUTPUT,
        @versao       = @versao_saldo OUTPUT;

    DECLARE @agora_ms BIGINT = DATEDIFF_BIG(MILLISECOND, '19700101', SYSUTCDATETIME());

    INSERT INTO dbo.GN_SimLotes
        (session_id, moeda, lote_client_id, seq, moeda_exib, preco, valor, qtd,
         restante, vendido, realizado, status, fee_valor, feerate, time_cliente_ms, robo_client_id)
    VALUES
        (@session_id, @moeda, @lote_client_id, @seq, 'BRL', @preco, @valor, @qtd,
         @qtd, 0, 0, 'open', @fee_brl, @feerate, @agora_ms, @robo_client_id);

    INSERT INTO dbo.GN_SimSyncLog (session_id, moeda, reason, payload, ip)
    VALUES (
        @session_id, @moeda, 'buy:robo',
        CONCAT(
            '{"lote_client_id":"', @lote_client_id, '"',
            ',"robo_client_id":', ISNULL('"' + @robo_client_id + '"', 'null'),
            ',"preco":', CAST(@preco AS VARCHAR(40)),
            ',"valor":', CAST(@valor AS VARCHAR(40)),
            ',"qtd":', CAST(@qtd AS VARCHAR(40)),
            ',"fee_valor":', CAST(@fee_brl AS VARCHAR(40)),
            ',"feerate":', CAST(@feerate AS VARCHAR(40)),
            ',"saldo_depois":', CAST(@saldo_depois AS VARCHAR(40)),
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
