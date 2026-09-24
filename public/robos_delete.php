<?php
/* ============================================================
 * robos_delete.php — apaga um robô (Autômato) da configuração da
 * sessão. Não mexe em nenhuma operação (GN_SimLotes/GN_SimVendas)
 * que o robô já tenha gerado no passado — isso fica preservado.
 *
 * Body esperado (POST JSON):
 *   { session_id: string (64 hex), robo_id: string }
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

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];

$sid    = trim((string)($body['session_id'] ?? ''));
$roboId = trim((string)($body['robo_id'] ?? ''));

if (strlen($sid) !== 64 || !ctype_xdigit($sid) || $roboId === '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'parametros invalidos']);
    exit;
}

try {
    $pdo = db();
    $st = $pdo->prepare('DELETE FROM dbo.GN_Robos WHERE session_id = ? AND robo_client_id = ?');
    $st->execute([$sid, $roboId]);
    if ($st->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'robo nao encontrado']);
        exit;
    }
    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
