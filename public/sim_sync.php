<?php
/* ============================================================
 * sim_sync.php — espelho evento-a-evento das operações do simulador
 * (compra/venda) do navegador para o SQL Server.
 *
 * NÃO decide nada sozinho: só grava o que o navegador já decidiu.
 * Recebe exatamente o par (reason, subject) que operations.js já
 * produz internamente em cada `_changed(reason, subject)` — nenhuma
 * lógica de negócio nova, só serialização.
 *
 * Body esperado (POST JSON):
 *   {
 *     session_id: string (64 hex),
 *     moeda: 'BTC'|'BCH',
 *     moeda_exib: string,
 *     reason: string,      // 'buy' | 'sell:scheduled' | 'sell:cancelled' |
 *                           // 'sell:executed' | 'sell:expired' |
 *                           // 'lot:deleted' | 'sell:deleted' | ...
 *     subject: object,     // o lot ou sell inteiro, como está em memória
 *   }
 *
 * Sempre responde rápido e nunca lança erro pro navegador tratar —
 * isso roda via sendBeacon/fetch(keepalive), sem UI esperando resposta.
 * Falha aqui não pode, de jeito nenhum, incomodar quem está operando
 * no gráfico.
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/../private/config.php';

const SYNC_LOG_FILE = __DIR__ . '/../private/logs/sim_sync_erros.log';
function log_erro(string $etapa, array $dados = []): void {
    $linha = json_encode(['ts'=>date('c'), 'etapa'=>$etapa, 'dados'=>$dados], JSON_UNESCAPED_SLASHES);
    @file_put_contents(SYNC_LOG_FILE, $linha . "\n", FILE_APPEND | LOCK_EX);
}

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

function client_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP','HTTP_X_REAL_IP','HTTP_X_FORWARDED_FOR','REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) return trim(explode(',', $_SERVER[$k])[0]);
    }
    return '0.0.0.0';
}

/* --- validação mínima (não é auditoria de negócio, é higiene de payload) --- */
function validar_numero($v): ?float {
    if ($v === null || $v === '') return null;
    if (!is_numeric($v)) return null;
    return (float)$v;
}

