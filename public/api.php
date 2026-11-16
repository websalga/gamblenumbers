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
  require_once __DIR__ . '/../private/sql_dsn.php';
  $dsn = gn_sql_dsn($DB_SERVER, $DB_PORT, $DB_DATABASE);
  return new PDO($dsn, $DB_USER, $DB_PASSWORD, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
  ]);
}

/**
 * Conexao de LEITURA (somente SELECT) para as tabelas de baixo nivel
 * GN_BTC_TxMovements / GN_BCH_TxMovements, usando as mesmas credenciais
 * de baixo privilegio ja usadas pelos jobs de sync do cache Fulcrum
 * (gn_btc_sync / gn_bch_sync). Usada so para anexar o TXID aos extratos —
 * nenhuma permissao nova precisa ser concedida no SQL Server.
 * Retorna null (silenciosamente) se o arquivo de credenciais nao existir
 * ou a conexao falhar, para que os extratos continuem funcionando mesmo
 * sem essa funcionalidade extra.
 */
function syncDb(string $asset): ?PDO {
  static $conns = [];
  if (array_key_exists($asset, $conns)) return $conns[$asset];
  global $SYNC_SQL_SERVER, $SYNC_SQL_DATABASE, $SYNC_SQL_PORT, $SYNC_BTC_USER, $SYNC_BTC_PASS, $SYNC_BCH_USER, $SYNC_BCH_PASS;
  $cfgFile = __DIR__ . '/../private/sync_config.php';
  if (!file_exists($cfgFile)) { $conns[$asset] = null; return null; }
  require_once $cfgFile;
  [$user, $pass] = $asset === 'BTC' ? [$SYNC_BTC_USER, $SYNC_BTC_PASS] : [$SYNC_BCH_USER, $SYNC_BCH_PASS];
  try {
    require_once __DIR__ . '/../private/sql_dsn.php';
    $dsn = gn_sql_dsn($SYNC_SQL_SERVER, $SYNC_SQL_PORT, $SYNC_SQL_DATABASE);
    $conns[$asset] = new PDO($dsn, $user, $pass, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
  } catch (Throwable $e) {
    error_log('api.php syncDb erro (' . $asset . '): ' . $e->getMessage());
    $conns[$asset] = null;
  }
  return $conns[$asset];
}

/**
 * Anexa o campo 'tx_hash' a cada evento do extrato, casando por endereco +
 * altura do bloco com as tabelas GN_BTC_TxMovements / GN_BCH_TxMovements.
 * Quando ha mais de uma transacao no mesmo endereco/altura (raro), desempata
 * pelo delta em satoshis mais proximo do evento.
 */
function forecastDb(): ?PDO {
  static $conn = null;
  static $tried = false;
  if ($tried) return $conn;
  $tried = true;
  global $FORECAST_SQL_SERVER, $FORECAST_SQL_DATABASE, $FORECAST_SQL_PORT, $FORECAST_READER_USER, $FORECAST_READER_PASS;
  $cfgFile = __DIR__ . '/../private/forecast_config.php';
  if (!file_exists($cfgFile)) return null;
  require_once $cfgFile;
  try {
    require_once __DIR__ . '/../private/sql_dsn.php';
    $dsn = gn_sql_dsn($FORECAST_SQL_SERVER, $FORECAST_SQL_PORT, $FORECAST_SQL_DATABASE);
    $conn = new PDO($dsn, $FORECAST_READER_USER, $FORECAST_READER_PASS, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
  } catch (Throwable $e) {
    error_log('api.php forecastDb erro: ' . $e->getMessage());
    $conn = null;
  }
  return $conn;
}

function anexarTxHash(array &$events): void {
  $porAtivo = [];
  foreach ($events as $i => $ev) {
    $asset = $ev['asset'] ?? '';
    $addr  = $ev['address'] ?? '';
    $h     = $ev['block_height'] ?? null;
    if ($asset === '' || $addr === '' || $h === null) continue;
    $porAtivo[$asset][] = $i;
  }
  foreach ($porAtivo as $asset => $indices) {
    $tabela = $asset === 'BTC' ? 'dbo.GN_BTC_TxMovements' : 'dbo.GN_BCH_TxMovements';
    $pdo = syncDb($asset);
    if (!$pdo) continue;

    $enderecos = [];
    $alturas = [];
    foreach ($indices as $i) {
      $enderecos[$events[$i]['address']] = true;
      $alturas[(int)$events[$i]['block_height']] = true;
    }
    $enderecos = array_keys($enderecos);
    $alturas = array_keys($alturas);
    if (!$enderecos || !$alturas) continue;

    $phEnd = implode(',', array_fill(0, count($enderecos), '?'));
    $phAlt = implode(',', array_fill(0, count($alturas), '?'));
    $candidatos = [];
    try {
      $stmt = $pdo->prepare(
        "SELECT address, height, tx_hash, value_in_sat, value_out_sat
         FROM {$tabela}
         WHERE address IN ({$phEnd}) AND height IN ({$phAlt})"
      );
      $stmt->execute(array_merge($enderecos, $alturas));
      while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $key = $row['address'] . '|' . $row['height'];
        $candidatos[$key][] = $row;
      }
    } catch (Throwable $e) {
      error_log('api.php anexarTxHash erro (' . $asset . '): ' . $e->getMessage());
      continue;
    }

    foreach ($indices as $i) {
      $key = $events[$i]['address'] . '|' . (int)$events[$i]['block_height'];
      $lista = $candidatos[$key] ?? [];
      if (!$lista) { $events[$i]['tx_hash'] = null; continue; }
      if (count($lista) === 1) {
        $events[$i]['tx_hash'] = $lista[0]['tx_hash'];
        continue;
      }
      // Mais de uma tx no mesmo endereco/altura: desempata pelo delta em sat.
      $alvo = isset($events[$i]['delta_sat']) ? (int)$events[$i]['delta_sat'] : null;
      $melhor = $lista[0];
      if ($alvo !== null) {
        $menorDiff = null;
        foreach ($lista as $c) {
          $net = (int)$c['value_in_sat'] - (int)$c['value_out_sat'];
          $diff = abs($net - $alvo);
          if ($menorDiff === null || $diff < $menorDiff) { $menorDiff = $diff; $melhor = $c; }
        }
      }
      $events[$i]['tx_hash'] = $melhor['tx_hash'];
    }
  }
}

// --- Whitelists ---
const MOEDAS_CRYPTO = [
  'BTC'  => 'dbo.snapshots',
  'BCH'  => 'dbo.BCH_Snapshots',
  // 15/11/2026: ETH (coletor eth_sync.py no lxbch01) e stablecoins (coletor_stable.py no lxweb01).
  // As views de USDT/USDC expoem as MESMAS colunas do BCH_Snapshots (price_xxx_binance/kraken/coinbase,
  // media_exchanges_usd/brl, usd_brl), entao o resto da API trata todas iguais.
  'ETH'  => 'dbo.ETH_Snapshots',
  'USDC' => 'dbo.vw_USDC_Precos',
  'USDT' => 'dbo.vw_USDT_Precos',
];
const MOEDAS_FIAT    = ['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'TRY', 'RUB'];
// Legado (compatibilidade com codigo que ainda referencia MOEDAS / MOEDAS_EXIBICAO)
const MOEDAS         = MOEDAS_CRYPTO;
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
      'morningstar' => ($moeda === 'BTC') ? "CASE WHEN price_usd_morningstar IS NOT NULL THEN price_usd_morningstar * {$fx} ELSE NULL END" : 'NULL',
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
    'morningstar' => ($moeda !== 'BTC') ? 'NULL'
                     : (($sufixo === 'brl') ? 'price_brl_morningstar'
                     : (($sufixo === 'usd') ? 'price_usd_morningstar'
                     : "CASE WHEN price_usd_morningstar IS NOT NULL THEN price_usd_morningstar * media_exchanges_{$sufixo} / NULLIF(media_exchanges_usd,0) END")),
    'usd_ref'    => $colUsdRef,
    'fx_col'     => null,
    'fx_literal' => null,
  ];
}

