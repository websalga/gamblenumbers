<?php
/*
 * Credenciais de LEITURA (somente SELECT) usadas pela api.php para ler o
 * motor de previsao estatistica (schema "forecast" no banco "bitcoin",
 * lsql2019) e expor a linha de referencia no grafico.
 *
 * E' o MESMO login de baixo privilegio ja usado pelo motor em si
 * (forecast_reader) - nenhuma permissao nova precisa ser concedida no
 * SQL Server.
 *
 * Copie este arquivo para forecast_config.php e preencha com as
 * credenciais reais. forecast_config.php e' ignorado pelo git (.gitignore).
 */
$FORECAST_SQL_SERVER   = '192.168.18.108';
$FORECAST_SQL_DATABASE = 'bitcoin';
$FORECAST_SQL_PORT     = 1433;

$FORECAST_READER_USER = 'forecast_reader';
$FORECAST_READER_PASS = 'TROCAR_AQUI';
