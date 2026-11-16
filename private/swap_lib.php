<?php
/* ============================================================
 * private/swap_lib.php - trocas BTC/BCH <-> USDC/USDT via THORChain (app).
 * VENDA (BTC -> USDC): transacao BTC da carteira do site, SO com UTXOs do endereco do perfil,
 *   saidas na ordem [cofre THORChain, troco p/ o proprio endereco, OP_RETURN com o memo].
 * COMPRA (USDC -> BTC/BCH): grava o pedido 'aprovado' em GN_SwapJobs; o assinador restrito
 *   (lxbch01, gn-eth-signer) revalida tudo e envia pela rede Ethereum.
 * O memo sempre leva o destino = endereco DO PROPRIO PERFIL e um limite minimo de saida
 * (abaixo dele a THORChain devolve o valor para a origem).
 * ============================================================ */
declare(strict_types=1);

const SWAP_THORNODES = ['https://thorchain-thornode-lb-1.thorwallet.org', 'https://thorchain.ibs.team/api'];
const SWAP_TOL_BPS   = 100;          // tolerancia de preco (1%) -> limite minimo no memo
const SWAP_MAX_SATVB = 20;           // teto da taxa de mineracao na venda
const SWAP_ATIVOS    = [
    'USDC' => 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
    'USDT' => 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
    'ETH'  => 'ETH.ETH',
];
const SWAP_ETH_RESERVA = 0.0002;      // ETH que fica no perfil para pagar o gas do deposito (troca com ETH)
const SWAP_ETH_ESPERA_GAS_USD = 0.10; // gas estimado da compra (pago pelo sistema)

function thor_get(string $path, int $tent = 4): array {
    $res = []; $err = [];
    foreach (SWAP_THORNODES as $u) {
        for ($t = 0; $t < $tent; $t++) {
            $ctx = stream_context_create(['http' => ['timeout' => 12, 'ignore_errors' => true, 'header' => "User-Agent: gn-app-swap/1.0\r\n"]]);
            $b = @file_get_contents($u . $path, false, $ctx);
            $j = $b !== false ? json_decode($b, true) : null;
            if (is_array($j) && !(isset($j['message']) && str_contains((string)$j['message'], 'stale'))) {
                if (isset($j['message']) && !isset($j['memo']) && !array_is_list($j)) { $err[] = (string)$j['message']; break; }
                $res[] = $j; break;
            }
            if ($t < $tent - 1) usleep(1500000);
        }
    }
    return [$res, $err];
}

/* Conjunto de cofres ativos de uma rede, aceito por >=2 THORNodes; e se a rede/trading esta pausado. */
function thor_cofres(string $chain): array {
    [$vs] = thor_get('/thorchain/vaults/asgard', 2);
    $sets = [];
    foreach ($vs as $lista) {
        $s = [];
        foreach ($lista as $v) if (($v['status'] ?? '') === 'ActiveVault') foreach (($v['addresses'] ?? []) as $a) if (($a['chain'] ?? '') === $chain) $s[] = strtolower($a['address']);
        sort($s); $sets[] = implode(',', $s);
    }
    if (count($sets) < 2 || count(array_unique($sets)) !== 1 || $sets[0] === '') throw new RuntimeException('THORChain indisponível no momento (servidores sem consenso). Tente em alguns minutos.');
    [$inb] = thor_get('/thorchain/inbound_addresses', 2);
    foreach ($inb as $l) foreach ($l as $c) if (in_array($c['chain'] ?? '', [$chain, 'ETH'], true) && (!empty($c['halted']) || !empty($c['chain_trading_paused']) || !empty($c['global_trading_paused'])))
        throw new RuntimeException('As trocas estão pausadas na THORChain neste momento. Tente mais tarde.');
    return explode(',', $sets[0]);
}

function thor_cotar(string $de, string $para, int $amt8, string $destino): array {
    [$qs, $err] = thor_get('/thorchain/quote/swap?from_asset=' . rawurlencode($de) . '&to_asset=' . rawurlencode($para) . '&amount=' . $amt8
        . '&destination=' . rawurlencode($destino) . '&streaming_interval=1&liquidity_tolerance_bps=' . SWAP_TOL_BPS);
    foreach ($qs as $q) if (isset($q['memo'], $q['inbound_address'], $q['expected_amount_out'])) return memo_com_margem($q);
    $m = $err ? $err[0] : 'sem resposta';
    if (stripos($m, 'less than') !== false || stripos($m, 'dust') !== false || stripos($m, 'not enough') !== false) throw new RuntimeException('Valor muito baixo para a troca.');
    if (stripos($m, 'halted') !== false || stripos($m, 'paused') !== false) throw new RuntimeException('A THORChain pausou temporariamente as trocas com essa moeda. Seu saldo está seguro; tente mais tarde.');
    throw new RuntimeException('Não foi possível cotar agora (' . mb_substr($m, 0, 120) . ').');
}

