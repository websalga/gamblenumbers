<?php
/* ============================================================
 * sim_sync.php — espelho evento-a-evento das operacoes do simulador (lotes e vendas)
 * do navegador para o SQL Server, que e' a FONTE DE VERDADE.
 *
 * Toda acao do usuario que altera uma operacao chega aqui, uma por requisicao, numa TRANSACAO,
 * e o navegador so' considera a acao entregue quando recebe a confirmacao ({ok:true}).
 *
 * POST JSON: { session_id, moeda, moeda_exib, reason, subject, lots?, removed?, force? }
 *   reason 'buy' | 'lot:sync'                       subject = lote          -> grava o lote
 *   reason 'sell:scheduled|cancelled|expired|executed|sell:sync'
 *                                                   subject = venda, lots = lotes afetados (execucao consome lotes)
 *   reason 'lot:deleted' | 'sell:deleted'           subject = item          -> exclusao LOGICA
 *   reason 'lot:visibility' | 'sell:visibility'     subject = item (hidden) -> o "olhinho"
 *   reason 'operations:cleared'                     removed = {lots:[ids], sells:[ids]} -> exclusao logica em lote
 *   Cada item carrega '_v' (versao que o navegador conhece). Se a linha no banco tem versao maior (um robo ou
 *   outro navegador mexeu) a gravacao NAO acontece e volta {ok:false, conflito:true, atuais:{...}} com o estado
 *   do banco; 'force' (itens antigos so' locais) ignora a checagem.
 * Resposta ok: { ok:true, itens:[{tipo,id,v,excluido?}], seq_max:{lot,sell} }
 * Erro transitorio: HTTP 500 (o navegador reenvia). Erro permanente: HTTP 422 {permanente:true}.
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

require_once __DIR__ . '/sim_common.php';

const SYNC_LOG_FILE = __DIR__ . '/../private/logs/sim_sync_erros.log';
function log_erro(string $etapa, array $dados = []): void {
    $linha = json_encode(['ts'=>date('c'), 'etapa'=>$etapa, 'dados'=>$dados], JSON_UNESCAPED_SLASHES);
    @file_put_contents(SYNC_LOG_FILE, $linha . "\n", FILE_APPEND | LOCK_EX);
}

function client_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP','HTTP_X_REAL_IP','HTTP_X_FORWARDED_FOR','REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) return trim(explode(',', $_SERVER[$k])[0]);
    }
    return '0.0.0.0';
}

function validar_numero($v): ?float {
    if ($v === null || $v === '') return null;
    if (!is_numeric($v)) return null;
    return (float)$v;
}

/* Decimal em notacao FIXA, na escala da coluna. Sem isso o PHP envia floats pequenos (< 0,0001, comuns em BTC) como
 * texto cientifico ("4.87317E-5") e o SQL Server falha com "Error converting data type nvarchar to numeric". */
function dec($v, int $casas): ?string {
    $f = validar_numero($v);
    return $f === null ? null : number_format($f, $casas, '.', '');
}

function responder(int $codigo, array $corpo): void {
    http_response_code($codigo);
    echo json_encode($corpo);
    exit;
}

/* versao que o navegador conhece do item (null = item novo) */
function versao_base(array $s): ?int {
    return (array_key_exists('_v', $s) && $s['_v'] !== null && is_numeric($s['_v'])) ? (int)$s['_v'] : null;
}