/* --- upsert de um lote (reason='buy') --- */
function upsertLote(PDO $pdo, string $sid, string $moeda, string $moedaExib, array $s): void {
    $clientId = trim((string)($s['id'] ?? ''));
    $seq      = (int)($s['seq'] ?? 0);
    if ($clientId === '' || $seq <= 0) throw new InvalidArgumentException('lote sem id/seq');

    $params = [
        ':session_id'      => $sid,
        ':moeda'           => $moeda,
        ':lote_client_id'  => $clientId,
        ':seq'             => $seq,
        ':moeda_exib'      => $s['moedaExib'] ?? $moedaExib,
        ':preco'           => validar_numero($s['price'] ?? null) ?? 0,
        ':valor'           => validar_numero($s['brl'] ?? null) ?? 0,
        ':qtd'             => validar_numero($s['qty'] ?? null) ?? 0,
        ':restante'        => validar_numero($s['remaining'] ?? null) ?? 0,
        ':vendido'         => validar_numero($s['sold'] ?? null) ?? 0,
        ':realizado'       => validar_numero($s['realized'] ?? null) ?? 0,
        ':status'          => in_array($s['status'] ?? '', ['open','closed'], true) ? $s['status'] : 'open',
        ':fee_valor'       => validar_numero($s['fee_brl'] ?? null),
        ':feerate'         => validar_numero($s['feerate'] ?? null),
        ':time_cliente_ms' => (int)($s['time'] ?? 0),
    ];

    $st = $pdo->prepare('SELECT id FROM dbo.GN_SimLotes WHERE session_id=:session_id AND moeda=:moeda AND lote_client_id=:lote_client_id');
    $st->execute([':session_id'=>$sid, ':moeda'=>$moeda, ':lote_client_id'=>$clientId]);
    $existe = $st->fetch();

    if ($existe) {
        $pdo->prepare('UPDATE dbo.GN_SimLotes SET
                seq=:seq, moeda_exib=:moeda_exib, preco=:preco, valor=:valor, qtd=:qtd,
                restante=:restante, vendido=:vendido, realizado=:realizado, status=:status,
                fee_valor=:fee_valor, feerate=:feerate, time_cliente_ms=:time_cliente_ms,
                atualizado_em=SYSUTCDATETIME()
            WHERE session_id=:session_id AND moeda=:moeda AND lote_client_id=:lote_client_id')
            ->execute($params);
    } else {
        $pdo->prepare('INSERT INTO dbo.GN_SimLotes
                (session_id, moeda, lote_client_id, seq, moeda_exib, preco, valor, qtd,
                 restante, vendido, realizado, status, fee_valor, feerate, time_cliente_ms)
            VALUES
                (:session_id, :moeda, :lote_client_id, :seq, :moeda_exib, :preco, :valor, :qtd,
                 :restante, :vendido, :realizado, :status, :fee_valor, :feerate, :time_cliente_ms)')
            ->execute($params);
    }
}

/* --- upsert de uma venda (reason começa com 'sell') --- */
function upsertVenda(PDO $pdo, string $sid, string $moeda, string $moedaExib, array $s): void {
    $clientId = trim((string)($s['id'] ?? ''));
    $seq      = (int)($s['seq'] ?? 0);
    if ($clientId === '' || $seq <= 0) throw new InvalidArgumentException('venda sem id/seq');

    $status = $s['status'] ?? 'pending';
    if (!in_array($status, ['pending','executed','cancelled','expired'], true)) $status = 'pending';

    $params = [
        ':session_id'       => $sid,
        ':moeda'            => $moeda,
        ':venda_client_id'  => $clientId,
        ':seq'              => $seq,
        ':moeda_exib'       => $s['moedaExib'] ?? $moedaExib,
        ':mark_time_ms'     => (int)($s['markTime'] ?? 0),
        ':mark_price'       => validar_numero($s['markPrice'] ?? null) ?? 0,
        ':qtd'              => validar_numero($s['qty'] ?? null) ?? 0,
        ':reservado'        => validar_numero($s['reserved'] ?? null) ?? 0,
        ':status'           => $status,
        ':exec_price'       => validar_numero($s['execPrice'] ?? null),
        ':exec_time_ms'     => isset($s['execTime']) ? (int)$s['execTime'] : null,
        ':fee_valor'        => validar_numero($s['fee_brl'] ?? null),
        ':feerate'          => validar_numero($s['feerate'] ?? null),
        ':pnl'              => validar_numero($s['_pnl'] ?? null),
        ':valor_liquido'    => validar_numero($s['_value'] ?? null),
        ':retorno_pct'      => validar_numero($s['_ret'] ?? null),
    ];

    $st = $pdo->prepare('SELECT id FROM dbo.GN_SimVendas WHERE session_id=:session_id AND moeda=:moeda AND venda_client_id=:venda_client_id');
    $st->execute([':session_id'=>$sid, ':moeda'=>$moeda, ':venda_client_id'=>$clientId]);
    $existe = $st->fetch();

    if ($existe) {
        $pdo->prepare('UPDATE dbo.GN_SimVendas SET
                seq=:seq, moeda_exib=:moeda_exib, mark_time_ms=:mark_time_ms, mark_price=:mark_price,
                qtd=:qtd, reservado=:reservado, status=:status, exec_price=:exec_price,
                exec_time_ms=:exec_time_ms, fee_valor=:fee_valor, feerate=:feerate, pnl=:pnl,
                valor_liquido=:valor_liquido, retorno_pct=:retorno_pct, atualizado_em=SYSUTCDATETIME()
            WHERE session_id=:session_id AND moeda=:moeda AND venda_client_id=:venda_client_id')
            ->execute($params);
    } else {
        $pdo->prepare('INSERT INTO dbo.GN_SimVendas
                (session_id, moeda, venda_client_id, seq, moeda_exib, mark_time_ms, mark_price,
                 qtd, reservado, status, exec_price, exec_time_ms, fee_valor, feerate, pnl,
                 valor_liquido, retorno_pct)
            VALUES
                (:session_id, :moeda, :venda_client_id, :seq, :moeda_exib, :mark_time_ms, :mark_price,
                 :qtd, :reservado, :status, :exec_price, :exec_time_ms, :fee_valor, :feerate, :pnl,
                 :valor_liquido, :retorno_pct)')
            ->execute($params);
    }
}

/* ============================================================
 * Entrada
 * ============================================================ */
$raw  = file_get_contents('php://input');
$body = json_decode($raw, true) ?: [];

$sid       = trim((string)($body['session_id'] ?? ''));
$moeda     = strtoupper(trim((string)($body['moeda'] ?? '')));
$moedaExib = strtoupper(trim((string)($body['moeda_exib'] ?? 'BRL')));
$reason    = trim((string)($body['reason'] ?? ''));
$subject   = $body['subject'] ?? null;

if (strlen($sid) !== 64 || !in_array($moeda, ['BTC','BCH'], true) || $reason === '' || !is_array($subject)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'payload inválido']);
    exit;
}

try {
    $pdo = db();

    $pdo->prepare('INSERT INTO dbo.GN_SimSyncLog (session_id, moeda, reason, payload, ip)
        VALUES (?,?,?,?,?)')
        ->execute([$sid, $moeda, $reason, $raw, client_ip()]);

    if ($reason === 'buy') {
        upsertLote($pdo, $sid, $moeda, $moedaExib, $subject);
    } elseif (str_starts_with($reason, 'sell')) {
        upsertVenda($pdo, $sid, $moeda, $moedaExib, $subject);
    }

    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    log_erro('sim_sync:excecao', [
        'reason' => $reason, 'session_id' => $sid, 'mensagem' => $e->getMessage(),
    ]);
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
