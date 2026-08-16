<?php
/*
 * Simulador — API PHP (PDO_SQLSRV)
 * Le bitcoin.dbo.snapshots (BTC) ou bitcoin.dbo.BCH_Snapshots (BCH) e
 * devolve JSON para o dashboard.
 * Credenciais em ../private/config.php - FORA da raiz publicada pelo Nginx.
 *
 * Parametros novos (Fase 2):
 *   moeda=BTC|BCH            -> qual carteira/ativo consultar (default BTC)
 *   moeda_exibicao=BRL|USD|EUR|GBP -> em qual moeda exibir os precos (default BRL)
 *
 * As colunas price_eur/price_gbp/price_<moeda>_<exchange> ja vem
 * PRE-CALCULADAS no banco (coletores gravam tudo pronto) - aqui so
 * escolhemos quais colunas ler, sem fazer conta nenhuma em PHP.
 *
 * Endpoints (inalterados, aceitam os 2 parametros novos opcionais):
 *   api.php?acao=cotacoes&limite=1500
 *   api.php?acao=atual
 *   api.php?acao=intervalo&desde=<ms>&ate=<ms>&max=<n>
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

// --- Whitelist de moeda cripto (carteira) -> tabela ---
// NUNCA aceitar nome de tabela vindo direto do usuario.
const MOEDAS = [
  'BTC' => 'dbo.snapshots',
  'BCH' => 'dbo.BCH_Snapshots',
];

// --- Whitelist de moeda de exibicao (fiat) ---
const MOEDAS_EXIBICAO = ['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'TRY', 'RUB'];

// Moedas que nao possuem colunas pre-calculadas em snapshots/BCH_Snapshots.
// O preco e derivado em tempo real: media_exchanges_usd * taxa_fx (do FX_Snapshots).
const MOEDAS_FX_COMPUTED = ['JPY', 'CNY', 'TRY', 'RUB'];

function moedaSelecionada(): string {
  $m = strtoupper($_GET['moeda'] ?? 'BTC');
  return array_key_exists($m, MOEDAS) ? $m : 'BTC';
}

function moedaExibicaoSelecionada(): string {
  $m = strtoupper($_GET['moeda_exibicao'] ?? 'BRL');
  return in_array($m, MOEDAS_EXIBICAO, true) ? $m : 'BRL';
}

/**
 * Monta os nomes de coluna (ja validados via whitelist, seguro para
 * interpolar no SQL) para a moeda/exibicao escolhidas, e os aliasa de
 * volta para os nomes que o frontend ja conhece (price_brl,
 * price_brl_binance, etc) - o contrato JSON nao muda, so o CONTEUDO.
 */
/**
 * Para JPY/CNY/TRY/RUB (MOEDAS_FX_COMPUTED) nao existem colunas pre-calculadas
 * em snapshots/BCH_Snapshots. Busca-se a taxa mais recente de FX_Snapshots
 * e multiplica pela coluna USD em tempo de consulta.
 * $fxRate vem como literal float seguro (da nossa propria base, nao de $_GET).
 */