/* Minimo garantido com margem: estimado - 1% - uma taxa de saida a mais (a taxa de saida pode dobrar em minutos,
   e em trocas pequenas isso sozinho ja passa de 1%, fazendo a THORChain devolver). Reescreve o limite no memo. */
function memo_com_margem(array $q): array {
    $p = explode(':', (string)$q['memo']);
    if (count($p) < 4) return $q;
    $exp = (int)$q['expected_amount_out']; $out = (int)($q['fees']['outbound'] ?? 0);
    $lim = (int)floor($exp * (1 - SWAP_TOL_BPS / 10000)) - $out;
    if ($lim <= 0) throw new RuntimeException('Valor muito baixo para a troca.');
    $r = explode('/', $p[3]); $r[0] = (string)$lim; $p[3] = implode('/', $r);
    $q['memo'] = implode(':', $p); $q['limite_margem'] = $lim;
    return $q;
}
function memo_limite(string $memo): int { $p = explode(':', $memo); return isset($p[3]) ? (int)explode('/', $p[3])[0] : 0; }
function bch_sem_prefixo(string $a): string { return str_starts_with(strtolower($a), 'bitcoincash:') ? substr($a, 12) : $a; }

/* ---------- VENDA: BTC do perfil -> USDC/USDT no endereco ETH do perfil ---------- */
/* Venda: BTC/BCH do perfil -> USDC/USDT no endereco ETH do perfil, ou (so BCH) -> BTC no endereco de SAIDA cadastrado.
   $destino/$precoDestBrl so sao usados quando $para = 'BTC'. */
function venda_cotar(array $u, int $sats, string $para, float $precoBrl, float $usdBrl, string $de = 'BTC', ?string $destino = null, float $precoDestBrl = 0.0): array {
    $paraBtc = $para === 'BTC'; $paraEth = $para === 'ETH';   // ETH: entrega no PERFIL e o assinador repassa a saida ETH
    if ($paraBtc && ($de !== 'BCH' || !$destino)) throw new RuntimeException('Conversão para BTC só a partir do BCH e com carteira de saída cadastrada.');
    if (!$paraBtc && empty($u['eth_address'])) throw new RuntimeException('Sua conta ainda não tem endereço Ethereum. Aguarde um minuto e tente de novo.');
    $dest = $paraBtc ? $destino : $u['eth_address'];
    $cofres = thor_cofres($de);
    $q = thor_cotar($de . '.' . $de, $paraBtc ? 'BTC.BTC' : ($paraEth ? 'ETH.ETH' : SWAP_ATIVOS[$para]), $sats, $dest);
    if (!in_array(strtolower($q['inbound_address']), $cofres, true)) throw new RuntimeException('Cotação com cofre não confirmado. Tente de novo.');
    $p = explode(':', $q['memo']);
    if (count($p) < 4 || strtolower($p[2]) !== strtolower($dest)) throw new RuntimeException('Cotação com destino inesperado. Operação bloqueada.');
    $lim = memo_limite($q['memo']);
    if ($lim <= 0) throw new RuntimeException('Cotação sem proteção de preço. Operação bloqueada.');
    if (strlen($q['memo']) > 80) throw new RuntimeException('Memo grande demais para a rede.');
    $min = (int)($q['recommended_min_amount_in'] ?? 0);
    $rec = (int)$q['expected_amount_out'] / 1e8;
    $taxaRede = max((int)($q['recommended_gas_rate'] ?? 3), 2);
    $feeEst = (int)ceil($taxaRede * ($de === 'BCH' ? 450 : 220));   // BCH: sem segwit, transacao em bytes e maior
    $entradaBrl = $sats / 1e8 * $precoBrl;
    $pxSaida = ($paraBtc || $paraEth) ? $precoDestBrl : $usdBrl;          // R$ por unidade do que chega
    $saidaBrl = $rec * $pxSaida;
    $custo = max(0.0, $entradaBrl - $saidaBrl) + $feeEst / 1e8 * $precoBrl;
    return ['lado' => 'vender', 'de' => $de, 'para' => $para, 'envia_sats' => $sats, 'recebe' => round($rec, ($paraBtc || $paraEth) ? 8 : 6), 'minimo' => round($lim / 1e8, ($paraBtc || $paraEth) ? 8 : 6),
        'minimo_brl' => round($lim / 1e8 * $pxSaida, 2), 'saida' => $paraBtc || $paraEth, 'repasse' => $paraEth, 'saida_eth' => $paraEth ? $destino : null,
        'memo' => $q['memo'], 'cofre' => $q['inbound_address'], 'expira' => (int)$q['expiry'], 'tempo_s' => (int)($q['total_swap_seconds'] ?? 600),
        'min_sats' => $min, 'taxa_satvb' => $taxaRede, 'fee_est_sats' => $feeEst, 'destino' => $dest,
        'entrada_brl' => round($entradaBrl, 2), 'recebe_brl' => round($saidaBrl, 2), 'custo_brl' => round($custo, 2),
        'custo_pct' => $entradaBrl > 0 ? round($custo / $entradaBrl * 100, 2) : null];
}

