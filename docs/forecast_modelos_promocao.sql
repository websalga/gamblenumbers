-- =============================================================================
-- Modelos concorrentes (SOMBRA), promocao automatica e backtest do motor de previsao.
-- Criado em 2026-09-25. Banco: bitcoin (SQL Server / lsql2019). Fonte de verdade: o banco;
-- este arquivo e' o registro para reconstruir/auditar. Codigo do motor: /home/claude/forecast-engine
-- (git local no lsql2019): run_forecast.py, modelos_previsao.py, backtest_modelos.py, avaliar_previsoes.py.
--
-- Como funciona
--   * Cada (ativo, horizonte) tem 1 modelo PUBLICADO (Model_Config.ativo_flag=1) - o UNICO que o site
--     serve (api.php filtra ativo_flag=1) - e varios em SOMBRA (em_teste=1): gerados a cada 15 min,
--     gravados em Runs/Points/Coverage e medidos, nunca servidos.
--   * forecast.usp_AvaliarPromocao (1x/hora, dentro do forecast-avaliador) compara cada sombra com o
--     publicado de forma PAREADA (mesma ancora e mesmo alvo) e troca sozinha se TODOS os criterios de
--     forecast.Config forem cumpridos. O publicado que sai vira sombra (continua medido). Auditoria em
--     forecast.Promocoes. Desligar a troca automatica: UPDATE forecast.Config SET valor='0' WHERE chave='promocao_automatica'.
--   * forecast.Backtest_Resumo guarda cada backtest (rolling-origin sobre o historico) rodado por
--     backtest_modelos.py.
-- Modelos: naive_constante (baseline, publicado), ses, tendencia_amortecida, theta, ar_retornos,
--   naive_conformal (banda empirica nao-parametrica), simulacao_site_v7 (porte do Forecast.project do
--   navegador com semente fixa por ativo/horizonte/ancora).
-- =============================================================================

ALTER TABLE forecast.Model_Config ADD
    em_teste  BIT NOT NULL CONSTRAINT DF_Model_Config_em_teste DEFAULT 0,
    descricao NVARCHAR(400) NULL;
GO

CREATE TABLE forecast.Promocoes (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Promocoes PRIMARY KEY,
    ativo VARCHAR(10) NOT NULL, horizonte_min INT NOT NULL,
    de_model_config_id INT NOT NULL, para_model_config_id INT NOT NULL,
    decisao VARCHAR(20) NOT NULL,            -- promovido | recomendado | mantido
    motivo NVARCHAR(600) NOT NULL, metricas_json NVARCHAR(MAX) NULL,
    decidido_em_utc DATETIME2 NOT NULL CONSTRAINT DF_Promocoes_em DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Promocoes_alvo ON forecast.Promocoes (ativo, horizonte_min, id DESC);

CREATE TABLE forecast.Config (
    chave VARCHAR(60) NOT NULL CONSTRAINT PK_ForecastConfig PRIMARY KEY,
    valor VARCHAR(200) NOT NULL, descricao NVARCHAR(300) NULL,
    atualizado_em DATETIME2 NOT NULL CONSTRAINT DF_ForecastConfig_em DEFAULT SYSUTCDATETIME()
);
INSERT INTO forecast.Config (chave, valor, descricao) VALUES
 ('promocao_automatica','1',N'1 = troca o modelo publicado sozinha; 0 = so'' registra recomendacao'),
 ('promocao_min_dias','5',N'dias distintos com dados de AMBOS (publicado e candidato)'),
 ('promocao_min_execucoes','150',N'execucoes minimas do candidato na janela'),
 ('promocao_janela_dias','7',N'janela (dias) da comparacao pareada'),
 ('promocao_margem_pct','3',N'MAPE do candidato pelo menos X% menor que o do publicado'),
 ('promocao_min_dias_venc','60',N'% minimo dos dias em que o candidato vence o publicado'),
 ('promocao_min_cobertura','60',N'cobertura minima da banda (%) do candidato'),
 ('promocao_min_tstat','2',N'estatistica t minima da diferenca diaria pareada'),
 ('promocao_cooldown_dias','3',N'dias sem nova troca no mesmo ativo/horizonte apos uma promocao');

CREATE TABLE forecast.Backtest_Resumo (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Backtest_Resumo PRIMARY KEY,
    executado_em_utc DATETIME2 NOT NULL CONSTRAINT DF_Backtest_em DEFAULT SYSUTCDATETIME(),
    ativo VARCHAR(10) NOT NULL, horizonte_min INT NOT NULL, modelo VARCHAR(50) NOT NULL,
    janela_de_utc DATETIME2 NOT NULL, janela_ate_utc DATETIME2 NOT NULL,
    n_origens INT NOT NULL, n_pontos INT NOT NULL,
    mape_pct FLOAT NOT NULL, mape_naive_pct FLOAT NOT NULL, skill_vs_naive_pct FLOAT NULL, vies_pct FLOAT NULL,
    cobertura_faixa_pct FLOAT NULL, acerto_direcao_pct FLOAT NULL,
    dias_venceu_pct FLOAT NULL, n_dias INT NULL, tstat_diario FLOAT NULL
);
CREATE INDEX IX_Backtest_Resumo_exec ON forecast.Backtest_Resumo (executado_em_utc DESC, ativo, horizonte_min);
GO

-- Candidatos em sombra (todos com ativo_flag=0, em_teste=1) para BTC/BCH x 60/360/1440 min:
--   ses, tendencia_amortecida, theta, ar_retornos, naive_conformal, simulacao_site_v7
-- (INSERT INTO forecast.Model_Config (ativo, horizonte_min, modelo, parametros_json, ativo_flag, em_teste, descricao) ...)
GO

-- forecast.usp_AvaliarPromocao: ver a definicao no banco (OBJECT_DEFINITION) - comparacao pareada por
-- (ativo, horizonte, ancora, alvo), dias robustos (>=100 pares/dia), t-stat diario, escolhe 1 candidato por
-- (ativo, horizonte), aplica em transacao (publicado antigo -> sombra), registra em forecast.Promocoes.

GRANT EXECUTE ON forecast.usp_AvaliarPromocao TO forecast_writer;
GRANT SELECT ON forecast.Config, forecast.Promocoes, forecast.Backtest_Resumo TO forecast_reader;