function colunas(string $moeda, string $moedaExibicao, float $fxRate = 1.0): array {
  $tabela = MOEDAS[$moeda];
  $sufixo = strtolower($moedaExibicao);
  $colUsdRef = 'media_exchanges_usd';

  if (in_array($moedaExibicao, MOEDAS_FX_COMPUTED, true)) {
    // Expresssoes SQL seguras: $fxRate e um float do nosso banco, nao input do usuario
    $fx = number_format($fxRate, 8, '.', '');
    return [
      'tabela'      => $tabela,
      'avg'         => "media_exchanges_usd * {$fx}",
      'binance'     => "CASE WHEN price_usd_binance  IS NOT NULL THEN price_usd_binance  * {$fx} ELSE NULL END",
      'kraken'      => "CASE WHEN price_usd_kraken   IS NOT NULL THEN price_usd_kraken   * {$fx} ELSE NULL END",
      'coinbase'    => "CASE WHEN price_usd_coinbase IS NOT NULL THEN price_usd_coinbase * {$fx} ELSE NULL END",
      'usd_ref'     => $colUsdRef,
      'fx_col'      => "usd_{$sufixo}",   // nome da coluna em FX_Snapshots
      'fx_literal'  => $fx,
    ];
  }

  return [
    'tabela'     => $tabela,
    'avg'        => "media_exchanges_{$sufixo}",
    'binance'    => "price_{$sufixo}_binance",
    'kraken'     => "price_{$sufixo}_kraken",
    'coinbase'   => "price_{$sufixo}_coinbase",
    'usd_ref'    => $colUsdRef,
    'fx_col'     => null,
    'fx_literal' => null,
  ];
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
    'usd_eur'  => isset($r['usd_eur'])  && $r['usd_eur']  !== null ? (float)$r['usd_eur']  : null,
    'usd_gbp'  => isset($r['usd_gbp'])  && $r['usd_gbp']  !== null ? (float)$r['usd_gbp']  : null,
    'usd_jpy'  => isset($r['usd_jpy'])  && $r['usd_jpy']  !== null ? (float)$r['usd_jpy']  : null,
    'usd_cny'  => isset($r['usd_cny'])  && $r['usd_cny']  !== null ? (float)$r['usd_cny']  : null,
    'usd_try'  => isset($r['usd_try'])  && $r['usd_try']  !== null ? (float)$r['usd_try']  : null,
    'usd_rub'  => isset($r['usd_rub'])  && $r['usd_rub']  !== null ? (float)$r['usd_rub']  : null,
  ];
}