function venda_montar(string $origem, string $cofre, int $sats, string $memo, float $rate, string $de = 'BTC'): array {
    if ($rate > SWAP_MAX_SATVB) throw new RuntimeException('Taxa de rede alta demais agora. Tente mais tarde.');
    $bch = $de === 'BCH';
    $rpc = fn(string $m, array $p) => $bch ? bch_rpc($m, $p) : btc_rpc($m, $p);
    $norm = fn(string $a) => $bch ? strtolower(bch_sem_prefixo(trim($a))) : trim($a);
    $utxos = $rpc('listunspent', [1, 9999999, [$origem]]);
    if (!$utxos) throw new RuntimeException('Sem saldo confirmado.');
    $ins = []; $tot = 0; $meus = [];
    foreach ($utxos as $x) { $tot += sats($x['amount']); $ins[] = ['txid' => $x['txid'], 'vout' => $x['vout']]; $meus[$x['txid'] . ':' . $x['vout']] = true; }
    $cofreTx = $bch ? 'bitcoincash:' . bch_sem_prefixo($cofre) : $cofre;
    $raw = $rpc('createrawtransaction', [$ins, $bch ? [$cofreTx => btc_str($sats), 'data' => bin2hex($memo)] : [[$cofreTx => btc_str($sats)], ['data' => bin2hex($memo)]]]);
    $opt = $bch ? ['changeAddress' => $origem, 'changePosition' => 1, 'feeRate' => sprintf('%.8f', $rate * 1000 / 1e8)]
                : ['add_inputs' => false, 'changeAddress' => $origem, 'changePosition' => 1, 'fee_rate' => sprintf('%.2f', $rate)];
    $f = $rpc('fundrawtransaction', [$raw, $opt]);
    $s = $rpc('signrawtransactionwithwallet', [$f['hex']]);
    if (empty($s['complete'])) throw new RuntimeException('Falha ao assinar a transação.');
    $d = $rpc('decoderawtransaction', [$s['hex']]);
    // Nunca gasta moedas de outro perfil: toda entrada tem que ser um UTXO deste endereco
    foreach ($d['vin'] as $v) if (empty($meus[($v['txid'] ?? '') . ':' . ($v['vout'] ?? -1)])) throw new RuntimeException('Conferência da transação falhou (entrada de outro endereço). Nada foi enviado.');
    $addr = fn(array $o) => (string)($o['scriptPubKey']['address'] ?? ($o['scriptPubKey']['addresses'][0] ?? ''));
    $vo = $d['vout'];
    $cofreOut = null; $okMemo = false; $okTroco = true;
    foreach ($vo as $o) {
        $t = $o['scriptPubKey']['type'] ?? '';
        if ($t === 'nulldata') { if (str_contains($o['scriptPubKey']['hex'] ?? '', bin2hex($memo))) $okMemo = true; continue; }
        if ($norm($addr($o)) === $norm($cofreTx) && $cofreOut === null) { $cofreOut = $o; continue; }
        if ($norm($addr($o)) !== $norm($origem)) $okTroco = false;
    }
    $okCofre = $cofreOut !== null && sats($cofreOut['value']) === $sats;
    $fee = sats($f['fee']);
    if (!$okCofre || !$okMemo || !$okTroco) throw new RuntimeException('Conferência da transação falhou. Nada foi enviado.');
    if ($sats + $fee > $tot) throw new RuntimeException('Saldo insuficiente para o valor e a taxa de rede.');
    $tm = $rpc('testmempoolaccept', [[$s['hex']]]);
    if (!is_array($tm)) throw new RuntimeException('O nó Bitcoin não permitiu a conferência da transação. Nada foi enviado.');
    if (empty($tm[0]['allowed'])) throw new RuntimeException('A rede recusaria a transação (' . ($tm[0]['reject-reason'] ?? '?') . '). Nada foi enviado.');
    return ['hex' => $s['hex'], 'txid' => $d['txid'], 'fee_sats' => $fee, 'saldo_sats' => $tot];
}

