<?php
/* ============================================================
 * private/pagar_lib.php - opcao "Pagar" do app (transferencia para QUALQUER endereco).
 *
 * Entrada: QR / link de pagamento / endereco digitado + valor.
 *   BIP21  bitcoin:ADDR?amount=0.001&label=..&message=..
 *          bitcoincash:qADDR?amount=0.01
 *   EIP681 ethereum:0xADDR[@1]?value=1.5e18                     (ETH, valor em wei)
 *          ethereum:0xA0b8..eB48[@1]/transfer?address=0xDEST&uint256=2.5e6   (USDC na Ethereum)
 *   Endereco puro: bc1/1/3 = BTC, bitcoincash:q/q/p = BCH, 0x = ETH ou USDC (o usuario escolhe).
 *
 * Unidades internas (inteiros): BTC/BCH = satoshi (1e8), USDC = 1e6, ETH = gwei (1e9).
 * A THORChain usa 1e8 para todos os ativos.
 *
 * Regras de seguranca:
 *  - nunca paga a menos: envio direto = valor exato; troca = limite minimo do memo IGUAL ao valor pedido
 *    (se a cotacao piorar, a THORChain devolve para a origem);
 *  - folga maxima da troca = 2% (o destino pode receber ate 2% a mais; acima disso a opcao nao e oferecida);
 *  - so moedas do proprio perfil (UTXOs do endereco do perfil); destino nunca e o proprio perfil;
 *  - limites por pagamento e por 24 h (padrao R$ 500 / R$ 2.000; o usuario muda no site).
 * ============================================================ */
declare(strict_types=1);

const PAGAR_ATIVOS        = ['BTC', 'BCH', 'ETH', 'USDC'];
const PAGAR_ESCALA        = ['BTC' => 8, 'BCH' => 8, 'USDC' => 6, 'ETH' => 9];
const PAGAR_USDC_CONTRATO = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const PAGAR_LIM_UNIT_PAD  = 500.0;     // R$ por pagamento (padrao)
const PAGAR_LIM_DIA_PAD   = 2000.0;    // R$ por 24 h (padrao)
const PAGAR_FOLGA_MAX     = 0.02;      // troca: destino recebe no maximo 2% a mais
const PAGAR_FOLGA_ALVO    = 0.005;     // troca: mira 0,5% acima + 1 taxa de saida (cobre a variacao da taxa)
const PAGAR_FOLGA_MIN     = 0.003;     // troca: abaixo de 0,3% + meia taxa de saida o risco de devolucao e alto
const PAGAR_BCH_SATB      = 1.1;       // taxa BCH (sat/byte)
const PAGAR_ETH_ATIVO     = false;     // envio de ETH/USDC e trocas com origem ETH/USDC: fase 4 (assinador)