/**
 * Taxa de conversao de BRL para a moeda de exibicao escolhida, usando a
 * linha mais recente de FX_Snapshots (mesma fonte que o restante da API
 * ja usa para JPY/CNY/TRY/RUB). Retorna null se a taxa nao puder ser
 * resolvida (nesse caso o chamador deve manter os valores em BRL).
 */

/**
 * Cotacao BTC/USD exibida pelo Google Finance, cuja fonte informada pelo Google
 * para criptomoedas e a Morningstar. Nao e fonte critica: se falhar, a API
 * simplesmente omite o campo morningstar e mantem as exchanges atuais.
 */
function morningstarBtcUsd(): ?float {
  $cache = __DIR__ . '/../private/logs/morningstar_btc_usd_cache.json';
  $ttl = 180; // Google Finance informa atraso de poucos minutos para cripto; evita bater a cada request.
  if (is_file($cache)) {
    $j = json_decode((string)@file_get_contents($cache), true);
    if (is_array($j) && isset($j['ts'], $j['price']) && time() - (int)$j['ts'] < $ttl && (float)$j['price'] > 0) {
      return (float)$j['price'];
    }
  }
  $url = 'https://www.google.com/finance/quote/BTC-USD?hl=en';
  $ctx = stream_context_create([
    'http' => [
      'timeout' => 4,
      'header' => "User-Agent: Mozilla/5.0 (compatible; GambleNumbers/1.0)\r\nAccept-Language: en-US,en;q=0.9\r\n",
    ],
  ]);
  $html = @file_get_contents($url, false, $ctx);
  if (!is_string($html) || $html === '') return null;
  if (!preg_match('/Bitcoin \/ United States Dollar.*?<span[^>]*>\s*([0-9][0-9,]*\.[0-9]+)\s*<\/span>/s', $html, $m)) {
    return null;
  }
  $price = (float)str_replace(',', '', $m[1]);
  if ($price <= 0) return null;
  @file_put_contents($cache, json_encode(['ts' => time(), 'price' => $price]), LOCK_EX);
  return $price;
}

