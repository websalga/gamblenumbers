<?php
/* ============================================================
 * robos_load.php — lista os robôs (Autômatos) configurados pela
 * sessão. Só leitura; nenhuma lógica de decisão de compra/venda
 * mora aqui — isso é o motor do robô em si, ainda não implementado.
 *
 * GET params:
 *   session_id (obrigatório, 64 hex)
 *
 * Resposta:
 *   { ok: true, robos: [ { id, apelido, moeda, valor_operacao,
 *       retorno_desejado_pct, limite_perda_diaria_pct, ativo,
 *       criado_em } ] }
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

$sid = trim((string)($_GET['session_id'] ?? ''));

if (strlen($sid) !== 64 || !ctype_xdigit($sid)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'parametros invalidos']);
    exit;
}

try {
    $pdo = db();

    $st = $pdo->prepare('SELECT robo_client_id, seq, apelido, moeda, valor_operacao,
            retorno_desejado_pct, limite_perda_diaria_pct, ativo, criado_em, atualizado_em
        FROM dbo.GN_Robos
        WHERE session_id = ?
        ORDER BY seq ASC');
    $st->execute([$sid]);

    $robos = [];
    foreach ($st->fetchAll() as $r) {
        $robos[] = [
            'id'                     => $r['robo_client_id'],
            'seq'                    => (int)$r['seq'],
            'apelido'                => $r['apelido'],
            'moeda'                  => $r['moeda'],
            'valorOperacao'          => num($r['valor_operacao']),
            'retornoDesejadoPct'     => num($r['retorno_desejado_pct']),
            'limitePerdaDiariaPct'   => num($r['limite_perda_diaria_pct']),
            'ativo'                  => (bool)$r['ativo'],
            'criadoEm'               => $r['criado_em'],
            'atualizadoEm'           => $r['atualizado_em'],
        ];
    }

    echo json_encode(['ok' => true, 'robos' => $robos]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
