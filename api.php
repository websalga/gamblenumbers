<?php
/*
 * BTC Simulador — API PHP (PDO_SQLSRV)
 * Lê bitcoin.dbo.snapshots e devolve JSON para o dashboard.
 * Credenciais via variáveis de ambiente (config.php). Nunca coloque senha aqui.
 *
 * Endpoints:
 *   api.php?acao=cotacoes&limite=1500  -> últimos N snapshots (crescente)
 *   api.php?acao=atual                 -> snapshot mais recente
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require __DIR__ . '/config.php'; // define $DB_SERVER, $DB_DATABASE, $DB_USER, $DB_PASSWORD, $DB_PORT

function db() {
  global $DB_SERVER, $DB_DATABASE, $DB_USER, $DB_PASSWORD, $DB_PORT;
  $dsn = "sqlsrv:Server={$DB_SERVER},{$DB_PORT};Database={$DB_DATABASE};Encrypt=1;TrustServerCertificate=1";  
  return new PDO($dsn, $DB_USER, $DB_PASSWORD, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
  ]);
}

// converte 'YYYY-MM-DD HH:MM:SS' (UTC) em epoch ms
function toMs($ts) {
  $t = strtotime($ts . ' UTC');
  return $t * 1000;
}

function mapRow($r) {
  $avg = $r['price_brl'] !== null ? (float)$r['price_brl'] : null;
  return [
    't'        => toMs($r['ts_utc']),
    'avg'      => $avg,
    'binance'  => $r['price_brl_binance']  !== null ? (float)$r['price_brl_binance']  : $avg,
    'kraken'   => $r['price_brl_kraken']   !== null ? (float)$r['price_brl_kraken']   : $avg,
    'coinbase' => $r['price_brl_coinbase'] !== null ? (float)$r['price_brl_coinbase'] : $avg,
    'btc_usd'  => $r['btc_usd']  !== null ? (float)$r['btc_usd']  : null,
    'usd_brl'  => $r['usd_brl']  !== null ? (float)$r['usd_brl']  : null,
  ];
}

try {
  $acao = $_GET['acao'] ?? 'cotacoes';
  $pdo = db();

  if ($acao === 'atual') {
    $sql = "SELECT TOP 1 ts_utc, price_brl,
              price_brl_binance, price_brl_kraken, price_brl_coinbase,
              btc_usd, usd_brl
            FROM dbo.snapshots
            WHERE ok = 1 AND price_brl IS NOT NULL
            ORDER BY ts_utc DESC";
    $row = $pdo->query($sql)->fetch(PDO::FETCH_ASSOC);
    if (!$row) { http_response_code(404); echo json_encode(['ok'=>false,'error'=>'Sem dados.']); exit; }
    echo json_encode(['ok'=>true,'data'=>mapRow($row)]);
    exit;
  }

  // cotacoes
  $limite = isset($_GET['limite']) ? (int)$_GET['limite'] : 1500;
  if ($limite < 1) $limite = 1;
  if ($limite > 5000) $limite = 5000;

  // TOP com parâmetro: usa subquery ordenada desc e reinverte para asc
  $sql = "SELECT * FROM (
            SELECT TOP ($limite) ts_utc, price_brl,
              price_brl_binance, price_brl_kraken, price_brl_coinbase,
              btc_usd, usd_brl
            FROM dbo.snapshots
            WHERE ok = 1 AND price_brl IS NOT NULL
            ORDER BY ts_utc DESC
          ) q
          ORDER BY ts_utc ASC";
  $stmt = $pdo->query($sql);
  $out = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) $out[] = mapRow($row);

  echo json_encode(['ok'=>true,'count'=>count($out),'data'=>$out]);

} catch (Throwable $e) {
  http_response_code(500);
  // não vaza detalhe interno ao cliente
  error_log('api.php erro: ' . $e->getMessage());
  echo json_encode(['ok'=>false,'error'=>'Falha ao consultar o banco.']);
}
