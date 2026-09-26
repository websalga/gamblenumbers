-- =============================================================================
-- GN_RoboVender — procedure que executa UMA venda simulada AGORA, ao preco real
-- "de agora" (ultima media_exchanges_brl de dbo.snapshots / dbo.BCH_Snapshots),
-- cuidando dos lotes do mesmo jeito que o front (operations.js:
-- scheduleSell + executeSell) e atualizando o saldo virtual da sessao.
--
-- Criada em: 2026-09-25        Banco: bitcoin (SQL Server / lsql2019)
-- Pre-requisitos: GN_Saldo.sql e a coluna dbo.GN_SimVendas.robo_client_id
--   (ALTER TABLE dbo.GN_SimVendas ADD robo_client_id VARCHAR(20) NULL;).
--
-- Regras (iguais as do front):
--  - quantidade livre = restante dos lotes abertos - reservado das vendas
--    'pending'; se @valor/preco exceder o livre a ordem e' AJUSTADA ao livre;
--    sem livre -> erro 50020;
--  - consome os lotes FIFO (seq crescente): baixa 'restante', soma 'vendido',
--    soma o PnL bruto em 'realizado' e fecha o lote ('closed') ao zerar;
--  - PnL do lote = tomado * (preco_execucao - preco_do_lote), com o preco do
--    lote convertido para BRL se ele nasceu em outra moeda de exibicao;
--  - taxa de rede = feerate * tamanho_tx * preco / 1e8 (BTC: est_6_satvb do
--    ultimo snapshot, tx 140 vB; BCH: 1 sat/byte, tx 225 bytes);
--    PnL liquido = bruto - taxa da venda - parcela da taxa de compra
--    proporcional a quantidade vendida; retorno% = pnl / custo * 100;
--  - grava a venda como 'executed' em GN_SimVendas, credita o valor liquido
--    (qtd*preco - taxa) no saldo (GN_SaldoAjustar) e registra 'sell:robo' em
--    GN_SimSyncLog. Tudo em UMA transacao.
--
-- NAO decide QUANDO vender (isso e' do motor dos robos "Automatos").
-- Erros: 50001 session_id, 50002 moeda, 50003 valor, 50004 cotacao,
--        50020 nada livre, 50013 sessao sem saldo registrado, 50012 saldo.
-- =============================================================================

CREATE OR ALTER PROCEDURE dbo.GN_RoboVender
    @session_id       VARCHAR(64),
    @moeda            CHAR(3),
    @valor            DECIMAL(18,2)  = NULL,   -- valor em BRL a vender (como o "valor de operacao" da tela)
    @vender_tudo      BIT            = 0,      -- 1 = vende toda a quantidade livre (ignora @valor)
    @robo_client_id   VARCHAR(20)    = NULL,
    @venda_client_id  VARCHAR(20)    OUTPUT,
    @preco            DECIMAL(24,8)  OUTPUT,
    @qtd              DECIMAL(24,10) OUTPUT,
    @valor_liquido    DECIMAL(18,2)  OUTPUT,
    @pnl              DECIMAL(18,2)  OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @session_id IS NULL OR LEN(@session_id) <> 64 THROW 50001, 'session_id invalido', 1;
    IF @moeda NOT IN ('BTC','BCH')                   THROW 50002, 'moeda invalida (use BTC ou BCH)', 1;
    IF ISNULL(@vender_tudo,0) = 0 AND (@valor IS NULL OR @valor <= 0)
                                                     THROW 50003, 'valor de operacao invalido', 1;

    /* 1) cotacao "de agora" e taxa de rede */
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

    IF @preco IS NULL OR @preco <= 0 THROW 50004, 'cotacao indisponivel no momento', 1;

    DECLARE @fee_brl DECIMAL(18,2) = CAST(@feerate * @txsize * (@preco / 100000000.0) AS DECIMAL(18,2));

    /* cambio (so' para lotes que nasceram em outra moeda de exibicao) */
    DECLARE @usd_brl DECIMAL(18,6), @usd_eur DECIMAL(18,6), @usd_gbp DECIMAL(18,6), @usd_jpy DECIMAL(18,6),
            @usd_cny DECIMAL(18,6), @usd_try DECIMAL(18,6), @usd_rub DECIMAL(18,6);
    SELECT TOP 1 @usd_brl = usd_brl, @usd_eur = usd_eur, @usd_gbp = usd_gbp, @usd_jpy = usd_jpy,
                 @usd_cny = usd_cny, @usd_try = usd_try, @usd_rub = usd_rub
    FROM dbo.FX_Snapshots WITH (NOLOCK) WHERE ok = 1 ORDER BY ts_utc DESC;

    BEGIN TRAN;

    /* 2) lotes com saldo (travados) e quantidade livre */
    SELECT id, seq, moeda_exib, preco, restante
    INTO #lotes
    FROM dbo.GN_SimLotes WITH (UPDLOCK, HOLDLOCK)
    WHERE session_id = @session_id AND moeda = @moeda AND restante > 0;

    DECLARE @total_rest DECIMAL(24,10) = ISNULL((SELECT SUM(restante) FROM #lotes), 0);
    DECLARE @reservado  DECIMAL(24,10) = ISNULL((SELECT SUM(reservado) FROM dbo.GN_SimVendas WITH (UPDLOCK, HOLDLOCK)
                                                 WHERE session_id = @session_id AND moeda = @moeda AND status = 'pending'), 0);
    DECLARE @livre DECIMAL(24,10) = @total_rest - @reservado;

    IF @livre <= 0 THROW 50020, 'nao ha quantidade livre para vender', 1;

    SET @qtd = CASE WHEN ISNULL(@vender_tudo,0) = 1 THEN @livre ELSE @valor / @preco END;
    IF @qtd > @livre SET @qtd = @livre;        -- ordem ajustada ao livre, como o front
    IF @qtd <= 0 THROW 50003, 'valor de operacao invalido', 1;

    /* 3) FIFO: quanto sai de cada lote */
    ;WITH x AS (
        SELECT id, seq, moeda_exib, preco, restante,
               SUM(restante) OVER (ORDER BY seq ROWS UNBOUNDED PRECEDING) AS acum
        FROM #lotes
    )
    SELECT id, seq, restante,
           CASE WHEN acum <= @qtd THEN restante
                WHEN acum - restante < @qtd THEN @qtd - (acum - restante)
                ELSE 0 END AS tomar,
           CASE WHEN moeda_exib = 'BRL' THEN preco
                ELSE COALESCE(preco / NULLIF(CASE moeda_exib
                        WHEN 'USD' THEN 1.0 WHEN 'EUR' THEN @usd_eur WHEN 'GBP' THEN @usd_gbp
                        WHEN 'JPY' THEN @usd_jpy WHEN 'CNY' THEN @usd_cny WHEN 'TRY' THEN @usd_try
                        WHEN 'RUB' THEN @usd_rub END, 0) * @usd_brl, preco) END AS preco_brl
    INTO #tomar
    FROM x;

    DELETE FROM #tomar WHERE tomar <= 0;

    DECLARE @qtd_vendida DECIMAL(24,10) = ISNULL((SELECT SUM(tomar) FROM #tomar), 0);
    DECLARE @pnl_bruto   DECIMAL(24,8)  = ISNULL((SELECT SUM(tomar * (@preco - preco_brl)) FROM #tomar), 0);
    DECLARE @custo       DECIMAL(24,8)  = ISNULL((SELECT SUM(tomar * preco_brl) FROM #tomar), 0);

    UPDATE l
       SET restante      = l.restante - t.tomar,
           vendido       = l.vendido + t.tomar,
           realizado     = l.realizado + CAST(t.tomar * (@preco - t.preco_brl) AS DECIMAL(18,2)),
           status        = CASE WHEN l.restante - t.tomar <= 0 THEN 'closed' ELSE l.status END,
           atualizado_em = SYSUTCDATETIME()
      FROM dbo.GN_SimLotes l
      JOIN #tomar t ON t.id = l.id;

    /* 4) resultado financeiro (mesma formula de executeSell) */
    DECLARE @taxa_compra_total DECIMAL(18,2) =
        ISNULL((SELECT SUM(ISNULL(fee_valor,0)) FROM dbo.GN_SimLotes WHERE session_id = @session_id AND moeda = @moeda), 0);
    DECLARE @taxa_compra_prop DECIMAL(18,2) =
        CASE WHEN @taxa_compra_total > 0 AND @total_rest > 0
             THEN CAST(@taxa_compra_total * (@qtd_vendida / @total_rest) AS DECIMAL(18,2)) ELSE 0 END;

    SET @pnl           = CAST(@pnl_bruto - @fee_brl - @taxa_compra_prop AS DECIMAL(18,2));
    SET @valor_liquido = CAST(@qtd_vendida * @preco - @fee_brl AS DECIMAL(18,2));
    DECLARE @retorno DECIMAL(9,4) = CASE WHEN @custo > 0 THEN CAST(@pnl / @custo * 100 AS DECIMAL(9,4)) ELSE 0 END;
    SET @qtd = @qtd_vendida;

    /* 5) registra a venda executada */
    DECLARE @seq INT;
    SELECT @seq = ISNULL(MAX(seq), 0) + 1 FROM dbo.GN_SimVendas WITH (UPDLOCK, HOLDLOCK)
    WHERE session_id = @session_id AND moeda = @moeda;
    SET @venda_client_id = 'V' + CAST(@seq AS VARCHAR(10));

    DECLARE @agora_ms BIGINT = DATEDIFF_BIG(MILLISECOND, '19700101', SYSUTCDATETIME());

    INSERT INTO dbo.GN_SimVendas
        (session_id, moeda, venda_client_id, seq, moeda_exib, mark_time_ms, mark_price, qtd, reservado,
         status, exec_price, exec_time_ms, fee_valor, feerate, pnl, valor_liquido, retorno_pct, robo_client_id)
    VALUES
        (@session_id, @moeda, @venda_client_id, @seq, 'BRL', @agora_ms, @preco, @qtd, 0,
         'executed', @preco, @agora_ms, @fee_brl, @feerate, @pnl, @valor_liquido, @retorno, @robo_client_id);

    /* 6) credita o valor liquido no saldo virtual da sessao */
    DECLARE @saldo_depois DECIMAL(18,2), @versao_saldo BIGINT;
    EXEC dbo.GN_SaldoAjustar
        @session_id   = @session_id,
        @delta_brl    = @valor_liquido,
        @origem       = 'robo',
        @ref          = @venda_client_id,
        @saldo_depois = @saldo_depois OUTPUT,
        @versao       = @versao_saldo OUTPUT;

    INSERT INTO dbo.GN_SimSyncLog (session_id, moeda, reason, payload, ip)
    VALUES (
        @session_id, @moeda, 'sell:robo',
        CONCAT(
            '{"venda_client_id":"', @venda_client_id, '"',
            ',"robo_client_id":', ISNULL('"' + @robo_client_id + '"', 'null'),
            ',"preco":', CAST(@preco AS VARCHAR(40)),
            ',"qtd":', CAST(@qtd AS VARCHAR(40)),
            ',"taxa":', CAST(@fee_brl AS VARCHAR(40)),
            ',"valor_liquido":', CAST(@valor_liquido AS VARCHAR(40)),
            ',"pnl":', CAST(@pnl AS VARCHAR(40)),
            ',"saldo_depois":', CAST(@saldo_depois AS VARCHAR(40)),
            ',"time_cliente_ms":', CAST(@agora_ms AS VARCHAR(20)),
            '}'
        ),
        'robo'
    );

    COMMIT TRAN;
END
GO

-- Exemplo:
-- DECLARE @venda VARCHAR(20), @preco DECIMAL(24,8), @qtd DECIMAL(24,10), @liq DECIMAL(18,2), @pnl DECIMAL(18,2);
-- EXEC dbo.GN_RoboVender @session_id = '<64 hex>', @moeda = 'BTC', @valor = 100.00, @robo_client_id = 'RB1',
--      @venda_client_id = @venda OUTPUT, @preco = @preco OUTPUT, @qtd = @qtd OUTPUT,
--      @valor_liquido = @liq OUTPUT, @pnl = @pnl OUTPUT;
-- SELECT @venda, @preco, @qtd, @liq, @pnl;
