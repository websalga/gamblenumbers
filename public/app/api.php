<?php
/* ============================================================
 * public/app/api.php — API do app mobile (PWA). Arquivo NOVO.
 * Não altera os endpoints existentes do site. Só BTC na v1.
 *
 * POST JSON { action, session_id, ... }
 *   resumo, cotacoes, robos, robo_alternar,
 *   passkey_estado, passkey_reg_opcoes, passkey_reg_verificar, passkey_revogar,
 *   saque_cotar, saque_desafio, saque_confirmar, saque_status, saques_lista
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/../../private/config.php';
require_once __DIR__ . '/../../private/wallet_config.php';
require_once __DIR__ . '/../../private/app_lib.php';

$body   = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];
$action = (string)($body['action'] ?? '');
$sid    = trim((string)($body['session_id'] ?? ''));

function usuario(string $sid): array {
    if (strlen($sid) !== 64 || !ctype_xdigit($sid)) out(['ok' => false, 'error' => 'sessão inválida'], 400);
    $st = db()->prepare('SELECT session_id, btc_address, moeda_saida, endereco_saida, senha_hash FROM dbo.GN_Usuarios WHERE session_id=?');
    $st->execute([$sid]);
    $u = $st->fetch();
    if (!$u) out(['ok' => false, 'error' => 'sessão não encontrada'], 404);
    return $u;
}

function preco_brl(): float {
    $r = db()->query('SELECT TOP 1 media_exchanges_brl FROM dbo.snapshots WHERE media_exchanges_brl > 0 ORDER BY ts_utc DESC')->fetch();
    $p = (float)($r['media_exchanges_brl'] ?? 0);
    if ($p <= 0) throw new RuntimeException('Sem cotação disponível.');
    return $p;
}

function destino_btc(array $u): string {
    $d = trim((string)($u['endereco_saida'] ?? ''));
    if ($d === '' || ($u['moeda_saida'] ?? '') !== 'BTC') out(['ok' => false, 'codigo' => 'sem_destino', 'error' => 'Configure no site o endereço Bitcoin de destino.'], 422);
    if (btc_address_script($d) === null) out(['ok' => false, 'error' => 'Endereço de destino inválido.'], 422);
    return $d;
}

/* Mensagem que pode ir para o usuário: detalhes de SQL/RPC ficam só no app.log. */
function msg_publica(Throwable $e): string {
    $m = $e->getMessage();
    if (stripos($m, 'does not cover') !== false || stripos($m, 'insufficient funds') !== false) return 'Saldo insuficiente para este valor mais a taxa de rede.';
    if ($e instanceof PDOException || str_contains($m, 'SQLSTATE') || str_contains($m, 'RPC') || str_contains($m, 'CBOR')) return 'Erro interno. Tente novamente em instantes.';
    return $m;
}

function mascara(string $a): string { return strlen($a) > 18 ? substr($a, 0, 8) . '…' . substr($a, -6) : $a; }

/* Valor pedido → satoshis (null = tudo) */
function valor_em_sats(array $b, float $preco): ?int {
    $tipo = (string)($b['tipo'] ?? 'brl');
    if ($tipo === 'max') return null;
    // Aceita "1.234,56", "1234,56" e "0.001": com vírgula, o ponto é separador de milhar.
    $txt = preg_replace('/\s+/', '', (string)($b['valor'] ?? '0'));
    if (str_contains($txt, ',')) $txt = str_replace(',', '.', str_replace('.', '', $txt));
    $v = is_numeric($txt) ? (float)$txt : 0.0;
    if ($v <= 0) out(['ok' => false, 'error' => 'Informe um valor maior que zero.'], 422);
    return $tipo === 'btc' ? (int)round($v * 1e8) : (int)floor($v / $preco * 1e8);
}

