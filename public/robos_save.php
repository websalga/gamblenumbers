<?php
/* ============================================================
 * robos_save.php — cria ou atualiza um robô (Autômato) configurado
 * pela sessão. Só grava a CONFIGURAÇÃO do robô (apelido, moeda,
 * valor por operação, retorno desejado, ativo/inativo, "Taxas
 * Reais", "modo crash") — a inteligência de decisão de compra/venda
 * roda à parte, no motor orquestrador (fila + GN_RoboOrquestrador)
 * no SQL Server; este endpoint não decide nada, só liga/desliga e
 * agenda o robô.
 *
 * Ativar o robô (ativo=true) agenda a primeira execução dele pra
 * "agora" (proxima_execucao), pra não esperar o ciclo cheio na
 * primeira vez. Desativar cancela qualquer execução ainda
 * pendente na fila (GN_RoboFila) pra não disparar uma operação
 * logo depois do usuário ter pausado o robô.
 *
 * "Taxas Reais" (taxas_reais): quando ligado (padrão), o motor
 * soma o custo estimado de conversão via SideShift à taxa de rede
 * na hora de decidir compra/venda, pra simular o custo real de
 * operar com dinheiro de verdade.
 *
 * "Compra em queda forte / modo crash" (queda_crash_pct): gatilho
 * ADICIONAL de compra (padrão 23%), que compara o preço com a
 * máxima dos últimos 7 dias -- quando a queda acumulada passa
 * desse valor, o robô entra em modo crash e compra a cada rodada
 * enquanto o preço continuar fazendo mínima nova (o motor mesmo
 * freia quando a queda perde força). 0 desativa o mecanismo.
 *
 * As duas chaves (taxas_reais, queda_crash_pct) moram juntas em
 * GN_Robos.config_json e são mescladas aqui -- salvar uma não
 * apaga a outra. Um save que não manda nenhum dos dois campos
 * (ex: o botão rápido de ativar/pausar) preserva tudo que já
 * estava salvo. Só ficam gravadas as chaves que diferem do padrão
 * (taxas_reais=true e queda_crash_pct=23 não geram entrada no
 * json -- fica NULL quando tudo está no padrão).
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
 *     taxas_reais: boolean,        // opcional; omitido = não mexe (update) / true (criação)
 *     queda_crash_pct: number,     // opcional; omitido = não mexe (update) / 23 (criação); 0 desativa
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
const QUEDA_CRASH_PCT_PADRAO = 23.0;
const QUEDA_CRASH_PCT_MAX = 90.0;

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

/* Mescla os campos informados nesta requisição (quando presentes) com o
 * config_json já existente, preservando o que não foi mandado. Só grava no
 * json as chaves que diferem do padrão -- mantém o registro limpo. */
function mesclarConfig(?string $configJsonAtual, ?bool $taxasReais, ?float $quedaCrashPct): ?string {
    $j = configDecode($configJsonAtual);

    if ($taxasReais !== null) {
        if ($taxasReais === true) unset($j['taxas_reais']);
        else $j['taxas_reais'] = false;
    }

    if ($quedaCrashPct !== null) {
        if (abs($quedaCrashPct - QUEDA_CRASH_PCT_PADRAO) < 0.0001) unset($j['queda_crash_pct']);
        else $j['queda_crash_pct'] = $quedaCrashPct;
    }

    return empty($j) ? null : json_encode($j);
}

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

$temTaxasReais = array_key_exists('taxas_reais', $body);
$taxasReais    = $temTaxasReais ? (bool)$body['taxas_reais'] : null;

$temQuedaCrash   = array_key_exists('queda_crash_pct', $body);
$quedaCrashInput = $temQuedaCrash ? $body['queda_crash_pct'] : null;

