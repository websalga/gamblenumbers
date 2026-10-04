-- Historico de parametros dos robos (criado em 2026-10-04) / Robot parameter history (created 2026-10-04).
-- Banco/Database: bitcoin. Ver/see: GN_RoboParametrosLog.sql, TR_GN_Robos_ParametrosLog.sql, GN_RoboAjustarParametros.sql
CREATE OR ALTER TRIGGER dbo.TR_GN_Robos_ParametrosLog ON dbo.GN_Robos AFTER INSERT, UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    /* Historico de parametros dos robos. Grava uma linha (copia do registro) a cada INSERT, DELETE ou UPDATE que
     * mude algum campo de CONFIGURACAO. Nao grava quando so' mudam proxima_execucao/atualizado_em (ruido do motor).
     * Origem/motivo/autor vem do SESSION_CONTEXT ('origem','motivo','autor'), definido por quem altera
     * (telas do site, GN_RoboAjustarParametros, motor). Sem contexto: origem='nao_informada', motivo vazio.
     * Qualquer falha aqui NUNCA bloqueia a alteracao do robo. */
    BEGIN TRY
        DECLARE @origem VARCHAR(20)    = COALESCE(CAST(SESSION_CONTEXT(N'origem') AS VARCHAR(20)), 'nao_informada');
        DECLARE @motivo NVARCHAR(1000) = CAST(SESSION_CONTEXT(N'motivo') AS NVARCHAR(1000));
        DECLARE @autor  NVARCHAR(100)  = CAST(SESSION_CONTEXT(N'autor')  AS NVARCHAR(100));
        IF @motivo = N'' SET @motivo = NULL;
        IF @origem = '' SET @origem = 'nao_informada';
        DECLARE @app NVARCHAR(128) = APP_NAME(), @host NVARCHAR(128) = HOST_NAME(), @usr NVARCHAR(128) = SUSER_SNAME();

        -- INSERT
        INSERT dbo.GN_RoboParametrosLog (operacao, robo_id, session_id, seq, robo_client_id, apelido, moeda, valor_operacao, retorno_desejado_pct,
               limite_perda_diaria_pct, ativo, config_json, ciclo_segundos, publico, clonado_de_id, campos_alterados, origem, aplicacao, host, usuario_bd, autor, motivo)
        SELECT 'I', i.id, i.session_id, i.seq, i.robo_client_id, i.apelido, i.moeda, i.valor_operacao, i.retorno_desejado_pct,
               i.limite_perda_diaria_pct, i.ativo, i.config_json, i.ciclo_segundos, i.publico, i.clonado_de_id, NULL, @origem, @app, @host, @usr, @autor, @motivo
        FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.id = i.id);

        -- DELETE
        INSERT dbo.GN_RoboParametrosLog (operacao, robo_id, session_id, seq, robo_client_id, apelido, moeda, valor_operacao, retorno_desejado_pct,
               limite_perda_diaria_pct, ativo, config_json, ciclo_segundos, publico, clonado_de_id, campos_alterados, origem, aplicacao, host, usuario_bd, autor, motivo)
        SELECT 'D', d.id, d.session_id, d.seq, d.robo_client_id, d.apelido, d.moeda, d.valor_operacao, d.retorno_desejado_pct,
               d.limite_perda_diaria_pct, d.ativo, d.config_json, d.ciclo_segundos, d.publico, d.clonado_de_id, NULL, @origem, @app, @host, @usr, @autor, @motivo
        FROM deleted d WHERE NOT EXISTS (SELECT 1 FROM inserted i WHERE i.id = d.id);

        -- UPDATE (so' se algum campo de configuracao mudou de verdade; texto comparado em binario p/ pegar maiusc./minusc.)
        INSERT dbo.GN_RoboParametrosLog (operacao, robo_id, session_id, seq, robo_client_id, apelido, moeda, valor_operacao, retorno_desejado_pct,
               limite_perda_diaria_pct, ativo, config_json, ciclo_segundos, publico, clonado_de_id, campos_alterados, origem, aplicacao, host, usuario_bd, autor, motivo)
        SELECT 'U', i.id, i.session_id, i.seq, i.robo_client_id, i.apelido, i.moeda, i.valor_operacao, i.retorno_desejado_pct,
               i.limite_perda_diaria_pct, i.ativo, i.config_json, i.ciclo_segundos, i.publico, i.clonado_de_id,
               CONCAT_WS(',',
                 CASE WHEN NOT EXISTS (SELECT i.apelido COLLATE Latin1_General_BIN2 INTERSECT SELECT d.apelido COLLATE Latin1_General_BIN2) THEN 'apelido' END,
                 CASE WHEN NOT EXISTS (SELECT i.moeda COLLATE Latin1_General_BIN2 INTERSECT SELECT d.moeda COLLATE Latin1_General_BIN2) THEN 'moeda' END,
                 CASE WHEN i.valor_operacao <> d.valor_operacao THEN 'valor_operacao' END,
                 CASE WHEN i.retorno_desejado_pct <> d.retorno_desejado_pct THEN 'retorno_desejado_pct' END,
                 CASE WHEN i.limite_perda_diaria_pct <> d.limite_perda_diaria_pct THEN 'limite_perda_diaria_pct' END,
                 CASE WHEN i.ativo <> d.ativo THEN 'ativo' END,
                 CASE WHEN NOT EXISTS (SELECT i.config_json COLLATE Latin1_General_BIN2 INTERSECT SELECT d.config_json COLLATE Latin1_General_BIN2) THEN 'config_json' END,
                 CASE WHEN i.ciclo_segundos <> d.ciclo_segundos THEN 'ciclo_segundos' END,
                 CASE WHEN i.publico <> d.publico THEN 'publico' END,
                 CASE WHEN NOT EXISTS (SELECT i.clonado_de_id INTERSECT SELECT d.clonado_de_id) THEN 'clonado_de_id' END,
                 CASE WHEN i.seq <> d.seq THEN 'seq' END,
                 CASE WHEN NOT EXISTS (SELECT i.robo_client_id COLLATE Latin1_General_BIN2 INTERSECT SELECT d.robo_client_id COLLATE Latin1_General_BIN2) THEN 'robo_client_id' END),
               @origem, @app, @host, @usr, @autor, @motivo
        FROM inserted i JOIN deleted d ON d.id = i.id
        WHERE i.apelido COLLATE Latin1_General_BIN2 <> d.apelido COLLATE Latin1_General_BIN2
           OR i.moeda COLLATE Latin1_General_BIN2 <> d.moeda COLLATE Latin1_General_BIN2
           OR i.valor_operacao <> d.valor_operacao
           OR i.retorno_desejado_pct <> d.retorno_desejado_pct
           OR i.limite_perda_diaria_pct <> d.limite_perda_diaria_pct
           OR i.ativo <> d.ativo
           OR NOT EXISTS (SELECT i.config_json COLLATE Latin1_General_BIN2 INTERSECT SELECT d.config_json COLLATE Latin1_General_BIN2)
           OR i.ciclo_segundos <> d.ciclo_segundos
           OR i.publico <> d.publico
           OR NOT EXISTS (SELECT i.clonado_de_id INTERSECT SELECT d.clonado_de_id)
           OR i.seq <> d.seq
           OR NOT EXISTS (SELECT i.robo_client_id COLLATE Latin1_General_BIN2 INTERSECT SELECT d.robo_client_id COLLATE Latin1_General_BIN2);
    END TRY
    BEGIN CATCH
        /* nunca derruba a gravacao do robo por causa do historico */
        DECLARE @ignorar INT = 0;
    END CATCH
END
GO