function taxa_escolhida(array $b, array $niveis): array {
    $nivel = (string)($b['nivel'] ?? 'min');
    if ($nivel === 'custom') {
        $r = round((float)($b['taxa'] ?? 0), 2);
        if ($r < $niveis['min'] || $r > APP_TAXA_MAX_SATVB) out(['ok' => false, 'error' => 'Taxa fora da faixa permitida (' . $niveis['min'] . ' a ' . APP_TAXA_MAX_SATVB . ' sat/vB).'], 422);
        return ['custom', $r];
    }
    if (!isset($niveis[$nivel])) $nivel = 'min';
    return [$nivel, (float)$niveis[$nivel]];
}

function dica_endereco(string $origem, float $vsizeAtual): array {
    $s = btc_address_script($origem);
    $tipo = $s[1] ?? '?';
    // tamanho típico de 1 entrada + 2 saídas (vB) por tipo de origem
    $ref = ['P2PKH' => 226, 'P2SH' => 166, 'P2WPKH' => 141, 'P2TR' => 154];
    $economia = null;
    if (isset($ref[$tipo]) && $tipo !== 'P2WPKH' && $tipo !== 'P2TR') $economia = (int)round((1 - $ref['P2WPKH'] / $ref[$tipo]) * 100);
    return ['tipo_origem' => $tipo, 'economia_pct' => $economia];
}

