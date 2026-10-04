-- Historico de parametros dos robos (criado em 2026-10-04) / Robot parameter history (created 2026-10-04).
-- Banco/Database: bitcoin. Ver/see: GN_RoboParametrosLog.sql, TR_GN_Robos_ParametrosLog.sql, GN_RoboAjustarParametros.sql
CREATE OR ALTER PROCEDURE dbo.GN_RoboAjustarParametros
    @robo_id                 BIGINT,
    @motivo                  NVARCHAR(1000),          -- OBRIGATORIO: por que os parametros estao sendo alterados
    @autor                   NVARCHAR(100)  = NULL,   -- ex.: nome/versao do agente de IA
    @origem                  VARCHAR(20)    = 'ia',   -- 'ia' ou 'auto' (ajuste automatico do motor)
    @valor_operacao          DECIMAL(18,2)  = NULL,
    @retorno_desejado_pct    DECIMAL(9,4)   = NULL,
    @limite_perda_diaria_pct DECIMAL(9,4)   = NULL,
    @ciclo_segundos          INT            = NULL,
    @queda_crash_pct         DECIMAL(9,4)   = NULL,   -- config_json.queda_crash_pct
    @lookback_minutos        INT            = NULL,   -- config_json.lookback_minutos
    @taxas_reais             BIT            = NULL,   -- config_json.taxas_reais
    @hist_id                 BIGINT         = NULL OUTPUT  -- id da linha criada em GN_RoboParametrosLog (NULL = nada mudou)
AS
BEGIN
    /* Unica porta recomendada para a IA/ajuste automatico alterar parametros de um robo.
     * Exige motivo, valida faixas, grava origem/motivo/autor no contexto da sessao e altera GN_Robos;
     * o trigger TR_GN_Robos_ParametrosLog registra a copia em GN_RoboParametrosLog.
     * NAO ativa/pausa o robo e NAO mexe em proxima_execucao (isso continua sendo da tela/do motor). */
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @hist_id = NULL;

    IF @motivo IS NULL OR LEN(LTRIM(RTRIM(@motivo))) < 5 THROW 50101, 'motivo obrigatorio (explique por que os parametros estao sendo alterados)', 1;
    IF @origem NOT IN ('ia','auto')                       THROW 50102, 'origem invalida (use ia ou auto)', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.GN_Robos WHERE id = @robo_id) THROW 50103, 'robo nao encontrado', 1;
    IF COALESCE(@valor_operacao,@retorno_desejado_pct,@limite_perda_diaria_pct,@ciclo_segundos,@queda_crash_pct,@lookback_minutos,CAST(@taxas_reais AS INT)) IS NULL
                                                          THROW 50104, 'nenhum parametro informado', 1;
    IF @valor_operacao          IS NOT NULL AND @valor_operacao <= 0                           THROW 50111, 'valor_operacao deve ser > 0', 1;
    IF @retorno_desejado_pct    IS NOT NULL AND (@retorno_desejado_pct < 0 OR @retorno_desejado_pct > 100)         THROW 50112, 'retorno_desejado_pct fora de 0..100', 1;
    IF @limite_perda_diaria_pct IS NOT NULL AND (@limite_perda_diaria_pct <= 0 OR @limite_perda_diaria_pct > 100)  THROW 50113, 'limite_perda_diaria_pct fora de (0..100]', 1;
    IF @ciclo_segundos          IS NOT NULL AND (@ciclo_segundos < 5 OR @ciclo_segundos > 86400)                   THROW 50114, 'ciclo_segundos fora de 5..86400', 1;
    IF @queda_crash_pct         IS NOT NULL AND (@queda_crash_pct < 0 OR @queda_crash_pct > 100)                   THROW 50115, 'queda_crash_pct fora de 0..100', 1;
    IF @lookback_minutos        IS NOT NULL AND (@lookback_minutos < 1 OR @lookback_minutos > 10080)               THROW 50116, 'lookback_minutos fora de 1..10080', 1;

    DECLARE @t0 DATETIME2 = SYSUTCDATETIME();
    DECLARE @cfg NVARCHAR(MAX) = (SELECT config_json FROM dbo.GN_Robos WHERE id = @robo_id);
    IF @cfg IS NULL OR ISJSON(@cfg) = 0 SET @cfg = N'{}';
    IF @queda_crash_pct  IS NOT NULL SET @cfg = JSON_MODIFY(@cfg, '$.queda_crash_pct', @queda_crash_pct);
    IF @lookback_minutos IS NOT NULL SET @cfg = JSON_MODIFY(@cfg, '$.lookback_minutos', @lookback_minutos);
    IF @taxas_reais      IS NOT NULL SET @cfg = JSON_MODIFY(@cfg, '$.taxas_reais', @taxas_reais);

    BEGIN TRY
        EXEC sys.sp_set_session_context @key = N'origem', @value = @origem;
        EXEC sys.sp_set_session_context @key = N'motivo', @value = @motivo;
        EXEC sys.sp_set_session_context @key = N'autor',  @value = @autor;

        UPDATE dbo.GN_Robos
           SET valor_operacao          = COALESCE(@valor_operacao, valor_operacao),
               retorno_desejado_pct    = COALESCE(@retorno_desejado_pct, retorno_desejado_pct),
               limite_perda_diaria_pct = COALESCE(@limite_perda_diaria_pct, limite_perda_diaria_pct),
               ciclo_segundos          = COALESCE(@ciclo_segundos, ciclo_segundos),
               config_json             = CASE WHEN @queda_crash_pct IS NULL AND @lookback_minutos IS NULL AND @taxas_reais IS NULL THEN config_json ELSE @cfg END,
               atualizado_em           = SYSUTCDATETIME()
         WHERE id = @robo_id;

        EXEC sys.sp_set_session_context @key = N'origem', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'motivo', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'autor',  @value = NULL;
    END TRY
    BEGIN CATCH
        EXEC sys.sp_set_session_context @key = N'origem', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'motivo', @value = NULL;
        EXEC sys.sp_set_session_context @key = N'autor',  @value = NULL;
        THROW;
    END CATCH

    SELECT TOP 1 @hist_id = hist_id FROM dbo.GN_RoboParametrosLog WHERE robo_id = @robo_id AND alterado_em >= @t0 ORDER BY hist_id DESC;
END
GO
