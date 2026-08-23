<?php
/*
 * Copie este arquivo para config.php e preencha com suas credenciais.
 * NUNCA versione o config.php real. O Nginx não deve servir .php de config
 * como texto — como é PHP, ele é executado, então o conteúdo não vaza.
 *
 * Dica de segurança extra: você pode mover config.php para fora da webroot
 * e ajustar o require em api.php para o caminho absoluto.
 */
$DB_SERVER   = 'SEU_SERVIDOR_SQL';   // IP ou hostname do SQL Server
$DB_DATABASE = 'bitcoin';
$DB_USER     = 'seu_usuario';
$DB_PASSWORD = 'sua_senha';
$DB_PORT     = 1433;
