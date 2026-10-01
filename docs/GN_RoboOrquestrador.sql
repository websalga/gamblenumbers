-- =============================================================================
-- GN_RoboOrquestrador — motor de decisao "compra na baixa, vende na alta" de
-- UM robo, chamado pelo GN_RoboProcessarFila. Le os parametros direto de
-- GN_Robos (sempre o valor mais recente configurado na tela), decide
-- comprar/vender e chama GN_RoboComprar / GN_RoboVender ja existentes. Grava
-- uma linha em GN_RoboExecucaoLog sempre, mesmo quando nao faz nada. Nao mexe
-- em GN_RoboFila -- isso e' responsabilidade de quem chamou.
--
-- Criada em: 2026-09-?? (antes da correcao abaixo)     Banco: bitcoin (SQL Server / lsql2019)
-- Pre-requisitos: GN_RoboComprar.sql, GN_RoboVender.sql, GN_RoboExecucaoLog, GN_Robos, GN_SideshiftJobs.
--
-- "Taxas Reais" (config_json.taxas_reais, default = ligado): quando ligado
-- (padrao, inclusive quando config_json e' NULL), o custo efetivo de
-- converter o par BTC/BCH<->stablecoin via SideShift entra no limiar de
-- compra e na meta de venda, junto da taxa de rede -- deixando a simulacao
-- fiel ao que o usuario enfrentaria operando com dinheiro real. O usuario
-- pode desligar na tela do robo (fica salvo como "taxas_reais":false) pra
-- operar so' contra a taxa de rede.
--
-- "Modo crash" (config_json.queda_crash_pct, default = 23): gatilho de
-- compra ADICIONAL ao gatilho normal (que so' olha 30 min). Se o preco cair
-- >= queda_crash_pct em relacao a' maxima dos ULTIMOS 7 DIAS, o robo entra em
-- modo crash e passa a comprar a cada ciclo enquanto o preco continuar
-- fazendo minima nova (freio: compara com as ultimas 3 leituras -- se o
-- preco parar de cair, a compra pausa ate' voltar a cair). queda_crash_pct
-- = 0 desativa esse mecanismo (fica so' o gatilho normal de 30 min).
--
-- Escopo desta procedure: SO a mecanica de decisao (quando comprar/vender e
-- com quais parametros chamar GN_RoboComprar/GN_RoboVender). Os parametros
-- estrategicos do robo (valor_operacao, retorno_desejado_pct,
-- limite_perda_diaria_pct, queda_crash_pct, taxas_reais) vem de GN_Robos e
-- NAO sao alterados por esta procedure.
--
-- ATUALIZADA em 2026-10-01 (correcao do calculo de lucro liquido dos robos):
-- a secao 5 (decisao de VENDA) deixou de ser a autorizacao final da venda e
-- passou a ser so' um PRE-FILTRO local (estimativa rapida, sem todas as
-- taxas reais) -- a autorizacao final e a apuracao exata agora sao feitas
-- DENTRO de GN_RoboVender, na mesma transacao que grava a venda (ver
-- GN_RoboVender.sql, @retorno_desejado_pct/@vendeu). Mudancas especificas:
--  - o pre-filtro comparava contra "retorno_desejado_pct + sideshift_fee_pct"
--    (a taxa de SideShift so' inflava a META, nunca era de fato subtraida do
--    resultado). Agora compara so' contra @retorno_desejado_pct, porque o
--    SideShift passou a ser corretamente descontado do pnl DENTRO de
--    GN_RoboVender (via @sideshift_pct) -- somar de novo aqui duplicaria o
--    efeito na meta.
--  - o cursor de lotes abertos passou a filtrar por
--    "robo_client_id = @robo_client_id" (antes nao filtrava: um robo podia
--    projetar venda sobre lotes de OUTRO robo ou de compras manuais da mesma
--    sessao). Isso espelha o mesmo filtro que GN_RoboVender agora aplica.
--  - passa os novos parametros @retorno_desejado_pct e @sideshift_pct (via
--    variavel local, pois EXEC nao aceita uma expressao CASE direto como
--    valor de parametro) para GN_RoboVender, e trata os novos OUTPUTs
--    @vendeu/@log_detalhe: quando @vendeu = 0 (meta nao confirmada na
--    execucao, so' no pre-filtro), registra no detalhe sem tratar como erro.
-- As secoes 1-4 (trava de perda diaria, cotacao/taxa de rede, estimativa da
-- taxa SideShift, limiar de compra e os dois gatilhos de compra normal/crash)
-- NAO foram alteradas por esta correcao -- o escopo foi so' corrigir a
-- apuracao da venda/PnL, nao os parametros estrategicos de compra.
-- =============================================================================

CREATE OR ALTER PROCEDURE dbo.GN_RoboOrquestrador
    @robo_id  BIGINT,
    @fila_id  BIGINT = NULL
AS
BEGIN
    /* ============================================================
     * GN_RoboOrquestrador — motor de decisao "compra na baixa,
     * vende na alta" de UM robo, chamado pelo GN_RoboProcessarFila.
     * Le os parametros direto de GN_Robos (sempre o valor mais
     * recente configurado na tela), decide comprar/vender e chama
     * GN_RoboComprar / GN_RoboVender ja existentes. Grava uma linha
     * em GN_RoboExecucaoLog sempre, mesmo quando nao faz nada.
     * Nao mexe em GN_RoboFila -- isso e' responsabilidade de quem
     * chamou.
     * ============================================================ */
    SET NOCOUNT ON;

    DECLARE @agora DATETIME2 = SYSUTCDATETIME();
    DECLARE @log_id BIGINT;

    IF @fila_id IS NOT NULL
        SELECT @log_id = log_id FROM dbo.GN_RoboExecucaoLog WHERE fila_id = @fila_id;

    DECLARE @session_id VARCHAR(64), @robo_client_id VARCHAR(20), @moeda CHAR(3),
            @valor_operacao DECIMAL(18,2), @retorno_desejado_pct DECIMAL(9,4),
            @limite_perda_diaria_pct DECIMAL(9,4), @ativo BIT, @config_json NVARCHAR(MAX);

    SELECT @session_id = session_id, @robo_client_id = robo_client_id, @moeda = moeda,
           @valor_operacao = valor_operacao, @retorno_desejado_pct = retorno_desejado_pct,
           @limite_perda_diaria_pct = limite_perda_diaria_pct, @ativo = ativo, @config_json = config_json
    FROM dbo.GN_Robos WHERE id = @robo_id;

    IF @log_id IS NULL
        INSERT INTO dbo.GN_RoboExecucaoLog (fila_id, robo_id, session_id, robo_client_id, iniciado_em, status)
        VALUES (@fila_id, @robo_id, ISNULL(@session_id,''), @robo_client_id, @agora, 'processando');
    ELSE
        UPDATE dbo.GN_RoboExecucaoLog SET session_id = ISNULL(@session_id, session_id), robo_client_id = @robo_client_id
        WHERE log_id = @log_id;

    IF @log_id IS NULL SET @log_id = SCOPE_IDENTITY();

    DECLARE @acao VARCHAR(10) = 'nenhuma', @referencia VARCHAR(20) = NULL,
            @preco_avaliado DECIMAL(24,8) = NULL, @detalhe NVARCHAR(1000) = '';

    IF @session_id IS NULL OR @ativo = 0
    BEGIN
        UPDATE dbo.GN_RoboExecucaoLog
           SET concluido_em = SYSUTCDATETIME(), acao = 'nenhuma', status = 'ok',
               detalhe = 'robo nao encontrado ou inativo'
         WHERE log_id = @log_id;
        RETURN;
    END

    BEGIN TRY
        /* 1) trava de perda diaria */
        DECLARE @saldo DECIMAL(18,2), @pnl_dia DECIMAL(18,2);
        SELECT @saldo = saldo_brl FROM dbo.GN_SimSaldo WHERE session_id = @session_id;
        SELECT @pnl_dia = ISNULL(SUM(pnl), 0) FROM dbo.GN_SimVendas
        WHERE session_id = @session_id AND moeda = @moeda AND robo_client_id = @robo_client_id
          AND CAST(DATEADD(SECOND, exec_time_ms/1000, '19700101') AS DATE) = CAST(SYSUTCDATETIME() AS DATE);

        IF @saldo > 0 AND @pnl_dia < 0 AND ABS(@pnl_dia) >= (@limite_perda_diaria_pct / 100.0) * @saldo
        BEGIN
            UPDATE dbo.GN_Robos SET ativo = 0, atualizado_em = SYSUTCDATETIME() WHERE id = @robo_id;
            UPDATE dbo.GN_RoboExecucaoLog
               SET concluido_em = SYSUTCDATETIME(), acao = 'nenhuma', status = 'ok',
                   detalhe = CONCAT('limite de perda diaria atingido: pnl_dia=', @pnl_dia, ' limite_pct=', @limite_perda_diaria_pct, ' saldo=', @saldo, ' -- robo desativado')
             WHERE log_id = @log_id;
            RETURN;
        END

        /* 2) cotacao e taxa de rede "de agora" */
        DECLARE @preco DECIMAL(24,8), @feerate DECIMAL(18,4) = 1.0,
                @txsize INT = CASE WHEN @moeda = 'BCH' THEN 225 ELSE 140 END;

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
            UPDATE dbo.GN_RoboExecucaoLog
               SET concluido_em = SYSUTCDATETIME(), acao = 'nenhuma', status = 'ok', detalhe = 'cotacao indisponivel'
             WHERE log_id = @log_id;
            RETURN;
        END

        DECLARE @fee_rede DECIMAL(18,2) = CAST(@feerate * @txsize * (@preco / 100000000.0) AS DECIMAL(18,2));

        /* 3) "Taxas Reais": SideShift entra no calculo por padrao, so' fica
         *    fora se o usuario desligou explicitamente (config_json.taxas_reais = false) */
        DECLARE @taxas_reais BIT = 1;
        IF @config_json IS NOT NULL AND JSON_VALUE(@config_json, '$.taxas_reais') = 'false'
            SET @taxas_reais = 0;

        DECLARE @sideshift_fee_pct DECIMAL(9,4) = 0;
        IF @taxas_reais = 1
        BEGIN
            ;WITH jobs AS (
                SELECT TOP 10 deposit_amount, settle_amount, from_coin, to_coin, criado_em
                FROM dbo.GN_SideshiftJobs WHERE status_reconciliado = 'liquidado'
                ORDER BY criado_em DESC
            ),
            precos AS (
                SELECT j.*,
                    (SELECT TOP 1 media_exchanges_brl FROM dbo.snapshots WITH (NOLOCK)
                     WHERE ts_utc <= j.criado_em AND j.from_coin = 'BTC' ORDER BY ts_utc DESC) AS pf_btc,
                    (SELECT TOP 1 media_exchanges_brl FROM dbo.BCH_Snapshots WITH (NOLOCK)
                     WHERE ts_utc <= j.criado_em AND j.from_coin = 'BCH' ORDER BY ts_utc DESC) AS pf_bch,
                    (SELECT TOP 1 media_exchanges_brl FROM dbo.snapshots WITH (NOLOCK)
                     WHERE ts_utc <= j.criado_em AND j.to_coin = 'BTC' ORDER BY ts_utc DESC) AS pt_btc,
                    (SELECT TOP 1 media_exchanges_brl FROM dbo.BCH_Snapshots WITH (NOLOCK)
                     WHERE ts_utc <= j.criado_em AND j.to_coin = 'BCH' ORDER BY ts_utc DESC) AS pt_bch
                FROM jobs j
            )
            SELECT @sideshift_fee_pct = AVG(fee_pct) FROM (
                SELECT (deposit_amount * COALESCE(pf_btc, pf_bch) - settle_amount * COALESCE(pt_btc, pt_bch))
                       / NULLIF(deposit_amount * COALESCE(pf_btc, pf_bch), 0) * 100.0 AS fee_pct
                FROM precos WHERE COALESCE(pf_btc, pf_bch) IS NOT NULL AND COALESCE(pt_btc, pt_bch) IS NOT NULL
            ) x;
            SET @sideshift_fee_pct = ISNULL(@sideshift_fee_pct, 3.5);
        END

        DECLARE @limiar_pct DECIMAL(9,4) =
            (@fee_rede / NULLIF(@valor_operacao,0) * 100.0) + @sideshift_fee_pct + @retorno_desejado_pct;

        /* 4) decisao de COMPRA (gatilho normal): preco caiu >= limiar_pct abaixo da maxima recente */
        DECLARE @lookback_min INT = 30;
        IF @config_json IS NOT NULL AND ISNUMERIC(JSON_VALUE(@config_json, '$.lookback_minutos')) = 1
            SET @lookback_min = CAST(JSON_VALUE(@config_json, '$.lookback_minutos') AS INT);

        DECLARE @maxima DECIMAL(24,8);
        IF @moeda = 'BTC'
            SELECT @maxima = MAX(media_exchanges_brl) FROM dbo.snapshots WITH (NOLOCK)
            WHERE ok = 1 AND media_exchanges_brl > 0 AND ts_utc >= DATEADD(MINUTE, -@lookback_min, @agora);
        ELSE
            SELECT @maxima = MAX(media_exchanges_brl) FROM dbo.BCH_Snapshots WITH (NOLOCK)
            WHERE ok = 1 AND media_exchanges_brl > 0 AND ts_utc >= DATEADD(MINUTE, -@lookback_min, @agora);

        IF @maxima IS NULL SET @maxima = @preco;

        DECLARE @queda_pct DECIMAL(9,4) = CASE WHEN @maxima > 0 THEN (@maxima - @preco) / @maxima * 100.0 ELSE 0 END;

        IF @queda_pct >= @limiar_pct
        BEGIN
            DECLARE @c_lote VARCHAR(20), @c_preco DECIMAL(24,8), @c_qtd DECIMAL(24,10);
            BEGIN TRY
                EXEC dbo.GN_RoboComprar
                    @session_id = @session_id, @moeda = @moeda, @valor = @valor_operacao,
                    @robo_client_id = @robo_client_id,
                    @lote_client_id = @c_lote OUTPUT, @preco = @c_preco OUTPUT, @qtd = @c_qtd OUTPUT;
                SET @acao = 'compra'; SET @referencia = @c_lote; SET @preco_avaliado = @c_preco;
                SET @detalhe = CONCAT(@detalhe, 'comprou: queda ', @queda_pct, '% >= limiar ', @limiar_pct, '%; lote ', @c_lote, '. ');
            END TRY
            BEGIN CATCH
                SET @detalhe = CONCAT(@detalhe, 'tentou comprar (queda ', @queda_pct, '% >= limiar ', @limiar_pct,
                                       '%) mas falhou: ', ERROR_MESSAGE(), '. ');
            END CATCH
        END
        ELSE
            SET @detalhe = CONCAT(@detalhe, 'sem compra: queda ', @queda_pct, '% < limiar ', @limiar_pct, '%. ');

        /* 4b) MODO CRASH: gatilho adicional, so' entra se o normal nao comprou.
         *     Queda medida contra a maxima de 7 DIAS (pega crash de varios dias,
         *     nao so' 30 min). Freio: so' compra se o preco ainda estiver fazendo
         *     minima nova nas ultimas 3 leituras -- quando a queda estabiliza,
         *     pausa ate' voltar a cair. */
        DECLARE @queda_crash_pct DECIMAL(9,4) = 23;
        IF @config_json IS NOT NULL AND ISNUMERIC(JSON_VALUE(@config_json, '$.queda_crash_pct')) = 1
            SET @queda_crash_pct = CAST(JSON_VALUE(@config_json, '$.queda_crash_pct') AS DECIMAL(9,4));

        IF @acao = 'nenhuma' AND @queda_crash_pct > 0
        BEGIN
            DECLARE @max_7d DECIMAL(24,8);
            IF @moeda = 'BTC'
                SELECT @max_7d = MAX(media_exchanges_brl) FROM dbo.snapshots WITH (NOLOCK)
                WHERE ok = 1 AND media_exchanges_brl > 0 AND ts_utc >= DATEADD(DAY, -7, @agora);
            ELSE
                SELECT @max_7d = MAX(media_exchanges_brl) FROM dbo.BCH_Snapshots WITH (NOLOCK)
                WHERE ok = 1 AND media_exchanges_brl > 0 AND ts_utc >= DATEADD(DAY, -7, @agora);

            IF @max_7d IS NULL SET @max_7d = @preco;
            DECLARE @queda_7d_pct DECIMAL(9,4) = CASE WHEN @max_7d > 0 THEN (@max_7d - @preco) / @max_7d * 100.0 ELSE 0 END;

            IF @queda_7d_pct >= @queda_crash_pct
            BEGIN
                DECLARE @min_ultimas3 DECIMAL(24,8);
                IF @moeda = 'BTC'
                    SELECT @min_ultimas3 = MIN(media_exchanges_brl) FROM (
                        SELECT TOP 3 media_exchanges_brl FROM dbo.snapshots WITH (NOLOCK)
                        WHERE ok = 1 AND media_exchanges_brl > 0 AND ts_utc < @agora
                        ORDER BY ts_utc DESC) x;
                ELSE
                    SELECT @min_ultimas3 = MIN(media_exchanges_brl) FROM (
                        SELECT TOP 3 media_exchanges_brl FROM dbo.BCH_Snapshots WITH (NOLOCK)
                        WHERE ok = 1 AND media_exchanges_brl > 0 AND ts_utc < @agora
                        ORDER BY ts_utc DESC) x;

                IF @min_ultimas3 IS NULL OR @preco < @min_ultimas3
                BEGIN
                    DECLARE @cc_lote VARCHAR(20), @cc_preco DECIMAL(24,8), @cc_qtd DECIMAL(24,10);
                    BEGIN TRY
                        EXEC dbo.GN_RoboComprar
                            @session_id = @session_id, @moeda = @moeda, @valor = @valor_operacao,
                            @robo_client_id = @robo_client_id,
                            @lote_client_id = @cc_lote OUTPUT, @preco = @cc_preco OUTPUT, @qtd = @cc_qtd OUTPUT;
                        SET @acao = 'compra'; SET @referencia = @cc_lote; SET @preco_avaliado = @cc_preco;
                        SET @detalhe = CONCAT(@detalhe, 'compra (modo crash): queda_7d ', @queda_7d_pct, '% >= gatilho ',
                                               @queda_crash_pct, '%; nova minima confirmada; lote ', @cc_lote, '. ');
                    END TRY
                    BEGIN CATCH
                        SET @detalhe = CONCAT(@detalhe, 'modo crash tentou comprar (queda_7d ', @queda_7d_pct, '% >= ',
                                               @queda_crash_pct, '%) mas falhou: ', ERROR_MESSAGE(), '. ');
                    END CATCH
                END
                ELSE
                    SET @detalhe = CONCAT(@detalhe, 'modo crash ativo (queda_7d ', @queda_7d_pct, '% >= ', @queda_crash_pct,
                                           '%) mas freio: preco nao fez nova minima nas ultimas 3 leituras. ');
            END
        END

        /* 5) decisao de VENDA: por lote aberto, PRE-FILTRO local (nao e' mais
         *    autorizacao final -- isso agora e' feito dentro de GN_RoboVender,
         *    na mesma transacao que grava a venda). Compara so' contra
         *    @retorno_desejado_pct (o SideShift ja e' descontado do pnl
         *    DENTRO de GN_RoboVender, via @sideshift_pct -- somar aqui de
         *    novo na meta duplicaria o efeito). Cursor filtrado por
         *    robo_client_id = @robo_client_id (um robo nunca projeta venda
         *    sobre lotes de outro robo ou de compra manual). */
        DECLARE @lote_id BIGINT, @lote_client VARCHAR(20), @preco_lote DECIMAL(24,8), @restante DECIMAL(24,10);
        DECLARE lotes_cur CURSOR LOCAL FAST_FORWARD FOR
            SELECT id, lote_client_id, preco, restante FROM dbo.GN_SimLotes
            WHERE session_id = @session_id AND moeda = @moeda AND restante > 0 AND excluido = 0
              AND (robo_client_id = @robo_client_id)
            ORDER BY seq;
        OPEN lotes_cur;
        FETCH NEXT FROM lotes_cur INTO @lote_id, @lote_client, @preco_lote, @restante;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            DECLARE @custo_lote DECIMAL(24,8) = @restante * @preco_lote;
            DECLARE @pnl_liquido_estimado DECIMAL(24,8) = @restante * (@preco - @preco_lote) - @fee_rede;
            DECLARE @retorno_pct DECIMAL(9,4) = CASE WHEN @custo_lote > 0 THEN @pnl_liquido_estimado / @custo_lote * 100.0 ELSE 0 END;

            IF @retorno_pct >= @retorno_desejado_pct
            BEGIN
                DECLARE @valor_venda DECIMAL(18,2) = CAST(@restante * @preco AS DECIMAL(18,2));
                DECLARE @v_venda VARCHAR(20), @v_preco DECIMAL(24,8), @v_qtd DECIMAL(24,10),
                        @v_liq DECIMAL(18,2), @v_pnl DECIMAL(18,2), @v_vendeu BIT, @v_log NVARCHAR(1000);
                -- EXEC nao aceita uma expressao CASE direto como valor de parametro
                -- (nem bare, nem entre parenteses) -- por isso resolve numa variavel antes.
                DECLARE @sideshift_pct_robo DECIMAL(9,4) = NULL;
                IF @taxas_reais = 1 SET @sideshift_pct_robo = @sideshift_fee_pct;
                BEGIN TRY
                    EXEC dbo.GN_RoboVender
                        @session_id = @session_id, @moeda = @moeda, @valor = @valor_venda, @vender_tudo = 0,
                        @robo_client_id = @robo_client_id,
                        @retorno_desejado_pct = @retorno_desejado_pct,
                        @sideshift_pct = @sideshift_pct_robo,
                        @venda_client_id = @v_venda OUTPUT, @preco = @v_preco OUTPUT, @qtd = @v_qtd OUTPUT,
                        @valor_liquido = @v_liq OUTPUT, @pnl = @v_pnl OUTPUT,
                        @vendeu = @v_vendeu OUTPUT, @log_detalhe = @v_log OUTPUT;

                    IF @v_vendeu = 1
                    BEGIN
                        SET @acao = CASE WHEN @acao = 'compra' THEN 'compra+venda' ELSE 'venda' END;
                        SET @referencia = @v_venda; SET @preco_avaliado = @v_preco;
                        SET @detalhe = CONCAT(@detalhe, 'vendeu lote ', @lote_client, ': pre-filtro ', @retorno_pct,
                                               '% >= meta ', @retorno_desejado_pct, '%; confirmado na execucao [', @v_log, ']. ');
                    END
                    ELSE
                        SET @detalhe = CONCAT(@detalhe, 'tentou vender lote ', @lote_client, ' (pre-filtro ', @retorno_pct,
                                               '% >= meta ', @retorno_desejado_pct,
                                               '%) mas a validacao final na execucao nao confirmou a meta [', @v_log, ']. ');
                END TRY
                BEGIN CATCH
                    SET @detalhe = CONCAT(@detalhe, 'tentou vender lote ', @lote_client, ' mas falhou: ', ERROR_MESSAGE(), '. ');
                END CATCH
            END

            FETCH NEXT FROM lotes_cur INTO @lote_id, @lote_client, @preco_lote, @restante;
        END
        CLOSE lotes_cur; DEALLOCATE lotes_cur;

        UPDATE dbo.GN_RoboExecucaoLog
           SET concluido_em = SYSUTCDATETIME(), acao = @acao, referencia = @referencia,
               preco_avaliado = ISNULL(@preco_avaliado, @preco), detalhe = @detalhe, status = 'ok'
         WHERE log_id = @log_id;
    END TRY
    BEGIN CATCH
        IF CURSOR_STATUS('local','lotes_cur') >= 0 BEGIN CLOSE lotes_cur; DEALLOCATE lotes_cur; END
        UPDATE dbo.GN_RoboExecucaoLog
           SET concluido_em = SYSUTCDATETIME(), status = 'erro', erro_msg = ERROR_MESSAGE()
         WHERE log_id = @log_id;
        THROW;
    END CATCH
END
GO

-- Exemplo de uso:
-- EXEC dbo.GN_RoboOrquestrador @robo_id = 1, @fila_id = NULL;
