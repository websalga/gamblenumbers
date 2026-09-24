<?php
/* ============================================================
 * robos_save.php — cria ou atualiza um robô (Autômato) configurado
 * pela sessão. Só grava a CONFIGURAÇÃO do robô (apelido, moeda,
 * valor por operação, retorno desejado, ativo/inativo) — a
 * inteligência de decisão de compra/venda do robô é um motor à
 * parte, ainda não implementado; este endpoint não decide nada.
 *
 * O limite de perda diária (10%) é fixo por decisão de produto e
 * nunca é aceito do cliente — sempre gravado como 10.
 *
 * Body esperado (POST JSON):
 *   {
 *     session_id: string (64 hex),
 *     robo_id: string | null,   // vazio/ausente = criar novo robô
 *     apelido: string,
 *     moeda: 'BTC'|'BCH',
 *     valor_operacao: number,
 *     retorno_desejado_pct: number,
 *     ativo: boolean,
 *   }
 *
 * Resposta:
 *   { ok: true, robo: {...} }  (mesmo formato de robos_load.php)
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/../private/config.php';

const ROBOS_MAX_POR_SESSAO = 5;
const LIMITE_PERDA_DIARIA_PCT_FIXO = 10;

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

function erro(int $status, string $msg): void {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];

$sid          = trim((string)($body['session_id'] ?? ''));
$roboId       = trim((string)($body['robo_id'] ?? ''));
$apelido      = trim((string)($body['apelido'] ?? ''));
$moeda        = strtoupper(trim((string)($body['moeda'] ?? '')));
$valorOp      = $body['valor_operacao'] ?? null;
$retornoPct   = $body['retorno_desejado_pct'] ?? null;
$ativo        = !empty($body['ativo']) ? 1 : 0;

if (strlen($sid) !== 64 || !ctype_xdigit($sid)) erro(400, 'sessao invalida');
if ($apelido === '' || mb_strlen($apelido) > 60) erro(400, 'apelido invalido');
if (!in_array($moeda, ['BTC', 'BCH'], true)) erro(400, 'moeda invalida');
if (!is_numeric($valorOp) || (float)$valorOp <= 0) erro(400, 'valor por operacao invalido');
if (!is_numeric($retornoPct) || (float)$retornoPct <= 0) erro(400, 'retorno desejado invalido');

try {
    $pdo = db();

    if ($roboId === '') {
        // criação: aplica o limite de robôs por sessão
        $stCount = $pdo->prepare('SELECT COUNT(*) AS n, ISNULL(MAX(seq), 0) AS max_seq FROM dbo.GN_Robos WHERE session_id = ?');
        $stCount->execute([$sid]);
        $row = $stCount->fetch();
        if ((int)$row['n'] >= ROBOS_MAX_POR_SESSAO) {
            erro(409, 'limite de ' . ROBOS_MAX_POR_SESSAO . ' robos atingido');
        }
        $seq = (int)$row['max_seq'] + 1;
        $roboId = 'RB' . $seq;

        $stIns = $pdo->prepare('INSERT INTO dbo.GN_Robos
                (session_id, seq, robo_client_id, apelido, moeda, valor_operacao,
                 retorno_desejado_pct, limite_perda_diaria_pct, ativo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stIns->execute([
            $sid, $seq, $roboId, $apelido, $moeda, (float)$valorOp,
            (float)$retornoPct, LIMITE_PERDA_DIARIA_PCT_FIXO, $ativo,
        ]);
    } else {
        // atualização: precisa pertencer à mesma sessão
        $stUpd = $pdo->prepare('UPDATE dbo.GN_Robos SET
                apelido = ?, moeda = ?, valor_operacao = ?, retorno_desejado_pct = ?,
                ativo = ?, atualizado_em = SYSUTCDATETIME()
            WHERE session_id = ? AND robo_client_id = ?');
        $stUpd->execute([$apelido, $moeda, (float)$valorOp, (float)$retornoPct, $ativo, $sid, $roboId]);
        if ($stUpd->rowCount() === 0) erro(404, 'robo nao encontrado');
    }

    $stGet = $pdo->prepare('SELECT robo_client_id, seq, apelido, moeda, valor_operacao,
            retorno_desejado_pct, limite_perda_diaria_pct, ativo, criado_em, atualizado_em
        FROM dbo.GN_Robos WHERE session_id = ? AND robo_client_id = ?');
    $stGet->execute([$sid, $roboId]);
    $r = $stGet->fetch();

    echo json_encode(['ok' => true, 'robo' => [
        'id'                   => $r['robo_client_id'],
        'seq'                  => (int)$r['seq'],
        'apelido'              => $r['apelido'],
        'moeda'                => $r['moeda'],
        'valorOperacao'        => num($r['valor_operacao']),
        'retornoDesejadoPct'   => num($r['retorno_desejado_pct']),
        'limitePerdaDiariaPct' => num($r['limite_perda_diaria_pct']),
        'ativo'                => (bool)$r['ativo'],
        'criadoEm'             => $r['criado_em'],
        'atualizadoEm'         => $r['atualizado_em'],
    ]]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
