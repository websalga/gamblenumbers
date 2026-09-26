<?php
/* ============================================================
 * sim_load.php — leitura das operacoes simuladas (lotes e vendas) no SQL Server, a FONTE DE VERDADE.
 * O navegador mescla o resultado com o seu estado (ver OperationsController.mergeServer): o que o banco tem
 * manda, exceto por itens com envio pendente. Nao decide nada e nao grava nada — so' SELECT.
 *
 * GET: session_id (64 hex), moeda ('BTC'|'BCH')
 * Resposta: {
 *   ok, lots:[...], sells:[...],                 itens ATIVOS no formato de operations.js, com hidden e _v (versao)
 *   excluidos:{ lots:[{id,v}], sells:[{id,v}] }, itens apagados (exclusao logica): o navegador remove os que tiver
 *   seq_max:{ lot, sell }                        maior sequencial ja usado, incluindo excluidos: nunca reaproveitar
 * }
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

require_once __DIR__ . '/sim_common.php';

$sid   = trim((string)($_GET['session_id'] ?? ''));
$moeda = strtoupper(trim((string)($_GET['moeda'] ?? '')));

if (strlen($sid) !== 64 || !ctype_xdigit($sid) || !in_array($moeda, ['BTC', 'BCH'], true)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'parametros invalidos']);
    exit;
}

try {
    $pdo = db();

    $stL = $pdo->prepare('SELECT ' . SIM_LOTE_COLS . ' FROM dbo.GN_SimLotes WHERE session_id = ? AND moeda = ? ORDER BY seq ASC');
    $stL->execute([$sid, $moeda]);
    $lots = []; $exL = [];
    foreach ($stL->fetchAll() as $r) {
        if ((int)$r['excluido'] === 1) $exL[] = ['id' => $r['lote_client_id'], 'v' => (int)$r['versao']];
        else $lots[] = sim_fmt_lote($r);
    }

    $stV = $pdo->prepare('SELECT ' . SIM_VENDA_COLS . ' FROM dbo.GN_SimVendas WHERE session_id = ? AND moeda = ? ORDER BY seq ASC');
    $stV->execute([$sid, $moeda]);
    $sells = []; $exV = [];
    foreach ($stV->fetchAll() as $r) {
        if ((int)$r['excluido'] === 1) $exV[] = ['id' => $r['venda_client_id'], 'v' => (int)$r['versao']];
        else $sells[] = sim_fmt_venda($r);
    }

    echo json_encode([
        'ok' => true, 'lots' => $lots, 'sells' => $sells,
        'excluidos' => ['lots' => $exL, 'sells' => $exV],
        'seq_max'   => sim_seq_max($pdo, $sid, $moeda),
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
