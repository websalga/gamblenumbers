<?php
/**
 * DSN unico das conexoes do site com o SQL Server (09/11/2026).
 * Cifrado e VALIDANDO o certificado: o lsql2019 usa um certificado assinado pela CA privada do GambleNumbers
 * (a mesma do tunel do RPC), instalada no lxweb01 em /etc/ssl/certs/gamblenumbers-tunnel-ca.pem.
 * HostNameInCertificate: o ODBC Driver 18 nao confere o IP contra o SAN de IP do certificado, entao a conexao
 * continua pelo IP (192.168.18.108) e o nome conferido e' "lsql2019" (que esta' no certificado).
 */
function gn_sql_dsn(string $servidor, $porta, string $banco): string {
    return "sqlsrv:Server={$servidor},{$porta};Database={$banco};Encrypt=yes;TrustServerCertificate=no;HostNameInCertificate=lsql2019";
}
