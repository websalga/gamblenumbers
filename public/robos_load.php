<?php
/* ============================================================
 * robos_load.php — lista os robôs (Autômatos) configurados pela
 * sessão. Só leitura; nenhuma lógica de decisão de compra/venda
 * mora aqui -- isso é o motor do robô em si (fila + GN_RoboOrquestrador).
 *
 * GET params:
 *   session_id (obrigatório, 64 hex)
 *
 * Resposta:
 *   { ok: true, robos: [ { id, apelido, moeda, valor_operacao,
 *       retorno_desejado_pct, limite_perda_diaria_pct, ativo,
 *       taxasReais, quedaCrashPct, criado_em } ] }
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/../private/config.php';

const QUEDA_CRASH_PCT_PADRAO = 23.0;

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

function configDecode(?string $configJson): array {
    if ($configJson === null) return [];
    $j = json_decode($configJson, true);
    return is_array($j) ? $j : [];
}

function taxasReaisDeConfig(?string $configJson): bool {
    $j = configDecode($configJson);
    return array_key_exists('taxas_reais', $j) ? (bool)$j['taxas_reais'] : true;
}

function quedaCrashPctDeConfig(?string $configJson): float {
    $j = configDecode($configJson);
    return array_key_exists('queda_crash_pct', $j) ? (float)$j['queda_crash_pct'] : QUEDA_CRASH_PCT_PADRAO;
}

$sid = trim((string)($_GET['session_id'] ?? ''));

if (strlen($sid) !== 64 || !ctype_xdigit($sid)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'parametros invalidos']);
    exit;
}

try {
    $pdo = db();

    $st = $pdo->prepare('SELECT robo_client_id, seq, apelido, moeda, valor_operacao,
            retorno_desejado_pct, limite_perda_diaria_pct, ativo, config_json, criado_em, atualizado_em
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
            'taxasReais'             => taxasReaisDeConfig($r['config_json']),
            'quedaCrashPct'          => quedaCrashPctDeConfig($r['config_json']),
            'criadoEm'               => $r['criado_em'],
            'atualizadoEm'           => $r['atualizado_em'],
        ];
    }

    echo json_encode(['ok' => true, 'robos' => $robos]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