function usdToDisplay(?float $usd, array $row, string $moedaExibicao): ?float {
  if ($usd === null || $usd <= 0) return null;
  if ($moedaExibicao === 'USD') return $usd;
  $col = 'usd_' . strtolower($moedaExibicao);
  if (!isset($row[$col]) || $row[$col] === null) return null;
  $rate = (float)$row[$col];
  return $rate > 0 ? $usd * $rate : null;
}

function mediaComMorningstar(?float $oldAvg, ?float $binance, ?float $kraken, ?float $coinbase, ?float $morningstar): ?float {
  $vals = [];
  foreach ([$binance, $kraken, $coinbase, $morningstar] as $v) {
    if ($v !== null && $v > 0) $vals[] = $v;
  }
  if (!$vals) return $oldAvg;
  return array_sum($vals) / count($vals);
}

function aplicarMorningstar(array &$rows, string $moeda, string $moedaExibicao): void {
  // O historico vem do banco (snapshots.price_*_morningstar, coletado a cada ciclo). Este overlay so
  // completa o ULTIMO ponto quando o banco ainda nao tem a leitura dele; nunca altera a media.
  if ($moeda !== 'BTC' || !in_array($moedaExibicao, MOEDAS_EXIBICAO, true) || !$rows) return;
  $i = count($rows) - 1;
  if (isset($rows[$i]['morningstar']) && $rows[$i]['morningstar'] !== null) return;
  $usd = morningstarBtcUsd();
  if ($usd === null) return;
  $ms = usdToDisplay($usd, $rows[$i], $moedaExibicao);
  if ($ms === null) return;
  $rows[$i]['morningstar'] = $ms;
}

function fxRateFromBrl(PDO $pdo, string $moedaExibicao): ?float {
  if ($moedaExibicao === 'BRL') return 1.0;
  $row = $pdo->query(
    "SELECT TOP 1 COALESCE(usd_brl_24h,usd_brl) AS usd_brl,COALESCE(usd_eur_24h,usd_eur) AS usd_eur,COALESCE(usd_gbp_24h,usd_gbp) AS usd_gbp,COALESCE(usd_jpy_24h,usd_jpy) AS usd_jpy,COALESCE(usd_cny_24h,usd_cny) AS usd_cny,COALESCE(usd_try_24h,usd_try) AS usd_try,COALESCE(usd_rub_24h,usd_rub) AS usd_rub FROM dbo.FX_Snapshots WHERE ok=1 ORDER BY ts_utc DESC"
  )->fetch(PDO::FETCH_ASSOC);
  if (!$row || empty($row['usd_brl'])) return null;
  $usdBrl = (float)$row['usd_brl'];
  if ($usdBrl <= 0) return null;
  if ($moedaExibicao === 'USD') return 1.0 / $usdBrl;
  $col = 'usd_' . strtolower($moedaExibicao);
  if (!isset($row[$col]) || $row[$col] === null) return null;
  $usdTarget = (float)$row[$col];
  return $usdTarget / $usdBrl;
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
    'morningstar' => $fx('price_brl_morningstar'),
    'btc_usd'  => $fx('btc_usd'),
    'usd_brl'  => $fx('usd_brl'),
    'usd_eur'  => $fx('usd_eur'),
    'usd_gbp'  => $fx('usd_gbp'),
    'usd_jpy'  => $fx('usd_jpy'),
    'usd_cny'  => $fx('usd_cny'),
    'usd_try'  => $fx('usd_try'),
    'usd_rub'  => $fx('usd_rub'),
    'fee_p50'  => $fx('fee_p50') ?? 0.0,
  ];
}

