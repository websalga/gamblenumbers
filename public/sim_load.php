<?php
/* ============================================================
 * sim_load.php — leitura das operações simuladas (compra/venda)
 * espelhadas no SQL Server, para reconstruir no gráfico o que já
 * está gravado no banco mas ainda não existe no IndexedDB local
 * (por exemplo, um INSERT manual feito direto no banco, ou uma
 * operação sincronizada de outro navegador/aparelho).
 *
 * NÃO decide nada, NÃO grava nada — é o espelho de leitura do que
 * o sim_sync.php grava. Só SELECT.
 *
 * GET params:
 *   session_id (obrigatório, 64 hex)
 *   moeda      (obrigatório, 'BTC'|'BCH')
 *
 * Resposta:
 *   { ok: true, lots: [...], sells: [...] }
 *   cada item já no formato que operations.js espera em memória
 *   (mesmos nomes de campo usados por doBuy()/scheduleSell()/executeSell()).
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/../private/config.php';

function db(): PDO {
    global $DB_SERVER, $DB_DATABASE, $DB_USER, $DB_PASSWORD, $DB_PORT;
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn = "sqlsrv:Server={$DB_SERVER},{$DB_PORT};Database={$DB_DATABASE};Encrypt=no";
    $pdo = new PDO($dsn, $DB_USER, $DB_PASSWORD, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function num($v) { return $v === null ? null : (float)$v; }

$sid   = trim((string)($_GET['session_id'] ?? ''));
$moeda = strtoupper(trim((string)($_GET['moeda'] ?? '')));

if (strlen($sid) !== 64 || !ctype_xdigit($sid) || !in_array($moeda, ['BTC', 'BCH'], true)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'parametros invalidos']);
    exit;
}

try {
    $pdo = db();

    $stLotes = $pdo->prepare('SELECT lote_client_id, seq, moeda_exib, preco, valor, qtd, restante, vendido,
            realizado, status, fee_valor, feerate, time_cliente_ms
        FROM dbo.GN_SimLotes
        WHERE session_id = ? AND moeda = ?
        ORDER BY seq ASC');
    $stLotes->execute([$sid, $moeda]);

    $lots = [];
    foreach ($stLotes->fetchAll() as $r) {
        $lots[] = [
            'id'        => $r['lote_client_id'],
            'seq'       => (int)$r['seq'],
            'moedaExib' => $r['moeda_exib'],
            'time'      => (int)$r['time_cliente_ms'],
            'price'     => num($r['preco']),
            'brl'       => num($r['valor']),
            'qty'       => num($r['qtd']),
            'remaining' => num($r['restante']),
            'sold'      => num($r['vendido']),
            'realized'  => num($r['realizado']),
            'status'    => $r['status'],
            'fee_brl'   => num($r['fee_valor']),
            'feerate'   => num($r['feerate']),
        ];
    }

    $stVendas = $pdo->prepare('SELECT venda_client_id, seq, moeda_exib, mark_time_ms, mark_price, qtd, reservado,
            status, exec_price, exec_time_ms, fee_valor, feerate, pnl, valor_liquido, retorno_pct
        FROM dbo.GN_SimVendas
        WHERE session_id = ? AND moeda = ?
        ORDER BY seq ASC');
    $stVendas->execute([$sid, $moeda]);

    $sells = [];
    foreach ($stVendas->fetchAll() as $r) {
        $sells[] = [
            'id'        => $r['venda_client_id'],
            'seq'       => (int)$r['seq'],
            'moedaExib' => $r['moeda_exib'],
            'markTime'  => (int)$r['mark_time_ms'],
            'markPrice' => num($r['mark_price']),
            'qty'       => num($r['qtd']),
            'reserved'  => num($r['reservado']),
            'status'    => $r['status'],
            'execPrice' => num($r['exec_price']),
            'execTime'  => $r['exec_time_ms'] !== null ? (int)$r['exec_time_ms'] : null,
            'fee_brl'   => num($r['fee_valor']),
            'feerate'   => num($r['feerate']),
            '_pnl'      => num($r['pnl']),
            '_profit'   => num($r['pnl']),
            '_value'    => num($r['valor_liquido']),
            '_ret'      => num($r['retorno_pct']),
        ];
    }

    echo json_encode(['ok' => true, 'lots' => $lots, 'sells' => $sells]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
