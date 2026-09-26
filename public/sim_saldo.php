<?php
/* ============================================================
 * sim_saldo.php — saldo virtual da sessão no SQL Server (dbo.GN_SimSaldo).
 *
 * O "Saldo virtual disponível" da tela passa a existir também no banco,
 * por session_id, para os robôs de compra e venda enxergarem e movimentarem
 * (GN_RoboComprar / GN_RoboVender) e para a tela refletir o que eles fizeram.
 * Valor sempre em BRL (a tela converte da/para a moeda de exibição).
 *
 * GET  ?session_id=<64 hex>
 *      -> { ok, existe, saldo_brl, versao, origem, atualizado_em }
 *
 * POST JSON { session_id, evento, saldo_brl, delta_brl?, origem?, ref? }
 *      evento 'set'   : grava saldo_brl como valor absoluto (edição manual,
 *                       refresh do saldo real, conversão de moeda, 1ª gravação)
 *      evento 'delta' : aplica delta_brl (compra<0, venda>0) de forma atômica
 *                       sobre o que já está no banco; saldo_brl (resultado que
 *                       a tela calculou) só é usado se a sessão ainda não
 *                       tem saldo gravado.
 *      -> { ok, saldo_brl, versao }   (o valor efetivo, já com o que os robôs
 *                       tenham movimentado)
 *
 * Nunca decide regra de negócio: só grava/lê. Falhas não podem atrapalhar
 * quem está operando na tela (o navegador segue funcionando sozinho).
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

require_once __DIR__ . '/../private/config.php';

const SALDO_LOG_FILE = __DIR__ . '/../private/logs/sim_saldo_erros.log';
function log_erro(string $etapa, array $dados = []): void {
    $linha = json_encode(['ts'=>date('c'), 'etapa'=>$etapa, 'dados'=>$dados], JSON_UNESCAPED_SLASHES);
    @file_put_contents(SALDO_LOG_FILE, $linha . "\n", FILE_APPEND | LOCK_EX);
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

function fail(int $code, string $msg): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}

/* número finito >= 0 (ou null se inválido) */
function num_ou_null($v): ?float {
    if ($v === null || $v === '' || !is_numeric($v)) return null;
    $f = (float)$v;
    return is_finite($f) ? $f : null;
}

$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    /* ---------------- leitura ---------------- */
    if ($metodo === 'GET') {
        $sid = trim((string)($_GET['session_id'] ?? ''));
        if (strlen($sid) !== 64 || !ctype_xdigit($sid)) fail(400, 'session_id invalido');

        $st = db()->prepare('SELECT saldo_brl, versao, origem, atualizado_em FROM dbo.GN_SimSaldo WHERE session_id = ?');
        $st->execute([$sid]);
        $r = $st->fetch();
        if (!$r) { echo json_encode(['ok' => true, 'existe' => false]); exit; }
        echo json_encode([
            'ok' => true, 'existe' => true,
            'saldo_brl' => (float)$r['saldo_brl'], 'versao' => (int)$r['versao'],
            'origem' => $r['origem'], 'atualizado_em' => $r['atualizado_em'],
        ]);
        exit;
    }

    /* ---------------- gravação ---------------- */
    if ($metodo !== 'POST') fail(405, 'metodo nao permitido');

    $body = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($body)) fail(400, 'payload invalido');

    $sid    = trim((string)($body['session_id'] ?? ''));
    $evento = (string)($body['evento'] ?? '');
    $saldo  = num_ou_null($body['saldo_brl'] ?? null);
    $delta  = num_ou_null($body['delta_brl'] ?? null);
    $origem = in_array($body['origem'] ?? '', ['front', 'identity', 'manual'], true) ? $body['origem'] : 'front';
    $ref    = substr(trim((string)($body['ref'] ?? '')), 0, 40);
    if ($ref === '') $ref = null;

    if (strlen($sid) !== 64 || !ctype_xdigit($sid)) fail(400, 'session_id invalido');
    if ($saldo === null || $saldo < 0)              fail(400, 'saldo_brl invalido');
    if ($evento === 'delta' && $delta === null)     fail(400, 'delta_brl invalido');
    if (!in_array($evento, ['set', 'delta'], true)) fail(400, 'evento invalido');

    $pdo = db();
    if ($evento === 'set') {
        $st = $pdo->prepare('DECLARE @sd DECIMAL(18,2), @v BIGINT;
            EXEC dbo.GN_SaldoDefinir @session_id = ?, @saldo_brl = ?, @origem = ?, @ref = ?,
                 @saldo_depois = @sd OUTPUT, @versao = @v OUTPUT;
            SELECT @sd AS saldo_brl, @v AS versao;');
        $st->execute([$sid, sprintf('%.2f', $saldo), $origem, $ref]);
    } else {
        $st = $pdo->prepare('DECLARE @sd DECIMAL(18,2), @v BIGINT;
            EXEC dbo.GN_SaldoAjustar @session_id = ?, @delta_brl = ?, @origem = ?, @ref = ?,
                 @permitir_zerar = 1, @saldo_inicial_brl = ?,
                 @saldo_depois = @sd OUTPUT, @versao = @v OUTPUT;
            SELECT @sd AS saldo_brl, @v AS versao;');
        $st->execute([$sid, sprintf('%.2f', $delta), $origem, $ref, sprintf('%.2f', $saldo)]);
    }

    $r = null;
    do { if ($st->columnCount() > 0) { $r = $st->fetch(); if ($r) break; } } while ($st->nextRowset());
    if (!$r) throw new RuntimeException('procedure nao retornou o saldo');

    echo json_encode(['ok' => true, 'saldo_brl' => (float)$r['saldo_brl'], 'versao' => (int)$r['versao']]);
} catch (Throwable $e) {
    log_erro('sim_saldo:excecao', ['metodo' => $metodo, 'mensagem' => $e->getMessage()]);
    fail(500, 'erro ao acessar o saldo');
}
