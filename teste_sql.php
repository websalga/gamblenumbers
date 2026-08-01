<?php
/*
 * teste-conexao.php — diagnóstico de conexão ao SQL Server.
 * Uso temporário. APAGUE depois de validar (mostra erros na tela).
 *
 * Testa a mesma DSN do api.php e imprime GETDATE() do servidor.
 * Tenta variações de criptografia para descobrir qual funciona no seu ambiente.
 */
header('Content-Type: text/plain; charset=utf-8');

require __DIR__ . '/config.php'; // $DB_SERVER, $DB_DATABASE, $DB_USER, $DB_PASSWORD, $DB_PORT

echo "=== Diagnóstico de conexão SQL Server ===\n";
echo "Driver PDO disponível: " . (in_array('sqlsrv', PDO::getAvailableDrivers()) ? 'sim' : 'NÃO') . "\n";
echo "Servidor: {$DB_SERVER},{$DB_PORT}  Banco: {$DB_DATABASE}  Usuário: {$DB_USER}\n";
echo str_repeat('-', 50) . "\n";

// variações de DSN, da mais provável para a menos
$variacoes = [
  'Encrypt=1;TrustServerCertificate=1' => "Criptografado + certificado confiável",
  'Encrypt=0'                          => "Sem criptografia",
  'TrustServerCertificate=1'           => "Padrão do driver + confia no certificado",
];

$sucesso = false;
foreach ($variacoes as $extra => $desc) {
  $dsn = "sqlsrv:Server={$DB_SERVER},{$DB_PORT};Database={$DB_DATABASE};{$extra}";
  echo "\n[Tentando] {$desc}\n  DSN extra: {$extra}\n";
  try {
    $pdo = new PDO($dsn, $DB_USER, $DB_PASSWORD, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_TIMEOUT => 5,
    ]);
    $row = $pdo->query("SELECT GETDATE() AS agora, @@VERSION AS versao")->fetch(PDO::FETCH_ASSOC);
    echo "  >>> SUCESSO!\n";
    echo "  GETDATE() do servidor: {$row['agora']}\n";
    echo "  Versão: " . substr($row['versao'], 0, 60) . "...\n";
    echo "\n==> Use no api.php a DSN com: {$extra}\n";
    $sucesso = true;
    break;
  } catch (Throwable $e) {
    echo "  Falhou: " . $e->getMessage() . "\n";
  }
}

if (!$sucesso) {
  echo "\n=== Nenhuma variação conectou. ===\n";
  echo "Leia a mensagem 'Falhou' acima:\n";
  echo " - 'Login failed'         -> usuário ou senha incorretos, ou sem acesso ao banco\n";
  echo " - 'SSL Provider'/'cert'  -> problema de criptografia/certificado\n";
  echo " - 'Login timeout'        -> rede/porta/instância (mas seu telnet 1433 funcionou)\n";
  echo " - 'could not find driver'-> pdo_sqlsrv não carregado neste PHP\n";
}
