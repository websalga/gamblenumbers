<?php
/* ============================================================
 * identity.php — Backend de identificação anônima
 *
 * Ações (POST JSON):
 *   check           → verifica se session_id já existe no SQL
 *   validate_address → valida endereço BTC/BCH via Electrs/Fulcrum
 *   create_profile  → grava GN_Usuarios, retorna session_id
 * ============================================================ */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/../private/config.php';
require_once __DIR__ . '/../private/wallet_config.php';

/* --- Log de depuração temporário (fase de desenvolvimento com dinheiro real) --- */
const DEBUG_LOG_FILE = __DIR__ . '/../private/logs/debug.log';
function debug_log(string $etapa, array $dados = []): void {
    $dir = dirname(DEBUG_LOG_FILE);
    if (!is_dir($dir)) @mkdir($dir, 0750, true);
    $linha = json_encode([
        'ts' => date('c'),
        'etapa' => $etapa,
        'dados' => $dados,
    ], JSON_UNESCAPED_SLASHES);
    @file_put_contents(DEBUG_LOG_FILE, $linha . "\n", FILE_APPEND | LOCK_EX);
}

/* --- RPC helper (wallets reais gamblenumbers) --- */
function wallet_rpc(string $coin, string $method, array $params = []) {
    global $RPC_BTC_HOST, $RPC_BTC_PORT, $RPC_BTC_USER, $RPC_BTC_PASS;
    global $RPC_BCH_HOST, $RPC_BCH_PORT, $RPC_BCH_USER, $RPC_BCH_PASS;
    if ($coin === 'BTC') {
        [$host, $port, $user, $pass] = [$RPC_BTC_HOST, $RPC_BTC_PORT, $RPC_BTC_USER, $RPC_BTC_PASS];
        $url = "http://{$host}:{$port}/wallet/gamblenumbers";
    } else {
        [$host, $port, $user, $pass] = [$RPC_BCH_HOST, $RPC_BCH_PORT, $RPC_BCH_USER, $RPC_BCH_PASS];
        $url = "http://{$host}:{$port}/";
    }
    // Bitcoin Core rejeita valores em notação científica no campo amount.
    // Formata qualquer float pequeno como string decimal simples antes de serializar.
    array_walk_recursive($params, function(&$v){
        if (is_float($v)) $v = sprintf('%.8f', $v);
    });
    $payload = json_encode(['jsonrpc'=>'1.0','id'=>'identity','method'=>$method,'params'=>$params]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Content-Type: text/plain'], CURLOPT_USERPWD => "{$user}:{$pass}",
        CURLOPT_TIMEOUT => 15,
    ]);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) throw new RuntimeException("Falha RPC {$coin} ({$method}): {$err}");
    $data = json_decode($resp, true);
    if (isset($data['error']) && $data['error'] !== null) throw new RuntimeException("Erro RPC {$coin} ({$method}): " . json_encode($data['error']));
    return $data['result'];
}

function gerar_endereco_deposito(string $coin, string $label) {
    return wallet_rpc($coin, 'getnewaddress', [$label]);
}

/* Saldo ATUAL disponível (não o total histórico recebido) — soma dos UTXOs
 * confirmados que pertencem especificamente a este endereço. */
function saldo_recebido(string $coin, string $address): float {
    $utxos = wallet_rpc($coin, 'listunspent', [1, 9999999, [$address]]);
    $total = 0.0;
    foreach ($utxos as $u) { $total += (float)$u['amount']; }
    return $total;
}

/* Saldo pendente (0 confirmações) — dinheiro real, só ainda não confirmado.
 * Mostrado separado do saldo confirmado pra nunca parecer que sumiu. */
function saldo_pendente(string $coin, string $address): float {
    $utxos = wallet_rpc($coin, 'listunspent', [0, 0, [$address]]);
    $total = 0.0;
    foreach ($utxos as $u) { $total += (float)$u['amount']; }
    return $total;
}

/* Transfere de um endereço ESPECÍFICO (não da wallet inteira) para outro
 * endereço, usando só os UTXOs daquele endereço como entrada — evita
 * misturar fundos de usuários diferentes na mesma wallet compartilhada. */