/* ---------- COMPRA: USDC/USDT do perfil -> BTC/BCH no endereco BTC/BCH do perfil ---------- */
function compra_cotar(array $u, float $valor, string $de, string $para, float $usdBrl, float $precoDestBrl, float $precoOrigemUsd = 1.0): array {
    $dest = $para === 'BTC' ? (string)$u['btc_address'] : ($para === 'ETH' ? (string)$u['eth_address'] : bch_sem_prefixo((string)$u['bch_address']));
    if ($dest === '') throw new RuntimeException('Sua conta não tem endereço ' . $para . '.');
    $cofres = thor_cofres('ETH');
    $q = thor_cotar(SWAP_ATIVOS[$de], $para === 'BTC' ? 'BTC.BTC' : ($para === 'ETH' ? 'ETH.ETH' : 'BCH.BCH'), (int)round($valor * 1e8), $dest);
    if (!in_array(strtolower($q['inbound_address']), $cofres, true)) throw new RuntimeException('Cotação com cofre não confirmado. Tente de novo.');
    $p = explode(':', $q['memo']);
    if (count($p) < 4 || strtolower(bch_sem_prefixo($p[2])) !== strtolower($dest)) throw new RuntimeException('Cotação com destino inesperado. Operação bloqueada.');
    $lim = memo_limite($q['memo']);
    if ($lim <= 0) throw new RuntimeException('Cotação sem proteção de preço. Operação bloqueada.');
    $rec = (int)$q['expected_amount_out'];
    $entradaBrl = $valor * $precoOrigemUsd * $usdBrl;
    $saidaBrl = $rec / 1e8 * $precoDestBrl;
    $custo = max(0.0, $entradaBrl - $saidaBrl) + SWAP_ETH_ESPERA_GAS_USD * $usdBrl;
    return ['lado' => 'comprar', 'de' => $de, 'para' => $para, 'envia' => round($valor, $de === 'ETH' ? 8 : 6), 'recebe_sats' => $rec, 'minimo_sats' => $lim,
        'memo' => $q['memo'], 'cofre' => $q['inbound_address'], 'router' => $q['router'] ?? null, 'expira' => (int)$q['expiry'],
        'tempo_s' => (int)($q['total_swap_seconds'] ?? 120), 'destino' => $para === 'BTC' ? $u['btc_address'] : ($para === 'ETH' ? $u['eth_address'] : $u['bch_address']),
        'min_entrada' => isset($q['recommended_min_amount_in']) ? (int)$q['recommended_min_amount_in'] / 1e8 : null,
        'entrada_brl' => round($entradaBrl, 2), 'recebe_brl' => round($saidaBrl, 2), 'custo_brl' => round($custo, 2),
        'custo_pct' => $entradaBrl > 0 ? round($custo / $entradaBrl * 100, 2) : null];
}

function usd_brl(): float {
    // site internacional, 24 h: dolar USDT 24 h (mesma base de BTC/BCH/ETH); o comercial para no fim de semana e fica de reserva
    $r = db()->query('SELECT TOP 1 CASE WHEN usd_brl_24h>0 THEN usd_brl_24h ELSE usd_brl END AS usd_brl FROM dbo.FX_Snapshots WHERE ok=1 AND (usd_brl_24h>0 OR usd_brl>0) ORDER BY ts_utc DESC')->fetch();
    $v = (float)($r['usd_brl'] ?? 0); if ($v <= 0) throw new RuntimeException('Sem cotação do dólar.'); return $v;
}
function preco_bch_brl(): float {
    $r = db()->query('SELECT TOP 1 media_exchanges_brl FROM dbo.BCH_Snapshots WHERE ok=1 AND media_exchanges_brl>0 ORDER BY ts_utc DESC')->fetch();
    $v = (float)($r['media_exchanges_brl'] ?? 0); if ($v <= 0) throw new RuntimeException('Sem cotação do BCH.'); return $v;
}

