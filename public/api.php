<?php
/*
 * Simulador — API PHP (PDO_SQLSRV)
 * Suporta qualquer par ativo/cotacao: crypto×fiat, fiat×fiat, crypto×crypto.
 * Credenciais em ../private/config.php - FORA da raiz publicada pelo Nginx.
 *
 * Parametros:
 *   moeda=BTC|BCH|USD|EUR|GBP|JPY|CNY|TRY|RUB|BRL  -> ativo (default BTC)
 *   moeda_exibicao=BRL|USD|EUR|GBP|JPY|CNY|TRY|RUB  -> cotacao (default BRL)
 *
 * Fontes de dados por tipo de par:
 *   crypto×fiat  -> dbo.snapshots / dbo.BCH_Snapshots (existente)
 *   fiat×fiat    -> dbo.FX_Snapshots (cruzamento via USD como pivo)
 *   crypto×crypto-> JOIN snapshots + BCH_Snapshots via USD como pivo
 *   fiat×crypto  -> FX_Snapshots invertido × media_exchanges_usd
 *
 * Endpoints:
 *   api.php?acao=cotacoes&limite=1500
 *   api.php?acao=atual
 *   api.php?acao=intervalo&desde=<ms>&ate=<ms>&max=<n>
 *   api.php?acao=config   -> vetor de calibracao do par (Chart_Config)
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

// --- Whitelists ---
const MOEDAS_CRYPTO = [
  'BTC' => 'dbo.snapshots',
  'BCH' => 'dbo.BCH_Snapshots',
];
const MOEDAS_FIAT    = ['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'TRY', 'RUB'];
// Legado (compatibilidade com codigo que ainda referencia MOEDAS / MOEDAS_EXIBICAO)
const MOEDAS         = ['BTC' => 'dbo.snapshots', 'BCH' => 'dbo.BCH_Snapshots'];
const MOEDAS_EXIBICAO = ['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'TRY', 'RUB'];
// Fiat sem coluna pre-calculada em snapshots: calculado via FX_Snapshots
const MOEDAS_FX_COMPUTED = ['JPY', 'CNY', 'TRY', 'RUB'];

function moedaSelecionada(): string {
  $m = strtoupper($_GET['moeda'] ?? 'BTC');
  // Aceita crypto E fiat como ativo
  if (array_key_exists($m, MOEDAS_CRYPTO)) return $m;
  if (in_array($m, MOEDAS_FIAT, true))    return $m;
  return 'BTC';
}

/** Classificação do par para roteamento da query. */
function tipoPar(string $ativo, string $cotacao): string {
  $isCryptoA = array_key_exists($ativo,  MOEDAS_CRYPTO);
  $isCryptoC = array_key_exists($cotacao, MOEDAS_CRYPTO);
  if ($isCryptoA && !$isCryptoC) return 'crypto_fiat';   // BTC/EUR (lógica atual)
  if ($isCryptoA && $isCryptoC)  return 'crypto_crypto'; // BTC/BCH
  if (!$isCryptoA && $isCryptoC) return 'fiat_crypto';   // EUR/BTC
  return 'fiat_fiat';                                     // EUR/JPY
}

function moedaExibicaoSelecionada(): string {
  $m = strtoupper($_GET['moeda_exibicao'] ?? 'BRL');
  if (in_array($m, MOEDAS_EXIBICAO, true))      return $m;
  if (array_key_exists($m, MOEDAS_CRYPTO))      return $m; // BCH como cotacao de BTC
  return 'BRL';
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
  $avg = isset($r['price_brl']) && $r['price_brl'] !== null ? (float)$r['price_brl'] : null;
  $fx  = fn($k) => isset($r[$k]) && $r[$k] !== null ? (float)$r[$k] : null;
  return [
    't'        => toMs($r['ts_utc']),
    'avg'      => $avg,
    'binance'  => $fx('price_brl_binance')  ?? $avg,
    'kraken'   => $fx('price_brl_kraken')   ?? $avg,
    'coinbase' => $fx('price_brl_coinbase') ?? $avg,
    'btc_usd'  => $fx('btc_usd'),
    'usd_brl'  => $fx('usd_brl'),
    'usd_eur'  => $fx('usd_eur'),
    'usd_gbp'  => $fx('usd_gbp'),
    'usd_jpy'  => $fx('usd_jpy'),
    'usd_cny'  => $fx('usd_cny'),
    'usd_try'  => $fx('usd_try'),
    'usd_rub'  => $fx('usd_rub'),
  ];
}