function salvar_saque(array $dados): void {
    // Se já existe (ex: reconfirmando), atualiza; senão insere.
    $existe = ler_saque($dados['txid']);
    if ($existe) {
        db()->prepare('UPDATE dbo.GN_Saques SET confirmado=?, confirmado_em=? WHERE txid=?')
            ->execute([
                $dados['confirmado'] ? 1 : 0,
                $dados['confirmado'] ? date('c') : null,
                $dados['txid'],
            ]);
        return;
    }
    db()->prepare('INSERT INTO dbo.GN_Saques
        (txid, session_id, moeda, valor, destino, foi_total, confirmado)
        VALUES (?,?,?,?,?,?,?)')
        ->execute([
            $dados['txid'], $dados['session_id'], $dados['moeda'],
            sprintf('%.8f', (float)$dados['valor']), $dados['destino'],
            $dados['foi_total'] ? 1 : 0, $dados['confirmado'] ? 1 : 0,
        ]);
}

function ler_saque(string $txid): ?array {
    $st = db()->prepare('SELECT txid, session_id, moeda, valor, destino, foi_total,
        criado_em, confirmado FROM dbo.GN_Saques WHERE txid=?');
    $st->execute([$txid]);
    $row = $st->fetch();
    if (!$row) return null;
    return [
        'txid' => $row['txid'], 'session_id' => $row['session_id'], 'moeda' => $row['moeda'],
        'valor' => $row['valor'], 'destino' => $row['destino'],
        'foi_total' => (bool)$row['foi_total'], 'criado_em' => $row['criado_em'],
        'confirmado' => (bool)$row['confirmado'],
    ];
}

function transferir_de_endereco(string $coin, string $enderecoOrigem, string $enderecoDestino, ?float $valor = null): array {
    debug_log('transferir_de_endereco:inicio', [
        'coin'=>$coin, 'origem'=>$enderecoOrigem, 'destino'=>$enderecoDestino, 'valor_pedido'=>$valor,
    ]);

    $utxos = wallet_rpc($coin, 'listunspent', [1, 9999999, [$enderecoOrigem]]);
    debug_log('transferir_de_endereco:utxos', ['coin'=>$coin, 'qtd'=>count($utxos), 'utxos'=>$utxos]);
    if (empty($utxos)) { debug_log('transferir_de_endereco:erro', ['motivo'=>'sem_utxo']); throw new RuntimeException('Sem saldo confirmado nesse endereço'); }

    $totalDisponivel = 0.0;
    $inputs = [];
    foreach ($utxos as $u) {
        $totalDisponivel += (float)$u['amount'];
        $inputs[] = ['txid' => $u['txid'], 'vout' => $u['vout']];
    }

    $ehTotal = ($valor === null) || (abs($valor - $totalDisponivel) < 0.00000001);
    $valorSaque = $ehTotal ? $totalDisponivel : $valor;
    debug_log('transferir_de_endereco:calculo', [
        'total_disponivel'=>$totalDisponivel, 'eh_total'=>$ehTotal, 'valor_saque'=>$valorSaque,
    ]);
    if ($valorSaque <= 0) { debug_log('transferir_de_endereco:erro', ['motivo'=>'valor_zero_ou_negativo', 'valor_saque'=>$valorSaque]); throw new RuntimeException('Nada a transferir'); }
    if ($valorSaque > $totalDisponivel) { debug_log('transferir_de_endereco:erro', ['motivo'=>'saldo_insuficiente', 'valor_saque'=>$valorSaque, 'total_disponivel'=>$totalDisponivel]); throw new RuntimeException('Saldo insuficiente para esse valor'); }

    $rawtx = wallet_rpc($coin, 'createrawtransaction', [$inputs, [$enderecoDestino => $valorSaque]]);
    debug_log('transferir_de_endereco:rawtx_criada', ['rawtx_len'=>strlen($rawtx)]);

    $fundOpts = ['add_inputs' => false];
    if ($ehTotal) {
        $fundOpts['subtractFeeFromOutputs'] = [0];
    } else {
        // Troco volta pro MESMO endereço de origem (mantém a segregação por usuário).
        $fundOpts['changeAddress'] = $enderecoOrigem;
    }
    debug_log('transferir_de_endereco:fundopts', $fundOpts);
    $funded = wallet_rpc($coin, 'fundrawtransaction', [$rawtx, $fundOpts]);
    debug_log('transferir_de_endereco:funded', ['fee'=>$funded['fee'] ?? null]);

    $signed = wallet_rpc($coin, 'signrawtransactionwithwallet', [$funded['hex']]);
    debug_log('transferir_de_endereco:assinada', ['complete'=>$signed['complete'] ?? null]);
    if (empty($signed['complete'])) { debug_log('transferir_de_endereco:erro', ['motivo'=>'assinatura_incompleta', 'errors'=>$signed['errors'] ?? null]); throw new RuntimeException('Falha ao assinar a transação de saída'); }

    $txid = wallet_rpc($coin, 'sendrawtransaction', [$signed['hex']]);
    debug_log('transferir_de_endereco:transmitida', ['txid'=>$txid, 'valor'=>$valorSaque, 'eh_total'=>$ehTotal]);

    return ['txid' => $txid, 'valor' => $valorSaque, 'total' => $ehTotal];
}

function varrer_saldo_para(string $coin, string $enderecoOrigem, string $enderecoDestino) {
    try {
        $r = transferir_de_endereco($coin, $enderecoOrigem, $enderecoDestino, null);
        return $r['txid'];
    } catch (Throwable $e) {
        return null;
    }
}

/* --- DB connection --- */
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

/* --- Electrum TCP client (para Electrs BTC e Fulcrum BCH) --- */
function electrum_query(string $host, int $port, array $request, int $timeout=6): ?array {
    $sock = @fsockopen($host, $port, $errno, $errstr, $timeout);
    if (!$sock) return null;
    stream_set_timeout($sock, $timeout);
    fwrite($sock, json_encode($request) . "\n");
    $resp = '';
    while (!feof($sock)) {
        $line = fgets($sock, 8192);
        if ($line === false) break;
        $resp .= $line;
        if (strpos($resp, "\n") !== false) break;
    }
    fclose($sock);
    $data = json_decode(trim($resp), true);
    return is_array($data) ? $data : null;
}

/* --- Converter endereço BCH para script hash (formato Electrum) --- */
function bch_address_to_scripthash(string $addr): ?string {
    // Aceita: bitcoincash:q... ou q...
    // Validação básica de formato — não fazemos decodificação cashaddr completa aqui.
    // Apenas verificamos se o endereço tem formato plausível.
    $addr = ltrim($addr);
    if (str_starts_with($addr, 'bitcoincash:')) $addr = substr($addr, 12);
    if (!preg_match('/^[qp][0-9a-z]{41,}$/i', $addr)) return null;
    return $addr; // retornamos o addr para uso no método get_history
}

/* --- Base58Check decode (sem bcmath/gmp): retorna bytes crus (versao+payload+checksum) --- */
function base58_decode(string $s): ?string {
    $alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    $bytes = [0];
    for ($i = 0; $i < strlen($s); $i++) {
        $p = strpos($alphabet, $s[$i]);
        if ($p === false) return null;
        $carry = $p;
        for ($j = 0; $j < count($bytes); $j++) {
            $carry += $bytes[$j] * 58;
            $bytes[$j] = $carry & 0xff;
            $carry >>= 8;
        }
        while ($carry > 0) { $bytes[] = $carry & 0xff; $carry >>= 8; }
    }
    $leadingZeros = 0;
    for ($i = 0; $i < strlen($s) && $s[$i] === '1'; $i++) $leadingZeros++;
    $bytes = array_reverse($bytes);
    return str_repeat("\x00", $leadingZeros) . implode('', array_map('chr', $bytes));
}

/* --- Bech32/Bech32m decode (BIP173/BIP350), sem dependencias externas --- */
function bech32_polymod(array $values): int {
    $gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    $chk = 1;
    foreach ($values as $v) {
        $top = $chk >> 25;
        $chk = (($chk & 0x1ffffff) << 5) ^ $v;
        for ($i = 0; $i < 5; $i++) if (($top >> $i) & 1) $chk ^= $gen[$i];
    }
    return $chk;
}
function bech32_hrp_expand(string $hrp): array {
    $ret = [];
    for ($i=0;$i<strlen($hrp);$i++) $ret[] = ord($hrp[$i]) >> 5;
    $ret[] = 0;
    for ($i=0;$i<strlen($hrp);$i++) $ret[] = ord($hrp[$i]) & 31;
    return $ret;
}
function bech32_decode(string $bech): ?array {
    $bech = strtolower($bech);
    $pos = strrpos($bech, '1');
    if ($pos === false || $pos < 1 || $pos + 7 > strlen($bech)) return null;
    $hrp = substr($bech, 0, $pos);
    $charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    $data = [];
    for ($i = $pos+1; $i < strlen($bech); $i++) {
        $d = strpos($charset, $bech[$i]);
        if ($d === false) return null;
        $data[] = $d;
    }
    $body = array_slice($data, 0, -6);
    if (bech32_polymod(array_merge(bech32_hrp_expand($hrp), $data)) === 1) return ['hrp'=>$hrp,'data'=>$body];
    if (bech32_polymod(array_merge(bech32_hrp_expand($hrp), $data)) === 0x2bc830a3) return ['hrp'=>$hrp,'data'=>$body];
    return null;
}
function convertbits(array $data, int $frombits, int $tobits, bool $pad): ?array {
    $acc = 0; $bits = 0; $ret = []; $maxv = (1 << $tobits) - 1;
    foreach ($data as $value) {
        if ($value < 0 || ($value >> $frombits)) return null;
        $acc = (($acc << $frombits) | $value);
        $bits += $frombits;
        while ($bits >= $tobits) { $bits -= $tobits; $ret[] = ($acc >> $bits) & $maxv; }
    }
    if ($pad) { if ($bits) $ret[] = ($acc << ($tobits - $bits)) & $maxv; }
    elseif ($bits >= $frombits || (($acc << ($tobits - $bits)) & $maxv)) return null;
    return $ret;
}

/* --- Endereco BTC (bech32 ou base58) -> scripthash Electrum (sha256 do scriptPubKey, invertido) --- */
function btc_address_to_scripthash(string $address): ?string {
    $script = null;
    if (preg_match('/^(bc1|tb1)[a-z0-9]{6,87}$/i', $address)) {
        $dec = bech32_decode($address);
        if (!$dec || count($dec['data']) < 1) return null;
        $witver = $dec['data'][0];
        $program = convertbits(array_slice($dec['data'], 1), 5, 8, false);
        if ($program === null || count($program) < 2 || count($program) > 40) return null;
        $opcode = $witver === 0 ? 0x00 : (0x50 + $witver);
        $script = chr($opcode) . chr(count($program)) . implode('', array_map('chr', $program));
    } else {
        $raw = base58_decode($address);
        if ($raw === null || strlen($raw) !== 25) return null;
        $payload  = substr($raw, 0, 21);
        $checksum = substr($raw, 21, 4);
        $calc = substr(hash('sha256', hash('sha256', $payload, true), true), 0, 4);
        if ($checksum !== $calc) return null;
        $version = ord($raw[0]);
        $hash160 = substr($raw, 1, 20);
        if ($version === 0x00)       $script = "\x76\xa9\x14" . $hash160 . "\x88\xac"; // P2PKH
        elseif ($version === 0x05)   $script = "\xa9\x14" . $hash160 . "\x87";           // P2SH
        else return null;
    }
    if ($script === null) return null;
    return bin2hex(strrev(hash('sha256', $script, true)));
}

/* --- Consultar saldo via Fulcrum-BTC (protocolo Electrum padrao: scripthash, nao address) --- */
function btc_balance(string $address): array {
    // Validação básica de endereço BTC
    if (!preg_match('/^(bc1[a-z0-9]{6,87}|[13][a-zA-Z1-9]{25,34})$/', $address)) {
        return ['valid'=>false, 'balance'=>'0'];
    }
    $sh = btc_address_to_scripthash($address);
    if ($sh === null) return ['valid'=>true, 'balance'=>'0', 'query_error'=>true];
    $req = ['id'=>1,'method'=>'blockchain.scripthash.get_balance','params'=>[$sh]];
    $resp = electrum_query('192.168.18.149', 50002, $req);
    if (!$resp || isset($resp['error'])) return ['valid'=>true, 'balance'=>'0', 'query_error'=>true];
    $sat = ($resp['result']['confirmed'] ?? 0) + ($resp['result']['unconfirmed'] ?? 0);
    $btc = number_format($sat / 1e8, 8, '.', '');
    return ['valid'=>true, 'balance'=>$btc];
}

/* --- Consultar saldo via Fulcrum (BCH) --- */
function bch_balance(string $address): array {
    $addr = ltrim($address);
    if (str_starts_with($addr, 'bitcoincash:')) $addr = substr($addr, 12);
    if (!preg_match('/^[qp][0-9a-z]{41,}$/i', $addr)) {
        return ['valid'=>false, 'balance'=>'0'];
    }
    $fullAddr = 'bitcoincash:' . $addr;
    $req = ['id'=>1,'method'=>'blockchain.address.get_balance','params'=>[$fullAddr]];
    $resp = electrum_query('192.168.18.112', 50001, $req);
    if (!$resp || isset($resp['error'])) return ['valid'=>true, 'balance'=>'0', 'query_error'=>true];
    $sat = ($resp['result']['confirmed'] ?? 0) + ($resp['result']['unconfirmed'] ?? 0);
    $bch = number_format($sat / 1e8, 8, '.', '');
    return ['valid'=>true, 'balance'=>$bch];
}

/* --- session_id = SHA256(fingerprint + btc + bch + ip) --- */
function make_session_id(string $fp, string $btc, string $bch, string $ip): string {
    return hash('sha256', $fp . '|' . $btc . '|' . $bch . '|' . $ip);
}

/* --- IP real do cliente --- */
function client_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP','HTTP_X_REAL_IP','HTTP_X_FORWARDED_FOR','REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) return trim(explode(',', $_SERVER[$k])[0]);
    }
    return '0.0.0.0';
}