if (strlen($sid) !== 64 || !ctype_xdigit($sid)) erro(400, 'sessao invalida');
if ($apelido === '' || mb_strlen($apelido) > 60) erro(400, 'apelido invalido');
if (!in_array($moeda, ['BTC', 'BCH'], true)) erro(400, 'moeda invalida');
if (!is_numeric($valorOp) || (float)$valorOp <= 0) erro(400, 'valor por operacao invalido');
if (!is_numeric($retornoPct) || (float)$retornoPct <= 0) erro(400, 'retorno desejado invalido');
if ($temQuedaCrash && (!is_numeric($quedaCrashInput) || (float)$quedaCrashInput < 0 || (float)$quedaCrashInput > QUEDA_CRASH_PCT_MAX)) {
    erro(400, 'queda de crash invalida');
}
$quedaCrashPct = $temQuedaCrash ? (float)$quedaCrashInput : null;

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

        // config_json nasce so' com o que o cliente mandou diferente do padrao
        $configJsonNovo = mesclarConfig(null, $taxasReais, $quedaCrashPct);

        // proxima_execucao so' entra ja' marcada se o robo ja' nasce ativo
        $stIns = $pdo->prepare('INSERT INTO dbo.GN_Robos
                (session_id, seq, robo_client_id, apelido, moeda, valor_operacao,
                 retorno_desejado_pct, limite_perda_diaria_pct, ativo, proxima_execucao, config_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN SYSUTCDATETIME() ELSE NULL END, ?)');
        $stIns->execute([
            $sid, $seq, $roboId, $apelido, $moeda, (float)$valorOp,
            (float)$retornoPct, LIMITE_PERDA_DIARIA_PCT_FIXO, $ativo, $ativo, $configJsonNovo,
        ]);
    } else {
        // atualização: precisa pertencer à mesma sessão
        // proxima_execucao: desativou -> NULL; ativou e nao tinha agenda -> agora;
        // ja' estava ativo com agenda em andamento -> mantem (nao reinicia o ciclo a
        // cada save).
        if ($temTaxasReais || $temQuedaCrash) {
            // le o config_json atual pra mesclar sem perder o que nao foi mandado agora
            $stCfg = $pdo->prepare('SELECT config_json FROM dbo.GN_Robos WHERE session_id = ? AND robo_client_id = ?');
            $stCfg->execute([$sid, $roboId]);
            $configAtual = $stCfg->fetchColumn();
            $configJsonNovo = mesclarConfig($configAtual === false ? null : $configAtual, $taxasReais, $quedaCrashPct);

            $stUpd = $pdo->prepare('UPDATE dbo.GN_Robos SET
                    apelido = ?, moeda = ?, valor_operacao = ?, retorno_desejado_pct = ?,
                    ativo = ?, config_json = ?,
                    proxima_execucao = CASE WHEN ? = 0 THEN NULL
                                            WHEN proxima_execucao IS NULL THEN SYSUTCDATETIME()
                                            ELSE proxima_execucao END,
                    atualizado_em = SYSUTCDATETIME()
                WHERE session_id = ? AND robo_client_id = ?');
            $stUpd->execute([$apelido, $moeda, (float)$valorOp, (float)$retornoPct, $ativo, $configJsonNovo, $ativo, $sid, $roboId]);
        } else {
            // save sem nenhum dos dois campos (ex: botao rapido de ativar/pausar) -- preserva config_json
            $stUpd = $pdo->prepare('UPDATE dbo.GN_Robos SET
                    apelido = ?, moeda = ?, valor_operacao = ?, retorno_desejado_pct = ?,
                    ativo = ?,
                    proxima_execucao = CASE WHEN ? = 0 THEN NULL
                                            WHEN proxima_execucao IS NULL THEN SYSUTCDATETIME()
                                            ELSE proxima_execucao END,
                    atualizado_em = SYSUTCDATETIME()
                WHERE session_id = ? AND robo_client_id = ?');
            $stUpd->execute([$apelido, $moeda, (float)$valorOp, (float)$retornoPct, $ativo, $ativo, $sid, $roboId]);
        }
        if ($stUpd->rowCount() === 0) erro(404, 'robo nao encontrado');

        if ($ativo === 0) {
            // cancela qualquer execucao ainda pendente na fila pra esse robo
            $stCancel = $pdo->prepare(
                "UPDATE f SET f.status = 'ER', f.data_execucao = SYSUTCDATETIME(),
                        f.erro_msg = 'cancelado: robo pausado pelo usuario'
                 FROM dbo.GN_RoboFila f
                 JOIN dbo.GN_Robos r ON r.id = f.robo_id
                 WHERE r.session_id = ? AND r.robo_client_id = ? AND f.status = 'AG'"
            );
            $stCancel->execute([$sid, $roboId]);
        }
    }

    $stGet = $pdo->prepare('SELECT robo_client_id, seq, apelido, moeda, valor_operacao,
            retorno_desejado_pct, limite_perda_diaria_pct, ativo, config_json, criado_em, atualizado_em
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
        'taxasReais'           => taxasReaisDeConfig($r['config_json']),
        'quedaCrashPct'        => quedaCrashPctDeConfig($r['config_json']),
        'criadoEm'             => $r['criado_em'],
        'atualizadoEm'         => $r['atualizado_em'],
    ]]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
