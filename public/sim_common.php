<?php
/* ============================================================
 * sim_common.php — funcoes compartilhadas por sim_sync.php (escrita) e sim_load.php (leitura)
 * das operacoes simuladas (lotes e vendas) espelhadas no SQL Server.
 *
 * O SQL Server e' a FONTE DE VERDADE: toda acao do usuario chega aqui na mesma acao, e os robos
 * (GN_RoboComprar / GN_RoboVender) mexem nas mesmas linhas. Cada linha tem:
 *   versao   +1 a cada mudanca (navegador ou robo): permite detectar edicao concorrente
 *   excluido exclusao LOGICA (preserva o historico; leituras e robos ignoram)
 *   oculto   o "olhinho" da tela
 * ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/../private/config.php';

const SIM_LOTE_COLS  = 'lote_client_id, seq, moeda_exib, preco, valor, qtd, restante, vendido, realizado, status,
                        fee_valor, feerate, time_cliente_ms, oculto, excluido, versao';
const SIM_VENDA_COLS = 'venda_client_id, seq, moeda_exib, mark_time_ms, mark_price, qtd, reservado, status, exec_price,
                        exec_time_ms, fee_valor, feerate, pnl, valor_liquido, retorno_pct, oculto, excluido, versao';

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

/* mesmo formato que operations.js espera em memoria (+ hidden e _v) */
function sim_fmt_lote(array $r): array {
    return [
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
        'hidden'    => (bool)$r['oculto'],
        '_v'        => (int)$r['versao'],
    ];
}

function sim_fmt_venda(array $r): array {
    return [
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
        'hidden'    => (bool)$r['oculto'],
        '_v'        => (int)$r['versao'],
    ];
}

/* maior sequencial JA USADO na sessao/moeda, incluindo excluidos: o navegador nunca reaproveita um id */
function sim_seq_max(PDO $pdo, string $sid, string $moeda): array {
    $l = $pdo->prepare('SELECT ISNULL(MAX(seq),0) FROM dbo.GN_SimLotes WHERE session_id = ? AND moeda = ?');
    $l->execute([$sid, $moeda]);
    $v = $pdo->prepare('SELECT ISNULL(MAX(seq),0) FROM dbo.GN_SimVendas WHERE session_id = ? AND moeda = ?');
    $v->execute([$sid, $moeda]);
    return ['lot' => (int)$l->fetchColumn(), 'sell' => (int)$v->fetchColumn()];
}

function sim_id_valido($id): bool {
    return is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,20}$/', $id) === 1;
}