try {
    switch ($action) {

    /* ---------- painel inicial ---------- */
    case 'resumo': {
        $u = usuario($sid);
        $conf = $pend = 0;
        if ($u['btc_address']) {
            try { $conf = saldo_sats($u['btc_address'], 1); $pend = saldo_sats($u['btc_address'], 0) - $conf; } catch (Throwable $e) {}
        }
        $preco = preco_brl();
        $r = db()->prepare('SELECT COUNT(*) t, SUM(CAST(ativo AS INT)) a FROM dbo.GN_Robos WHERE session_id=?');
        $r->execute([$sid]); $rr = $r->fetch();
        $l = db()->prepare("SELECT COUNT(*) FROM dbo.GN_SimLotes WHERE session_id=? AND moeda='BTC' AND ISNULL(excluido,0)=0 AND restante > 0");
        $l->execute([$sid]);
        $pk = db()->prepare('SELECT COUNT(*) FROM dbo.GN_AppPasskeys WHERE session_id=? AND revogado_em IS NULL');
        $pk->execute([$sid]);
        out(['ok' => true,
            'saldo_sats' => $conf, 'pendente_sats' => max(0, $pend), 'preco_brl' => $preco,
            'saldo_brl' => round($conf / 1e8 * $preco, 2),
            'robos_total' => (int)$rr['t'], 'robos_ativos' => (int)($rr['a'] ?? 0), 'lotes_abertos' => (int)$l->fetchColumn(),
            'destino' => $u['moeda_saida'] === 'BTC' && $u['endereco_saida'] ? mascara($u['endereco_saida']) : null,
            'passkeys' => (int)$pk->fetchColumn(),
        ]);
    }

    /* ---------- gráfico de cotação (médias por intervalo) ---------- */
    case 'cotacoes': {
        usuario($sid);
        $mapa = ['1h' => [60, 2], '24h' => [1440, 30], '7d' => [10080, 180], '30d' => [43200, 720]];
        $range = (string)($body['range'] ?? '24h');
        if (!isset($mapa[$range])) $range = '24h';
        [$min, $bucket] = $mapa[$range];
        $bucket = (int)$bucket; $min = (int)$min;
        $st = db()->query("SELECT DATEDIFF(MINUTE, '2000-01-01', ts_utc) / {$bucket} AS k, AVG(CAST(media_exchanges_brl AS FLOAT)) AS p
            FROM dbo.snapshots WHERE ts_utc >= DATEADD(MINUTE, -{$min}, GETUTCDATE()) AND media_exchanges_brl > 0
            GROUP BY DATEDIFF(MINUTE, '2000-01-01', ts_utc) / {$bucket} ORDER BY k");
        $pts = [];
        foreach ($st->fetchAll() as $r) $pts[] = [(int)$r['k'] * $bucket * 60 + 946684800, round((float)$r['p'], 2)];
        $var = null;
        if (count($pts) > 1 && $pts[0][1] > 0) $var = round(($pts[count($pts) - 1][1] / $pts[0][1] - 1) * 100, 2);
        out(['ok' => true, 'range' => $range, 'pontos' => $pts, 'variacao_pct' => $var, 'ultimo' => $pts ? end($pts)[1] : null]);
    }

    /* ---------- robôs ---------- */
    case 'robos': {
        usuario($sid);
        $st = db()->prepare("SELECT r.robo_client_id id, r.apelido, r.ativo, r.retorno_desejado_pct venda, ISNULL(r.queda_compra_pct, r.retorno_desejado_pct) compra,
              (SELECT COUNT(*) FROM dbo.GN_SimLotes l WHERE l.session_id=r.session_id AND l.robo_client_id=r.robo_client_id AND ISNULL(l.excluido,0)=0 AND l.restante > 0) lotes,
              (SELECT TOP 1 e.detalhe FROM dbo.GN_RoboExecucaoLog e WHERE e.robo_id=r.id ORDER BY e.log_id DESC) decisao
            FROM dbo.GN_Robos r WHERE r.session_id=? ORDER BY r.seq");
        $st->execute([$sid]);
        $o = [];
        foreach ($st->fetchAll() as $r) $o[] = ['id' => $r['id'], 'apelido' => $r['apelido'], 'ativo' => (bool)$r['ativo'],
            'compra_pct' => (float)$r['compra'], 'venda_pct' => (float)$r['venda'], 'lotes' => (int)$r['lotes'], 'decisao' => $r['decisao']];
        out(['ok' => true, 'robos' => $o]);
    }

    case 'robo_alternar': {
        usuario($sid);
        $rid = (string)($body['robo_id'] ?? ''); $ativo = !empty($body['ativo']) ? 1 : 0;
        if ($rid === '') out(['ok' => false, 'error' => 'robô inválido'], 400);
        $pdo = db();
        $pdo->exec("EXEC sys.sp_set_session_context N'origem', N'usuario'");
        $st = $pdo->prepare('UPDATE dbo.GN_Robos SET ativo=?,
              proxima_execucao = CASE WHEN ?=0 THEN NULL WHEN proxima_execucao IS NULL THEN SYSUTCDATETIME() ELSE proxima_execucao END,
              atualizado_em = SYSUTCDATETIME() WHERE session_id=? AND robo_client_id=?');
        $st->execute([$ativo, $ativo, $sid, $rid]);
        if (!$ativo) {
            $pdo->prepare("UPDATE f SET f.status='ER', f.data_execucao=SYSUTCDATETIME(), f.erro_msg='cancelado: robo pausado pelo usuario (app)'
                FROM dbo.GN_RoboFila f JOIN dbo.GN_Robos r ON r.id=f.robo_id WHERE r.session_id=? AND r.robo_client_id=? AND f.status='AG'")->execute([$sid, $rid]);
        }
        out(['ok' => true, 'alterados' => $st->rowCount()]);
    }

    /* ---------- passkey (digital) ---------- */
    case 'passkey_estado': {
        usuario($sid);
        $st = db()->prepare('SELECT credential_id, apelido, criado_em, ultimo_uso FROM dbo.GN_AppPasskeys WHERE session_id=? AND revogado_em IS NULL');
        $st->execute([$sid]);
        out(['ok' => true, 'passkeys' => $st->fetchAll()]);
    }

    case 'passkey_reg_opcoes': {
        $u = usuario($sid);
        $chave = 'pkreg:' . $sid . ':' . client_ip();
        if (tentativas_excedidas($chave, 5, 10)) out(['ok' => false, 'error' => 'Muitas tentativas. Aguarde alguns minutos.'], 429);
        if (empty($u['senha_hash']) || !password_verify((string)($body['senha'] ?? ''), $u['senha_hash'])) {
            registrar_tentativa($chave);
            out(['ok' => false, 'error' => 'Senha incorreta.'], 403);
        }
        $ch = novo_desafio($sid, 'reg', null);
        $ex = db()->prepare('SELECT credential_id FROM dbo.GN_AppPasskeys WHERE session_id=? AND revogado_em IS NULL');
        $ex->execute([$sid]);
        out(['ok' => true, 'publicKey' => [
            'challenge' => $ch,
            'rp' => ['name' => 'GambleNumbers', 'id' => APP_RP_ID],
            'user' => ['id' => b64u_enc(hex2bin($sid)), 'name' => 'conta-' . substr($sid, 0, 8), 'displayName' => 'Minha conta'],
            'pubKeyCredParams' => [['type' => 'public-key', 'alg' => -7]],
            'authenticatorSelection' => ['authenticatorAttachment' => 'platform', 'userVerification' => 'required', 'residentKey' => 'discouraged'],
            'excludeCredentials' => array_map(fn($r) => ['type' => 'public-key', 'id' => $r['credential_id']], $ex->fetchAll()),
            'attestation' => 'none', 'timeout' => 60000,
        ]]);
    }

    case 'passkey_reg_verificar': {
        usuario($sid);
        $ch = (string)($body['challenge'] ?? '');
        if (consumir_desafio($ch, $sid, 'reg') === null) out(['ok' => false, 'error' => 'Desafio expirado. Tente novamente.'], 400);
        [$cid, $pem, $cnt] = webauthn_registrar((string)($body['clientDataJSON'] ?? ''), (string)($body['attestationObject'] ?? ''), $ch);
        db()->prepare('INSERT INTO dbo.GN_AppPasskeys (session_id, credential_id, public_key_pem, sign_count, apelido) VALUES (?,?,?,?,?)')
            ->execute([$sid, $cid, $pem, $cnt, substr((string)($body['apelido'] ?? 'Meu celular'), 0, 80)]);
        app_log('passkey:registrada', ['sid' => substr($sid, 0, 8)]);
        out(['ok' => true]);
    }

    case 'passkey_revogar': {
        $u = usuario($sid);
        $chave = 'pkrev:' . $sid . ':' . client_ip();
        if (tentativas_excedidas($chave, 5, 10)) out(['ok' => false, 'error' => 'Muitas tentativas. Aguarde alguns minutos.'], 429);
        if (empty($u['senha_hash']) || !password_verify((string)($body['senha'] ?? ''), $u['senha_hash'])) { registrar_tentativa($chave); out(['ok' => false, 'error' => 'Senha incorreta.'], 403); }
        db()->prepare('UPDATE dbo.GN_AppPasskeys SET revogado_em=SYSUTCDATETIME() WHERE session_id=? AND revogado_em IS NULL')->execute([$sid]);
        out(['ok' => true]);
    }

    /* ---------- saque: cotação das três velocidades + faixa ---------- */
    case 'saque_cotar': {
        $u = usuario($sid);
        $destino = destino_btc($u);
        $preco = preco_brl();
        $niveis = niveis_taxa();
        $valorSats = valor_em_sats($body, $preco);
        $base = montar_saque($u['btc_address'], $destino, $valorSats, $niveis['min']);
        $vs = $base['vsize'];
        $mk = function (string $id, float $rate) use ($vs, $base, $preco): array {
            $fee = (int)ceil($rate * $vs);
            $rec = $base['total'] ? $base['saldo_sats'] - $fee : $base['recebido_sats'];
            $blocos = blocos_ate_confirmar($rate);
            return ['id' => $id, 'taxa_satvb' => $rate, 'fee_sats' => $fee, 'fee_brl' => round($fee / 1e8 * $preco, 2),
                'recebido_sats' => $rec, 'debitado_sats' => $rec + $fee, 'debitado_brl' => round(($rec + $fee) / 1e8 * $preco, 2),
                'eta_min' => $blocos * 10, 'blocos' => $blocos];
        };
        $lista = [$mk('min', $niveis['min']), $mk('normal', $niveis['normal']), $mk('rapida', $niveis['rapida'])];
        if (isset($body['taxa']) && ($body['nivel'] ?? '') === 'custom') {
            [, $rate] = taxa_escolhida($body, $niveis);
            $lista[] = $mk('custom', $rate);
        }
        out(['ok' => true, 'preco_brl' => $preco, 'saldo_sats' => $base['saldo_sats'], 'destino' => mascara($destino),
            'vsize' => $vs, 'faixa' => ['min' => $niveis['min'], 'max' => APP_TAXA_MAX_SATVB],
            'tudo_igual' => ($niveis['min'] === $niveis['rapida']),
            'niveis' => $lista, 'dica' => dica_endereco($u['btc_address'], $vs)]);
    }

    /* ---------- saque: cria o desafio que a digital vai assinar ---------- */
    case 'saque_desafio': {
        $u = usuario($sid);
        $destino = destino_btc($u);
        $pk = db()->prepare('SELECT credential_id FROM dbo.GN_AppPasskeys WHERE session_id=? AND revogado_em IS NULL');
        $pk->execute([$sid]);
        $creds = $pk->fetchAll(PDO::FETCH_COLUMN);
        if (!$creds) out(['ok' => false, 'codigo' => 'sem_passkey', 'error' => 'Cadastre a digital deste aparelho antes de sacar.'], 412);
        $preco = preco_brl();
        $niveis = niveis_taxa();
        [$nivel, $rate] = taxa_escolhida($body, $niveis);
        $valorSats = valor_em_sats($body, $preco);
        $t = montar_saque($u['btc_address'], $destino, $valorSats, $rate);
        if ($t['fee_sats'] * 2 >= $t['recebido_sats']) out(['ok' => false, 'error' => 'A taxa seria maior que metade do valor enviado. Aumente o valor.'], 422);
        $payload = ['destino' => $destino, 'valor_sats' => $valorSats, 'total' => $t['total'], 'rate' => $rate, 'nivel' => $nivel,
            'recebido_sats' => $t['recebido_sats'], 'fee_sats' => $t['fee_sats'], 'vsize' => $t['vsize'], 'preco_brl' => $preco];
        $ch = novo_desafio($sid, 'saque', $payload);
        out(['ok' => true, 'challenge' => $ch, 'allowCredentials' => array_map(fn($c) => ['type' => 'public-key', 'id' => $c], $creds),
            'rpId' => APP_RP_ID, 'expira_s' => APP_DESAFIO_TTL,
            'resumo' => ['destino' => mascara($destino), 'recebido_sats' => $t['recebido_sats'], 'fee_sats' => $t['fee_sats'], 'taxa_satvb' => $rate,
                'debitado_sats' => $t['debitado_sats'], 'debitado_brl' => round($t['debitado_sats'] / 1e8 * $preco, 2), 'fee_brl' => round($t['fee_sats'] / 1e8 * $preco, 2)]]);
    }

    /* ---------- saque: confere a digital e só então transmite ---------- */
    case 'saque_confirmar': {
        $u = usuario($sid);
        $ch = (string)($body['challenge'] ?? '');
        $a  = is_array($body['assertion'] ?? null) ? $body['assertion'] : [];
        $payload = consumir_desafio($ch, $sid, 'saque');
        if ($payload === null) out(['ok' => false, 'error' => 'Confirmação expirada. Refaça o saque.'], 400);

        $st = db()->prepare('SELECT credential_id, public_key_pem, sign_count FROM dbo.GN_AppPasskeys WHERE session_id=? AND credential_id=? AND revogado_em IS NULL');
        $st->execute([$sid, (string)($a['id'] ?? '')]);
        $pk = $st->fetch();
        if (!$pk) out(['ok' => false, 'error' => 'Digital não cadastrada para esta conta.'], 403);
        try {
            $novoCnt = webauthn_verificar($a, $ch, $pk['public_key_pem'], (int)$pk['sign_count']);
        } catch (Throwable $e) {
            app_log('saque:digital_recusada', ['sid' => substr($sid, 0, 8), 'motivo' => $e->getMessage()]);
            out(['ok' => false, 'error' => $e->getMessage()], 403);
        }
        db()->prepare('UPDATE dbo.GN_AppPasskeys SET sign_count=?, ultimo_uso=SYSUTCDATETIME() WHERE credential_id=?')->execute([$novoCnt, $pk['credential_id']]);

        // O destino salvo na conta não pode ter mudado entre o desafio e a confirmação.
        if (trim((string)$u['endereco_saida']) !== $payload['destino']) out(['ok' => false, 'error' => 'O endereço de destino mudou. Refaça o saque.'], 409);

        $t = montar_saque($u['btc_address'], $payload['destino'], $payload['valor_sats'], (float)$payload['rate']);
        if (abs($t['fee_sats'] - $payload['fee_sats']) > max(50, (int)($payload['fee_sats'] * 0.1)) || ($t['recebido_sats'] !== $payload['recebido_sats'] && !$t['total'])) {
            out(['ok' => false, 'error' => 'As condições mudaram (saldo ou taxa). Refaça o saque.'], 409);
        }
        app_log('saque:transmitindo', ['sid' => substr($sid, 0, 8), 'recebido' => $t['recebido_sats'], 'fee' => $t['fee_sats'], 'rate' => $payload['rate']]);
        $txid = btc_rpc('sendrawtransaction', [$t['hex']]);

        // A partir daqui o dinheiro saiu: falhas de registro não podem virar "erro de saque".
        try {
            db()->prepare('INSERT INTO dbo.GN_Saques (txid, session_id, moeda, valor, destino, foi_total, confirmado) VALUES (?,?,?,?,?,?,0)')
                ->execute([$txid, $sid, 'BTC', btc_str($t['recebido_sats']), $payload['destino'], $t['total'] ? 1 : 0]);
        } catch (Throwable $e) { app_log('saque:erro_pos_envio', ['etapa' => 'GN_Saques', 'msg' => $e->getMessage(), 'txid' => $txid]); }
        try {
            db()->prepare('INSERT INTO dbo.GN_AppSaqueMeta (txid, session_id, fee_rate_satvb, fee_sats, vsize, nivel, credential_id, valor_brl, preco_brl) VALUES (?,?,?,?,?,?,?,?,?)')
                ->execute([$txid, $sid, $payload['rate'], $t['fee_sats'], $t['vsize'], $payload['nivel'], $pk['credential_id'],
                    round($t['recebido_sats'] / 1e8 * $payload['preco_brl'], 2), $payload['preco_brl']]);
        } catch (Throwable $e) { app_log('saque:erro_pos_envio', ['etapa' => 'AppSaqueMeta', 'msg' => $e->getMessage(), 'txid' => $txid]); }
        try {
            $novo = saldo_sats($u['btc_address'], 1);
            db()->prepare('UPDATE dbo.GN_Usuarios SET btc_saldo_visto=?, ultimo_acesso=GETUTCDATE() WHERE session_id=?')->execute([btc_str($novo), $sid]);
        } catch (Throwable $e) { app_log('saque:erro_pos_envio', ['etapa' => 'saldo', 'msg' => $e->getMessage(), 'txid' => $txid]); }

        out(['ok' => true, 'txid' => $txid, 'recebido_sats' => $t['recebido_sats'], 'fee_sats' => $t['fee_sats'], 'taxa_satvb' => $payload['rate'],
            'destino' => mascara($payload['destino']), 'preco_brl' => $payload['preco_brl']]);
    }

    /* ---------- acompanhamento: lê SOMENTE o SQL (atualizado pelo serviço em lxbtc01 a cada 5 min) ---------- */
    case 'saque_status': {
        $u = usuario($sid);
        $txid = strtolower(trim((string)($body['txid'] ?? '')));
        if (!preg_match('/^[0-9a-f]{64}$/', $txid)) out(['ok' => false, 'error' => 'TXID inválido'], 400);
        $st = db()->prepare('SELECT s.txid, s.destino, s.valor, s.confirmacoes AS conf_antiga, m.fee_rate_satvb, m.fee_sats, m.preco_brl,
                a.confirmacoes, a.bloco, a.estado, a.visto_no_destino, a.recebido_sats, a.atualizado_em
            FROM dbo.GN_Saques s
            LEFT JOIN dbo.GN_AppSaqueMeta m ON m.txid=s.txid
            LEFT JOIN dbo.GN_AppSaqueStatus a ON a.txid=s.txid
            WHERE s.txid=? AND s.session_id=?');
        $st->execute([$txid, $sid]);
        $s = $st->fetch();
        if (!$s) out(['ok' => false, 'error' => 'Saque não encontrado nesta conta.'], 404);

        $temStatus = $s['estado'] !== null;
        $conf = $temStatus ? (int)$s['confirmacoes'] : (int)($s['conf_antiga'] ?? 0);
        $estado = $temStatus ? $s['estado'] : 'transmitido';
        $visto = $temStatus ? (bool)$s['visto_no_destino'] : false;
        $recebido = ($temStatus && $s['recebido_sats'] !== null) ? (int)$s['recebido_sats'] : sats($s['valor']);

        $eta1 = null; $etaAlvo = null;
        if ($conf < APP_CONF_ALVO && $estado !== 'substituida') {
            if ($conf >= 1) { $eta1 = 10; $etaAlvo = 10 + (APP_CONF_ALVO - $conf - 1) * 10; }
        }
        $sync = db()->query("SELECT DATEDIFF(SECOND, ultimo_ciclo, SYSUTCDATETIME()) AS seg FROM dbo.GN_AppSyncEstado WHERE nome='saque_status'")->fetch();
        $seg = $sync ? (int)$sync['seg'] : null;
        out(['ok' => true, 'txid' => $txid, 'estado' => $estado, 'confirmacoes' => max(0, $conf), 'alvo' => APP_CONF_ALVO,
            'bloco' => $temStatus && $s['bloco'] !== null ? (int)$s['bloco'] : null,
            'visto_no_destino' => $visto, 'recebido_sats' => $recebido,
            'fee_sats' => $s['fee_sats'] !== null ? (int)$s['fee_sats'] : null,
            'taxa_satvb' => $s['fee_rate_satvb'] !== null ? (float)$s['fee_rate_satvb'] : null,
            'preco_brl' => $s['preco_brl'] !== null ? (float)$s['preco_brl'] : null,
            'destino' => mascara($s['destino']), 'eta_proxima_min' => $eta1, 'eta_alvo_min' => $etaAlvo,
            'atualizado_ha_seg' => $temStatus ? max(0, (int)(time() - strtotime($s['atualizado_em'] . ' UTC'))) : null,
            'sync_ok' => $seg !== null && $seg < 900,
            'explorer' => 'https://mempool.space/tx/' . $txid]);
    }

    case 'saques_lista': {
        usuario($sid);
        $st = db()->prepare("SELECT TOP 20 s.txid, s.valor, s.destino, s.criado_em, COALESCE(a.confirmacoes, s.confirmacoes, 0) AS conf, a.estado
            FROM dbo.GN_Saques s LEFT JOIN dbo.GN_AppSaqueStatus a ON a.txid=s.txid
            WHERE s.session_id=? AND s.moeda='BTC' ORDER BY s.criado_em DESC");
        $st->execute([$sid]);
        $o = [];
        foreach ($st->fetchAll() as $r) $o[] = ['txid' => $r['txid'], 'valor_sats' => sats($r['valor']), 'destino' => mascara($r['destino']), 'criado_em' => $r['criado_em'], 'confirmacoes' => (int)$r['conf'], 'estado' => $r['estado']];
        out(['ok' => true, 'saques' => $o]);
    }

    default:
        out(['ok' => false, 'error' => 'ação desconhecida'], 400);
    }
} catch (Throwable $e) {
    app_log('excecao', ['action' => $action, 'msg' => $e->getMessage(), 'linha' => $e->getLine()]);
    out(['ok' => false, 'error' => msg_publica($e)], 500);
}