/* ===================== Keccak-256 (para o checksum EIP-55) ===================== */
function _k_lsr(int $x, int $n): int { return $n === 0 ? $x : (($x >> $n) & (PHP_INT_MAX >> ($n - 1))); }
function _k_rotl(int $x, int $n): int { $n %= 64; return $n === 0 ? $x : (($x << $n) | _k_lsr($x, 64 - $n)); }
function keccak256(string $msg): string {
    static $RC = null;
    if ($RC === null) {
        $h = [[0,1],[0,0x8082],[0x80000000,0x808A],[0x80000000,0x80008000],[0,0x808B],[0,0x80000001],[0x80000000,0x80008081],
              [0x80000000,0x8009],[0,0x8A],[0,0x88],[0,0x80008009],[0,0x8000000A],[0,0x8000808B],[0x80000000,0x8B],
              [0x80000000,0x8089],[0x80000000,0x8003],[0x80000000,0x8002],[0x80000000,0x80],[0,0x800A],[0x80000000,0x8000000A],
              [0x80000000,0x80008081],[0x80000000,0x8080],[0,0x80000001],[0x80000000,0x80008008]];
        $RC = array_map(fn($p) => ($p[0] << 32) | $p[1], $h);
    }
    $R = [0,1,62,28,27, 36,44,6,55,20, 3,10,43,25,39, 41,45,15,21,8, 18,2,61,56,14];
    $rate = 136;
    $msg .= "\x01"; while (strlen($msg) % $rate) $msg .= "\x00";
    $msg[strlen($msg) - 1] = chr(ord($msg[strlen($msg) - 1]) | 0x80);
    $A = array_fill(0, 25, 0);
    foreach (str_split($msg, $rate) as $bloco) {
        $l = array_values(unpack('P17', $bloco));
        for ($i = 0; $i < 17; $i++) $A[$i] ^= $l[$i];
        for ($r = 0; $r < 24; $r++) {
            $C = []; for ($x = 0; $x < 5; $x++) $C[$x] = $A[$x] ^ $A[$x + 5] ^ $A[$x + 10] ^ $A[$x + 15] ^ $A[$x + 20];
            for ($x = 0; $x < 5; $x++) { $D = $C[($x + 4) % 5] ^ _k_rotl($C[($x + 1) % 5], 1); for ($y = 0; $y < 25; $y += 5) $A[$y + $x] ^= $D; }
            $B = array_fill(0, 25, 0);
            for ($x = 0; $x < 5; $x++) for ($y = 0; $y < 5; $y++) $B[$y + 5 * ((2 * $x + 3 * $y) % 5)] = _k_rotl($A[$x + 5 * $y], $R[$x + 5 * $y]);
            for ($y = 0; $y < 25; $y += 5) for ($x = 0; $x < 5; $x++) $A[$y + $x] = $B[$y + $x] ^ ((~$B[$y + ($x + 1) % 5]) & $B[$y + ($x + 2) % 5]);
            $A[0] ^= $RC[$r];
        }
    }
    return bin2hex(pack('P4', $A[0], $A[1], $A[2], $A[3]));
}
/* Endereco Ethereum com checksum EIP-55 */
function eth_checksum(string $a): string {
    $h = strtolower(substr($a, 2)); $k = keccak256($h); $o = '0x';
    for ($i = 0; $i < 40; $i++) $o .= (hexdec($k[$i]) >= 8) ? strtoupper($h[$i]) : $h[$i];
    return $o;
}
/* Valido = formato 0x+40 hex; se vier com maiusculas e minusculas misturadas, o checksum tem que bater */
function eth_endereco_ok(string $a): bool {
    if (!preg_match('/^0x[0-9a-fA-F]{40}$/', $a)) return false;
    $c = substr($a, 2);
    if ($c === strtolower($c) || $c === strtoupper($c)) return true;
    return eth_checksum($a) === $a;
}

/* ===================== numeros ===================== */
/* "1.5e18", "0.001", "1500" -> inteiro de valor * 10^esc, arredondando PARA CIMA (nunca paga a menos) */
function pagar_dec_int(string $s, int $esc): ?int {
    $s = trim($s);
    if (!preg_match('/^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/', $s, $m) || ($m[1] ?? '') . ($m[2] ?? '') === '') return null;
    $int = $m[1] ?? ''; $frac = $m[2] ?? ''; $exp = isset($m[3]) && $m[3] !== '' ? (int)$m[3] : 0;
    $dig = ltrim($int . $frac, '0'); if ($dig === '') return 0;
    $e = $exp - strlen($frac) + $esc;
    if ($e >= 0) { $dig .= str_repeat('0', $e); $sobe = false; }
    else { $corte = substr($dig, $e); $dig = strlen($dig) + $e > 0 ? substr($dig, 0, $e) : '0'; $sobe = trim($corte, '0') !== ''; }
    $dig = ltrim($dig, '0'); if ($dig === '') $dig = '0';
    if (strlen($dig) > 18) return null;
    return (int)$dig + ($sobe ? 1 : 0);
}
/* Texto digitado no formato brasileiro ("1.234,56", "0,001") -> string decimal com ponto */
function pagar_txt_num(string $t): string {
    $t = preg_replace('/\s+/', '', $t);
    if (str_contains($t, ',')) $t = str_replace(',', '.', str_replace('.', '', $t));
    return $t;
}
function pagar_fmt(int $base, string $ativo): string {
    $e = PAGAR_ESCALA[$ativo]; $casas = $ativo === 'USDC' ? 6 : ($ativo === 'ETH' ? 9 : 8);
    return rtrim(rtrim(number_format($base / (10 ** $e), $casas, '.', ''), '0'), '.');
}
function pagar_para_thor(int $base, string $ativo): int {   // unidade base -> 1e8 (THORChain), arredonda para cima
    $e = PAGAR_ESCALA[$ativo];
    if ($e === 8) return $base;
    if ($e < 8) return $base * (10 ** (8 - $e));
    return intdiv($base + (10 ** ($e - 8)) - 1, 10 ** ($e - 8));
}
function pagar_de_thor(int $t8, string $ativo): int {
    $e = PAGAR_ESCALA[$ativo];
    if ($e === 8) return $t8;
    if ($e < 8) return intdiv($t8, 10 ** (8 - $e));
    return $t8 * (10 ** ($e - 8));
}

