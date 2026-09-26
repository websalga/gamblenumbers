-- =============================================================================
-- Avaliacao continua da previsao (motor de inferencia) — forecast.usp_AvaliarPrevisoes
-- e views de ranking. Criado em 2026-09-25. Banco: bitcoin (SQL Server / lsql2019).
--
-- Objetivo: TODA previsao gravada pelo motor (forecast.Runs/Points, igual para todos
-- os usuarios) e' medida contra a cotacao REALIZADA, para validar a precisao ou
-- abandonar um metodo impreciso. Fluxo: forecast-engine gera -> forecast-avaliador
-- (a cada 5 min, ver infra/lsql2019/forecast-avaliador) acrescenta em forecast.Coverage.
--
--   forecast.Coverage          1 linha por (run, alvo): y_hat, y_real, dentro_da_faixa,
--                              erro_abs_pct (pontos percentuais). Indice unico => idempotente.
--   forecast.usp_AvaliarPrevisoes(@dias, @tolerancia_seg, @avaliadas OUT)
--   forecast.vw_Precisao_Modelos  ranking por (ativo, horizonte, modelo): MAPE, MAPE do naive
--                                 nos MESMOS pontos, skill_vs_naive, vies, cobertura da banda,
--                                 acerto de direcao (so' movimento previsto >= 0,01%).
--   forecast.vw_Precisao_Diaria   a mesma medida por dia (a precisao melhora ou piora?).
--
-- Backfill inicial (feito em 2026-09-25): EXEC forecast.usp_AvaliarPrevisoes @dias = 30, @avaliadas = @n OUTPUT;
-- Preco realizado = 1a cotacao valida (media_exchanges_brl, ok=1) em [alvo, alvo+tolerancia (900 s)],
-- a mesma serie que o motor usa. Ponto de ancora (k=0) nao e' previsao e nao entra.
-- =============================================================================

CREATE UNIQUE INDEX UX_Coverage_run_alvo ON forecast.Coverage (run_id, target_t_utc);
GO

CREATE OR ALTER PROCEDURE forecast.usp_AvaliarPrevisoes
    @dias           INT = 2,
    @tolerancia_seg INT = 900,
    @avaliadas      INT = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @dias IS NULL OR @dias < 1 OR @dias > 90 THROW 50101, 'dias invalido (1..90)', 1;
    IF @tolerancia_seg IS NULL OR @tolerancia_seg < 60 OR @tolerancia_seg > 3600 THROW 50102, 'tolerancia invalida (60..3600)', 1;

    SET @avaliadas = 0;

    DECLARE @lock INT;
    EXEC @lock = sp_getapplock @Resource = 'forecast.usp_AvaliarPrevisoes', @LockMode = 'Exclusive',
                               @LockOwner = 'Session', @LockTimeout = 0;
    IF @lock < 0 RETURN;   -- ja tem outra avaliacao rodando

    BEGIN TRY
        DECLARE @agora   DATETIME2 = SYSUTCDATETIME();
        DECLARE @alvo_ate DATETIME2 = DATEADD(SECOND, -@tolerancia_seg, @agora);
        DECLARE @alvo_de  DATETIME2 = DATEADD(DAY, -@dias, @agora);
        DECLARE @runs_de  DATETIME2 = DATEADD(DAY, -(@dias + 2), @agora);          -- horizonte maximo e' 24h
        DECLARE @n1 INT = 0, @n2 INT = 0;

        INSERT INTO forecast.Coverage (run_id, target_t_utc, y_hat, y_real, dentro_da_faixa, erro_abs_pct, avaliado_em_utc)
        SELECT r.run_id, p.target_t_utc, p.y_hat, s.px,
               CASE WHEN p.y_lo IS NOT NULL AND p.y_hi IS NOT NULL AND s.px BETWEEN p.y_lo AND p.y_hi THEN 1 ELSE 0 END,
               ABS(p.y_hat - s.px) / s.px * 100.0, @agora
        FROM forecast.Runs r
        JOIN forecast.Points p ON p.run_id = r.run_id
        CROSS APPLY (SELECT TOP 1 media_exchanges_brl AS px FROM dbo.snapshots WITH (NOLOCK)
                     WHERE ts_utc >= p.target_t_utc AND ts_utc <= DATEADD(SECOND, @tolerancia_seg, p.target_t_utc)
                       AND ok = 1 AND media_exchanges_brl > 0 ORDER BY ts_utc) s
        WHERE r.ativo = 'BTC' AND r.gerado_em_utc >= @runs_de
          AND p.target_t_utc > r.ancora_t_utc AND p.target_t_utc BETWEEN @alvo_de AND @alvo_ate
          AND NOT EXISTS (SELECT 1 FROM forecast.Coverage c WHERE c.run_id = p.run_id AND c.target_t_utc = p.target_t_utc);
        SET @n1 = @@ROWCOUNT;

        INSERT INTO forecast.Coverage (run_id, target_t_utc, y_hat, y_real, dentro_da_faixa, erro_abs_pct, avaliado_em_utc)
        SELECT r.run_id, p.target_t_utc, p.y_hat, s.px,
               CASE WHEN p.y_lo IS NOT NULL AND p.y_hi IS NOT NULL AND s.px BETWEEN p.y_lo AND p.y_hi THEN 1 ELSE 0 END,
               ABS(p.y_hat - s.px) / s.px * 100.0, @agora
        FROM forecast.Runs r
        JOIN forecast.Points p ON p.run_id = r.run_id
        CROSS APPLY (SELECT TOP 1 media_exchanges_brl AS px FROM dbo.BCH_Snapshots WITH (NOLOCK)
                     WHERE ts_utc >= p.target_t_utc AND ts_utc <= DATEADD(SECOND, @tolerancia_seg, p.target_t_utc)
                       AND ok = 1 AND media_exchanges_brl > 0 ORDER BY ts_utc) s
        WHERE r.ativo = 'BCH' AND r.gerado_em_utc >= @runs_de
          AND p.target_t_utc > r.ancora_t_utc AND p.target_t_utc BETWEEN @alvo_de AND @alvo_ate
          AND NOT EXISTS (SELECT 1 FROM forecast.Coverage c WHERE c.run_id = p.run_id AND c.target_t_utc = p.target_t_utc);
        SET @n2 = @@ROWCOUNT;

        SET @avaliadas = @n1 + @n2;
        EXEC sp_releaseapplock @Resource = 'forecast.usp_AvaliarPrevisoes', @LockOwner = 'Session';
    END TRY
    BEGIN CATCH
        EXEC sp_releaseapplock @Resource = 'forecast.usp_AvaliarPrevisoes', @LockOwner = 'Session';
        THROW;
    END CATCH
END
GO

CREATE OR ALTER VIEW forecast.vw_Precisao_Modelos AS
SELECT r.ativo, mc.horizonte_min, mc.modelo, mc.id AS model_config_id, mc.ativo_flag AS publicado,
       COUNT(*)                                                        AS n_pontos,
       COUNT(DISTINCT c.run_id)                                        AS n_execucoes,
       AVG(c.erro_abs_pct)                                             AS mape_pct,
       AVG(ABS(r.ancora_preco - c.y_real) / c.y_real * 100.0)          AS mape_naive_pct,
       (1.0 - AVG(c.erro_abs_pct) / NULLIF(AVG(ABS(r.ancora_preco - c.y_real) / c.y_real * 100.0), 0)) * 100.0 AS skill_vs_naive_pct,
       AVG((c.y_hat - c.y_real) / c.y_real * 100.0)                    AS vies_pct,
       AVG(CAST(c.dentro_da_faixa AS FLOAT)) * 100.0                   AS cobertura_faixa_pct,
       AVG(CASE WHEN ABS(c.y_hat - r.ancora_preco) / r.ancora_preco >= 0.0001
                THEN CASE WHEN SIGN(c.y_hat - r.ancora_preco) = SIGN(c.y_real - r.ancora_preco) THEN 100.0 ELSE 0.0 END END) AS acerto_direcao_pct,
       MIN(c.target_t_utc) AS primeiro_alvo, MAX(c.target_t_utc) AS ultimo_alvo
FROM forecast.Coverage c
JOIN forecast.Runs r          ON r.run_id = c.run_id
JOIN forecast.Model_Config mc ON mc.id = r.model_config_id
GROUP BY r.ativo, mc.horizonte_min, mc.modelo, mc.id, mc.ativo_flag;
GO

CREATE OR ALTER VIEW forecast.vw_Precisao_Diaria AS
SELECT CAST(c.target_t_utc AS DATE) AS dia_utc, r.ativo, mc.horizonte_min, mc.modelo,
       COUNT(*)                                               AS n_pontos,
       AVG(c.erro_abs_pct)                                    AS mape_pct,
       AVG(ABS(r.ancora_preco - c.y_real) / c.y_real * 100.0) AS mape_naive_pct,
       (1.0 - AVG(c.erro_abs_pct) / NULLIF(AVG(ABS(r.ancora_preco - c.y_real) / c.y_real * 100.0), 0)) * 100.0 AS skill_vs_naive_pct,
       AVG((c.y_hat - c.y_real) / c.y_real * 100.0)           AS vies_pct,
       AVG(CAST(c.dentro_da_faixa AS FLOAT)) * 100.0          AS cobertura_faixa_pct
FROM forecast.Coverage c
JOIN forecast.Runs r          ON r.run_id = c.run_id
JOIN forecast.Model_Config mc ON mc.id = r.model_config_id
GROUP BY CAST(c.target_t_utc AS DATE), r.ativo, mc.horizonte_min, mc.modelo;
GO

GRANT EXECUTE ON forecast.usp_AvaliarPrevisoes TO forecast_writer;
GRANT SELECT  ON forecast.vw_Precisao_Modelos TO forecast_reader;
GRANT SELECT  ON forecast.vw_Precisao_Diaria  TO forecast_reader;
