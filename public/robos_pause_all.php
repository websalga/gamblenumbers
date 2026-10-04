<?php
/* ============================================================
 * robos_pause_all.php — botão de emergência: pausa (desativa)
 * TODOS os robôs (Autômatos) da sessão de uma só vez.
 *
 * Body esperado (POST JSON):
 *   { session_id: string (64 hex) }
 *
 * Não apaga nada, apenas zera o campo "ativo" — as configurações
 * dos robôs continuam intactas e podem ser reativadas depois.
 * Também cancela qualquer execução já enfileirada (GN_RoboFila,
 * status 'AG') desses robôs, pra não disparar uma operação logo
 * depois do usuário ter apertado o botão de emergência.
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

$sid = trim((string)($body['session_id'] ?? ''));

if (strlen($sid) !== 64 || !ctype_xdigit($sid)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'parametros invalidos']);
    exit;
}

try {
    $pdo = db();
    // historico de parametros (GN_RoboParametrosLog): informa ao trigger que a alteracao veio do usuario
    $pdo->exec("EXEC sys.sp_set_session_context N'origem', N'usuario'");
    $st = $pdo->prepare(
        'UPDATE dbo.GN_Robos SET ativo = 0, proxima_execucao = NULL, atualizado_em = SYSUTCDATETIME() ' .
        'WHERE session_id = ? AND ativo = 1'
    );
    $st->execute([$sid]);
    $pausados = $st->rowCount();

    $stCancel = $pdo->prepare(
        "UPDATE f SET f.status = 'ER', f.data_execucao = SYSUTCDATETIME(),
                f.erro_msg = 'cancelado: robo pausado pelo usuario (pausar todos)'
         FROM dbo.GN_RoboFila f
         JOIN dbo.GN_Robos r ON r.id = f.robo_id
         WHERE r.session_id = ? AND f.status = 'AG'"
    );
    $stCancel->execute([$sid]);

    echo json_encode(['ok' => true, 'pausados' => $pausados]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