/* ============================================================
 * Roteador de ações
 * ============================================================ */
$body   = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $body['action'] ?? '';

try {
    match ($action) {

        /* ---- check: sessão existente? ---- */
        'check' => (function() use ($body) {
            $sid = $body['session_id'] ?? '';
            if (strlen($sid) !== 64) { echo json_encode(['valid'=>false]); return; }
            $st = db()->prepare('SELECT session_id, btc_address, bch_address,
                btc_saldo_visto, bch_saldo_visto, modo_real, moeda_saida, endereco_saida, senha_hash
                FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            $row = $st->fetch();
            if (!$row) { echo json_encode(['valid'=>false]); return; }
            // Atualiza ultimo_acesso
            db()->prepare('UPDATE dbo.GN_Usuarios SET ultimo_acesso=GETUTCDATE() WHERE session_id=?')
                ->execute([$sid]);
            $btcPendente = 0.0; $bchPendente = 0.0;
            try { if ($row['btc_address']) $btcPendente = saldo_pendente('BTC', $row['btc_address']); } catch (Throwable $e) {}
            try { if ($row['bch_address']) $bchPendente = saldo_pendente('BCH', $row['bch_address']); } catch (Throwable $e) {}
            echo json_encode(['valid'=>true, 'session_id'=>$sid,
                'btc_address'    => $row['btc_address'],
                'bch_address'    => $row['bch_address'],
                'btc_saldo'      => $row['btc_saldo_visto'],
                'bch_saldo'      => $row['bch_saldo_visto'],
                'btc_pendente'   => $btcPendente,
                'bch_pendente'   => $bchPendente,
                'modo_real'      => (bool)$row['modo_real'],
                'moeda_saida'    => $row['moeda_saida'],
                'endereco_saida' => $row['endereco_saida'],
                'tem_senha'      => !empty($row['senha_hash']),
            ]);
        })(),

        /* ---- validate_address: valida endereço e retorna saldo ---- */
        'validate_address' => (function() use ($body) {
            $moeda   = strtoupper($body['moeda']   ?? '');
            $address = trim($body['address'] ?? '');
            if (!$address) { echo json_encode(['valid'=>false]); return; }
            if ($moeda === 'BTC') {
                $r = btc_balance($address);
            } elseif ($moeda === 'BCH') {
                $r = bch_balance($address);
            } else {
                echo json_encode(['valid'=>false,'error'=>'moeda desconhecida']); return;
            }
            echo json_encode($r);
        })(),

        /* ---- create_profile: cria perfil e GERA os endereços de depósito reais ---- */
        'create_profile' => (function() use ($body) {
            $fp  = trim($body['fingerprint_hash'] ?? '');
            $ua  = substr(trim($body['user_agent'] ?? ''), 0, 500);
            $ip  = client_ip();

            if (strlen($fp) < 16) { echo json_encode(['error'=>'fingerprint inválido']); return; }

            $sid = make_session_id($fp, '', '', $ip);

            // Já existe?
            $st = db()->prepare('SELECT session_id, btc_address, bch_address,
                btc_saldo_visto, bch_saldo_visto, modo_real, senha_hash FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            $existing = $st->fetch();
            if ($existing) {
                db()->prepare('UPDATE dbo.GN_Usuarios SET ultimo_acesso=GETUTCDATE() WHERE session_id=?')
                    ->execute([$sid]);
                echo json_encode(['session_id'=>$sid,
                    'btc_address'=>$existing['btc_address'],
                    'bch_address'=>$existing['bch_address'],
                    'btc_saldo'=>$existing['btc_saldo_visto'],
                    'bch_saldo'=>$existing['bch_saldo_visto'],
                    'modo_real'=>(bool)$existing['modo_real'],
                    'tem_senha'=>!empty($existing['senha_hash']),
                ]);
                return;
            }

            // Gera endereços reais nas duas wallets gamblenumbers
            $btcAddr = gerar_endereco_deposito('BTC', 'usuario-' . substr($sid, 0, 12));
            $bchAddr = gerar_endereco_deposito('BCH', 'usuario-' . substr($sid, 0, 12));

            $idioma = trim($body['idioma'] ?? '') ?: null;
            $ins = db()->prepare('INSERT INTO dbo.GN_Usuarios
                (session_id, fingerprint_hash, btc_address, bch_address,
                 btc_habilitado, bch_habilitado, btc_saldo_visto, bch_saldo_visto,
                 ip_primeiro, user_agent, idioma_preferido)
                VALUES (?,?,?,?,1,1,0,0,?,?,?)');
            $ins->execute([$sid, $fp, $btcAddr, $bchAddr, $ip, $ua, $idioma]);

            echo json_encode([
                'session_id'  => $sid,
                'btc_address' => $btcAddr,
                'bch_address' => $bchAddr,
                'btc_saldo'   => '0',
                'bch_saldo'   => '0',
                'modo_real'   => false,
                'tem_senha'   => false,
            ]);
        })(),

        /* ---- refresh_balance: reconsulta saldo REAL (RPC) dos enderecos gerados ---- */
        'refresh_balance' => (function() use ($body) {
            $sid = trim($body['session_id'] ?? '');
            if (strlen($sid) !== 64) { echo json_encode(['error'=>'session_id inválido']); return; }

            $st = db()->prepare('SELECT btc_address, bch_address, modo_real
                FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            $row = $st->fetch();
            if (!$row) { echo json_encode(['error'=>'sessão não encontrada']); return; }

            $btcNovo = null; $bchNovo = null; $btcPendente = 0.0; $bchPendente = 0.0;
            try { if ($row['btc_address']) $btcNovo = saldo_recebido('BTC', $row['btc_address']); } catch (Throwable $e) {}
            try { if ($row['bch_address']) $bchNovo = saldo_recebido('BCH', $row['bch_address']); } catch (Throwable $e) {}
            try { if ($row['btc_address']) $btcPendente = saldo_pendente('BTC', $row['btc_address']); } catch (Throwable $e) {}
            try { if ($row['bch_address']) $bchPendente = saldo_pendente('BCH', $row['bch_address']); } catch (Throwable $e) {}

            $jaEraReal = (bool)$row['modo_real'];
            $agoraEReal = $jaEraReal || ($btcNovo > 0) || ($bchNovo > 0) || ($btcPendente > 0) || ($bchPendente > 0);

            $sets = ['ultimo_acesso=GETUTCDATE()']; $params = [];
            if ($btcNovo !== null) { $sets[] = 'btc_saldo_visto=?'; $params[] = sprintf('%.8f', $btcNovo); }
            if ($bchNovo !== null) { $sets[] = 'bch_saldo_visto=?'; $params[] = sprintf('%.8f', $bchNovo); }
            if ($agoraEReal && !$jaEraReal) { $sets[] = 'modo_real=1'; $sets[] = 'modo_real_desde=GETUTCDATE()'; }
            $params[] = $sid;
            db()->prepare('UPDATE dbo.GN_Usuarios SET '.implode(', ', $sets).' WHERE session_id=?')
                ->execute($params);

            $st2 = db()->prepare('SELECT btc_saldo_visto, bch_saldo_visto, modo_real FROM dbo.GN_Usuarios WHERE session_id=?');
            $st2->execute([$sid]);
            $cur = $st2->fetch();

            echo json_encode([
                'session_id'      => $sid,
                'btc_saldo'       => $cur['btc_saldo_visto'],
                'bch_saldo'       => $cur['bch_saldo_visto'],
                'btc_pendente'    => $btcPendente,
                'bch_pendente'    => $bchPendente,
                'modo_real'       => (bool)$cur['modo_real'],
            ]);
        })(),

        /* ---- sacar_externa: envia parte ou todo o saldo de UM endereço pra fora, sem apagar o perfil ---- */
        /* ---- configurar_saida: cadastra o endereço/moeda de saída preferido do usuário ---- */
        'configurar_saida' => (function() use ($body) {
            $sid    = trim($body['session_id'] ?? '');
            $moeda  = strtoupper($body['moeda'] ?? '');
            $endereco = trim($body['endereco'] ?? '');

            if (strlen($sid) !== 64) { echo json_encode(['ok'=>false,'error'=>'session_id inválido']); return; }
            if (!in_array($moeda, ['BTC','BCH'], true)) { echo json_encode(['ok'=>false,'error'=>'moeda inválida']); return; }
            if (!$endereco) { echo json_encode(['ok'=>false,'error'=>'endereço obrigatório']); return; }

            db()->prepare('UPDATE dbo.GN_Usuarios SET moeda_saida=?, endereco_saida=?, ultimo_acesso=GETUTCDATE() WHERE session_id=?')
                ->execute([$moeda, $endereco, $sid]);

            echo json_encode(['ok'=>true, 'moeda_saida'=>$moeda, 'endereco_saida'=>$endereco]);
        })(),

        'sacar_externa' => (function() use ($body) {
            debug_log('sacar_externa:requisicao', $body);
            $sid    = trim($body['session_id'] ?? '');
            $moeda  = strtoupper($body['moeda'] ?? '');
            $valor  = isset($body['valor']) && $body['valor'] !== '' ? (float)$body['valor'] : null; // null = tudo

            if (strlen($sid) !== 64) { debug_log('sacar_externa:erro', ['motivo'=>'session_id_invalido']); echo json_encode(['ok'=>false,'error'=>'session_id inválido']); return; }
            if (!in_array($moeda, ['BTC','BCH'], true)) { debug_log('sacar_externa:erro', ['motivo'=>'moeda_invalida', 'moeda'=>$moeda]); echo json_encode(['ok'=>false,'error'=>'moeda inválida']); return; }

            $st = db()->prepare('SELECT btc_address, bch_address, moeda_saida, endereco_saida FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            $perfil = $st->fetch();
            if (!$perfil) { echo json_encode(['ok'=>false,'error'=>'sessão não encontrada']); return; }

            // Endereço de destino: usa o informado na chamada, ou cai pro endereço configurado previamente.
            $destino = trim($body['endereco_destino'] ?? '') ?: ($perfil['endereco_saida'] ?? '');
            if (!$destino) { echo json_encode(['ok'=>false,'error'=>'endereço de destino obrigatório (informe ou configure um antes em Configuração)']); return; }

            $enderecoOrigem = $moeda === 'BTC' ? $perfil['btc_address'] : $perfil['bch_address'];
            if (!$enderecoOrigem) { echo json_encode(['ok'=>false,'error'=>'endereço de origem inexistente']); return; }

            // Sacar 100% de UMA moeda (valor=null) não exige nada da outra moeda —
            // o usuário continua no site, a sessão continua existindo, nada fica órfão.
            // A exigência de concentração só se aplica ao wipe_profile (encerrar a conta).

            try {
                $r = transferir_de_endereco($moeda, $enderecoOrigem, $destino, $valor);
            } catch (Throwable $e) {
                debug_log('sacar_externa:excecao', ['mensagem'=>$e->getMessage(), 'trace'=>$e->getTraceAsString()]);
                echo json_encode(['ok'=>false, 'error'=>$e->getMessage()]);
                return;
            }
            debug_log('sacar_externa:sucesso', $r);

            // A PARTIR DAQUI o dinheiro JÁ SAIU DE VERDADE — nenhuma falha
            // depois deste ponto pode fazer a resposta parecer um erro geral.
            // Cada etapa pós-envio é isolada em seu próprio try/catch.

            try {
                salvar_saque([
                    'txid' => $r['txid'], 'session_id' => $sid, 'moeda' => $moeda,
                    'valor' => $r['valor'], 'destino' => $destino, 'foi_total' => $r['total'],
                    'criado_em' => date('c'), 'confirmado' => false,
                ]);
            } catch (Throwable $e) {
                debug_log('sacar_externa:erro_pos_envio', ['etapa'=>'salvar_saque', 'mensagem'=>$e->getMessage(), 'txid'=>$r['txid']]);
            }

            $btcAtual = null; $bchAtual = null;
            try { $btcAtual = saldo_recebido('BTC', $perfil['btc_address']); } catch (Throwable $e) {
                debug_log('sacar_externa:erro_pos_envio', ['etapa'=>'saldo_recebido_btc', 'mensagem'=>$e->getMessage(), 'txid'=>$r['txid']]);
            }
            try { $bchAtual = saldo_recebido('BCH', $perfil['bch_address']); } catch (Throwable $e) {
                debug_log('sacar_externa:erro_pos_envio', ['etapa'=>'saldo_recebido_bch', 'mensagem'=>$e->getMessage(), 'txid'=>$r['txid']]);
            }

            $aindaReal = ($btcAtual > 0) || ($bchAtual > 0);
            try {
                if ($btcAtual !== null || $bchAtual !== null) {
                    $sets = ['ultimo_acesso=GETUTCDATE()']; $params = [];
                    if ($btcAtual !== null) { $sets[]='btc_saldo_visto=?'; $params[]=sprintf('%.8f',$btcAtual); }
                    if ($bchAtual !== null) { $sets[]='bch_saldo_visto=?'; $params[]=sprintf('%.8f',$bchAtual); }
                    $sets[] = 'modo_real=?'; $params[] = $aindaReal ? 1 : 0;
                    $params[] = $sid;
                    db()->prepare('UPDATE dbo.GN_Usuarios SET '.implode(', ', $sets).' WHERE session_id=?')->execute($params);
                }
            } catch (Throwable $e) {
                debug_log('sacar_externa:erro_pos_envio', ['etapa'=>'update_saldo', 'mensagem'=>$e->getMessage(), 'txid'=>$r['txid']]);
            }

            // Sempre reporta sucesso do ENVIO em si — o que falhar depois fica só no log.
            echo json_encode([
                'ok'         => true,
                'txid'       => $r['txid'],
                'valor'      => $r['valor'],
                'foi_total'  => $r['total'],
                'btc_saldo'  => $btcAtual,
                'bch_saldo'  => $bchAtual,
                'modo_real'  => $aindaReal,
            ]);
        })(),

        /* ---- status_saque: consulta confirmações reais de um saque pelo TXID ---- */
        'status_saque' => (function() use ($body) {
            $txid = trim($body['txid'] ?? '');
            $moeda = strtoupper($body['moeda'] ?? '');
            if (!$txid || !in_array($moeda, ['BTC','BCH'], true)) {
                echo json_encode(['ok'=>false, 'error'=>'txid/moeda inválidos']); return;
            }
            $registro = ler_saque($txid);
            try {
                $tx = wallet_rpc($moeda, 'gettransaction', [$txid]);
                $conf = $tx['confirmations'] ?? 0;
                if ($conf > 0 && $registro && !$registro['confirmado']) {
                    $registro['confirmado'] = true;
                    salvar_saque($registro);
                }
                echo json_encode([
                    'ok' => true, 'txid' => $txid, 'confirmations' => $conf,
                    'registro' => $registro,
                ]);
            } catch (Throwable $e) {
                echo json_encode(['ok'=>false, 'error'=>$e->getMessage(), 'registro'=>$registro]);
            }
        })(),

        /* ---- cotacao_saque: preço atual + taxa de rede, na moeda de exibição escolhida ---- */
        'cotacao_saque' => (function() use ($body) {
            $moeda = strtoupper($body['moeda'] ?? '');
            $moedaExibicao = strtoupper($body['moeda_exibicao'] ?? 'BRL');
            if (!in_array($moeda, ['BTC','BCH'], true)) { echo json_encode(['ok'=>false,'error'=>'moeda inválida']); return; }

            $tabela = $moeda === 'BTC' ? 'dbo.snapshots' : 'dbo.BCH_Snapshots';
            $row = db()->query("SELECT TOP 1 media_exchanges_brl, media_exchanges_usd FROM {$tabela} ORDER BY ts_utc DESC")->fetch();
            if (!$row) { echo json_encode(['ok'=>false,'error'=>'sem cotação disponível']); return; }

            $precoBrl = (float)$row['media_exchanges_brl'];
            $precoUsd = (float)$row['media_exchanges_usd'];
            $precoExib = $precoBrl;

            if ($moedaExibicao !== 'BRL') {
                $fx = db()->query("SELECT TOP 1 usd_brl,usd_eur,usd_gbp,usd_jpy,usd_cny,usd_try,usd_rub FROM dbo.FX_Snapshots WHERE ok=1 ORDER BY ts_utc DESC")->fetch();
                if ($fx && (float)($fx['usd_brl'] ?? 0) > 0) {
                    $usdBrl = (float)$fx['usd_brl'];
                    if ($moedaExibicao === 'USD') {
                        $precoExib = $precoUsd;
                    } else {
                        $col = 'usd_' . strtolower($moedaExibicao);
                        if (isset($fx[$col]) && $fx[$col] !== null) {
                            $rate = (float)$fx[$col] / $usdBrl; // BRL -> moeda de exibição
                            $precoExib = $precoBrl * $rate;
                        }
                    }
                }
            }

            // Taxa de rede estimada: fee rate ao vivo via RPC (as tabelas de cotação
            // não coletam essa info de forma consistente entre BTC e BCH).
            $feeRateSatVb = 1.0;
            try {
                $relayFee = (float)wallet_rpc($moeda, 'getnetworkinfo')['relayfee'];
                if ($moeda === 'BTC') {
                    $est = wallet_rpc('BTC', 'estimatesmartfee', [6]);
                    $feePerKb = (float)($est['feerate'] ?? $relayFee);
                } else {
                    $feePerKb = (float)wallet_rpc('BCH', 'estimatefee');
                    if ($feePerKb <= 0) $feePerKb = $relayFee;
                }
                $feeRateSatVb = max(($feePerKb / 1000) * 1e8, ($relayFee / 1000) * 1e8);
            } catch (Throwable $e) { /* mantém o piso de 1 sat/vB */ }
            if ($feeRateSatVb <= 0) $feeRateSatVb = 1;
            $tamanhoTxVbytes = 140;
            $taxaSats = $feeRateSatVb * $tamanhoTxVbytes;
            $taxaCripto = $taxaSats / 1e8;
            $taxaExib = $taxaCripto * $precoExib;

            echo json_encode([
                'ok' => true, 'moeda' => $moeda, 'moeda_exibicao' => $moedaExibicao,
                'preco_unitario' => $precoExib,
                'taxa_rede_cripto' => $taxaCripto,
                'taxa_rede_exib' => $taxaExib,
            ]);
        })(),

        /* ---- log_cliente: recebe eventos/erros do navegador para o mesmo log de depuração ---- */
        'log_cliente' => (function() use ($body) {
            debug_log('cliente:' . ($body['etapa'] ?? 'desconhecida'), $body['dados'] ?? []);
            echo json_encode(['ok'=>true]);
        })(),

        /* ---- configurar_senha: define/atualiza a senha de acesso portátil (hash bcrypt/argon2) ---- */
        'configurar_senha' => (function() use ($body) {
            $sid   = trim($body['session_id'] ?? '');
            $senha = (string)($body['senha'] ?? '');

            if (strlen($sid) !== 64) { echo json_encode(['ok'=>false,'error'=>'session_id inválido']); return; }

            if (strlen($senha) < 8) {
                echo json_encode(['ok'=>false,'error'=>'A senha precisa ter pelo menos 8 caracteres.']); return;
            }
            if (!preg_match('/[A-Z]/', $senha)) {
                echo json_encode(['ok'=>false,'error'=>'A senha precisa ter pelo menos 1 letra maiúscula.']); return;
            }
            if (!preg_match('/[a-z]/', $senha)) {
                echo json_encode(['ok'=>false,'error'=>'A senha precisa ter pelo menos 1 letra minúscula.']); return;
            }
            if (!preg_match('/[0-9]/', $senha)) {
                echo json_encode(['ok'=>false,'error'=>'A senha precisa ter pelo menos 1 número.']); return;
            }

            $st = db()->prepare('SELECT session_id FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            if (!$st->fetch()) { echo json_encode(['ok'=>false,'error'=>'sessão não encontrada']); return; }

            $hash = password_hash($senha, PASSWORD_DEFAULT);
            db()->prepare('UPDATE dbo.GN_Usuarios SET senha_hash=?, ultimo_acesso=GETUTCDATE() WHERE session_id=?')
                ->execute([$hash, $sid]);

            echo json_encode(['ok'=>true]);
        })(),

        /* ---- login_senha: recupera a sessão existente a partir da senha, de qualquer navegador/aparelho ---- */
        'login_senha' => (function() use ($body) {
            $senha = (string)($body['senha'] ?? '');
            if ($senha === '') { echo json_encode(['matched'=>false]); return; }

            $st = db()->query("SELECT session_id, btc_address, bch_address, btc_saldo_visto, bch_saldo_visto,
                modo_real, moeda_saida, endereco_saida, senha_hash, idioma_preferido
                FROM dbo.GN_Usuarios WHERE senha_hash IS NOT NULL");
            $candidatos = $st->fetchAll();

            foreach ($candidatos as $row) {
                if (password_verify($senha, $row['senha_hash'])) {
                    db()->prepare('UPDATE dbo.GN_Usuarios SET ultimo_acesso=GETUTCDATE() WHERE session_id=?')
                        ->execute([$row['session_id']]);

                    $btcPendente = 0.0; $bchPendente = 0.0;
                    try { if ($row['btc_address']) $btcPendente = saldo_pendente('BTC', $row['btc_address']); } catch (Throwable $e) {}
                    try { if ($row['bch_address']) $bchPendente = saldo_pendente('BCH', $row['bch_address']); } catch (Throwable $e) {}

                    echo json_encode([
                        'matched'          => true,
                        'session_id'       => $row['session_id'],
                        'btc_address'      => $row['btc_address'],
                        'bch_address'      => $row['bch_address'],
                        'btc_saldo'        => $row['btc_saldo_visto'],
                        'bch_saldo'        => $row['bch_saldo_visto'],
                        'btc_pendente'     => $btcPendente,
                        'bch_pendente'     => $bchPendente,
                        'modo_real'        => (bool)$row['modo_real'],
                        'moeda_saida'      => $row['moeda_saida'],
                        'endereco_saida'   => $row['endereco_saida'],
                        'idioma_preferido' => $row['idioma_preferido'],
                    ]);
                    return;
                }
            }
            echo json_encode(['matched'=>false]);
        })(),

        /* ---- salvar_idioma: persiste o idioma preferido da conta ---- */
        'salvar_idioma' => (function() use ($body) {
            $sid = trim($body['session_id'] ?? '');
            $idioma = trim($body['idioma'] ?? '');
            if (strlen($sid) !== 64 || !$idioma) { echo json_encode(['ok'=>false]); return; }
            db()->prepare('UPDATE dbo.GN_Usuarios SET idioma_preferido=? WHERE session_id=?')
                ->execute([$idioma, $sid]);
            echo json_encode(['ok'=>true]);
        })(),

        'wipe_profile' => (function() use ($body) {
            $sid = trim($body['session_id'] ?? '');
            if (strlen($sid) !== 64) { echo json_encode(['error'=>'session_id invalido']); return; }

            $st = db()->prepare('SELECT btc_address, bch_address, modo_real, moeda_saida, endereco_saida FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            $perfil = $st->fetch();

            if ($perfil && $perfil['modo_real']) {
                $saldoBtc = 0; $saldoBch = 0;
                try { $saldoBtc = saldo_recebido('BTC', $perfil['btc_address']); } catch (Throwable $e) {}
                try { $saldoBch = saldo_recebido('BCH', $perfil['bch_address']); } catch (Throwable $e) {}

                // Wipe completo exige saldo concentrado numa moeda só.
                if ($saldoBtc > 0 && $saldoBch > 0) {
                    echo json_encode([
                        'ok' => false,
                        'precisa_consolidar' => true,
                        'saldo_btc' => $saldoBtc,
                        'saldo_bch' => $saldoBch,
                        'error' => 'Você tem saldo nas duas moedas. Consolide tudo numa moeda só usando TRANSFERÊNCIA antes de encerrar sua conta.',
                    ]);
                    return;
                }

                $moedaComSaldo = $saldoBtc > 0 ? 'BTC' : ($saldoBch > 0 ? 'BCH' : null);
                if ($moedaComSaldo) {
                    $destino = trim($body['endereco_saida'] ?? '') ?: ($perfil['endereco_saida'] ?? '');
                    if (!$destino) {
                        echo json_encode(['ok'=>false, 'precisa_endereco_saida'=>true, 'moeda'=>$moedaComSaldo,
                            'saldo'=>$moedaComSaldo==='BTC'?$saldoBtc:$saldoBch]);
                        return;
                    }
                    $enderecoOrigem = $moedaComSaldo === 'BTC' ? $perfil['btc_address'] : $perfil['bch_address'];
                    try {
                        $txids = [strtolower($moedaComSaldo) => varrer_saldo_para($moedaComSaldo, $enderecoOrigem, $destino)];
                    } catch (Throwable $e) {
                        http_response_code(500);
                        echo json_encode(['ok'=>false, 'error'=>'Falha ao transferir saldo antes de sair: '.$e->getMessage()]);
                        return;
                    }
                }
            }

            $pdo = db();
            $pdo->beginTransaction();
            try {
                $pdo->prepare('DELETE FROM dbo.GN_Enderecos_Escrow WHERE trade_id IN (SELECT trade_id FROM dbo.GN_Trades WHERE session_comprador=? OR session_vendedor=?)')->execute([$sid, $sid]);
                $pdo->prepare('DELETE FROM dbo.GN_Depositos WHERE session_id=? OR trade_id IN (SELECT trade_id FROM dbo.GN_Trades WHERE session_comprador=? OR session_vendedor=?)')->execute([$sid, $sid, $sid]);
                $pdo->prepare('DELETE FROM dbo.GN_Pagamentos WHERE session_destinatario=? OR trade_id IN (SELECT trade_id FROM dbo.GN_Trades WHERE session_comprador=? OR session_vendedor=?)')->execute([$sid, $sid, $sid]);
                $pdo->prepare('DELETE FROM dbo.GN_Trades WHERE session_comprador=? OR session_vendedor=?')->execute([$sid, $sid]);
                $pdo->prepare('DELETE FROM dbo.GN_Ordens WHERE session_id=?')->execute([$sid]);
                $st = $pdo->prepare('DELETE FROM dbo.GN_Usuarios WHERE session_id=?');
                $st->execute([$sid]);
                $apagado = $st->rowCount() > 0;
                $pdo->commit();
                echo json_encode(['ok'=>true, 'apagado'=>$apagado, 'txids'=>$txids ?? []]);
            } catch (Throwable $e) {
                $pdo->rollBack();
                http_response_code(500);
                echo json_encode(['ok'=>false, 'error'=>$e->getMessage()]);
            }
        })(),

        default => (function() {
            http_response_code(400);
            echo json_encode(['error'=>'ação desconhecida']);
        })()
    };
} catch (Throwable $e) {
    debug_log('router:excecao_nao_tratada', [
        'action' => $action, 'mensagem' => $e->getMessage(),
        'arquivo' => $e->getFile(), 'linha' => $e->getLine(), 'trace' => $e->getTraceAsString(),
    ]);
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