try {
  $acao = $_GET['acao'] ?? 'cotacoes';
  $moeda        = moedaSelecionada();
  $moedaExibicao = moedaExibicaoSelecionada();
  $pdo          = db();
  $tipo         = tipoPar($moeda, $moedaExibicao);


  // ── Endpoint de extratos BTC/BCH por sessão ───────────────────────────
  if ($acao === 'extratos') {
    $sessionId = (string)($_SERVER['HTTP_X_GN_SESSION'] ?? $_GET['session_id'] ?? ''); // sessao no cabecalho (fora da URL e dos logs); GET legado por enquanto
    if (!preg_match('/^[a-f0-9]{64}$/', $sessionId)) {
      http_response_code(400);
      echo json_encode(['ok'=>false,'error'=>'Sessão inválida.']);
      exit;
    }
    $stmt = $pdo->prepare("SELECT session_id FROM dbo.GN_Usuarios WHERE session_id = ?");
    $stmt->execute([$sessionId]);
    if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
      http_response_code(404);
      echo json_encode(['ok'=>false,'error'=>'Sessão não encontrada.']);
      exit;
    }
    $stmt = $pdo->prepare("SELECT asset, address, last_checked_utc, last_height, total_coin, tx_count, utxo_count, status, last_error, price_brl, price_ts_utc, value_brl FROM dbo.vw_GN_AddressStatementSummary WHERE session_id = ? ORDER BY asset");
    $stmt->execute([$sessionId]);
    $summary = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $stmt = $pdo->prepare("SELECT TOP (200) asset, address, observed_at_utc, block_height, event_type, total_coin, delta_coin, delta_sat, price_brl, value_brl, delta_value_brl, source_host FROM dbo.vw_GN_AddressStatementEvents WHERE session_id = ? ORDER BY observed_at_utc DESC, asset");
    $stmt->execute([$sessionId]);
    $events = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 16/11/2026: totais do historico COMPLETO (a tela lista so as 25 ultimas linhas; os cartoes
    // Entradas/Saidas/Atualizacoes somavam so essas 25 e ficavam errados em endereco com mais movimento)
    $stmt = $pdo->prepare("SELECT asset, SUM(CASE WHEN delta_sat > 0 THEN delta_sat ELSE 0 END) AS ent_sat,
                                  SUM(CASE WHEN delta_sat < 0 THEN -delta_sat ELSE 0 END) AS sai_sat, COUNT(*) AS n
                           FROM dbo.vw_GN_AddressStatementEvents WHERE session_id = ? GROUP BY asset");
    $stmt->execute([$sessionId]);
    $tot = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $t) $tot[$t['asset']] = $t;
    foreach ($summary as &$row) {
      $t = $tot[$row['asset']] ?? null;
      $row['entradas_coin'] = $t ? (int)$t['ent_sat'] / 1e8 : 0;
      $row['saidas_coin']   = $t ? (int)$t['sai_sat'] / 1e8 : 0;
      $row['eventos']       = $t ? (int)$t['n'] : 0;
    }
    unset($row);

    // Anexa o TXID de cada evento (via credenciais de sync, somente leitura)
    // para permitir rastreio no mempool.space (BTC) / bchmempool.cash (BCH).
    anexarTxHash($events);

    // Converte os valores monetarios (nativamente em BRL nas views) para a
    // moeda de exibicao escolhida pelo usuario (?moeda_exibicao=USD|EUR|...).
    // O front informa qual moeda foi de fato aplicada via 'moeda_exibicao'
    // na resposta, mesmo quando a taxa nao pode ser resolvida (fallback BRL).
    $moedaAplicada = 'BRL';
    $fxRate = fxRateFromBrl($pdo, $moedaExibicao);
    if ($fxRate !== null) {
      $moedaAplicada = $moedaExibicao;
      if ($fxRate != 1.0) {
        foreach ($summary as &$row) {
          foreach (['price_brl', 'value_brl'] as $k) {
            if (isset($row[$k]) && $row[$k] !== null) $row[$k] = (float)$row[$k] * $fxRate;
          }
        }
        unset($row);
        foreach ($events as &$row) {
          foreach (['price_brl', 'value_brl', 'delta_value_brl'] as $k) {
            if (isset($row[$k]) && $row[$k] !== null) $row[$k] = (float)$row[$k] * $fxRate;
          }
        }
        unset($row);
      }
    }

    echo json_encode(['ok'=>true,'session_id'=>$sessionId,'moeda_exibicao'=>$moedaAplicada,'summary'=>$summary,'events'=>$events]);
    exit;
  }

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
        'crypto_fiat'   => match($moeda) { 'BCH' => '_DEFAULT_BCH', 'ETH' => '_DEFAULT_ETH',
                                             'USDC', 'USDT' => '_DEFAULT_STABLE', default => '_DEFAULT_BTC' },
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

  // ── Endpoint de previsao estatistica (motor forecast, lsql2019) ───────
  // Linha de referencia pontilhada no grafico: NAO substitui a simulacao
  // client-side existente, e' so um traco informativo. Cobre no maximo
  // 24h a frente (horizonte validado por validacao cruzada rolling-origin).
  if ($acao === 'previsao') {
    // ETH/USDC/USDT ainda nao tem modelo de previsao: nao devolve a do BTC (escala de preco errada no grafico)
    if (in_array($moeda, ['ETH', 'USDC', 'USDT'], true)) {
      echo json_encode(['ok' => false, 'error' => 'sem previsao disponivel para ' . $moeda]);
      exit;
    }
    $ativoPrev = in_array($moeda, ['BTC', 'BCH'], true) ? $moeda : 'BTC';
    $fdb = forecastDb();
    if (!$fdb) {
      echo json_encode(['ok' => false, 'error' => 'motor de previsao indisponivel']);
      exit;
    }
    $stmt = $fdb->prepare(
      "SELECT TOP 1 r.run_id, r.ancora_t_utc, r.ancora_preco, r.gerado_em_utc,
              mc.modelo, mc.horizonte_min, mc.mape_oos
       FROM forecast.Runs r
       JOIN forecast.Model_Config mc ON mc.id = r.model_config_id
       WHERE r.ativo = ? AND mc.horizonte_min = 1440 AND mc.ativo_flag = 1   -- so' o modelo PUBLICADO (modelos em sombra nunca sao servidos)
       ORDER BY r.run_id DESC"
    );
    $stmt->execute([$ativoPrev]);
    $run = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$run) {
      echo json_encode(['ok' => false, 'error' => 'sem previsao disponivel para ' . $ativoPrev]);
      exit;
    }
    // Miolo do "sino": a faixa completa (y_lo..y_hi, nominal 80%) abre demais nas pontas. O site desenha so' o
    // MIOLO: y_hat +/- fator*(y_hi-y_hat), com o fator calibrado em forecast.Config para que a metade dos casos
    // reais (faixa_central_pct = 50) caia dentro. A faixa completa segue disponivel em avg_lo80/avg_hi80.
    $fator = 0.4; $centralPct = 50;
    try {
      $cs = $fdb->prepare("SELECT valor FROM forecast.Config WHERE chave = ?");
      $cs->execute(['faixa_central_fator_' . $ativoPrev]);
      $v = $cs->fetchColumn(); if ($v !== false && is_numeric($v) && $v > 0) $fator = (float)$v;
      $cs->execute(['faixa_central_pct']);
      $v = $cs->fetchColumn(); if ($v !== false && is_numeric($v)) $centralPct = (int)$v;
    } catch (Throwable $e) { /* usa os padroes */ }

    $stmt2 = $fdb->prepare(
      "SELECT target_t_utc, y_hat, y_lo, y_hi
       FROM forecast.Points WHERE run_id = ? ORDER BY target_t_utc ASC"
    );
    $stmt2->execute([$run['run_id']]);
    $pontos = [];
    while ($p = $stmt2->fetch(PDO::FETCH_ASSOC)) {
      $yh = (float)$p['y_hat'];
      $lo80 = $p['y_lo'] !== null ? (float)$p['y_lo'] : null;
      $hi80 = $p['y_hi'] !== null ? (float)$p['y_hi'] : null;
      $pontos[] = [
        't'        => toMs($p['target_t_utc']),
        'avg'      => $yh,
        'avg_lo'   => $lo80 !== null ? $yh - $fator * ($yh - $lo80) : null,   // miolo (mínimo)
        'avg_hi'   => $hi80 !== null ? $yh + $fator * ($hi80 - $yh) : null,   // miolo (máximo)
        'avg_lo80' => $lo80,
        'avg_hi80' => $hi80,
      ];
    }

    // CENARIO ilustrativo: a curva da Mimetagem (copia o futuro real do trecho passado que melhor se encaixou).
    // NAO e' a previsao (a previsao e' 'pontos', do modelo publicado): e' um desenho plausivel de como o preco
    // poderia se mover, igual para todos os usuarios, regenerado a cada 15 min. Modelo em sombra servido de
    // forma explicita e rotulada; se estiver velho (>45 min) ou ausente, simplesmente nao vai.
    $cenario = null;
    try {
      $cq = $fdb->prepare(
        "SELECT TOP 1 r.run_id, r.ancora_t_utc, r.ancora_preco, r.gerado_em_utc, mc.modelo
         FROM forecast.Runs r JOIN forecast.Model_Config mc ON mc.id = r.model_config_id
         WHERE r.ativo = ? AND mc.horizonte_min = 1440 AND mc.modelo = 'mimetagem_trajetoria'
           AND r.gerado_em_utc >= DATEADD(MINUTE, -45, SYSUTCDATETIME())
         ORDER BY r.run_id DESC"
      );
      $cq->execute([$ativoPrev]);
      $cr = $cq->fetch(PDO::FETCH_ASSOC);
      if ($cr) {
        $cp = $fdb->prepare("SELECT target_t_utc, y_hat FROM forecast.Points WHERE run_id = ? ORDER BY target_t_utc ASC");
        $cp->execute([$cr['run_id']]);
        $cpts = [];
        while ($q = $cp->fetch(PDO::FETCH_ASSOC)) $cpts[] = ['t' => toMs($q['target_t_utc']), 'avg' => (float)$q['y_hat']];
        if (count($cpts) > 1) {
          $cenario = [
            'modelo'        => $cr['modelo'],
            'gerado_em_utc' => $cr['gerado_em_utc'],
            'ancora'        => ['t' => toMs($cr['ancora_t_utc']), 'avg' => (float)$cr['ancora_preco']],
            'pontos'        => $cpts,
          ];
        }
      }
    } catch (Throwable $e) { $cenario = null; }

    // CURVAS ANTERIORES da Mimetagem: para o usuario ver se ela previu certo, o trecho que ja virou passado
    // continua desenhado (pontilhado) do lado da cotacao real. Para cada antecedencia (forecast.Config
    // 'cenario_passado_min', padrao 60,180,360 min), a curva gerada naquela hora, cortada no AGORA. So' curvas
    // densas (>= 100 pontos), pois as antigas tinham poucos marcos. Teste: ?lb=15,30 sobrescreve as antecedencias.
    $passado = [];
    try {
      $lbs = [60, 180, 360];
      $parse = function ($txt) {
        $v = array_values(array_unique(array_filter(array_map('intval', explode(',', (string)$txt)), function ($x) { return $x >= 5 && $x <= 1440; })));
        return array_slice($v, 0, 8);
      };
      $cv = $fdb->query("SELECT valor FROM forecast.Config WHERE chave = 'cenario_passado_min'")->fetchColumn();
      if ($cv !== false && count($parse($cv))) $lbs = $parse($cv);
      if (isset($_GET['lb']) && count($parse($_GET['lb']))) $lbs = $parse($_GET['lb']);
      sort($lbs);
      $pq = $fdb->prepare(
        "SELECT TOP 1 r.run_id, r.ancora_t_utc, r.ancora_preco
         FROM forecast.Runs r JOIN forecast.Model_Config mc ON mc.id = r.model_config_id
         WHERE r.ativo = ? AND mc.horizonte_min = 1440 AND mc.modelo = 'mimetagem_trajetoria'
           AND r.ancora_t_utc <= DATEADD(MINUTE, CAST(? AS INT), SYSUTCDATETIME())
           AND r.ancora_t_utc >= DATEADD(MINUTE, CAST(? AS INT), SYSUTCDATETIME())
           AND (SELECT COUNT(*) FROM forecast.Points p WHERE p.run_id = r.run_id) >= 100
         ORDER BY r.ancora_t_utc DESC"
      );
      $pp = $fdb->prepare("SELECT target_t_utc, y_hat FROM forecast.Points WHERE run_id = ? AND target_t_utc <= SYSUTCDATETIME() ORDER BY target_t_utc ASC");
      foreach ($lbs as $lb) {
        $pq->execute([$ativoPrev, -$lb, -($lb + 20)]);
        $pr = $pq->fetch(PDO::FETCH_ASSOC);
        if (!$pr) continue;
        $pp->execute([$pr['run_id']]);
        $pts = [];
        while ($q = $pp->fetch(PDO::FETCH_ASSOC)) $pts[] = ['t' => toMs($q['target_t_utc']), 'avg' => (float)$q['y_hat']];
        if (count($pts) > 1) $passado[] = ['lookback_min' => $lb, 'ancora' => ['t' => toMs($pr['ancora_t_utc']), 'avg' => (float)$pr['ancora_preco']], 'pontos' => $pts];
      }
    } catch (Throwable $e) { error_log('api.php cenario_passado erro: ' . $e->getMessage()); $passado = []; }

    echo json_encode([
      'ok'            => true,
      'ativo'         => $ativoPrev,
      'modelo'        => $run['modelo'],
      'mape_oos'      => $run['mape_oos'] !== null ? (float)$run['mape_oos'] : null,
      'gerado_em_utc' => $run['gerado_em_utc'],
      'ancora'        => ['t' => toMs($run['ancora_t_utc']), 'avg' => (float)$run['ancora_preco']],
      'faixa'         => ['central_pct' => $centralPct, 'fator' => $fator],
      'pontos'        => $pontos,
      'cenario'       => $cenario,
      'cenario_passado' => $passado,
    ]);
    exit;
  }

  // ── Câmbio (15/11/2026): o site é internacional e opera 24 h. Cada ponto usa o câmbio DAQUELE momento
  //    (OUTER APPLY na FX_Snapshots), preferindo a cotação 24 h (usd_xxx_24h: pares USDT em exchanges que
  //    nunca fecham) e caindo na comercial (usd_xxx) quando ela não existe (BRL antes de 07/10/2026, demais
  //    antes de 15/11/2026, CNY/RUB sem fonte 24 h confiável). Antes usava a ÚLTIMA cotação para todo o histórico.
  $FX_MOEDAS = ['brl', 'eur', 'gbp', 'jpy', 'cny', 'try', 'rub'];
  $fx24 = fn(string $m, string $p = '') => "COALESCE({$p}usd_{$m}_24h, {$p}usd_{$m})";
  $fxApply = function (string $tabela) use ($FX_MOEDAS, $fx24): string {
    $exp  = preg_replace('/^dbo\./', '', $tabela);
    $cols = implode(', ', array_map(fn($m) => $fx24($m, 'f.') . " AS fx_{$m}", $FX_MOEDAS));
    return "{$tabela} OUTER APPLY (SELECT TOP 1 {$cols} FROM dbo.FX_Snapshots f
              WHERE f.ok = 1 AND f.ts_utc <= {$exp}.ts_utc ORDER BY f.ts_utc DESC) fx";
  };
  $fxOut = implode(",\n              ", array_map(fn($m) => "fx.fx_{$m} AS usd_{$m}", ['eur', 'gbp', 'jpy', 'cny', 'try', 'rub']));

  if ($tipo === 'fiat_fiat') {
    // fiat×fiat via USD como pivô (USD = 1.0, sem coluna própria), linha a linha da própria FX_Snapshots
    $cx    = fn(string $m) => $m === 'USD' ? '1.0' : $fx24(strtolower($m));
    $colC  = $cx($moedaExibicao);
    $colA  = $cx($moeda);
    $expr  = ($moeda === 'USD') ? $colC : "({$colC} / NULLIF({$colA}, 0))";
    $usdCols = implode(', ', array_map(fn($m) => $fx24($m) . " AS usd_{$m}", $FX_MOEDAS));
    $selectCols = "ts_utc,
              {$expr} AS price_brl,
              {$expr} AS price_brl_binance,
              {$expr} AS price_brl_kraken,
              {$expr} AS price_brl_coinbase,
              {$colA} AS btc_usd,
              {$usdCols}";
    $col = [
      'tabela'    => 'dbo.FX_Snapshots',
      'avg'       => $expr,
      'filterCol' => "{$colA} IS NOT NULL AND {$colC} IS NOT NULL",
    ];

  } elseif ($tipo === 'fiat_crypto') {
    // fiat/crypto: quanto de crypto 1 unidade do fiat compra. BRL = inverso exato do gráfico crypto/BRL
    // (mesmas colunas gravadas pelo coletor); USD = inverso do preço em USD; demais = USD × câmbio do momento.
    $tblCrypto = MOEDAS_CRYPTO[$moedaExibicao];
    if ($moeda === 'BRL') {
      $base = ['media_exchanges_brl', 'price_brl_binance', 'price_brl_kraken', 'price_brl_coinbase']; $mult = '';
    } else {
      $base = ['media_exchanges_usd', 'price_usd_binance', 'price_usd_kraken', 'price_usd_coinbase'];
      $mult = ($moeda === 'USD') ? '' : ' * fx.fx_' . strtolower($moeda);
    }
    $inv = array_map(fn($c) => "CASE WHEN {$c} IS NOT NULL THEN 1.0 / NULLIF({$c}{$mult}, 0) END", $base);
    $expr = "(1.0 / NULLIF({$base[0]}{$mult}, 0))";
    $selectCols = "ts_utc,
              {$expr}   AS price_brl,
              {$inv[1]} AS price_brl_binance,
              {$inv[2]} AS price_brl_kraken,
              {$inv[3]} AS price_brl_coinbase,
              media_exchanges_usd AS btc_usd,
              usd_brl,
              {$fxOut}";
    $col = [
      'tabela'    => $fxApply($tblCrypto),
      'avg'       => $expr,
      'filterCol' => "{$base[0]} IS NOT NULL" . ($mult !== '' ? ' AND fx.fx_' . strtolower($moeda) . ' IS NOT NULL' : ''),
    ];

  } else {
    // crypto_fiat. BRL e USD: colunas gravadas pelo coletor (o BRL já usa o dólar 24 h).
    // Demais moedas (EUR, GBP, JPY, CNY, TRY, RUB): preço em USD × câmbio do momento.
    $tabelaC = MOEDAS_CRYPTO[$moeda];
    if (in_array($moedaExibicao, ['BRL', 'USD'], true)) {
      $col = colunas($moeda, $moedaExibicao);
    } else {
      $fxc = 'fx.fx_' . strtolower($moedaExibicao);
      $mx  = fn(string $c) => "CASE WHEN {$c} IS NOT NULL THEN {$c} * {$fxc} END";
      $col = [
        'avg'         => "media_exchanges_usd * {$fxc}",
        'binance'     => $mx('price_usd_binance'),
        'kraken'      => $mx('price_usd_kraken'),
        'coinbase'    => $mx('price_usd_coinbase'),
        'morningstar' => ($moeda === 'BTC') ? $mx('price_usd_morningstar') : 'NULL',
        'usd_ref'     => 'media_exchanges_usd',
      ];
    }
    $col['tabela'] = $fxApply($tabelaC);
    $selectCols = "ts_utc,
              {$col['avg']}      AS price_brl,
              {$col['binance']}  AS price_brl_binance,
              {$col['kraken']}   AS price_brl_kraken,
              {$col['coinbase']} AS price_brl_coinbase,
              {$col['morningstar']} AS price_brl_morningstar,
              {$col['usd_ref']}  AS btc_usd,
              usd_brl,
              {$fxOut}";
    $col['filterCol'] = "{$col['avg']} IS NOT NULL";
  }
  // ── Taxa de rede (fee_p50): BTC usa est_6_satvb nativo, BCH usa 1 sat/byte, outros 0 ────
  if ($tipo === 'crypto_fiat' && $moeda === 'BTC') {
    $selectCols .= ",\n              ISNULL(est_6_satvb, 1.0) AS fee_p50";
  } elseif ($tipo === 'crypto_fiat' && $moeda === 'ETH') {
    // ETH: preco do gas em gwei (o site multiplica por 21.000 gas / 1e9); historico sem gas = 0,25 gwei
    $selectCols .= ",\n              ISNULL(gas_price_gwei, 0.25) AS fee_p50";
  } elseif ($tipo === 'crypto_fiat' && in_array($moeda, ['USDC', 'USDT'], true)) {
    // USDC/USDT (ERC-20): gas x preco do ETH / preco da stable (o site multiplica por 65.000 gas / 1e9)
    $selectCols .= ",\n              ISNULL(fee_p50_eq, 0.25) AS fee_p50";
  } elseif ($tipo === 'crypto_fiat') {  // BCH ou outros crypto
    $selectCols .= ",\n              1.0 AS fee_p50";
  } else {
    $selectCols .= ",\n              0.0 AS fee_p50";
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
    $data = [mapRow($row)];
    aplicarMorningstar($data, $moeda, $moedaExibicao);
    echo json_encode(['ok'=>true,'moeda'=>$moeda,'moeda_exibicao'=>$moedaExibicao,'data'=>$data[0]]);
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
      // todas as consultas (menos crypto×crypto) devolvem as 7 taxas do momento; crypto×fiat também o Morningstar
      $baseCols = "ts_utc, price_brl, price_brl_binance, price_brl_kraken, price_brl_coinbase, btc_usd, usd_brl, usd_eur, usd_gbp, usd_jpy, usd_cny, usd_try, usd_rub";
      if ($tipo === 'crypto_fiat') $baseCols .= ", price_brl_morningstar";
      $baseCols .= ', fee_p50';  // taxa de rede (presente em todos os pares)
      $fxAlias = $baseCols;
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
    aplicarMorningstar($out, $moeda, $moedaExibicao);
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
  aplicarMorningstar($out, $moeda, $moedaExibicao);

  echo json_encode(['ok'=>true,'moeda'=>$moeda,'moeda_exibicao'=>$moedaExibicao,'count'=>count($out),'data'=>$out]);

} catch (Throwable $e) {
  http_response_code(500);
  error_log('api.php erro: ' . $e->getMessage());
  echo json_encode(['ok'=>false,'error'=>'Falha ao consultar o banco.']);
}