try {
  $acao = $_GET['acao'] ?? 'cotacoes';
  $moeda        = moedaSelecionada();
  $moedaExibicao = moedaExibicaoSelecionada();
  $pdo          = db();
  $tipo         = tipoPar($moeda, $moedaExibicao);

  // ── Endpoint de configuração do par (Chart_Config) ────────────────────
  if ($acao === 'config') {
    $stmt = $pdo->prepare(
      "SELECT fonte, price_decimals, y_padding_pct, forecast_min_amp_pct,
              show_spread, show_exchanges, default_periodo
       FROM dbo.Chart_Config WHERE ativo = ? AND cotacao = ?"
    );
    $stmt->execute([$moeda, $moedaExibicao]);
    $cfg = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$cfg) {
      // Fallback: default por categoria
      $defKey = match($tipo) {
        'crypto_crypto' => '_DEFAULT_BTC',
        'crypto_fiat'   => ($moeda === 'BCH' ? '_DEFAULT_BCH' : '_DEFAULT_BTC'),
        default         => '_DEFAULT_FIAT',
      };
      $stmt2 = $pdo->prepare(
        "SELECT fonte, price_decimals, y_padding_pct, forecast_min_amp_pct,
                show_spread, show_exchanges, default_periodo
         FROM dbo.Chart_Config WHERE ativo = ? AND cotacao = '_'"
      );
      $stmt2->execute([$defKey]);
      $cfg = $stmt2->fetch(PDO::FETCH_ASSOC);
    }
    echo json_encode(['ok' => true, 'ativo' => $moeda, 'cotacao' => $moedaExibicao,
                      'tipo' => $tipo, 'config' => $cfg ?: null]);
    exit;
  }

  // ── Taxas FX necessárias para queries de pares não-crypto_fiat ───────
  // Busca uma vez; usada para montar expressões SQL literais (float do
  // nosso banco — não input do usuário, sem risco de injeção).
  // Colunas válidas em FX_Snapshots — jamais incluir usd_btc/usd_bch/usd_usd
  // (crypto não existe em FX_Snapshots; USD é o pivô =1, sem coluna própria)
  $fxRow = null;
  if ($tipo !== 'crypto_fiat' || in_array($moedaExibicao, MOEDAS_FX_COMPUTED, true)) {
    $fxRow = $pdo->query(
      "SELECT TOP 1 usd_brl,usd_eur,usd_gbp,usd_jpy,usd_cny,usd_try,usd_rub
       FROM dbo.FX_Snapshots WHERE ok=1 ORDER BY ts_utc DESC"
    )->fetch(PDO::FETCH_ASSOC) ?: [];
  }

  // ── Rotear para a função de colunas correta ───────────────────────────
  $fxRate = 1.0;
  if ($tipo === 'crypto_fiat' && in_array($moedaExibicao, MOEDAS_FX_COMPUTED, true)) {
    $fxCol  = 'usd_' . strtolower($moedaExibicao);
    $fxRate = $fxRow ? (float)($fxRow[$fxCol] ?? 1.0) : 1.0;
  }
  // ── Montar $col e $selectCols de acordo com o tipo de par ──────────────

  if ($tipo === 'fiat_fiat') {
    // fiat×fiat via USD como pivo em FX_Snapshots
    // USD é o próprio pivô (=1.0) — sem coluna usd_usd na tabela
    $colC = 'usd_' . strtolower($moedaExibicao);
    if ($moeda === 'USD') {
      $expr       = $colC;   // USD/JPY = usd_jpy diretamente
      $colA_expr  = '1.0';
      $filterExpr = "{$colC} IS NOT NULL";
    } else {
      $colA       = 'usd_' . strtolower($moeda);
      $expr       = "({$colC} / NULLIF({$colA}, 0))";
      $colA_expr  = $colA;
      $filterExpr = "{$colA} IS NOT NULL AND {$colC} IS NOT NULL";
    }
    // Lê FX direto da tabela — sem literais extras para evitar alias duplicado
    $selectCols = "ts_utc,
              {$expr} AS price_brl,
              {$expr} AS price_brl_binance,
              {$expr} AS price_brl_kraken,
              {$expr} AS price_brl_coinbase,
              {$colA_expr} AS btc_usd,
              usd_brl, usd_eur, usd_gbp, usd_jpy, usd_cny, usd_try, usd_rub";
    $col = [
      'tabela'    => 'dbo.FX_Snapshots',
      'avg'       => $expr,
      'filterCol' => $filterExpr,
    ];

  } elseif ($tipo === 'fiat_crypto') {
    // fiat/BTC|BCH: quanto de crypto vale 1 unidade do fiat
    // USD/BTC = 1/BTC_USD_price (sem coluna usd_usd em FX_Snapshots)
    $tblCrypto = MOEDAS_CRYPTO[$moedaExibicao];
    if ($moeda === 'USD') {
      $expr    = "(1.0 / NULLIF(media_exchanges_usd, 0))";
      $exprBin = "CASE WHEN price_usd_binance  IS NOT NULL THEN 1.0/NULLIF(price_usd_binance,0)  ELSE NULL END";
      $exprKrk = "CASE WHEN price_usd_kraken   IS NOT NULL THEN 1.0/NULLIF(price_usd_kraken,0)   ELSE NULL END";
      $exprCbs = "CASE WHEN price_usd_coinbase IS NOT NULL THEN 1.0/NULLIF(price_usd_coinbase,0) ELSE NULL END";
    } else {
      $colA    = 'usd_' . strtolower($moeda);
      $fxA     = isset($fxRow[$colA]) ? number_format((float)$fxRow[$colA], 8, '.', '') : '1.0';
      $expr    = "(1.0 / NULLIF(media_exchanges_usd * {$fxA}, 0))";
      $exprBin = "CASE WHEN price_usd_binance  IS NOT NULL THEN 1.0/NULLIF(price_usd_binance  * {$fxA},0) ELSE NULL END";
      $exprKrk = "CASE WHEN price_usd_kraken   IS NOT NULL THEN 1.0/NULLIF(price_usd_kraken   * {$fxA},0) ELSE NULL END";
      $exprCbs = "CASE WHEN price_usd_coinbase IS NOT NULL THEN 1.0/NULLIF(price_usd_coinbase * {$fxA},0) ELSE NULL END";
    }
    // literais de taxa para o cliente converter entre moedas
    $fxLits = [];
    if ($fxRow) {
      foreach (['brl','eur','gbp','jpy','cny','try','rub'] as $fc) {
        $k = "usd_{$fc}";
        if (isset($fxRow[$k]) && $fxRow[$k] !== null)
          $fxLits[] = number_format((float)$fxRow[$k], 8, '.', '') . " AS {$k}";
      }
    }
    $fxExtras = $fxLits ? (",
              " . implode(",
              ", $fxLits)) : '';
    $selectCols = "ts_utc,
              {$expr}    AS price_brl,
              {$exprBin} AS price_brl_binance,
              {$exprKrk} AS price_brl_kraken,
              {$exprCbs} AS price_brl_coinbase,
              media_exchanges_usd AS btc_usd,
              usd_brl{$fxExtras}";
    $col = [
      'tabela'    => $tblCrypto,
      'avg'       => $expr,
      'filterCol' => 'media_exchanges_usd IS NOT NULL',
    ];

  } else {
    // crypto_fiat (lógica original) + taxas extras jpy/cny/try/rub como literais
    // NÃO duplicar brl/eur/gbp que já vêm como expressões no SELECT
    $col = colunas($moeda, $moedaExibicao, $fxRate);

    $fxLiteralCol = '';
    if (!empty($col['fx_literal']) && !empty($col['fx_col'])) {
      $fxLiteralCol = ",
              {$col['fx_literal']} AS {$col['fx_col']}";
    }
    $fxExtras = '';
    if ($fxRow) {
      $lits = [];
      foreach (['jpy','cny','try','rub'] as $fc) {
        $k = "usd_{$fc}";
        if (isset($fxRow[$k]) && $fxRow[$k] !== null)
          $lits[] = number_format((float)$fxRow[$k], 8, '.', '') . " AS {$k}";
      }
      if ($lits) $fxExtras = ",
              " . implode(",
              ", $lits);
    }
    $selectCols = "ts_utc,
              {$col['avg']}      AS price_brl,
              {$col['binance']}  AS price_brl_binance,
              {$col['kraken']}   AS price_brl_kraken,
              {$col['coinbase']} AS price_brl_coinbase,
              {$col['usd_ref']}  AS btc_usd,
              usd_brl,
              (media_exchanges_eur / NULLIF(media_exchanges_usd,0)) AS usd_eur,
              (media_exchanges_gbp / NULLIF(media_exchanges_usd,0)) AS usd_gbp{$fxExtras}";
    // Nota: fxExtras já inclui usd_{moedaExibicao} para MOEDAS_FX_COMPUTED
    // (ex: usd_cny). Não usar fxLiteralCol aqui — causaria alias duplicado no CTE.
    $col['filterCol'] = $col['filterCol'] ?? "{$col['avg']} IS NOT NULL";
  }

  if ($acao === 'atual') {
    if ($tipo === 'crypto_crypto') {
      $tblA = MOEDAS_CRYPTO[$moeda]; $tblC = MOEDAS_CRYPTO[$moedaExibicao];
      $sql = "SELECT TOP 1 s.ts_utc,
                (s.media_exchanges_usd / NULLIF(b.media_exchanges_usd,0)) AS price_brl,
                (CASE WHEN s.price_usd_binance IS NOT NULL AND b.price_usd_binance IS NOT NULL
                      THEN s.price_usd_binance/NULLIF(b.price_usd_binance,0) END) AS price_brl_binance,
                (CASE WHEN s.price_usd_kraken  IS NOT NULL AND b.price_usd_kraken  IS NOT NULL
                      THEN s.price_usd_kraken/NULLIF(b.price_usd_kraken,0) END) AS price_brl_kraken,
                (CASE WHEN s.price_usd_coinbase IS NOT NULL AND b.price_usd_coinbase IS NOT NULL
                      THEN s.price_usd_coinbase/NULLIF(b.price_usd_coinbase,0) END) AS price_brl_coinbase,
                s.media_exchanges_usd AS btc_usd, NULL AS usd_brl
              FROM {$tblA} s
              CROSS APPLY (SELECT TOP 1 media_exchanges_usd, price_usd_binance,
                                        price_usd_kraken, price_usd_coinbase
                           FROM {$tblC} WHERE ok=1 AND media_exchanges_usd IS NOT NULL
                           AND ts_utc <= s.ts_utc ORDER BY ts_utc DESC) b
              WHERE s.ok=1 AND s.media_exchanges_usd IS NOT NULL
              ORDER BY s.ts_utc DESC";
    } else {
      $filter = $col['filterCol'] ?? "{$col['avg']} IS NOT NULL";
      $sql = "SELECT TOP 1 {$selectCols}
              FROM {$col['tabela']}
              WHERE ok = 1 AND {$filter}
              ORDER BY ts_utc DESC";
    }
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

    if ($tipo === 'crypto_crypto') {
      $tblA = MOEDAS_CRYPTO[$moeda]; $tblC = MOEDAS_CRYPTO[$moedaExibicao];
      $sql = "
        WITH src AS (
          SELECT s.ts_utc,
            (s.media_exchanges_usd/NULLIF(b.media_exchanges_usd,0)) AS price_brl,
            (CASE WHEN s.price_usd_binance IS NOT NULL AND b.price_usd_binance IS NOT NULL
                  THEN s.price_usd_binance/NULLIF(b.price_usd_binance,0) END) AS price_brl_binance,
            (CASE WHEN s.price_usd_kraken IS NOT NULL AND b.price_usd_kraken IS NOT NULL
                  THEN s.price_usd_kraken/NULLIF(b.price_usd_kraken,0) END) AS price_brl_kraken,
            (CASE WHEN s.price_usd_coinbase IS NOT NULL AND b.price_usd_coinbase IS NOT NULL
                  THEN s.price_usd_coinbase/NULLIF(b.price_usd_coinbase,0) END) AS price_brl_coinbase,
            s.media_exchanges_usd AS btc_usd, NULL AS usd_brl,
            DATEDIFF_BIG(SECOND,'1970-01-01',s.ts_utc) / :bkt AS bucket
          FROM {$tblA} s
          CROSS APPLY (SELECT TOP 1 media_exchanges_usd, price_usd_binance,
                                    price_usd_kraken, price_usd_coinbase
                       FROM {$tblC} WHERE ok=1 AND media_exchanges_usd IS NOT NULL
                       AND ts_utc <= s.ts_utc ORDER BY ts_utc DESC) b
          WHERE s.ok=1 AND s.media_exchanges_usd IS NOT NULL
            AND s.ts_utc >= :d0 AND s.ts_utc <= :d1
        ),
        ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY ts_utc DESC) AS rn FROM src)
        SELECT ts_utc, price_brl, price_brl_binance, price_brl_kraken, price_brl_coinbase, btc_usd, usd_brl
        FROM ranked WHERE rn=1 ORDER BY ts_utc ASC";
    } else {
      $filter = $col['filterCol'] ?? "{$col['avg']} IS NOT NULL";
      // Construir lista de colunas para o SELECT final do intervalo.
      // Para crypto_fiat: inclui expressões computadas de usd_eur/gbp.
      // Para fiat_fiat/fiat_crypto: inclui usd_brl direto da tabela.
      // Sempre: adiciona usd_jpy/cny/try/rub se estiverem no selectCols.
      $baseCols = "ts_utc, price_brl, price_brl_binance, price_brl_kraken, price_brl_coinbase, btc_usd, usd_brl";
      if ($tipo === 'crypto_fiat') $baseCols .= ", usd_eur, usd_gbp";
      elseif ($tipo === 'fiat_fiat') $baseCols .= ", usd_eur, usd_gbp, usd_jpy, usd_cny, usd_try, usd_rub";
      // Para crypto_fiat com MOEDAS_FX_COMPUTED: as extras vieram no fxExtras
      $extraAlias = '';
      if ($fxRow) {
        $eLits = [];
        foreach (['jpy','cny','try','rub'] as $fc) {
          if (isset($fxRow["usd_{$fc}"]) && $fxRow["usd_{$fc}"] !== null)
            $eLits[] = "usd_{$fc}";
        }
        if ($eLits && $tipo === 'crypto_fiat')
          $extraAlias = ', ' . implode(', ', $eLits);
      }
      $fxAlias = $baseCols . $extraAlias;
      $sql = "
        WITH src AS (
          SELECT {$selectCols},
                 DATEDIFF_BIG(SECOND, '1970-01-01', ts_utc) / :bkt AS bucket
          FROM {$col['tabela']}
          WHERE ok = 1 AND {$filter}
            AND ts_utc >= :d0 AND ts_utc <= :d1
        ),
        ranked AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY ts_utc DESC) AS rn
          FROM src
        )
        SELECT {$fxAlias}
        FROM ranked WHERE rn = 1 ORDER BY ts_utc ASC";
    }
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

  if ($tipo === 'crypto_crypto') {
    $tblA = MOEDAS_CRYPTO[$moeda]; $tblC = MOEDAS_CRYPTO[$moedaExibicao];
    $sql = "SELECT * FROM (SELECT TOP ($limite) s.ts_utc,
              (s.media_exchanges_usd/NULLIF(b.media_exchanges_usd,0)) AS price_brl,
              (CASE WHEN s.price_usd_binance IS NOT NULL AND b.price_usd_binance IS NOT NULL
                    THEN s.price_usd_binance/NULLIF(b.price_usd_binance,0) END) AS price_brl_binance,
              (CASE WHEN s.price_usd_kraken IS NOT NULL AND b.price_usd_kraken IS NOT NULL
                    THEN s.price_usd_kraken/NULLIF(b.price_usd_kraken,0) END) AS price_brl_kraken,
              (CASE WHEN s.price_usd_coinbase IS NOT NULL AND b.price_usd_coinbase IS NOT NULL
                    THEN s.price_usd_coinbase/NULLIF(b.price_usd_coinbase,0) END) AS price_brl_coinbase,
              s.media_exchanges_usd AS btc_usd, NULL AS usd_brl
            FROM {$tblA} s
            CROSS APPLY (SELECT TOP 1 media_exchanges_usd, price_usd_binance,
                                      price_usd_kraken, price_usd_coinbase
                         FROM {$tblC} WHERE ok=1 AND media_exchanges_usd IS NOT NULL
                         AND ts_utc <= s.ts_utc ORDER BY ts_utc DESC) b
            WHERE s.ok=1 AND s.media_exchanges_usd IS NOT NULL
            ORDER BY s.ts_utc DESC) q ORDER BY ts_utc ASC";
  } else {
    $filter = $col['filterCol'] ?? "{$col['avg']} IS NOT NULL";
    $sql = "SELECT * FROM (
              SELECT TOP ($limite) {$selectCols}
              FROM {$col['tabela']}
              WHERE ok = 1 AND {$filter}
              ORDER BY ts_utc DESC
            ) q ORDER BY ts_utc ASC";
  }
  $stmt = $pdo->query($sql);
  $out = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) $out[] = mapRow($row);

  echo json_encode(['ok'=>true,'moeda'=>$moeda,'moeda_exibicao'=>$moedaExibicao,'count'=>count($out),'data'=>$out]);

} catch (Throwable $e) {
  http_response_code(500);
  error_log('api.php erro: ' . $e->getMessage());
  echo json_encode(['ok'=>false,'error'=>'Falha ao consultar o banco.']);
}