/* ---------- SideShift: so COMPARACAO de preco (endpoint publico, sem conta, sem IP do usuario). Execucao continua so pela THORChain. ---------- */
const SIDESHIFT_MOEDA = ['BTC' => 'btc-bitcoin', 'BCH' => 'bch-bitcoincash', 'USDC' => 'usdc-ethereum', 'USDT' => 'usdt-ethereum', 'ETH' => 'eth-ethereum'];
function sideshift_cotar(string $de, string $para, float $valor): array {
    if (!isset(SIDESHIFT_MOEDA[$de], SIDESHIFT_MOEDA[$para]) || $valor <= 0) throw new RuntimeException('Par não suportado.');
    $url = 'https://sideshift.ai/api/v2/pair/' . SIDESHIFT_MOEDA[$de] . '/' . SIDESHIFT_MOEDA[$para] . '?amount=' . rawurlencode(sprintf('%.8f', $valor));
    $ctx = stream_context_create(['http' => ['timeout' => 10, 'ignore_errors' => true, 'header' => "User-Agent: gn-app-swap/1.0\r\n"]]);
    $b = @file_get_contents($url, false, $ctx); $j = $b !== false ? json_decode($b, true) : null;
    if (!is_array($j) || !isset($j['rate'])) throw new RuntimeException('SideShift não respondeu' . (isset($j['error']['message']) ? ' (' . mb_substr((string)$j['error']['message'], 0, 80) . ')' : '') . '.');
    $min = (float)($j['min'] ?? 0); $max = (float)($j['max'] ?? 0);
    return ['recebe' => $valor * (float)$j['rate'], 'min' => $min, 'max' => $max, 'abaixo_min' => $min > 0 && $valor < $min, 'acima_max' => $max > 0 && $valor > $max];
}

/* Preco do ETH em US$ (media das exchanges, gravada a cada 5 min pelo lxbch01) */
function eth_preco_usd(): float {
    $r = db()->query("SELECT TOP 1 media_exchanges_usd FROM dbo.ETH_Snapshots WHERE ok=1 AND ts_utc >= DATEADD(MINUTE, -30, SYSUTCDATETIME()) ORDER BY id DESC")->fetch();
    $v = (float)($r['media_exchanges_usd'] ?? 0); if ($v <= 0) throw new RuntimeException('Sem cotação do ETH agora.'); return $v;
}

/* RPC da carteira BCH do site (mesma carteira que gera os enderecos BCH dos perfis) */
function bch_rpc(string $method, array $params = []) {
    global $RPC_BCH_HOST, $RPC_BCH_PORT, $RPC_BCH_USER, $RPC_BCH_PASS;
    array_walk_recursive($params, function (&$v) { if (is_float($v)) $v = sprintf('%.8f', $v); });
    $ch = curl_init("http://{$RPC_BCH_HOST}:{$RPC_BCH_PORT}/");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['jsonrpc' => '1.0', 'id' => 'app', 'method' => $method, 'params' => $params]),
        CURLOPT_HTTPHEADER => ['Content-Type: text/plain'], CURLOPT_USERPWD => "{$RPC_BCH_USER}:{$RPC_BCH_PASS}", CURLOPT_TIMEOUT => 20]);
    $resp = curl_exec($ch); $err = curl_error($ch); curl_close($ch);
    if ($resp === false) throw new RuntimeException("Falha RPC BCH ({$method}): {$err}");
    $d = json_decode($resp, true);
    if (!is_array($d)) throw new RuntimeException("O nó BCH não respondeu ({$method}).");
    if (isset($d['error']) && $d['error'] !== null) throw new RuntimeException('Erro RPC BCH (' . $method . '): ' . ($d['error']['message'] ?? json_encode($d['error'])));
    return $d['result'];
}
/* Saldo BCH de um endereco: minconf 1 = confirmado; (0,0) = so pendente */
function bch_saldo_sats(string $addr, int $minconf, int $maxconf = 9999999): int {
    if ($addr === '') return 0;
    $t = 0; foreach (bch_rpc('listunspent', [$minconf, $maxconf, [$addr]]) as $x) $t += sats($x['amount']);
    return $t;
}
