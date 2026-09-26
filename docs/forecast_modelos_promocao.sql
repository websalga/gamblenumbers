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

-- =============================================================================
-- Adendo 2026-09-26: Mimetagem, grade de 5 min e precisao por antecedencia
--   * Candidatos em sombra 'mimetagem' (ultimas 4 cotacoes) e 'mimetagem_longa' (12 cotacoes): metodo das
--     analogias (k-NN) - sobrepoe a janela atual a todos os trechos do historico (biblioteca ate 20000 janelas),
--     40 vizinhos diversos, previsao = mediana ponderada do que veio depois, banda = quantis dos vizinhos.
--   * Motor v3: serie reamostrada em GRADE REGULAR de 5 min (1 cotacao por janela). O BTC grava ~2 cotacoes por
--     janela (pares a segundos); contando passos por cotacao, 12 passos valiam ~30 min e a volatilidade por passo
--     saia subestimada (faixa do BTC cobria 66-74% em vez de 80%). Apos a correcao a faixa publicada de 24h do BTC
--     ficou ~1,45x mais larga e a cobertura no backtest passou a 83-86%. O ponto previsto (naive) nao mudou.
--   * Backtest v2: agregado + por antecedencia (Backtest_Resumo.antecedencia_min; NULL = agregado).
-- =============================================================================
ALTER TABLE forecast.Backtest_Resumo ADD antecedencia_min FLOAT NULL;
GO
CREATE VIEW forecast.vw_Precisao_Antecedencia AS
SELECT r.ativo, mc.horizonte_min, mc.modelo,
       CAST(ROUND(DATEDIFF(SECOND, r.ancora_t_utc, c.target_t_utc) / 60.0, 0) AS INT) AS antecedencia_min,
       COUNT(*) AS n_pontos, AVG(c.erro_abs_pct) AS mape_pct,
       AVG(ABS(r.ancora_preco - c.y_real) / c.y_real * 100.0) AS mape_naive_pct,
       (1.0 - AVG(c.erro_abs_pct) / NULLIF(AVG(ABS(r.ancora_preco - c.y_real) / c.y_real * 100.0), 0)) * 100.0 AS skill_vs_naive_pct,
       AVG((c.y_hat - c.y_real) / c.y_real * 100.0) AS vies_pct,
       AVG(CAST(c.dentro_da_faixa AS FLOAT)) * 100.0 AS cobertura_faixa_pct
FROM forecast.Coverage c JOIN forecast.Runs r ON r.run_id = c.run_id JOIN forecast.Model_Config mc ON mc.id = r.model_config_id
GROUP BY r.ativo, mc.horizonte_min, mc.modelo, CAST(ROUND(DATEDIFF(SECOND, r.ancora_t_utc, c.target_t_utc) / 60.0, 0) AS INT);
GO
GRANT SELECT ON forecast.vw_Precisao_Antecedencia TO forecast_reader;

-- =============================================================================
-- Adendo 2026-09-26 (2): miolo da faixa, cenario da Mimetagem e o que o site desenha
--   * Miolo do "sino": a faixa completa (y_lo..y_hi, nominal 80%) abria demais nas pontas. O api.php serve como
--     avg_lo/avg_hi apenas o MIOLO = y_hat +/- fator*(y_hi-y_hat); a faixa completa segue em avg_lo80/avg_hi80.
--     O fator faz a metade dos casos reais cair dentro (calibrado em 21 dias de grade de 5 min: a distribuicao real
--     e' mais concentrada no centro que a normal, cujo fator seria 0,527). Recalibrar com o mesmo metodo se a
--     volatilidade mudar muito: mediana de |real-ancora| / (1,28*sigma*raiz(n)).
INSERT INTO forecast.Config (chave, valor, descricao) VALUES
 ('faixa_central_pct','50',N'largura nominal do miolo servido ao site'),
 ('faixa_central_fator_BTC','0.367',N'fator do miolo, BTC'),
 ('faixa_central_fator_BCH','0.405',N'fator do miolo, BCH');
--   * mimetagem_trajetoria (candidato em SOMBRA): grava 144 marcos por curva de 24h (1 ponto a cada 10 min).
--     O api.php a serve num campo separado e rotulado ('cenario'), so' como desenho ilustrativo igual para todos;
--     a PREVISAO continua sendo 'pontos', do modelo publicado.
--   * Grafico: com a previsao do servidor disponivel, a projecao local (simulacao congelada no navegador) deixa de
--     ser desenhada e de entrar na escala; a escala tambem so' considera lotes/vendas cujo marcador aparece na janela.
-- =============================================================================