/* ===================== leitura do destino ===================== */
function pagar_bch_ok(string $a): ?string {
    $s = strtolower(bch_sem_prefixo(trim($a)));
    if (!preg_match('/^[qp][02-9ac-hj-np-z]{41}$/', $s)) return null;
    try { $v = bch_rpc('validateaddress', ['bitcoincash:' . $s]); if (empty($v['isvalid'])) return null; } catch (Throwable $e) { return null; }
    return 'bitcoincash:' . $s;
}
/* Retorna ['ativo' => BTC|BCH|ETH|USDC|null, 'escolher' => [..] quando 0x puro, 'endereco', 'valor' (base int|null), 'travado', 'referencia'] */
function pagar_ler(string $texto): array {
    $t = trim($texto);
    if ($t === '') throw new RuntimeException('Leia o QR code ou cole o endereço de destino.');
    if (strlen($t) > 600) throw new RuntimeException('Código longo demais para um endereço de pagamento.');
    $esq = ''; $resto = $t;
    if (preg_match('/^([a-zA-Z]+):(.*)$/s', $t, $m)) { $esq = strtolower($m[1]); $resto = $m[2]; }
    [$cam, $qs] = array_pad(explode('?', $resto, 2), 2, '');
    $q = []; foreach (explode('&', $qs) as $kv) if ($kv !== '') { [$k, $v] = array_pad(explode('=', $kv, 2), 2, ''); $q[strtolower(urldecode($k))] = urldecode($v); }
    $ref = trim((string)($q['label'] ?? '') . ' ' . (string)($q['message'] ?? ''));
    $ref = $ref !== '' ? mb_substr($ref, 0, 200) : null;
    foreach (array_keys($q) as $k) if (str_starts_with($k, 'req-')) throw new RuntimeException('Este código exige um recurso que o app ainda não suporta (' . $k . ').');

    if ($esq === 'bitcoin' || ($esq === '' && preg_match('/^(bc1|[13])/i', $cam))) {
        $a = trim($cam); if (preg_match('/^bc1/i', $a)) $a = strtolower($a);
        if (preg_match('/^(tb1|bcrt1|[mn2])/i', $a)) throw new RuntimeException('Endereço de rede de teste (testnet). Não use.');
        if (btc_address_script($a) === null) throw new RuntimeException('Endereço Bitcoin inválido. Confira o código.');
        $v = isset($q['amount']) && $q['amount'] !== '' ? pagar_dec_int($q['amount'], 8) : null;
        if (isset($q['amount']) && ($v === null || $v <= 0)) throw new RuntimeException('Valor do QR code inválido.');
        return ['ativo' => 'BTC', 'endereco' => $a, 'valor' => $v, 'travado' => $v !== null, 'referencia' => $ref];
    }
    if ($esq === 'bitcoincash' || ($esq === '' && preg_match('/^[qp][02-9ac-hj-np-z]{41}$/i', $cam))) {
        $a = pagar_bch_ok($cam);
        if ($a === null) throw new RuntimeException('Endereço Bitcoin Cash inválido. Confira o código.');
        $v = isset($q['amount']) && $q['amount'] !== '' ? pagar_dec_int($q['amount'], 8) : null;
        if (isset($q['amount']) && ($v === null || $v <= 0)) throw new RuntimeException('Valor do QR code inválido.');
        return ['ativo' => 'BCH', 'endereco' => $a, 'valor' => $v, 'travado' => $v !== null, 'referencia' => $ref];
    }
    if ($esq === 'ethereum' || ($esq === '' && preg_match('/^0x[0-9a-f]{40}$/i', $cam))) {
        $cam = preg_replace('/^pay-/i', '', $cam);
        // alvo[@chain][/funcao]
        if (!preg_match('/^(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/([a-zA-Z]+))?$/', $cam, $m)) throw new RuntimeException('Código Ethereum inválido.');
        $alvo = $m[1]; $chain = isset($m[2]) && $m[2] !== '' ? (int)$m[2] : 1; $fn = strtolower($m[3] ?? '');
        if ($chain !== 1) throw new RuntimeException('Este pagamento é em outra rede (chain ' . $chain . '). O app só paga na rede Ethereum principal.');
        if ($fn === 'transfer') {
            if (strtolower($alvo) !== PAGAR_USDC_CONTRATO) throw new RuntimeException('Token não suportado. O app paga só ETH e USDC na rede Ethereum.');
            $dest = (string)($q['address'] ?? '');
            if (!eth_endereco_ok($dest)) throw new RuntimeException('Endereço de destino do USDC inválido (checksum não confere).');
            $v = isset($q['uint256']) && $q['uint256'] !== '' ? pagar_dec_int($q['uint256'], 0) : null;
            if (isset($q['uint256']) && ($v === null || $v <= 0)) throw new RuntimeException('Valor do QR code inválido.');
            return ['ativo' => 'USDC', 'endereco' => eth_checksum($dest), 'valor' => $v, 'travado' => $v !== null, 'referencia' => $ref];
        }
        if ($fn !== '') throw new RuntimeException('Função não suportada no código (' . $fn . ').');
        if (!eth_endereco_ok($alvo)) throw new RuntimeException('Endereço Ethereum inválido (checksum não confere).');
        if (strtolower($alvo) === PAGAR_USDC_CONTRATO) throw new RuntimeException('Esse é o endereço do contrato do USDC, não de uma carteira. Confira o destino.');
        $v = null;
        if (isset($q['value']) && $q['value'] !== '') { $wei = pagar_dec_int($q['value'], -9); $v = $wei; if ($v === null || $v <= 0) throw new RuntimeException('Valor do QR code inválido.'); }
        // ethereum: com valor = ETH; endereco puro = ETH ou USDC (o usuario escolhe)
        if ($esq === 'ethereum' || $v !== null) return ['ativo' => 'ETH', 'endereco' => eth_checksum($alvo), 'valor' => $v, 'travado' => $v !== null, 'referencia' => $ref];
        return ['ativo' => null, 'escolher' => ['ETH', 'USDC'], 'endereco' => eth_checksum($alvo), 'valor' => null, 'travado' => false, 'referencia' => $ref];
    }
    if (preg_match('/^(lightning|lnbc|lnurl)/i', $t)) throw new RuntimeException('Pagamentos Lightning ainda não são suportados. Escolha Bitcoin "on-chain" na página de pagamento.');
    throw new RuntimeException('Não reconheci esse código. O app paga em BTC, BCH, ETH e USDC (rede Ethereum).');
}