try {
  $acao = $_GET['acao'] ?? 'cotacoes';
  $moeda = moedaSelecionada();
  $moedaExibicao = moedaExibicaoSelecionada();
  $pdo = db();

  // Para moedas computadas (JPY/CNY/TRY/RUB), busca a taxa FX mais recente
  // uma unica vez — usada como literal SQL em todas as queries desta requisicao.
  $fxRate = 1.0;
  if (in_array($moedaExibicao, MOEDAS_FX_COMPUTED, true)) {
    $fxCol = 'usd_' . strtolower($moedaExibicao);
    $fxRow = $pdo->query(
      "SELECT TOP 1 {$fxCol} FROM dbo.FX_Snapshots WHERE ok=1 AND {$fxCol} IS NOT NULL ORDER BY ts_utc DESC"
    )->fetch(PDO::FETCH_ASSOC);
    $fxRate = $fxRow ? (float)$fxRow[$fxCol] : 1.0;
  }

  $col = colunas($moeda, $moedaExibicao, $fxRate);

  // monta o SELECT dinamico (colunas ja validadas via whitelist acima -
  // seguro interpolar; nada aqui vem direto de $_GET sem passar pelas
  // funcoes moedaSelecionada()/moedaExibicaoSelecionada())
  // usd_eur/usd_gbp: derivados das colunas de media ja existentes (preco
  // do ativo em EUR/GBP dividido pelo preco em USD) - taxa implicita,
  // sem precisar de JOIN com FX_Snapshots. Usados no cliente para
  // converter valores de operacoes entre moedas de exibicao diferentes.
  // Para moedas computadas: inclui a taxa FX como literal para que mapRow
  // possa devolvê-la ao frontend (ex: usd_jpy) para conversoes no cliente.
  $fxLiteralCol = '';
  if ($col['fx_literal'] !== null && $col['fx_col'] !== null) {
    $fxLiteralCol = ",
              {$col['fx_literal']} AS {$col['fx_col']}";
  }

  $selectCols = "ts_utc,
              {$col['avg']}      AS price_brl,
              {$col['binance']}  AS price_brl_binance,
              {$col['kraken']}   AS price_brl_kraken,
              {$col['coinbase']} AS price_brl_coinbase,
              {$col['usd_ref']}  AS btc_usd,
              usd_brl,
              (media_exchanges_eur / NULLIF(media_exchanges_usd,0)) AS usd_eur,
              (media_exchanges_gbp / NULLIF(media_exchanges_usd,0)) AS usd_gbp{$fxLiteralCol}";

  if ($acao === 'atual') {
    $sql = "SELECT TOP 1 {$selectCols}
            FROM {$col['tabela']}
            WHERE ok = 1 AND {$col['avg']} IS NOT NULL
            ORDER BY ts_utc DESC";
    $row = $pdo->query($sql)->fetch(PDO::FETCH_ASSOC);
    if (!$row) { http_response_code(404); echo json_encode(['ok'=>false,'error'=>'Sem dados.']); exit; }
    echo json_encode(['ok'=>true,'moeda'=>$moeda,'moeda_exibicao'=>$moedaExibicao,'data'=>mapRow($row)]);
    exit;
  }

  if ($acao === 'intervalo') {
    $desde = isset($_GET['desde']) ? (float)$_GET['desde'] : 0.0;
    $ate   = isset($_GET['ate'])   ? (float)$_GET['ate']   : 0.0;
    $maxN  = isset($_GET['max'])   ? (int)$_GET['max']     : 1200;
    if ($maxN < 2)    $maxN = 2;
    if ($maxN > 4000) $maxN = 4000;
    if ($ate <= 0)    $ate = round(microtime(true) * 1000);
    if ($desde <= 0)  $desde = $ate - 30.0 * 86400.0 * 1000.0;
    if ($desde >= $ate) { echo json_encode(['ok'=>true,'count'=>0,'data'=>[]]); exit; }

    $desdeDt = gmdate('Y-m-d H:i:s', (int)floor($desde / 1000));
    $ateDt   = gmdate('Y-m-d H:i:s', (int)floor($ate   / 1000));

    $spanSec = max(1.0, ($ate - $desde) / 1000.0);
    $bucketSec = (int)max(1, ceil($spanSec / $maxN));

    $sql = "
      WITH src AS (
        SELECT {$selectCols},
               DATEDIFF_BIG(SECOND, '1970-01-01', ts_utc) / :bkt AS bucket
        FROM {$col['tabela']}
        WHERE ok = 1 AND {$col['avg']} IS NOT NULL
          AND ts_utc >= :d0 AND ts_utc <= :d1
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY ts_utc DESC) AS rn
        FROM src
      )
      SELECT ts_utc, price_brl, price_brl_binance, price_brl_kraken, price_brl_coinbase, btc_usd, usd_brl, usd_eur, usd_gbp
      FROM ranked
      WHERE rn = 1
      ORDER BY ts_utc ASC";
    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':bkt', $bucketSec, PDO::PARAM_INT);
    $stmt->bindValue(':d0', $desdeDt);
    $stmt->bindValue(':d1', $ateDt);
    $stmt->execute();
    $out = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) $out[] = mapRow($row);
    echo json_encode(['ok'=>true,'moeda'=>$moeda,'moeda_exibicao'=>$moedaExibicao,'count'=>count($out),'bucketSec'=>$bucketSec,'data'=>$out]);
    exit;
  }

  // cotacoes
  $limite = isset($_GET['limite']) ? (int)$_GET['limite'] : 1500;
  if ($limite < 1) $limite = 1;
  if ($limite > 5000) $limite = 5000;

  $sql = "SELECT * FROM (
            SELECT TOP ($limite) {$selectCols}
            FROM {$col['tabela']}
            WHERE ok = 1 AND {$col['avg']} IS NOT NULL
            ORDER BY ts_utc DESC
          ) q
          ORDER BY ts_utc ASC";
  $stmt = $pdo->query($sql);
  $out = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) $out[] = mapRow($row);

  echo json_encode(['ok'=>true,'moeda'=>$moeda,'moeda_exibicao'=>$moedaExibicao,'count'=>count($out),'data'=>$out]);

} catch (Throwable $e) {
  http_response_code(500);
  error_log('api.php erro: ' . $e->getMessage());
  echo json_encode(['ok'=>false,'error'=>'Falha ao consultar o banco.']);
}
