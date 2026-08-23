<?php
/*
 * Endpoint de i18n: devolve os textos do site no idioma pedido.
 * Uso: textos.php?idioma=pt-BR|en-US|es-ES (default pt-BR se invalido)
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require __DIR__ . '/../private/config.php';

function db() {
  global $DB_SERVER, $DB_DATABASE, $DB_USER, $DB_PASSWORD, $DB_PORT;
  $dsn = "sqlsrv:Server={$DB_SERVER},{$DB_PORT};Database={$DB_DATABASE};Encrypt=1;TrustServerCertificate=1";
  return new PDO($dsn, $DB_USER, $DB_PASSWORD, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
  ]);
}

const IDIOMAS_DISPONIVEIS = ['pt-BR', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'ja-JP', 'nl-NL', 'ru-RU', 'tr-TR', 'zh-CN'];

try {
  $idioma = $_GET['idioma'] ?? 'pt-BR';
  if (!in_array($idioma, IDIOMAS_DISPONIVEIS, true)) {
    $idioma = 'pt-BR';
  }

  $pdo = db();
  $stmt = $pdo->prepare("SELECT chave, texto FROM dbo.Site_Textos WHERE idioma = ?");
  $stmt->execute([$idioma]);

  $textos = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $textos[$row['chave']] = $row['texto'];
  }

  echo json_encode(['ok' => true, 'idioma' => $idioma, 'idiomas_disponiveis' => IDIOMAS_DISPONIVEIS, 'textos' => $textos]);

} catch (Throwable $e) {
  http_response_code(500);
  error_log('textos.php erro: ' . $e->getMessage());
  echo json_encode(['ok' => false, 'error' => 'Falha ao consultar textos.']);
}
