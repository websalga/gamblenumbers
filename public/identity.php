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
            $st = db()->prepare('SELECT session_id, btc_habilitado, bch_habilitado,
                btc_address, bch_address, btc_saldo_visto, bch_saldo_visto
                FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            $row = $st->fetch();
            if (!$row) { echo json_encode(['valid'=>false]); return; }
            // Atualiza ultimo_acesso
            db()->prepare('UPDATE dbo.GN_Usuarios SET ultimo_acesso=GETUTCDATE() WHERE session_id=?')
                ->execute([$sid]);
            echo json_encode(['valid'=>true, 'session_id'=>$sid,
                'btc_habilitado'=>(bool)$row['btc_habilitado'],
                'bch_habilitado'=>(bool)$row['bch_habilitado'],
                'btc_address'   => $row['btc_address'],
                'bch_address'   => $row['bch_address'],
                'btc_saldo'     => $row['btc_saldo_visto'],
                'bch_saldo'     => $row['bch_saldo_visto'],
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

        /* ---- create_profile: cria ou retorna perfil existente ---- */
        'create_profile' => (function() use ($body) {
            $fp  = trim($body['fingerprint_hash'] ?? '');
            $btc = trim($body['btc_address']      ?? '');
            $bch = trim($body['bch_address']       ?? '');
            $ua  = substr(trim($body['user_agent'] ?? ''), 0, 500);
            $ip  = client_ip();

            if (strlen($fp) < 16) { echo json_encode(['error'=>'fingerprint inválido']); return; }

            $sid = make_session_id($fp, $btc, $bch, $ip);

            // Já existe?
            $st = db()->prepare('SELECT session_id, btc_habilitado, bch_habilitado,
                btc_saldo_visto, bch_saldo_visto FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            $existing = $st->fetch();
            if ($existing) {
                db()->prepare('UPDATE dbo.GN_Usuarios SET ultimo_acesso=GETUTCDATE() WHERE session_id=?')
                    ->execute([$sid]);
                echo json_encode(['session_id'=>$sid,
                    'btc_habilitado'=>(bool)$existing['btc_habilitado'],
                    'bch_habilitado'=>(bool)$existing['bch_habilitado'],
                    'btc_saldo'=>$existing['btc_saldo_visto'],
                    'bch_saldo'=>$existing['bch_saldo_visto'],
                ]);
                return;
            }

            // Validar e consultar saldos
            $btcResult = $btc ? btc_balance($btc) : ['valid'=>false,'balance'=>'0'];
            $bchResult = $bch ? bch_balance($bch) : ['valid'=>false,'balance'=>'0'];

            $btcHab = $btc && $btcResult['valid'];
            $bchHab = $bch && $bchResult['valid'];

            // Gravar
            $ins = db()->prepare('INSERT INTO dbo.GN_Usuarios
                (session_id, fingerprint_hash, btc_address, bch_address,
                 btc_habilitado, bch_habilitado, btc_saldo_visto, bch_saldo_visto,
                 ip_primeiro, user_agent)
                VALUES (?,?,?,?,?,?,?,?,?,?)');
            $ins->execute([
                $sid, $fp,
                $btcHab ? $btc : null,
                $bchHab ? $bch : null,
                $btcHab ? 1 : 0,
                $bchHab ? 1 : 0,
                $btcHab ? $btcResult['balance'] : null,
                $bchHab ? $bchResult['balance'] : null,
                $ip, $ua
            ]);

            echo json_encode([
                'session_id'    => $sid,
                'btc_habilitado'=> $btcHab,
                'bch_habilitado'=> $bchHab,
                'btc_saldo'     => $btcHab ? $btcResult['balance'] : '0',
                'bch_saldo'     => $bchHab ? $bchResult['balance'] : '0',
            ]);
        })(),

        /* ---- refresh_balance: reconsulta saldo on-chain dos enderecos ja salvos ---- */
        'refresh_balance' => (function() use ($body) {
            $sid = trim($body['session_id'] ?? '');
            if (strlen($sid) !== 64) { echo json_encode(['error'=>'session_id inválido']); return; }

            $st = db()->prepare('SELECT btc_address, bch_address, btc_habilitado, bch_habilitado
                FROM dbo.GN_Usuarios WHERE session_id=?');
            $st->execute([$sid]);
            $row = $st->fetch();
            if (!$row) { echo json_encode(['error'=>'sessão não encontrada']); return; }

            $btcNovo = null; $bchNovo = null;
            if ($row['btc_habilitado'] && $row['btc_address']) {
                $r = btc_balance($row['btc_address']);
                if ($r['valid'] && empty($r['query_error'])) $btcNovo = $r['balance'];
            }
            if ($row['bch_habilitado'] && $row['bch_address']) {
                $r = bch_balance($row['bch_address']);
                if ($r['valid'] && empty($r['query_error'])) $bchNovo = $r['balance'];
            }

            // So sobrescreve no banco os saldos que vieram bem; um erro pontual
            // na rede/Fulcrum nao apaga o ultimo valor conhecido do usuario.
            $sets = ['ultimo_acesso=GETUTCDATE()']; $params = [];
            if ($btcNovo !== null) { $sets[] = 'btc_saldo_visto=?'; $params[] = $btcNovo; }
            if ($bchNovo !== null) { $sets[] = 'bch_saldo_visto=?'; $params[] = $bchNovo; }
            $params[] = $sid;
            db()->prepare('UPDATE dbo.GN_Usuarios SET '.implode(', ', $sets).' WHERE session_id=?')
                ->execute($params);

            $st2 = db()->prepare('SELECT btc_saldo_visto, bch_saldo_visto FROM dbo.GN_Usuarios WHERE session_id=?');
            $st2->execute([$sid]);
            $cur = $st2->fetch();

            echo json_encode([
                'session_id'     => $sid,
                'btc_habilitado' => (bool)$row['btc_habilitado'],
                'bch_habilitado' => (bool)$row['bch_habilitado'],
                'btc_saldo'      => $cur['btc_saldo_visto'],
                'bch_saldo'      => $cur['bch_saldo_visto'],
            ]);
        })(),

        'wipe_profile' => (function() use ($body) {
            $sid = trim($body['session_id'] ?? '');
            if (strlen($sid) !== 64) { echo json_encode(['error'=>'session_id invalido']); return; }
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
                echo json_encode(['ok'=>true, 'apagado'=>$apagado]);
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
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