/* ===================== precos, saldos, limites ===================== */
if (!function_exists('preco_brl')) {   // o api.php do app ja define; o site (identity.php) usa esta
    function preco_brl(): float {
        $r = db()->query('SELECT TOP 1 media_exchanges_brl FROM dbo.snapshots WHERE media_exchanges_brl > 0 ORDER BY ts_utc DESC')->fetch();
        $p = (float)($r['media_exchanges_brl'] ?? 0); if ($p <= 0) throw new RuntimeException('Sem cotação disponível.'); return $p;
    }
}
function pagar_precos(): array {   // R$ por unidade inteira
    $usd = usd_brl(); $p = ['BTC' => preco_brl(), 'USDC' => $usd, 'usd_brl' => $usd];
    try { $p['BCH'] = preco_bch_brl(); } catch (Throwable $e) { $p['BCH'] = 0.0; }
    try { $p['ETH'] = eth_preco_usd() * $usd; } catch (Throwable $e) { $p['ETH'] = 0.0; }
    return $p;
}
function pagar_brl(int $base, string $ativo, array $px): float { return $base / (10 ** PAGAR_ESCALA[$ativo]) * (float)($px[$ativo] ?? 0); }
/* Saldo disponivel (base int) por ativo. ETH ja desconta a reserva de gas. */
function pagar_saldos(array $u): array {
    $s = ['BTC' => 0, 'BCH' => 0, 'ETH' => 0, 'USDC' => 0];
    try { if (!empty($u['btc_address'])) $s['BTC'] = saldo_sats((string)$u['btc_address'], 1); } catch (Throwable $e) {}
    try { if (!empty($u['bch_address'])) $s['BCH'] = bch_saldo_sats((string)$u['bch_address'], 1); } catch (Throwable $e) {}
    if (!empty($u['eth_address'])) {
        $st = db()->prepare('SELECT CAST(balance_eth_wei / 1e9 AS decimal(38,0)) AS gwei, balance_usdc FROM dbo.GN_ETH_AddressCache WHERE address=?');
        $st->execute([(string)$u['eth_address']]); $c = $st->fetch() ?: [];
        $s['ETH'] = max(0, (int)($c['gwei'] ?? 0) - (int)round(SWAP_ETH_RESERVA * 1e9));
        $s['USDC'] = (int)floor((float)($c['balance_usdc'] ?? 0) * 1e6 + 1e-6);
    }
    return $s;
}
/* Maior saldo, em R$, de uma unica moeda: teto dos limites que o usuario pode configurar */
function pagar_maior_saldo_brl(array $u, ?array $px = null): float {
    $px = $px ?? pagar_precos(); $m = 0.0;
    foreach (pagar_saldos($u) as $a => $v) $m = max($m, pagar_brl($v, $a, $px));
    return round($m, 2);
}
/* Limites efetivos. Um aumento pendente passa a valer sozinho quando chega a hora. */
function pagar_limites(string $sid): array {
    $st = db()->prepare('SELECT pag_limite_unit_brl u, pag_limite_dia_brl d, pag_limite_unit_pend up, pag_limite_dia_pend dp, pag_limite_pend_vale_em ve,
        CASE WHEN pag_limite_pend_vale_em <= SYSUTCDATETIME() THEN 1 ELSE 0 END ja FROM dbo.GN_Usuarios WHERE session_id=?');
    $st->execute([$sid]); $r = $st->fetch() ?: [];
    if (!empty($r['ve']) && (int)$r['ja'] === 1) {
        db()->prepare('UPDATE dbo.GN_Usuarios SET pag_limite_unit_brl=COALESCE(pag_limite_unit_pend, pag_limite_unit_brl), pag_limite_dia_brl=COALESCE(pag_limite_dia_pend, pag_limite_dia_brl),
            pag_limite_unit_pend=NULL, pag_limite_dia_pend=NULL, pag_limite_pend_vale_em=NULL WHERE session_id=? AND pag_limite_pend_vale_em <= SYSUTCDATETIME()')->execute([$sid]);
        $r['u'] = $r['up'] ?? $r['u']; $r['d'] = $r['dp'] ?? $r['d']; $r['up'] = $r['dp'] = $r['ve'] = null;
    }
    $usado = db()->prepare("SELECT COALESCE(SUM(destino_valor_brl),0) FROM dbo.GN_PagamentosCripto WHERE session_id=? AND status IN ('aprovado','enviado','confirmado')
        AND criado_em >= DATEADD(HOUR, -24, SYSUTCDATETIME())");
    $usado->execute([$sid]); $us = (float)$usado->fetchColumn();
    $un = isset($r['u']) && $r['u'] !== null && $r['u'] !== '' ? (float)$r['u'] : PAGAR_LIM_UNIT_PAD;
    $di = isset($r['d']) && $r['d'] !== null && $r['d'] !== '' ? (float)$r['d'] : PAGAR_LIM_DIA_PAD;
    return ['por_pagamento' => $un, 'por_dia' => $di, 'usado_24h' => round($us, 2), 'disponivel_24h' => round(max(0.0, $di - $us), 2),
        'pendente' => !empty($r['ve']) ? ['por_pagamento' => $r['up'] !== null ? (float)$r['up'] : null, 'por_dia' => $r['dp'] !== null ? (float)$r['dp'] : null, 'vale_em' => $r['ve']] : null,
        'padrao' => !isset($r['u']) && !isset($r['d'])];
}

/* ===================== montagem do envio direto (BTC/BCH) ===================== */
/* So UTXOs do endereco do perfil; saidas = [destino com o valor EXATO, troco para o proprio endereco]. Nao transmite. */
function pagar_montar_direto(string $de, string $origem, string $destino, int $sats, float $rate): array {
    $bch = $de === 'BCH';
    $rpc = fn(string $m, array $p) => $bch ? bch_rpc($m, $p) : btc_rpc($m, $p);
    $norm = fn(string $a) => $bch ? strtolower(bch_sem_prefixo(trim($a))) : strtolower(trim($a));
    if ($sats < ($bch ? 546 : 330)) throw new RuntimeException('Valor abaixo do mínimo aceito pela rede.');
    if ($norm($destino) === $norm($origem)) throw new RuntimeException('O destino é o próprio endereço da sua conta.');
    $utxos = $rpc('listunspent', [1, 9999999, [$origem]]);
    if (!$utxos) throw new RuntimeException('Sem saldo confirmado em ' . $de . '.');
    $ins = []; $tot = 0; $meus = [];
    foreach ($utxos as $x) { $tot += sats($x['amount']); $ins[] = ['txid' => $x['txid'], 'vout' => $x['vout']]; $meus[$x['txid'] . ':' . $x['vout']] = true; }
    if ($sats >= $tot) throw new RuntimeException('Saldo de ' . $de . ' insuficiente para o valor mais a taxa de rede.');
    $destTx = $bch ? 'bitcoincash:' . strtolower(bch_sem_prefixo($destino)) : $destino;
    $raw = $rpc('createrawtransaction', [$ins, $bch ? [$destTx => btc_str($sats)] : [[$destTx => btc_str($sats)]]]);
    $opt = $bch ? ['changeAddress' => $origem, 'changePosition' => 1, 'feeRate' => sprintf('%.8f', $rate * 1000 / 1e8)]
                : ['add_inputs' => false, 'changeAddress' => $origem, 'changePosition' => 1, 'fee_rate' => sprintf('%.2f', $rate)];
    try { $f = $rpc('fundrawtransaction', [$raw, $opt]); }
    catch (Throwable $e) { if (stripos($e->getMessage(), 'insufficient') !== false) throw new RuntimeException('Saldo de ' . $de . ' insuficiente para o valor mais a taxa de rede.'); throw $e; }
    $s = $rpc('signrawtransactionwithwallet', [$f['hex']]);
    if (empty($s['complete'])) throw new RuntimeException('Falha ao assinar a transação.');
    $d = $rpc('decoderawtransaction', [$s['hex']]);
    foreach ($d['vin'] as $v) if (empty($meus[($v['txid'] ?? '') . ':' . ($v['vout'] ?? -1)])) throw new RuntimeException('Conferência da transação falhou (entrada de outro endereço). Nada foi enviado.');
    $addr = fn(array $o) => (string)($o['scriptPubKey']['address'] ?? ($o['scriptPubKey']['addresses'][0] ?? ''));
    $nDest = 0; $okDest = false; $okResto = true;
    foreach ($d['vout'] as $o) {
        $a = $norm($addr($o));
        if ($a === $norm($destTx)) { $nDest++; $okDest = sats($o['value']) === $sats; continue; }
        if ($a !== $norm($origem)) $okResto = false;
    }
    if ($nDest !== 1 || !$okDest || !$okResto) throw new RuntimeException('Conferência da transação falhou (saídas). Nada foi enviado.');
    $fee = sats($f['fee']);
    if ($sats + $fee > $tot) throw new RuntimeException('Saldo insuficiente para o valor e a taxa de rede.');
    $tm = $rpc('testmempoolaccept', [[$s['hex']]]);
    if (!is_array($tm)) throw new RuntimeException('O nó não permitiu a conferência da transação. Nada foi enviado.');
    if (empty($tm[0]['allowed'])) throw new RuntimeException('A rede recusaria a transação (' . ($tm[0]['reject-reason'] ?? '?') . '). Nada foi enviado.');
    return ['hex' => $s['hex'], 'txid' => $d['txid'], 'fee_sats' => $fee, 'saldo_sats' => $tot, 'tamanho' => (int)($d['vsize'] ?? $d['size'] ?? 0)];
}
function pagar_taxa_btc(): float { $n = niveis_taxa(); return min((float)$n['normal'], (float)APP_TAXA_MAX_SATVB); }

/* ===================== troca com entrega direto no destino (THORChain) ===================== */
/* Ajusta a entrada para o destino receber o valor pedido + folga (<= 2%). Limite do memo = valor pedido EXATO. */
function pagar_cotar_troca(string $de, string $para, string $destino, int $alvoBase, array $px): array {
    $ativoThor = fn(string $a) => $a === 'USDC' ? SWAP_ATIVOS['USDC'] : ($a . '.' . $a);
    $alvo8 = pagar_para_thor($alvoBase, $para);
    $destQ = $para === 'BCH' ? strtolower(bch_sem_prefixo($destino)) : $destino;
    if (($px[$de] ?? 0) <= 0 || ($px[$para] ?? 0) <= 0) throw new RuntimeException('Sem cotação de ' . $de . ' ou ' . $para . ' agora.');
    $cofres = thor_cofres($de === 'USDC' ? 'ETH' : $de);
    $in8 = (int)ceil($alvo8 * $px[$para] / $px[$de] * (1 + PAGAR_FOLGA_ALVO + 0.01));
    $q = null; $exp = 0; $out = 0; $tgt = 0;
    for ($i = 0; $i < 4; $i++) {
        $q = thor_cotar($ativoThor($de), $ativoThor($para), $in8, $destQ);
        $exp = (int)$q['expected_amount_out']; $out = (int)($q['fees']['outbound'] ?? 0);
        $tgt = $alvo8 + (int)ceil(min(PAGAR_FOLGA_MAX * $alvo8 * 0.95, PAGAR_FOLGA_ALVO * $alvo8 + $out));
        if ($exp > 0 && abs($exp - $tgt) <= max(1, (int)(0.002 * $alvo8)) && $exp >= $alvo8) break;
        if ($exp <= 0) throw new RuntimeException('Cotação sem valor de saída.');
        $in8 = (int)ceil($in8 * $tgt / $exp);
    }
    if (!in_array(strtolower((string)$q['inbound_address']), $cofres, true)) throw new RuntimeException('Cotação com cofre não confirmado. Tente de novo.');
    $p = explode(':', (string)$q['memo']);
    if (count($p) < 4 || strtolower(bch_sem_prefixo($p[2])) !== strtolower(bch_sem_prefixo($destQ))) throw new RuntimeException('Cotação com destino inesperado. Operação bloqueada.');
    $folga = ($exp - $alvo8) / $alvo8;
    if ($exp < $alvo8 + PAGAR_FOLGA_MIN * $alvo8 + $out / 2) throw new RuntimeException('Margem insuficiente: a THORChain poderia devolver o valor. Prefira outra moeda.');
    if ($folga > PAGAR_FOLGA_MAX + 0.0005) throw new RuntimeException('A troca entregaria ' . number_format($folga * 100, 1, ',', '.') . '% a mais que o pedido (máximo 2%). Valor pequeno para converter; prefira pagar na mesma moeda.');
    // limite do memo = valor EXATO pedido: abaixo disso a THORChain devolve para a origem (nunca paga a menos)
    $r = explode('/', $p[3]); $r[0] = (string)$alvo8; $p[3] = implode('/', $r); $memo = implode(':', $p);
    if (in_array($de, ['BTC', 'BCH'], true) && strlen($memo) > ($de === 'BTC' ? 80 : 220)) throw new RuntimeException('Memo grande demais para a rede.');
    $min = (int)($q['recommended_min_amount_in'] ?? 0);
    if ($min && $in8 < $min) throw new RuntimeException('Valor abaixo do mínimo da THORChain para converter.');
    $taxaRede = in_array($de, ['BTC', 'BCH'], true) ? max((int)($q['recommended_gas_rate'] ?? 3), $de === 'BCH' ? 1 : 2) : 0;
    $feeEst = $de === 'BTC' ? (int)ceil($taxaRede * 220) : ($de === 'BCH' ? (int)ceil($taxaRede * 450) : 0);
    return ['in_base' => pagar_de_thor($in8, $de), 'in8' => $in8, 'esperado8' => $exp, 'minimo8' => $alvo8, 'folga' => $folga, 'saida_fee8' => $out,
        'memo' => $memo, 'cofre' => (string)$q['inbound_address'], 'router' => $q['router'] ?? null, 'expira' => (int)$q['expiry'],
        'tempo_s' => (int)($q['total_swap_seconds'] ?? 900), 'taxa_rede' => $taxaRede, 'fee_est' => $feeEst];
}

/* ===================== opcoes de origem ===================== */
/* $alvo = valor exato que o destino deve receber (base int do ativo de destino) */
function pagar_opcoes(array $u, string $para, string $destino, int $alvo, array $px, ?string $so = null): array {
    $saldos = pagar_saldos($u);
    $alvoBrl = pagar_brl($alvo, $para, $px);
    $ops = [];
    foreach (PAGAR_ATIVOS as $de) {
        if ($so !== null && $de !== $so) continue;
        $o = ['origem' => $de, 'saldo' => pagar_fmt($saldos[$de], $de), 'saldo_brl' => round(pagar_brl($saldos[$de], $de, $px), 2), 'disponivel' => false, 'motivo' => null];
        try {
            if ($saldos[$de] <= 0) throw new RuntimeException('Sem saldo em ' . $de . '.');
            if ($de === $para) {
                $o['modo'] = 'direto';
                if (!in_array($de, ['BTC', 'BCH'], true) && !PAGAR_ETH_ATIVO) throw new RuntimeException('Envio de ' . $de . ' chega na próxima versão.');
                $rate = $de === 'BCH' ? PAGAR_BCH_SATB : pagar_taxa_btc();
                $orig = (string)($de === 'BCH' ? $u['bch_address'] : $u['btc_address']);
                $t = pagar_montar_direto($de, $orig, $destino, $alvo, $rate);
                $o += ['paga' => pagar_fmt($alvo, $de), 'taxa_rede' => pagar_fmt($t['fee_sats'], $de), 'taxa_rede_brl' => round(pagar_brl($t['fee_sats'], $de, $px), 2),
                    'total_brl' => round(pagar_brl($alvo + $t['fee_sats'], $de, $px), 2), 'custo_brl' => round(pagar_brl($t['fee_sats'], $de, $px), 2),
                    'recebe' => pagar_fmt($alvo, $para), 'minimo' => pagar_fmt($alvo, $para), 'folga_pct' => 0.0, 'tempo_s' => $de === 'BTC' ? 1800 : 600,
                    '_rate' => $rate, '_in_base' => $alvo, '_fee' => $t['fee_sats']];
            } else {
                $o['modo'] = in_array($para, ['BTC', 'BCH'], true) ? 'troca' : 'troca_envio';
                if ($o['modo'] === 'troca_envio' || !in_array($de, ['BTC', 'BCH'], true)) {
                    if (!PAGAR_ETH_ATIVO) throw new RuntimeException('Pagar ' . $para . ' com ' . $de . ' chega na próxima versão.');
                }
                $c = pagar_cotar_troca($de, $para, $destino, $alvo, $px);
                if ($c['in_base'] + $c['fee_est'] > $saldos[$de]) throw new RuntimeException('Saldo de ' . $de . ' insuficiente (precisa de ' . pagar_fmt($c['in_base'] + $c['fee_est'], $de) . ').');
                $entBrl = pagar_brl($c['in_base'] + $c['fee_est'], $de, $px);
                $o += ['paga' => pagar_fmt($c['in_base'], $de), 'taxa_rede' => pagar_fmt($c['fee_est'], $de), 'taxa_rede_brl' => round(pagar_brl($c['fee_est'], $de, $px), 2),
                    'total_brl' => round($entBrl, 2), 'custo_brl' => round(max(0.0, $entBrl - $alvoBrl), 2),
                    'recebe' => pagar_fmt(pagar_de_thor($c['esperado8'], $para), $para), 'minimo' => pagar_fmt($alvo, $para), 'folga_pct' => round($c['folga'] * 100, 2),
                    'tempo_s' => $c['tempo_s'] + ($para === 'BTC' ? 1200 : 600), 'expira' => $c['expira'],   // + confirmacao no destino
                    '_rate' => (float)$c['taxa_rede'], '_in_base' => $c['in_base'], '_fee' => $c['fee_est'], '_memo' => $c['memo'], '_cofre' => $c['cofre'], '_router' => $c['router']];
            }
            $o['disponivel'] = true;
        } catch (Throwable $e) { $o['motivo'] = msg_publica($e); }
        $ops[] = $o;
    }
    // ordem: disponiveis primeiro, depois menor custo; selos "mais barata" e "mais rapida"
    usort($ops, fn($a, $b) => [$b['disponivel'] ? 1 : 0, $a['custo_brl'] ?? 1e12] <=> [$a['disponivel'] ? 1 : 0, $b['custo_brl'] ?? 1e12]);
    $disp = array_values(array_filter($ops, fn($o) => $o['disponivel']));
    if ($disp) {
        $ops[0]['selo'] = 'mais barata';
        $rap = $disp[0]; foreach ($disp as $o) if ($o['tempo_s'] < $rap['tempo_s']) $rap = $o;
        foreach ($ops as &$o) if ($o['origem'] === $rap['origem'] && $o['disponivel']) $o['selo'] = isset($o['selo']) ? 'mais barata e mais rápida' : 'mais rápida';
        unset($o);
    }
    return $ops;
}
/* Remove campos internos (_*) antes de mandar ao app */
function pagar_publico_opcao(array $o): array { return array_filter($o, fn($k) => $k[0] !== '_', ARRAY_FILTER_USE_KEY); }

/* Destino: confere que nao e o proprio perfil e se ja foi usado antes */
function pagar_destino_checar(array $u, string $ativo, string $destino): array {
    $n = fn(string $a) => strtolower(bch_sem_prefixo(trim($a)));
    foreach (['btc_address', 'bch_address', 'eth_address'] as $c) if (!empty($u[$c]) && $n((string)$u[$c]) === $n($destino))
        throw new RuntimeException('Esse é um endereço da sua própria conta. Informe o endereço de quem vai receber.');
    $st = db()->prepare("SELECT COUNT(*) FROM dbo.GN_PagamentosCripto WHERE session_id=? AND destino_endereco=? AND status IN ('enviado','confirmado')");
    $st->execute([(string)$u['session_id'], $destino]);
    return ['novo' => (int)$st->fetchColumn() === 0];
}

/* Link publico do explorador */
function pagar_explorer(string $ativo, string $tx): string {
    $t = strtolower(preg_replace('/^0x/i', '', $tx));
    if ($ativo === 'BTC') return 'https://mempool.space/tx/' . $t;
    if ($ativo === 'BCH') return 'https://blockchair.com/bitcoin-cash/transaction/' . $t;
    return 'https://etherscan.io/tx/0x' . $t;
}