function lote_row(PDO $pdo, string $sid, string $moeda, string $id): ?array {
    $st = $pdo->prepare('SELECT ' . SIM_LOTE_COLS . ' FROM dbo.GN_SimLotes WITH (UPDLOCK, HOLDLOCK)
                         WHERE session_id = ? AND moeda = ? AND lote_client_id = ?');
    $st->execute([$sid, $moeda, $id]);
    $r = $st->fetch();
    return $r ?: null;
}
function venda_row(PDO $pdo, string $sid, string $moeda, string $id): ?array {
    $st = $pdo->prepare('SELECT ' . SIM_VENDA_COLS . ' FROM dbo.GN_SimVendas WITH (UPDLOCK, HOLDLOCK)
                         WHERE session_id = ? AND moeda = ? AND venda_client_id = ?');
    $st->execute([$sid, $moeda, $id]);
    $r = $st->fetch();
    return $r ?: null;
}

/* ---------- lote: cria ou atualiza (com checagem de versao) ---------- */
function upsertLote(PDO $pdo, string $sid, string $moeda, string $moedaExib, array $s, bool $force, bool $forceSeSemVersao = false): array {
    $id  = trim((string)($s['id'] ?? ''));
    $seq = (int)($s['seq'] ?? 0);
    if (!sim_id_valido($id) || $seq <= 0) throw new InvalidArgumentException('lote sem id/seq validos');
    $base = versao_base($s);

    $params = [
        ':session_id'      => $sid,
        ':moeda'           => $moeda,
        ':lote_client_id'  => $id,
        ':seq'             => $seq,
        ':moeda_exib'      => $s['moedaExib'] ?? $moedaExib,
        ':preco'           => dec($s['price'] ?? null, 8) ?? '0',
        ':valor'           => dec($s['brl'] ?? null, 2) ?? '0',
        ':qtd'             => dec($s['qty'] ?? null, 10) ?? '0',
        ':restante'        => dec($s['remaining'] ?? null, 10) ?? '0',
        ':vendido'         => dec($s['sold'] ?? null, 10) ?? '0',
        ':realizado'       => dec($s['realized'] ?? null, 2) ?? '0',
        ':status'          => in_array($s['status'] ?? '', ['open','closed'], true) ? $s['status'] : 'open',
        ':fee_valor'       => dec($s['fee_brl'] ?? null, 2),
        ':feerate'         => dec($s['feerate'] ?? null, 4),
        ':time_cliente_ms' => (int)($s['time'] ?? 0),
        ':oculto'          => !empty($s['hidden']) ? 1 : 0,
    ];

    $row = lote_row($pdo, $sid, $moeda, $id);
    if ($row === null) {
        $pdo->prepare('INSERT INTO dbo.GN_SimLotes
                (session_id, moeda, lote_client_id, seq, moeda_exib, preco, valor, qtd,
                 restante, vendido, realizado, status, fee_valor, feerate, time_cliente_ms, oculto)
            VALUES
                (:session_id, :moeda, :lote_client_id, :seq, :moeda_exib, :preco, :valor, :qtd,
                 :restante, :vendido, :realizado, :status, :fee_valor, :feerate, :time_cliente_ms, :oculto)')
            ->execute($params);
        return ['tipo' => 'lote', 'id' => $id, 'v' => 1];
    }
    if ((int)$row['excluido'] === 1) {   // apagado no banco: nao ressuscita
        return ['tipo' => 'lote', 'id' => $id, 'v' => (int)$row['versao'], 'excluido' => true];
    }
    $ignorar = $force || ($forceSeSemVersao && $base === null);
    if (!$ignorar) {
        if ($base === null)                     return ['conflito' => true, 'tipo' => 'lote', 'id' => $id, 'motivo' => 'id_existente'];
        if ((int)$row['versao'] > $base)        return ['conflito' => true, 'tipo' => 'lote', 'id' => $id, 'motivo' => 'versao'];
    }
    $pdo->prepare('UPDATE dbo.GN_SimLotes SET
            seq=:seq, moeda_exib=:moeda_exib, preco=:preco, valor=:valor, qtd=:qtd,
            restante=:restante, vendido=:vendido, realizado=:realizado, status=:status,
            fee_valor=:fee_valor, feerate=:feerate, time_cliente_ms=:time_cliente_ms, oculto=:oculto,
            versao=versao+1, atualizado_em=SYSUTCDATETIME()
        WHERE session_id=:session_id AND moeda=:moeda AND lote_client_id=:lote_client_id')
        ->execute($params);
    return ['tipo' => 'lote', 'id' => $id, 'v' => (int)$row['versao'] + 1];
}

/* ---------- venda: cria ou atualiza (com checagem de versao) ---------- */
function upsertVenda(PDO $pdo, string $sid, string $moeda, string $moedaExib, array $s, bool $force): array {
    $id  = trim((string)($s['id'] ?? ''));
    $seq = (int)($s['seq'] ?? 0);
    if (!sim_id_valido($id) || $seq <= 0) throw new InvalidArgumentException('venda sem id/seq validos');
    $base = versao_base($s);

    $status = $s['status'] ?? 'pending';
    if (!in_array($status, ['pending','executed','cancelled','expired'], true)) $status = 'pending';

    $params = [
        ':session_id'       => $sid,
        ':moeda'            => $moeda,
        ':venda_client_id'  => $id,
        ':seq'              => $seq,
        ':moeda_exib'       => $s['moedaExib'] ?? $moedaExib,
        ':mark_time_ms'     => (int)($s['markTime'] ?? 0),
        ':mark_price'       => dec($s['markPrice'] ?? null, 8) ?? '0',
        ':qtd'              => dec($s['qty'] ?? null, 10) ?? '0',
        ':reservado'        => dec($s['reserved'] ?? null, 10) ?? '0',
        ':status'           => $status,
        ':exec_price'       => dec($s['execPrice'] ?? null, 8),
        ':exec_time_ms'     => isset($s['execTime']) ? (int)$s['execTime'] : null,
        ':fee_valor'        => dec($s['fee_brl'] ?? null, 2),
        ':feerate'          => dec($s['feerate'] ?? null, 4),
        ':pnl'              => dec($s['_pnl'] ?? null, 2),
        ':valor_liquido'    => dec($s['_value'] ?? null, 2),
        ':retorno_pct'      => dec($s['_ret'] ?? null, 4),
        ':oculto'           => !empty($s['hidden']) ? 1 : 0,
    ];

    $row = venda_row($pdo, $sid, $moeda, $id);
    if ($row === null) {
        $pdo->prepare('INSERT INTO dbo.GN_SimVendas
                (session_id, moeda, venda_client_id, seq, moeda_exib, mark_time_ms, mark_price,
                 qtd, reservado, status, exec_price, exec_time_ms, fee_valor, feerate, pnl,
                 valor_liquido, retorno_pct, oculto)
            VALUES
                (:session_id, :moeda, :venda_client_id, :seq, :moeda_exib, :mark_time_ms, :mark_price,
                 :qtd, :reservado, :status, :exec_price, :exec_time_ms, :fee_valor, :feerate, :pnl,
                 :valor_liquido, :retorno_pct, :oculto)')
            ->execute($params);
        return ['tipo' => 'venda', 'id' => $id, 'v' => 1];
    }
    if ((int)$row['excluido'] === 1) {
        return ['tipo' => 'venda', 'id' => $id, 'v' => (int)$row['versao'], 'excluido' => true];
    }
    if (!$force) {
        if ($base === null)                     return ['conflito' => true, 'tipo' => 'venda', 'id' => $id, 'motivo' => 'id_existente'];
        if ((int)$row['versao'] > $base)        return ['conflito' => true, 'tipo' => 'venda', 'id' => $id, 'motivo' => 'versao'];
    }
    $pdo->prepare('UPDATE dbo.GN_SimVendas SET
            seq=:seq, moeda_exib=:moeda_exib, mark_time_ms=:mark_time_ms, mark_price=:mark_price,
            qtd=:qtd, reservado=:reservado, status=:status, exec_price=:exec_price,
            exec_time_ms=:exec_time_ms, fee_valor=:fee_valor, feerate=:feerate, pnl=:pnl,
            valor_liquido=:valor_liquido, retorno_pct=:retorno_pct, oculto=:oculto,
            versao=versao+1, atualizado_em=SYSUTCDATETIME()
        WHERE session_id=:session_id AND moeda=:moeda AND venda_client_id=:venda_client_id')
        ->execute($params);
    return ['tipo' => 'venda', 'id' => $id, 'v' => (int)$row['versao'] + 1];
}

/* ---------- exclusao LOGICA e ocultacao (nao dependem de versao: sao a intencao do usuario) ---------- */
function excluirLogico(PDO $pdo, bool $ehLote, string $sid, string $moeda, string $id): array {
    if (!sim_id_valido($id)) throw new InvalidArgumentException('id invalido');
    $t = $ehLote ? 'GN_SimLotes' : 'GN_SimVendas';
    $c = $ehLote ? 'lote_client_id' : 'venda_client_id';
    $pdo->prepare("UPDATE dbo.$t SET excluido = 1, excluido_em = SYSUTCDATETIME(), versao = versao + 1, atualizado_em = SYSUTCDATETIME()
                   WHERE session_id = ? AND moeda = ? AND $c = ? AND excluido = 0")->execute([$sid, $moeda, $id]);
    $q = $pdo->prepare("SELECT versao FROM dbo.$t WHERE session_id = ? AND moeda = ? AND $c = ?");
    $q->execute([$sid, $moeda, $id]);
    $v = $q->fetchColumn();
    return ['tipo' => $ehLote ? 'lote' : 'venda', 'id' => $id, 'v' => $v === false ? 0 : (int)$v, 'excluido' => true];
}

function definirOculto(PDO $pdo, bool $ehLote, string $sid, string $moeda, string $id, bool $oculto): array {
    if (!sim_id_valido($id)) throw new InvalidArgumentException('id invalido');
    $t = $ehLote ? 'GN_SimLotes' : 'GN_SimVendas';
    $c = $ehLote ? 'lote_client_id' : 'venda_client_id';
    $pdo->prepare("UPDATE dbo.$t SET oculto = ?, versao = versao + 1, atualizado_em = SYSUTCDATETIME()
                   WHERE session_id = ? AND moeda = ? AND $c = ? AND excluido = 0 AND oculto <> ?")
        ->execute([$oculto ? 1 : 0, $sid, $moeda, $id, $oculto ? 1 : 0]);
    $q = $pdo->prepare("SELECT versao, excluido FROM dbo.$t WHERE session_id = ? AND moeda = ? AND $c = ?");
    $q->execute([$sid, $moeda, $id]);
    $r = $q->fetch();
    $item = ['tipo' => $ehLote ? 'lote' : 'venda', 'id' => $id, 'v' => $r ? (int)$r['versao'] : 0];
    if ($r && (int)$r['excluido'] === 1) $item['excluido'] = true;
    return $item;
}

/* estado atual (sem trava) dos itens de um evento: devolvido quando ha conflito */
function estado_atual(PDO $pdo, string $sid, string $moeda, array $idsLotes, array $idsVendas): array {
    $lots = []; $sells = [];
    foreach (array_unique($idsLotes) as $id) {
        $st = $pdo->prepare('SELECT ' . SIM_LOTE_COLS . ' FROM dbo.GN_SimLotes WHERE session_id = ? AND moeda = ? AND lote_client_id = ?');
        $st->execute([$sid, $moeda, $id]);
        if ($r = $st->fetch()) $lots[] = (int)$r['excluido'] === 1 ? ['id' => $r['lote_client_id'], 'excluido' => true, '_v' => (int)$r['versao']] : sim_fmt_lote($r);
    }
    foreach (array_unique($idsVendas) as $id) {
        $st = $pdo->prepare('SELECT ' . SIM_VENDA_COLS . ' FROM dbo.GN_SimVendas WHERE session_id = ? AND moeda = ? AND venda_client_id = ?');
        $st->execute([$sid, $moeda, $id]);
        if ($r = $st->fetch()) $sells[] = (int)$r['excluido'] === 1 ? ['id' => $r['venda_client_id'], 'excluido' => true, '_v' => (int)$r['versao']] : sim_fmt_venda($r);
    }
    return ['lots' => $lots, 'sells' => $sells];
}

/* ============================================================
 * Entrada
 * ============================================================ */
$raw  = file_get_contents('php://input');
$body = json_decode((string)$raw, true);
if (!is_array($body)) $body = [];

$sid       = trim((string)($body['session_id'] ?? ''));
$moeda     = strtoupper(trim((string)($body['moeda'] ?? '')));
$moedaExib = strtoupper(trim((string)($body['moeda_exib'] ?? 'BRL')));
$reason    = trim((string)($body['reason'] ?? ''));
$subject   = $body['subject'] ?? null;
$force     = !empty($body['force']);

if (strlen($sid) !== 64 || !ctype_xdigit($sid) || !in_array($moeda, ['BTC','BCH'], true) || $reason === '' || !is_array($subject)) {
    responder(400, ['ok' => false, 'permanente' => true, 'error' => 'payload invalido']);
}

$REASONS_VENDA = ['sell:scheduled', 'sell:cancelled', 'sell:expired', 'sell:executed', 'sell:sync'];

try {
    $pdo = db();

    /* auditoria do evento bruto (fora da transacao: fica registrado mesmo se a gravacao falhar) */
    $pdo->prepare('INSERT INTO dbo.GN_SimSyncLog (session_id, moeda, reason, payload, ip) VALUES (?,?,?,?,?)')
        ->execute([$sid, $moeda, mb_substr($reason, 0, 30), (string)$raw, client_ip()]);

    $pdo->beginTransaction();
    $itens = []; $conflitos = []; $idsLotes = []; $idsVendas = [];
    $anota = function (array $r) use (&$itens, &$conflitos) { if (!empty($r['conflito'])) $conflitos[] = $r; else $itens[] = $r; };

    if ($reason === 'buy' || $reason === 'lot:sync') {
        $idsLotes[] = (string)($subject['id'] ?? '');
        $anota(upsertLote($pdo, $sid, $moeda, $moedaExib, $subject, $force || $reason === 'lot:sync'));

    } elseif (in_array($reason, $REASONS_VENDA, true)) {
        $idsVendas[] = (string)($subject['id'] ?? '');
        $anota(upsertVenda($pdo, $sid, $moeda, $moedaExib, $subject, $force || $reason === 'sell:sync'));
        /* a execucao de uma venda consome lotes: os lotes afetados vao no mesmo evento e na mesma transacao;
         * lote sem versao conhecida e' um lote antigo so' local: grava direto (forceSeSemVersao) */
        $lotesDoEvento = (isset($body['lots']) && is_array($body['lots'])) ? array_slice($body['lots'], 0, 200) : [];
        foreach ($lotesDoEvento as $l) {
            if (!is_array($l)) continue;
            $idsLotes[] = (string)($l['id'] ?? '');
            $anota(upsertLote($pdo, $sid, $moeda, $moedaExib, $l, $force, true));
        }

    } elseif ($reason === 'lot:deleted') {
        $itens[] = excluirLogico($pdo, true, $sid, $moeda, (string)($subject['id'] ?? ''));

    } elseif ($reason === 'sell:deleted') {
        $itens[] = excluirLogico($pdo, false, $sid, $moeda, (string)($subject['id'] ?? ''));

    } elseif ($reason === 'lot:visibility') {
        $itens[] = definirOculto($pdo, true, $sid, $moeda, (string)($subject['id'] ?? ''), !empty($subject['hidden']));

    } elseif ($reason === 'sell:visibility') {
        $itens[] = definirOculto($pdo, false, $sid, $moeda, (string)($subject['id'] ?? ''), !empty($subject['hidden']));

    } elseif ($reason === 'operations:cleared') {
        $rem = (isset($body['removed']) && is_array($body['removed'])) ? $body['removed'] : [];
        foreach (array_slice((array)($rem['lots'] ?? []), 0, 500) as $id)  $itens[] = excluirLogico($pdo, true,  $sid, $moeda, (string)$id);
        foreach (array_slice((array)($rem['sells'] ?? []), 0, 500) as $id) $itens[] = excluirLogico($pdo, false, $sid, $moeda, (string)$id);
    }
    /* qualquer outro reason: so' fica no log */

    if ($conflitos) {
        $pdo->rollBack();
        responder(200, [
            'ok' => false, 'conflito' => true, 'conflitos' => $conflitos,
            'atuais'  => estado_atual($pdo, $sid, $moeda, $idsLotes, $idsVendas),
            'seq_max' => sim_seq_max($pdo, $sid, $moeda),
        ]);
    }

    $pdo->commit();
    responder(200, ['ok' => true, 'itens' => $itens, 'seq_max' => sim_seq_max($pdo, $sid, $moeda)]);

} catch (InvalidArgumentException $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    log_erro('sim_sync:invalido', ['reason' => $reason, 'mensagem' => $e->getMessage()]);
    responder(422, ['ok' => false, 'permanente' => true, 'error' => $e->getMessage()]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    $sqlstate = ($e instanceof PDOException && isset($e->errorInfo[0])) ? (string)$e->errorInfo[0] : '';
    log_erro('sim_sync:excecao', ['reason' => $reason, 'sqlstate' => $sqlstate, 'mensagem' => $e->getMessage()]);
    if ($sqlstate === '23000') {   // violacao de FK/unique: reenviar nao resolve (ex.: sessao inexistente)
        responder(422, ['ok' => false, 'permanente' => true, 'error' => 'dado rejeitado pelo banco']);
    }
    responder(500, ['ok' => false, 'error' => 'erro ao gravar']);
}
