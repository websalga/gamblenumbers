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
require_once __DIR__ . '/../../private/seguranca_lib.php';   // espera de 24 h apos ativar 2FA ou trocar endereco
require_once __DIR__ . '/../../private/swap_lib.php';   // trocas BTC/BCH <-> USDC/USDT (THORChain)
require_once __DIR__ . '/../../private/pagar_lib.php';  // opcao Pagar: transferencia para qualquer endereco

$body   = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];
$action = (string)($body['action'] ?? '');
$sid    = trim((string)($body['session_id'] ?? ''));

function usuario(string $sid): array {
    if (strlen($sid) !== 64 || !ctype_xdigit($sid)) out(['ok' => false, 'error' => 'sessão inválida'], 400);
    $st = db()->prepare('SELECT session_id, btc_address, moeda_saida, endereco_saida, senha_hash FROM dbo.GN_Usuarios WHERE session_id=? AND ativo=1');
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

/*
 * Regras de saque iguais as do site, conferidas ao criar o desafio E de novo ao confirmar: bloqueio do
 * administrador e espera de 24 h depois de trocar o endereco de saida, de ativar o 2FA (quem ativou) ou
 * de cadastrar uma digital nova. No app a digital faz o papel do codigo do 2FA.
 */
function checar_saque(string $sid): void {
    // S04: com o no BTC fora do ar, dessincronizado ou sem carteira, nenhum saque e' aceito
    if (!seg_no_operacional('BTC')) out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
    $seg = seg_linha(db(), $sid);
    if ($seg && $seg['bloqueado_admin']) out(['ok' => false, 'codigo' => 'bloqueado_admin', 'error' => 'Saques desta conta estão bloqueados. Fale com o suporte.'], 423);
    if ($lib = seg_saque_liberado_em($seg, seg_ultima_passkey_em(db(), $sid))) out(['ok' => false, 'codigo' => 'espera_2fa', 'saque_liberado_em' => gmdate('c', $lib),
        'error' => 'Por segurança, saques ficam liberados a partir de ' . gmdate('d/m H:i', $lib) . ' UTC (24 h depois de trocar o endereço de saída, ativar a verificação em 2 etapas ou cadastrar uma digital nova).'], 423);
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
        if ($r < $niveis['piso'] || $r > APP_TAXA_MAX_SATVB) out(['ok' => false, 'error' => 'Taxa fora da faixa permitida (' . $niveis['piso'] . ' a ' . APP_TAXA_MAX_SATVB . ' sat/vB).'], 422);
        return ['custom', $r];
    }
    if (!in_array($nivel, ['min', 'normal', 'rapida'], true)) $nivel = 'min';
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

/* ---------- trocas: perfil com os enderecos das 3 redes ---------- */
function swap_usuario(string $sid): array {
    if (strlen($sid) !== 64 || !ctype_xdigit($sid)) out(['ok' => false, 'error' => 'sessão inválida'], 400);
    $st = db()->prepare('SELECT session_id, btc_address, bch_address, eth_address, moeda_saida, endereco_saida, endereco_saida_eth FROM dbo.GN_Usuarios WHERE session_id=? AND ativo=1');
    $st->execute([$sid]); $u = $st->fetch();
    if (!$u) out(['ok' => false, 'error' => 'sessão não encontrada'], 404);
    return $u;
}
/* body: lado=vender {para USDC|USDT, tipo brl|btc|max, valor} | lado=comprar {de USDC|USDT, para BTC|BCH, valor (em US$)} */
function swap_cotacao(array $u, array $b): array {
    $lado = (string)($b['lado'] ?? '');
    $usd = usd_brl();
    if ($lado === 'vender') {
        $para = in_array($b['para'] ?? '', ['USDC', 'USDT', 'BTC', 'ETH'], true) ? $b['para'] : 'USDC';
        $de = ($b['de'] ?? 'BTC') === 'BCH' ? 'BCH' : 'BTC';
        // BCH -> BTC so para a carteira de SAIDA cadastrada (porta para o mundo fiduciario), nunca para outro endereco
        $dest = null; $pxDest = 0.0;
        if ($para === 'BTC') {
            if ($de !== 'BCH') out(['ok' => false, 'error' => 'Escolha BCH para converter em BTC.'], 422);
            if (($u['moeda_saida'] ?? '') !== 'BTC' || empty($u['endereco_saida'])) out(['ok' => false, 'codigo' => 'sem_saida', 'error' => 'Cadastre antes a sua carteira de saída BTC (no site, em ⚙ Configuração).'], 422);
            $dest = (string)$u['endereco_saida']; $pxDest = preco_brl();
        }
        if ($para === 'ETH') {   // BTC/BCH -> ETH no perfil -> repasse automatico para a carteira de saida ETH
            if (empty($u['endereco_saida_eth'])) out(['ok' => false, 'codigo' => 'sem_saida_eth', 'error' => 'Cadastre antes a sua carteira de saída ETH (no site, em ⚙ Configuração).'], 422);
            $dest = (string)$u['endereco_saida_eth']; $pxDest = eth_preco_usd() * $usd;
        }
        $origem = (string)($de === 'BCH' ? $u['bch_address'] : $u['btc_address']);
        if ($origem === '') out(['ok' => false, 'error' => 'Sua conta não tem endereço ' . $de . '.'], 422);
        $preco = $de === 'BCH' ? preco_bch_brl() : preco_brl();
        $saldo = $de === 'BCH' ? bch_saldo_sats($origem, 1) : saldo_sats($origem, 1);
        $sats = valor_em_sats($b, $preco);
        if ($sats === null) $sats = max(0, $saldo - 2000);           // "tudo": reserva a taxa de mineracao
        if ($sats + 1000 > $saldo) out(['ok' => false, 'error' => 'Saldo insuficiente (considere ~1.000 sats de taxa de rede).'], 422);
        $c = venda_cotar($u, $sats, $para, $preco, $usd, $de, $dest, $pxDest);
        if (($b['tipo'] ?? '') === 'max') {
            // "Tudo": deixa so a taxa de mineracao (com folga de 60%) e um troco minimo acima do limite de poeira
            $reserva = (int)ceil($c['fee_est_sats'] * 1.6) + 546;
            if ($saldo - $sats < $reserva) { $sats = $saldo - $reserva; $c = venda_cotar($u, $sats, $para, $preco, $usd, $de, $dest, $pxDest); }
        }
        if ($c['min_sats'] && $sats < $c['min_sats']) out(['ok' => false, 'codigo' => 'abaixo_minimo', 'error' => 'Valor abaixo do mínimo da THORChain (' . number_format($c['min_sats'] / 1e8 * $preco, 2, ',', '.') . ' reais).', 'min_brl' => round($c['min_sats'] / 1e8 * $preco, 2)], 422);
        $c['saldo_sats'] = $saldo; $c['preco_brl'] = $preco; $c['usd_brl'] = $usd;
        return $c;
    }
    if ($lado === 'comprar') {
        $de = in_array($b['de'] ?? '', ['USDC', 'USDT', 'ETH'], true) ? $b['de'] : 'USDC';
        $para = in_array($b['para'] ?? '', ['BTC', 'BCH', 'ETH'], true) ? $b['para'] : 'BTC';
        if ($para === 'ETH' && ($de === 'ETH' || empty($u['endereco_saida_eth']))) out(['ok' => false, 'codigo' => 'sem_saida_eth', 'error' => $de === 'ETH' ? 'Para mandar ETH ao banco, use "Sacar ETH".' : 'Cadastre antes a sua carteira de saída ETH (no site, em ⚙ Configuração).'], 422);
        $pxOrig = $de === 'ETH' ? eth_preco_usd() : 1.0;   // US$ por unidade da moeda de origem
        $txt = preg_replace('/\s+/', '', (string)($b['valor'] ?? '0'));
        if (str_contains($txt, ',')) $txt = str_replace(',', '.', str_replace('.', '', $txt));
        $v = is_numeric($txt) ? (float)$txt : 0.0;
        if (($b['tipo'] ?? 'usd') === 'brl') $v = $v / $usd;
        $v = $v / $pxOrig;                                  // US$ -> unidades da moeda de origem
        $col = $de === 'USDT' ? 'balance_usdt' : ($de === 'ETH' ? 'CAST(balance_eth_wei / 1e18 AS float)' : 'balance_usdc');
        $st = db()->prepare('SELECT ' . $col . ' AS s FROM dbo.GN_ETH_AddressCache WHERE address=?');
        $st->execute([(string)$u['eth_address']]); $saldo = (float)($st->fetch()['s'] ?? 0);
        if ($de === 'ETH') $saldo = max(0.0, $saldo - SWAP_ETH_RESERVA);   // reserva para o gas do deposito
        if (($b['tipo'] ?? '') === 'max') $v = $saldo;
        $casas = $de === 'ETH' ? 1e8 : 1e6;
        $v = floor($v * $casas) / $casas;
        if ($v <= 0) out(['ok' => false, 'error' => 'Informe um valor maior que zero.'], 422);
        if ($v > $saldo + 1e-9) out(['ok' => false, 'error' => 'Saldo de ' . $de . ' insuficiente (disponível ' . number_format($saldo, 2, ',', '.') . ').'], 422);
        $c = compra_cotar($u, $v, $de, $para, $usd, $para === 'BTC' ? preco_brl() : ($para === 'ETH' ? eth_preco_usd() * $usd : preco_bch_brl()), $pxOrig);
        if ($para === 'ETH') { $c['saida'] = true; $c['repasse'] = true; $c['saida_eth'] = (string)$u['endereco_saida_eth']; }
        $c['saldo'] = $saldo; $c['usd_brl'] = $usd;
        return $c;
    }
    if ($lado === 'sacar_eth') {
        if (empty($u['endereco_saida_eth'])) out(['ok' => false, 'codigo' => 'sem_saida_eth', 'error' => 'Cadastre antes a sua carteira de saída ETH (no site, em ⚙ Configuração).'], 422);
        $px = eth_preco_usd();
        $st = db()->prepare('SELECT CAST(balance_eth_wei / 1e18 AS float) AS s FROM dbo.GN_ETH_AddressCache WHERE address=?');
        $st->execute([(string)$u['eth_address']]); $saldo = max(0.0, (float)($st->fetch()['s'] ?? 0) - SWAP_ETH_RESERVA);
        $txt = preg_replace('/\s+/', '', (string)($b['valor'] ?? '0'));
        if (str_contains($txt, ',')) $txt = str_replace(',', '.', str_replace('.', '', $txt));
        $v = is_numeric($txt) ? (float)$txt : 0.0;
        $tipo = (string)($b['tipo'] ?? 'brl');
        if ($tipo === 'brl') $v = $v / $usd / $px; elseif ($tipo === 'usd') $v = $v / $px; elseif ($tipo === 'max') $v = $saldo;
        $v = floor($v * 1e8) / 1e8;
        if ($v <= 0) out(['ok' => false, 'error' => $tipo === 'max' ? 'Sem ETH para sacar (fica uma reserva de ' . SWAP_ETH_RESERVA . ' ETH para o gás).' : 'Informe um valor maior que zero.'], 422);
        if ($v > $saldo + 1e-12) out(['ok' => false, 'error' => 'Saldo de ETH insuficiente (disponível ' . number_format($saldo, 6, ',', '.') . ' ETH, já descontada a reserva de gás).'], 422);
        $gasBrl = 21000 * 1e-9 * 0.3 * $px * $usd;   // estimativa (~0,3 gwei); o gas real sai do ETH do perfil
        return ['lado' => 'sacar_eth', 'de' => 'ETH', 'para' => 'ETH', 'envia' => $v, 'recebe' => $v, 'destino' => (string)$u['endereco_saida_eth'],
            'saida' => true, 'entrada_brl' => round($v * $px * $usd, 2), 'recebe_brl' => round($v * $px * $usd, 2), 'custo_brl' => round($gasBrl, 2),
            'custo_pct' => 0, 'usd_brl' => $usd, 'expira' => time() + 600, 'tempo_s' => 60, 'saldo' => $saldo];
    }
    out(['ok' => false, 'error' => 'Tipo de troca inválido.'], 400);
}
/* Situacao publica de uma troca (sem enderecos completos) */
function swap_publico(array $r): array {
    $mapa = ['solicitado' => 'aguardando', 'cotado' => 'aguardando', 'aprovado' => 'na fila', 'assinando' => 'enviando', 'gas_enviado' => 'enviando',
        'approve_enviado' => 'enviando', 'deposito_enviado' => 'trocando', 'concluido' => 'concluída', 'reembolsado' => 'devolvida', 'erro' => 'falhou',
        'cancelado' => 'cancelada', 'expirado' => 'expirada'];
    [$de, $para] = array_pad(explode('>', (string)$r['direcao']), 2, '');
    $tx = (string)($r['tx_deposit'] ?? '');
    return ['id' => (int)$r['id'], 'de' => $de, 'para' => $para, 'valor' => (float)$r['from_amount'], 'esperado' => $r['expected_out'] !== null ? (float)$r['expected_out'] : null,
        'minimo' => $r['min_out'] !== null ? (float)$r['min_out'] : null, 'status' => $r['status'], 'situacao' => $mapa[$r['status']] ?? $r['status'],
        'erro' => $r['status'] === 'erro' ? 'A troca não foi feita. ' . (str_contains((string)$r['erro'], 'saldo') ? 'Saldo insuficiente.' : 'Nenhum valor saiu da sua conta.') : null,
        'criado_em' => $r['criado_em'], 'link' => ($tx && $para !== 'SAIDA') ? 'https://thorchain.net/tx/' . strtoupper(preg_replace('/^0x/i', '', $tx)) : null,
        'tx_envio' => $tx ?: null, 'tx_envio_link' => $tx ? swap_explorer($de, $tx) : null,
        'tx_recebido' => !empty($r['tx_saida']) ? strtolower((string)$r['tx_saida']) : null,
        'tx_recebido_link' => !empty($r['tx_saida']) ? swap_explorer($para, (string)$r['tx_saida']) : null,
        'repasse' => !empty($r['repasse_saida']), 'tx_repasse' => (isset($r['tx_repasse']) && str_starts_with((string)$r['tx_repasse'], '0x')) ? $r['tx_repasse'] : null,
        'tx_repasse_link' => (isset($r['tx_repasse']) && str_starts_with((string)$r['tx_repasse'], '0x')) ? 'https://etherscan.io/tx/' . $r['tx_repasse'] : null];
}
/* Link publico do explorador para um txid, conforme a rede do ativo */
function swap_explorer(string $ativo, string $tx): string {
    $t = strtolower(preg_replace('/^0x/i', '', $tx));
    if ($ativo === 'BTC') return 'https://mempool.space/tx/' . $t;
    if ($ativo === 'BCH') return 'https://blockchair.com/bitcoin-cash/transaction/' . $t;
    return 'https://etherscan.io/tx/0x' . $t;
}

try {
    if (str_starts_with($action, 'pagar_') || $action === 'pagamentos_lista') { require __DIR__ . '/../../private/pagar_api.php'; }
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
        $bchConf = $bchPend = 0; $precoBch = 0.0;
        try {
            $sb = db()->prepare('SELECT bch_address FROM dbo.GN_Usuarios WHERE session_id=?'); $sb->execute([$sid]); $bchAddr = (string)($sb->fetchColumn() ?: '');
            if ($bchAddr !== '') { $bchConf = bch_saldo_sats($bchAddr, 1); $bchPend = bch_saldo_sats($bchAddr, 0, 0); if ($bchConf + $bchPend > 0) $precoBch = preco_bch_brl(); }
        } catch (Throwable $e) {}
        out(['ok' => true,
            'bch_sats' => $bchConf, 'bch_pendente_sats' => $bchPend, 'preco_bch_brl' => $precoBch, 'bch_brl' => round($bchConf / 1e8 * $precoBch, 2),
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
        // Com o 2FA ativo (opcional), cadastrar uma digital tambem pede o codigo do app autenticador:
        // senao quem descobrisse a senha cadastraria a propria digital e sacaria pelo app sem o codigo.
        if ($e = seg_exigir_se_ativo(db(), $sid, trim((string)($body['codigo_2fa'] ?? '')))) {
            out(['ok' => false, 'codigo' => 'precisa_codigo_2fa', 'codigo_invalido' => !empty($e['codigo_invalido']), 'error' => $e['error']], 403);
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
                'eta_min' => $blocos * 10, 'blocos' => $blocos, 'medido' => tempo_medido($rate)];
        };
        $lista = [$mk('min', $niveis['min']), $mk('normal', $niveis['normal']), $mk('rapida', $niveis['rapida'])];
        if (isset($body['taxa']) && ($body['nivel'] ?? '') === 'custom') {
            [, $rate] = taxa_escolhida($body, $niveis);
            $lista[] = $mk('custom', $rate);
        }
        out(['ok' => true, 'preco_brl' => $preco, 'saldo_sats' => $base['saldo_sats'], 'destino' => mascara($destino),
            'vsize' => $vs, 'faixa' => ['min' => $niveis['piso'], 'max' => APP_TAXA_MAX_SATVB],
            'tudo_igual' => ($niveis['min'] === $niveis['rapida']),
            'niveis' => $lista, 'dica' => dica_endereco($u['btc_address'], $vs)]);
    }

    /* ---------- saque: cria o desafio que a digital vai assinar ---------- */
    case 'saque_desafio': {
        $u = usuario($sid);
        checar_saque($sid);
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
        // o bloqueio ou a espera podem ter comecado depois do desafio: confere de novo antes de assinar
        checar_saque($sid);

        $st = db()->prepare('SELECT credential_id, public_key_pem, sign_count FROM dbo.GN_AppPasskeys WHERE session_id=? AND credential_id=? AND revogado_em IS NULL');
        $st->execute([$sid, (string)($a['id'] ?? '')]);
        $pk = $st->fetch();
        if (!$pk) out(['ok' => false, 'error' => 'Digital não cadastrada para esta conta.'], 403);
        try {
            $novoCnt = webauthn_verificar($a, $ch, $pk['public_key_pem'], (int)$pk['sign_count']);
        } catch (Throwable $e) {
            seg_log(db(), 'saque_app', 'recusado', ['origem' => 'app', 'moeda' => 'BTC', 'resultado' => 'recusado', 'motivo' => 'digital: ' . $e->getMessage()], $sid);
            out(['ok' => false, 'error' => $e->getMessage()], 403);
        }
        db()->prepare('UPDATE dbo.GN_AppPasskeys SET sign_count=?, ultimo_uso=SYSUTCDATETIME() WHERE credential_id=?')->execute([$novoCnt, $pk['credential_id']]);

        // O destino salvo na conta não pode ter mudado entre o desafio e a confirmação.
        if (trim((string)$u['endereco_saida']) !== $payload['destino']) out(['ok' => false, 'error' => 'O endereço de destino mudou. Refaça o saque.'], 409);

        $t = montar_saque($u['btc_address'], $payload['destino'], $payload['valor_sats'], (float)$payload['rate']);
        if (abs($t['fee_sats'] - $payload['fee_sats']) > max(50, (int)($payload['fee_sats'] * 0.1)) || ($t['recebido_sats'] !== $payload['recebido_sats'] && !$t['total'])) {
            out(['ok' => false, 'error' => 'As condições mudaram (saldo ou taxa). Refaça o saque.'], 409);
        }
        // S05 + S04: registrar no SQL antes de transmitir; se nao gravar, nada e' enviado (nunca cai para arquivo)
        $LA = fn(string $etapa, array $c) => seg_log(db(), 'saque_app', $etapa, $c + ['origem' => 'app', 'moeda' => 'BTC', 'destino' => $payload['destino']], $sid);
        if (!$LA('aprovado', ['valor' => btc_str($t['recebido_sats']), 'taxa' => $payload['rate'], 'resultado' => 'em_andamento'])) {
            out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
        }
        $txid = btc_rpc('sendrawtransaction', [$t['hex']]);
        $LA('enviado', ['valor' => btc_str($t['recebido_sats']), 'taxa' => $payload['rate'], 'txid' => $txid, 'resultado' => 'ok']);

        // A partir daqui o dinheiro saiu: falhas de registro não podem virar "erro de saque".
        try {
            db()->prepare('INSERT INTO dbo.GN_Saques (txid, session_id, moeda, valor, destino, foi_total, confirmado) VALUES (?,?,?,?,?,?,0)')
                ->execute([$txid, $sid, 'BTC', btc_str($t['recebido_sats']), $payload['destino'], $t['total'] ? 1 : 0]);
        } catch (Throwable $e) { $LA('erro_pos_envio', ['txid' => $txid, 'resultado' => 'erro_pos_envio', 'motivo' => 'GN_Saques: ' . $e->getMessage()]); }
        try {
            db()->prepare('INSERT INTO dbo.GN_AppSaqueMeta (txid, session_id, fee_rate_satvb, fee_sats, vsize, nivel, credential_id, valor_brl, preco_brl) VALUES (?,?,?,?,?,?,?,?,?)')
                ->execute([$txid, $sid, $payload['rate'], $t['fee_sats'], $t['vsize'], $payload['nivel'], $pk['credential_id'],
                    round($t['recebido_sats'] / 1e8 * $payload['preco_brl'], 2), $payload['preco_brl']]);
        } catch (Throwable $e) { $LA('erro_pos_envio', ['txid' => $txid, 'resultado' => 'erro_pos_envio', 'motivo' => 'AppSaqueMeta: ' . $e->getMessage()]); }
        try {
            $novo = saldo_sats($u['btc_address'], 1);
            db()->prepare('UPDATE dbo.GN_Usuarios SET btc_saldo_visto=?, ultimo_acesso=GETUTCDATE() WHERE session_id=?')->execute([btc_str($novo), $sid]);
        } catch (Throwable $e) { $LA('erro_pos_envio', ['txid' => $txid, 'resultado' => 'erro_pos_envio', 'motivo' => 'saldo: ' . $e->getMessage()]); }

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

        $bloco = $temStatus && $s['bloco'] !== null ? (int)$s['bloco'] : null;
        // Esperando a 1a confirmacao: pergunta na hora a mempool local (o gn-saque-sync so roda a cada 5 min).
        if ($conf < 1 && $estado !== 'substituida') {
            $v = mempool_get('/api/tx/' . $txid . '/status', 3);
            if ($v && !empty($v['confirmed'])) { $conf = 1; $visto = true; if (isset($v['block_height'])) $bloco = (int)$v['block_height']; }
        }

        $eta1 = null; $etaAlvo = null;
        if ($conf < APP_CONF_ALVO && $estado !== 'substituida') {
            if ($conf >= 1) { $eta1 = 10; $etaAlvo = 10 + (APP_CONF_ALVO - $conf - 1) * 10; }
        }
        $sync = db()->query("SELECT DATEDIFF(SECOND, ultimo_ciclo, SYSUTCDATETIME()) AS seg, altura_tip FROM dbo.GN_AppSyncEstado WHERE nome='saque_status'")->fetch();
        $seg = $sync ? (int)$sync['seg'] : null;
        // 09/11/2026: contagem real. O gn-saque-sync para de consultar o no ao chegar no alvo (3 = concluido, regra
        // inalterada); depois disso a contagem vem do topo da rede que ele grava a cada ciclo: topo - bloco + 1.
        $tip = $sync && $sync['altura_tip'] !== null ? (int)$sync['altura_tip'] : null;
        if ($bloco && $tip && $tip >= $bloco && $estado !== 'substituida') $conf = max($conf, $tip - $bloco + 1);
        out(['ok' => true, 'txid' => $txid, 'estado' => $estado, 'confirmacoes' => max(0, $conf), 'alvo' => APP_CONF_ALVO,
            'bloco' => $bloco,
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
        $st = db()->prepare("SELECT TOP 20 s.txid, s.valor, s.destino, s.criado_em, COALESCE(a.confirmacoes, s.confirmacoes, 0) AS conf, a.estado, a.bloco,
                   (SELECT altura_tip FROM dbo.GN_AppSyncEstado WHERE nome='saque_status') AS tip
            FROM dbo.GN_Saques s LEFT JOIN dbo.GN_AppSaqueStatus a ON a.txid=s.txid
            WHERE s.session_id=? AND s.moeda='BTC' ORDER BY s.criado_em DESC");
        $st->execute([$sid]);
        $o = [];
        foreach ($st->fetchAll() as $r) $o[] = ['txid' => $r['txid'], 'valor_sats' => sats($r['valor']), 'destino' => mascara($r['destino']), 'criado_em' => $r['criado_em'], 'confirmacoes' => ($r['bloco'] && $r['tip'] && (int)$r['tip'] >= (int)$r['bloco'] && $r['estado'] !== 'substituida') ? max((int)$r['conf'], (int)$r['tip'] - (int)$r['bloco'] + 1) : (int)$r['conf'], 'estado' => $r['estado']];
        out(['ok' => true, 'saques' => $o]);
    }

    /* ================= TROCAS (THORChain): vender BTC -> USDC/USDT e comprar BTC/BCH com USDC/USDT ================= */
    case 'swap_saldos': {
        $u = swap_usuario($sid);
        $preco = preco_brl(); $usd = usd_brl();
        $st = db()->prepare('SELECT balance_usdc, balance_usdt, balance_eth_wei, last_checked_utc FROM dbo.GN_ETH_AddressCache WHERE address=?');
        $st->execute([(string)$u['eth_address']]); $c = $st->fetch() ?: [];
        $eth = (float)($c['balance_eth_wei'] ?? 0) / 1e18; $ethUsd = 0.0; try { $ethUsd = eth_preco_usd(); } catch (Throwable $e) {}
        out(['ok' => true, 'btc_sats' => saldo_sats($u['btc_address'], 1), 'usdc' => (float)($c['balance_usdc'] ?? 0), 'usdt' => (float)($c['balance_usdt'] ?? 0),
            'eth' => $eth, 'eth_usd' => $ethUsd, 'eth_reserva' => SWAP_ETH_RESERVA,
            'saida_eth' => !empty($u['endereco_saida_eth']) ? mascara((string)$u['endereco_saida_eth']) : null,
            'bch_sats' => (function () use ($u) { try { return bch_saldo_sats((string)$u['bch_address'], 1); } catch (Throwable $e) { return 0; } })(),
            'preco_bch_brl' => (function () { try { return preco_bch_brl(); } catch (Throwable $e) { return 0; } })(),
            'eth_address' => $u['eth_address'] ? mascara($u['eth_address']) : null, 'preco_btc_brl' => $preco, 'usd_brl' => $usd,
            'tem_bch' => !empty($u['bch_address'])]);
    }

    case 'swap_cotar': {
        $u = swap_usuario($sid);
        out(['ok' => true, 'cot' => swap_cotacao($u, $body)]);
    }

    case 'swap_sideshift': {
        // Comparacao de preco com a SideShift (so consulta; a troca e sempre executada pela THORChain)
        swap_usuario($sid);
        $de = (string)($body['de'] ?? ''); $para = (string)($body['para'] ?? ''); $v = (float)($body['origem'] ?? 0);
        $c = sideshift_cotar($de, $para, $v);
        $usd = usd_brl();
        $c['recebe_brl'] = in_array($para, ['USDC', 'USDT'], true) ? $c['recebe'] * $usd
            : ($para === 'ETH' ? $c['recebe'] * eth_preco_usd() * $usd : $c['recebe'] * ($para === 'BTC' ? preco_brl() : preco_bch_brl()));
        $c['recebe_brl'] = round($c['recebe_brl'], 2); $c['usd_brl'] = $usd; $c['para'] = $para;
        out(['ok' => true, 'ss' => $c]);
    }

    case 'swap_desafio': {
        $u = swap_usuario($sid);
        checar_saque($sid);
        $pk = db()->prepare('SELECT credential_id FROM dbo.GN_AppPasskeys WHERE session_id=? AND revogado_em IS NULL');
        $pk->execute([$sid]); $creds = $pk->fetchAll(PDO::FETCH_COLUMN);
        if (!$creds) out(['ok' => false, 'codigo' => 'sem_passkey', 'error' => 'Cadastre a digital deste aparelho antes de trocar.'], 412);
        $cot = swap_cotacao($u, $body);
        $ch = novo_desafio($sid, 'swap', $cot);
        out(['ok' => true, 'challenge' => $ch, 'allowCredentials' => array_map(fn($c) => ['type' => 'public-key', 'id' => $c], $creds),
            'rpId' => APP_RP_ID, 'expira_s' => APP_DESAFIO_TTL, 'cot' => $cot]);
    }

    case 'swap_confirmar': {
        $u = swap_usuario($sid);
        $ch = (string)($body['challenge'] ?? ''); $a = is_array($body['assertion'] ?? null) ? $body['assertion'] : [];
        $cot = consumir_desafio($ch, $sid, 'swap');
        if ($cot === null) out(['ok' => false, 'error' => 'Confirmação expirada. Refaça a troca.'], 400);
        checar_saque($sid);
        $st = db()->prepare('SELECT credential_id, public_key_pem, sign_count FROM dbo.GN_AppPasskeys WHERE session_id=? AND credential_id=? AND revogado_em IS NULL');
        $st->execute([$sid, (string)($a['id'] ?? '')]); $pk = $st->fetch();
        if (!$pk) out(['ok' => false, 'error' => 'Digital não cadastrada para esta conta.'], 403);
        try { $novoCnt = webauthn_verificar($a, $ch, $pk['public_key_pem'], (int)$pk['sign_count']); }
        catch (Throwable $e) { seg_log(db(), 'swap_app', 'recusado', ['origem' => 'app', 'resultado' => 'recusado', 'motivo' => 'digital: ' . $e->getMessage()], $sid); out(['ok' => false, 'error' => $e->getMessage()], 403); }
        db()->prepare('UPDATE dbo.GN_AppPasskeys SET sign_count=?, ultimo_uso=SYSUTCDATETIME() WHERE credential_id=?')->execute([$novoCnt, $pk['credential_id']]);
        if ((int)$cot['expira'] < time() + 60) out(['ok' => false, 'error' => 'A cotação venceu. Refaça a troca.'], 409);
        $LA = fn(string $etapa, array $c) => seg_log(db(), 'swap_app', $etapa, $c + ['origem' => 'app', 'moeda' => $cot['de'] . '>' . $cot['para']], $sid);

        if ($cot['lado'] === 'vender') {
            $de = ($cot['de'] ?? 'BTC') === 'BCH' ? 'BCH' : 'BTC';
            $origem = (string)($de === 'BCH' ? $u['bch_address'] : $u['btc_address']);
            $paraBtc = ($cot['para'] ?? '') === 'BTC'; $paraEth = ($cot['para'] ?? '') === 'ETH';
            $destOk = $paraBtc ? (string)$u['endereco_saida'] : (string)$u['eth_address'];
            if ($paraEth && strtolower((string)($u['endereco_saida_eth'] ?? '')) !== strtolower((string)($cot['saida_eth'] ?? '-'))) out(['ok' => false, 'error' => 'A carteira de saída ETH mudou desde a cotação. Refaça a troca. Nada foi enviado.'], 409);
            if ($paraBtc && (($u['moeda_saida'] ?? '') !== 'BTC' || $de !== 'BCH')) out(['ok' => false, 'error' => 'Carteira de saída BTC não cadastrada. Nada foi enviado.'], 409);
            if (strtolower((string)$cot['destino']) !== strtolower($destOk)) out(['ok' => false, 'error' => 'O destino mudou desde a cotação. Refaça a troca. Nada foi enviado.'], 409);
            if (!in_array(strtolower($cot['cofre']), thor_cofres($de), true)) out(['ok' => false, 'error' => 'O cofre da THORChain mudou. Refaça a troca.'], 409);
            $t = venda_montar($origem, $cot['cofre'], (int)$cot['envia_sats'], $cot['memo'], (float)$cot['taxa_satvb'], $de);
            if (!$LA('aprovado', ['valor' => btc_str((int)$cot['envia_sats']), 'resultado' => 'em_andamento'])) out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
            $ins = db()->prepare("INSERT INTO dbo.GN_SwapJobs (session_id, direcao, provedor, from_asset, from_amount, to_asset, from_address, dest_address, expected_out, min_out, memo, vault,
                quote_expira_utc, status, tx_deposit, origem, preco_brl, custo_brl, tx_fee_sats, repasse_saida) OUTPUT INSERTED.id
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,DATEADD(second, CAST(? AS int), '1970-01-01'),'assinando',?,?,?,?,?,?)");
            $ins->execute([$sid, $de . '>' . $cot['para'], 'thorchain', $de . '.' . $de, btc_str((int)$cot['envia_sats']), $paraBtc ? 'BTC.BTC' : ($paraEth ? 'ETH.ETH' : 'ETH.' . $cot['para']), $origem, $destOk,
                $cot['recebe'], $cot['minimo'], $cot['memo'], $cot['cofre'], (int)$cot['expira'], $t['txid'], 'app', $de === 'BCH' ? preco_bch_brl() : preco_brl(), $cot['custo_brl'], $t['fee_sats'], $paraEth ? 1 : 0]);
            $id = (int)$ins->fetchColumn();
            try { $txid = $de === 'BCH' ? bch_rpc('sendrawtransaction', [$t['hex']]) : btc_rpc('sendrawtransaction', [$t['hex']]); }
            catch (Throwable $e) {
                db()->prepare("UPDATE dbo.GN_SwapJobs SET status='erro', erro=?, atualizado_em=SYSUTCDATETIME() WHERE id=?")->execute([mb_substr($e->getMessage(), 0, 1900), $id]);
                $LA('recusado', ['valor' => btc_str((int)$cot['envia_sats']), 'resultado' => 'recusado', 'motivo' => 'envio: ' . $e->getMessage()]);
                out(['ok' => false, 'error' => 'A rede não aceitou o envio. Nada saiu da sua conta.'], 502);
            }
            db()->prepare("UPDATE dbo.GN_SwapJobs SET status='deposito_enviado', tx_deposit=?, atualizado_em=SYSUTCDATETIME() WHERE id=?")->execute([$txid, $id]);
            $LA('enviado', ['valor' => btc_str((int)$cot['envia_sats']), 'txid' => $txid, 'resultado' => 'ok']);
            // Se a troca nasceu de uma sugestao dos robos, marca como aprovada (so a sugestao pendente deste perfil)
            $sug = (int)($body['sugestao_id'] ?? 0);
            if ($sug > 0) { try { db()->prepare("UPDATE dbo.GN_RoboSugestoes SET status='aprovada', decidido_em=SYSUTCDATETIME(), swap_job_id=? WHERE id=? AND session_id=? AND status='pendente'")->execute([$id, $sug, $sid]); } catch (Throwable $e) {} }
            out(['ok' => true, 'id' => $id, 'txid' => $txid]);
        }
        if ($cot['lado'] === 'sacar_eth') {
            // saque de ETH: o assinador confere de novo a carteira de saida ETH e o bloqueio de 24 h antes de enviar
            if (strtolower((string)($u['endereco_saida_eth'] ?? '')) !== strtolower((string)$cot['destino'])) out(['ok' => false, 'error' => 'A carteira de saída ETH mudou desde a cotação. Refaça. Nada foi enviado.'], 409);
            if (!$LA('aprovado', ['valor' => (string)$cot['envia'], 'resultado' => 'em_andamento'])) out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
            $ins = db()->prepare("INSERT INTO dbo.GN_SwapJobs (session_id, direcao, provedor, from_asset, from_amount, to_asset, from_address, dest_address, expected_out, min_out,
                quote_expira_utc, status, origem, preco_brl, custo_brl) OUTPUT INSERTED.id
                VALUES (?,?,?,?,?,?,?,?,?,?,DATEADD(second, CAST(? AS int), '1970-01-01'),'aprovado',?,?,?)");
            $ins->execute([$sid, 'ETH>SAIDA', 'saque', 'ETH.ETH', sprintf('%.8f', $cot['envia']), 'ETH.ETH', $u['eth_address'], $cot['destino'], sprintf('%.8f', $cot['envia']), sprintf('%.8f', $cot['envia']),
                (int)$cot['expira'], 'app', eth_preco_usd() * usd_brl(), $cot['custo_brl']]);
            out(['ok' => true, 'id' => (int)$ins->fetchColumn()]);
        }
        // comprar: o assinador (lxbch01) pega o pedido 'aprovado', revalida e envia pela rede Ethereum
        $col = $cot['de'] === 'USDT' ? 'balance_usdt' : ($cot['de'] === 'ETH' ? 'CAST(balance_eth_wei / 1e18 AS float)' : 'balance_usdc');
        $st = db()->prepare('SELECT ' . $col . ' AS s FROM dbo.GN_ETH_AddressCache WHERE address=?');
        $st->execute([(string)$u['eth_address']]); $saldo = (float)($st->fetch()['s'] ?? 0);
        if ($cot['de'] === 'ETH') $saldo -= SWAP_ETH_RESERVA;
        if ($saldo + 1e-9 < (float)$cot['envia']) out(['ok' => false, 'error' => 'Saldo de ' . $cot['de'] . ' insuficiente.'], 422);
        if (($cot['para'] ?? '') === 'ETH' && strtolower((string)($u['endereco_saida_eth'] ?? '')) !== strtolower((string)($cot['saida_eth'] ?? '-'))) out(['ok' => false, 'error' => 'A carteira de saída ETH mudou desde a cotação. Refaça. Nada foi enviado.'], 409);
        if (!$LA('aprovado', ['valor' => (string)$cot['envia'], 'resultado' => 'em_andamento'])) out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
        $ins = db()->prepare("INSERT INTO dbo.GN_SwapJobs (session_id, direcao, provedor, from_asset, from_amount, to_asset, from_address, dest_address, expected_out, min_out, memo, vault, router,
            quote_expira_utc, status, origem, preco_brl, custo_brl, repasse_saida) OUTPUT INSERTED.id
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,DATEADD(second, CAST(? AS int), '1970-01-01'),'aprovado',?,?,?,?)");
        $ins->execute([$sid, $cot['de'] . '>' . $cot['para'], 'thorchain', SWAP_ATIVOS[$cot['de']], $cot['envia'], $cot['para'] === 'BTC' ? 'BTC.BTC' : ($cot['para'] === 'ETH' ? 'ETH.ETH' : 'BCH.BCH'),
            $u['eth_address'], $cot['destino'], $cot['recebe_sats'] / 1e8, $cot['minimo_sats'] / 1e8, $cot['memo'], $cot['cofre'], $cot['router'], (int)$cot['expira'], 'app',
            $cot['para'] === 'BTC' ? preco_brl() : ($cot['para'] === 'ETH' ? eth_preco_usd() * usd_brl() : preco_bch_brl()), $cot['custo_brl'], $cot['para'] === 'ETH' ? 1 : 0]);
        $id = (int)$ins->fetchColumn();
        out(['ok' => true, 'id' => $id]);
    }

    case 'sugestoes_lista': {
        swap_usuario($sid);
        try { db()->prepare("UPDATE dbo.GN_RoboSugestoes SET status='expirada', decidido_em=SYSUTCDATETIME() WHERE session_id=? AND status='pendente' AND expira_em < SYSUTCDATETIME()")->execute([$sid]); } catch (Throwable $e) {}
        $st = db()->prepare("SELECT TOP 10 id, tipo, status, lucro_brl, valor_brl, n_vendas, robos, criado_em, expira_em, decidido_em, swap_job_id
            FROM dbo.GN_RoboSugestoes WHERE session_id=? AND status IN ('pendente','aprovada','ignorada','expirada') ORDER BY id DESC");
        $st->execute([$sid]);
        out(['ok' => true, 'sugestoes' => array_map(fn($r) => [
            'id' => (int)$r['id'], 'tipo' => $r['tipo'], 'status' => $r['status'], 'lucro_brl' => (float)$r['lucro_brl'], 'valor_brl' => (float)$r['valor_brl'],
            'n_vendas' => (int)$r['n_vendas'], 'robos' => $r['robos'], 'criado_em' => $r['criado_em'], 'expira_em' => $r['expira_em'],
            'decidido_em' => $r['decidido_em'], 'swap_id' => $r['swap_job_id'] !== null ? (int)$r['swap_job_id'] : null], $st->fetchAll())]);
    }

    case 'sugestao_ignorar': {
        swap_usuario($sid);
        $st = db()->prepare("UPDATE dbo.GN_RoboSugestoes SET status='ignorada', decidido_em=SYSUTCDATETIME() WHERE id=? AND session_id=? AND status='pendente'");
        $st->execute([(int)($body['id'] ?? 0), $sid]);
        out(['ok' => $st->rowCount() === 1]);
    }

    case 'swaps_lista': {
        swap_usuario($sid);
        $st = db()->prepare('SELECT TOP 20 id, direcao, from_amount, expected_out, min_out, status, tx_deposit, tx_saida, erro, criado_em, atualizado_em, repasse_saida, tx_repasse FROM dbo.GN_SwapJobs WHERE session_id=? AND origem=\'app\' ORDER BY id DESC');
        $st->execute([$sid]);
        out(['ok' => true, 'swaps' => array_map('swap_publico', $st->fetchAll())]);
    }

    case 'swap_status': {
        swap_usuario($sid);
        $st = db()->prepare('SELECT id, direcao, from_amount, expected_out, min_out, status, tx_deposit, tx_saida, erro, criado_em, atualizado_em, repasse_saida, tx_repasse FROM dbo.GN_SwapJobs WHERE session_id=? AND id=?');
        $st->execute([$sid, (int)($body['id'] ?? 0)]); $r = $st->fetch();
        if (!$r) out(['ok' => false, 'error' => 'Troca não encontrada nesta conta.'], 404);
        $p = swap_publico($r);
        if ($r['tx_deposit'] && in_array($r['status'], ['deposito_enviado', 'concluido', 'reembolsado'], true)) {
            [$s] = thor_get('/thorchain/tx/status/' . strtoupper(preg_replace('/^0x/i', '', (string)$r['tx_deposit'])), 1);
            if ($s) { $st2 = $s[0]['stages'] ?? []; $p['etapas'] = ['observado' => !empty($st2['inbound_observed']['completed']), 'confirmado' => !empty($st2['inbound_finalised']['completed']),
                'trocado' => !empty($st2['swap_finalised']['completed']), 'enviado' => !empty($st2['outbound_signed']['completed'])];
                // Contagem regressiva informada pela THORChain (confirmacoes da entrada + atraso de saida em trocas grandes)
                $falta = 0; $tem = false;
                if (isset($st2['inbound_confirmation_counted']['remaining_confirmation_seconds']) && empty($st2['inbound_confirmation_counted']['completed'])) { $falta += (int)$st2['inbound_confirmation_counted']['remaining_confirmation_seconds']; $tem = true; }
                if (isset($st2['outbound_delay']['remaining_delay_seconds']) && empty($st2['outbound_delay']['completed'])) { $falta += (int)$st2['outbound_delay']['remaining_delay_seconds']; $tem = true; }
                $p['faltam_seg'] = $tem ? $falta : null;
                // Saida assinada: grava conclusao/devolucao e o TXID que entrou na conta (nao depende do timer do lxbch01)
                $outs = $s[0]['out_txs'] ?? [];
                if ($r['status'] === 'deposito_enviado' && !empty($st2['outbound_signed']['completed']) && $outs && !empty($outs[0]['id'])) {
                    $refund = false; foreach ($outs as $o) if (stripos((string)($o['memo'] ?? ''), 'REFUND') !== false) $refund = true;
                    $novo = $refund ? 'reembolsado' : 'concluido';
                    db()->prepare("UPDATE dbo.GN_SwapJobs SET status=?, tx_saida=?, atualizado_em=SYSUTCDATETIME() WHERE id=? AND session_id=? AND status='deposito_enviado'")
                        ->execute([$novo, (string)$outs[0]['id'], (int)$r['id'], $sid]);
                    $r['status'] = $novo; $r['tx_saida'] = (string)$outs[0]['id'];
                    $p = array_merge($p, array_intersect_key(swap_publico($r), array_flip(['status', 'situacao', 'tx_recebido', 'tx_recebido_link'])));
                }
            }
        }
        out(['ok' => true, 'swap' => $p]);
    }

    default:
        out(['ok' => false, 'error' => 'ação desconhecida'], 400);
    }
} catch (Throwable $e) {
    app_log('excecao', ['action' => $action, 'msg' => $e->getMessage(), 'linha' => $e->getLine()]);
    out(['ok' => false, 'error' => msg_publica($e)], 500);
}
