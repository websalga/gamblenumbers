<?php
/*
 * Credenciais de LEITURA (somente SELECT) usadas pela api.php para anexar
 * o TXID de cada evento do extrato, consultando diretamente as tabelas de
 * baixo nível GN_BTC_TxMovements / GN_BCH_TxMovements.
 *
 * São os MESMOS logins de baixo privilégio já usados pelos jobs de sync
 * do cache Fulcrum (gn_btc_sync / gn_bch_sync) — nenhuma permissão nova
 * precisa ser concedida no SQL Server.
 *
 * Copie este arquivo para sync_config.php e preencha com as credenciais
 * reais. sync_config.php é ignorado pelo git (.gitignore).
 */
$SYNC_SQL_SERVER   = '192.168.18.108';
$SYNC_SQL_DATABASE = 'bitcoin';
$SYNC_SQL_PORT     = 1433;

$SYNC_BTC_USER = 'gn_btc_sync';
$SYNC_BTC_PASS = 'TROCAR_AQUI';

$SYNC_BCH_USER = 'gn_bch_sync';
$SYNC_BCH_PASS = 'TROCAR_AQUI';
