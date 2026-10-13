<?php
/* ============================================================
 * app_lib.php — funções de apoio do app mobile (public/app/api.php)
 *
 * Arquivo NOVO. Não altera nem inclui nenhum arquivo existente do site;
 * apenas lê private/config.php e private/wallet_config.php (credenciais).
 * Só BTC no app (v1).
 * ============================================================ */
declare(strict_types=1);

const APP_RP_ID        = 'gamblenumbers.com';
const APP_ORIGENS      = ['https://gamblenumbers.com', 'https://www.gamblenumbers.com'];
const APP_MEMPOOL_API  = 'http://192.168.18.149:4000';   // mempool.space em lxbtc01
const APP_FULCRUM_HOST = '192.168.18.149';
const APP_FULCRUM_PORT = 50002;
const APP_TAXA_MAX_SATVB = 50;                            // teto da taxa personalizada
const APP_CONF_ALVO    = 3;                               // confirmações exibidas como "concluído"
const APP_DESAFIO_TTL  = 120;                             // segundos para confirmar com a digital

/* ---------- utilidades ---------- */
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

function out(array $d, int $code = 200): void {
    http_response_code($code);
    echo json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function app_log(string $etapa, array $dados = []): void {
    $f = __DIR__ . '/logs/app.log';
    if (!is_dir(dirname($f))) @mkdir(dirname($f), 0750, true);
    @file_put_contents($f, json_encode(['ts' => date('c'), 'etapa' => $etapa, 'dados' => $dados], JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}

function b64u_enc(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true); }

function client_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) return trim(explode(',', $_SERVER[$k])[0]);
    }
    return '0.0.0.0';
}

/* Limite de tentativas (senha/passkey) — tabela própria GN_AppTentativas */
/* A chave de tentativa vira HMAC (prefixo + hash): nunca grava IP nem session_id em claro. */
function chave_anon(string $chave): string {
    static $salt = null;
    if ($salt === null) {
        $salt = 'gn';
        $f = __DIR__ . '/anon_config.php';
        if (is_file($f)) { $c = include $f; if (is_array($c) && !empty($c['anon_salt'])) $salt = (string)$c['anon_salt']; }
    }
    $p = strpos($chave, ':');
    return ($p === false ? '' : substr($chave, 0, $p + 1)) . substr(hash_hmac('sha256', 'tentativa|' . $chave, $salt), 0, 40);
}
function tentativas_excedidas(string $chave, int $max, int $janelaMin): bool {
    $chave = chave_anon($chave);
    $st = db()->prepare('SELECT COUNT(*) FROM dbo.GN_AppTentativas WHERE chave=? AND criado_em > DATEADD(MINUTE, CAST(? AS INT), SYSUTCDATETIME())');
    $st->execute([$chave, -$janelaMin]);
    return (int)$st->fetchColumn() >= $max;
}
function registrar_tentativa(string $chave): void {
    $chave = chave_anon($chave);
    db()->prepare('INSERT INTO dbo.GN_AppTentativas (chave) VALUES (?)')->execute([$chave]);
    db()->exec("DELETE FROM dbo.GN_AppTentativas WHERE criado_em < DATEADD(DAY,-2,SYSUTCDATETIME())");
}

/* ---------- RPC Bitcoin Core (carteira gamblenumbers) ---------- */
function btc_rpc(string $method, array $params = []) {
    global $RPC_BTC_HOST, $RPC_BTC_PORT, $RPC_BTC_USER, $RPC_BTC_PASS;
    $url = "http://{$RPC_BTC_HOST}:{$RPC_BTC_PORT}/wallet/gamblenumbers";
    array_walk_recursive($params, function (&$v) { if (is_float($v)) $v = sprintf('%.8f', $v); });
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['jsonrpc' => '1.0', 'id' => 'app', 'method' => $method, 'params' => $params]),
        CURLOPT_HTTPHEADER => ['Content-Type: text/plain'],
        CURLOPT_USERPWD => "{$RPC_BTC_USER}:{$RPC_BTC_PASS}", CURLOPT_TIMEOUT => 20,
    ]);
    $resp = curl_exec($ch); $err = curl_error($ch); curl_close($ch);
    if ($resp === false) throw new RuntimeException("Falha RPC ({$method}): {$err}");
    $d = json_decode($resp, true);
    if (isset($d['error']) && $d['error'] !== null) throw new RuntimeException('Erro RPC (' . $method . '): ' . ($d['error']['message'] ?? json_encode($d['error'])));
    return $d['result'];
}

function sats(float|string $btc): int { return (int)round(((float)$btc) * 1e8); }
function btc_str(int $sats): string { return number_format($sats / 1e8, 8, '.', ''); }

function saldo_sats(string $address, int $minconf): int {
    $tot = 0;
    foreach (btc_rpc('listunspent', [$minconf, 9999999, [$address]]) as $u) $tot += sats($u['amount']);
    return $tot;
}

/* ---------- mempool.space (lxbtc01) ---------- */
function mempool_get(string $path, int $timeout = 4): ?array {
    $ch = curl_init(APP_MEMPOOL_API . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_CONNECTTIMEOUT => 2]);
    $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($r === false || $code !== 200) return null;
    $j = json_decode($r, true);
    return is_array($j) ? $j : null;
}

/* Níveis de taxa. Padrão do app = mínima. */
function niveis_taxa(): array {
    $rec = mempool_get('/api/v1/fees/recommended') ?? [];
    $min = max(1.0, (float)($rec['minimumFee'] ?? 1));
    try { $mp = btc_rpc('getmempoolinfo'); $min = max($min, (float)$mp['mempoolminfee'] * 1e5); } catch (Throwable $e) {}
    $normal = max($min, (float)($rec['halfHourFee'] ?? $min));
    $rapida = max($normal, (float)($rec['fastestFee'] ?? $normal));
    return ['min' => $min, 'normal' => $normal, 'rapida' => $rapida];
}

/* Quantos blocos até confirmar, dado o fee rate, pelos blocos projetados do mempool. */
function blocos_ate_confirmar(float $rate): int {
    $blocks = mempool_get('/api/v1/fees/mempool-blocks');
    if (!$blocks) return 1;
    foreach ($blocks as $i => $b) {
        $min = (float)($b['feeRange'][0] ?? 0);
        if ($rate >= $min) return $i + 1;
    }
    return count($blocks) + 1;
}

/* ---------- Fulcrum (protocolo Electrum) ---------- */
function electrum_query(array $req, int $timeout = 6): ?array {
    $sock = @stream_socket_client('tcp://' . APP_FULCRUM_HOST . ':' . APP_FULCRUM_PORT, $en, $es, $timeout);
    if (!$sock) {
        // porta 50002 pode ser TLS: tenta ssl sem verificar o certificado interno
        $ctx = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
        $sock = @stream_socket_client('ssl://' . APP_FULCRUM_HOST . ':' . APP_FULCRUM_PORT, $en, $es, $timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$sock) return null;
    }
    stream_set_timeout($sock, $timeout);
    fwrite($sock, json_encode($req) . "\n");
    $resp = '';
    while (!feof($sock)) { $l = fgets($sock, 1 << 20); if ($l === false) break; $resp .= $l; if (str_contains($resp, "\n")) break; }
    fclose($sock);
    $d = json_decode(trim($resp), true);
    return is_array($d) ? $d : null;
}

function base58_decode(string $s): ?string {
    $alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    $bytes = [0];
    for ($i = 0; $i < strlen($s); $i++) {
        $p = strpos($alphabet, $s[$i]); if ($p === false) return null;
        $carry = $p;
        for ($j = 0; $j < count($bytes); $j++) { $carry += $bytes[$j] * 58; $bytes[$j] = $carry & 0xff; $carry >>= 8; }
        while ($carry > 0) { $bytes[] = $carry & 0xff; $carry >>= 8; }
    }
    $lz = 0; for ($i = 0; $i < strlen($s) && $s[$i] === '1'; $i++) $lz++;
    return str_repeat("\x00", $lz) . implode('', array_map('chr', array_reverse($bytes)));
}
function bech32_polymod(array $v): int {
    $gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; $chk = 1;
    foreach ($v as $x) { $top = $chk >> 25; $chk = (($chk & 0x1ffffff) << 5) ^ $x; for ($i = 0; $i < 5; $i++) if (($top >> $i) & 1) $chk ^= $gen[$i]; }
    return $chk;
}
function bech32_decode_prog(string $bech): ?array {
    $bech = strtolower($bech); $pos = strrpos($bech, '1');
    if ($pos === false || $pos < 1 || $pos + 7 > strlen($bech)) return null;
    $hrp = substr($bech, 0, $pos); $cs = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'; $data = [];
    for ($i = $pos + 1; $i < strlen($bech); $i++) { $d = strpos($cs, $bech[$i]); if ($d === false) return null; $data[] = $d; }
    $exp = []; for ($i = 0; $i < strlen($hrp); $i++) $exp[] = ord($hrp[$i]) >> 5; $exp[] = 0; for ($i = 0; $i < strlen($hrp); $i++) $exp[] = ord($hrp[$i]) & 31;
    $pm = bech32_polymod(array_merge($exp, $data));
    if ($pm !== 1 && $pm !== 0x2bc830a3) return null;
    return ['hrp' => $hrp, 'data' => array_slice($data, 0, -6)];
}
function convertbits(array $data, int $from, int $to, bool $pad): ?array {
    $acc = 0; $bits = 0; $ret = []; $maxv = (1 << $to) - 1;
    foreach ($data as $v) { if ($v < 0 || ($v >> $from)) return null; $acc = ($acc << $from) | $v; $bits += $from; while ($bits >= $to) { $bits -= $to; $ret[] = ($acc >> $bits) & $maxv; } }
    if ($pad) { if ($bits) $ret[] = ($acc << ($to - $bits)) & $maxv; }
    elseif ($bits >= $from || (($acc << ($to - $bits)) & $maxv)) return null;
    return $ret;
}
/* Endereço BTC → [scriptPubKey binário, tipo] */
function btc_address_script(string $a): ?array {
    if (preg_match('/^bc1[a-z0-9]{6,87}$/i', $a)) {
        $dec = bech32_decode_prog($a); if (!$dec || count($dec['data']) < 1) return null;
        $ver = $dec['data'][0]; $prog = convertbits(array_slice($dec['data'], 1), 5, 8, false);
        if ($prog === null || count($prog) < 2 || count($prog) > 40) return null;
        $script = chr($ver === 0 ? 0x00 : 0x50 + $ver) . chr(count($prog)) . implode('', array_map('chr', $prog));
        $tipo = $ver === 0 ? (count($prog) === 20 ? 'P2WPKH' : 'P2WSH') : ($ver === 1 ? 'P2TR' : 'WITNESS_V' . $ver);
        return [$script, $tipo];
    }
    $raw = base58_decode($a);
    if ($raw === null || strlen($raw) !== 25) return null;
    if (substr(hash('sha256', hash('sha256', substr($raw, 0, 21), true), true), 0, 4) !== substr($raw, 21, 4)) return null;
    $h = substr($raw, 1, 20);
    if (ord($raw[0]) === 0x00) return ["\x76\xa9\x14" . $h . "\x88\xac", 'P2PKH'];
    if (ord($raw[0]) === 0x05) return ["\xa9\x14" . $h . "\x87", 'P2SH'];
    return null;
}
function btc_scripthash(string $a): ?string {
    $s = btc_address_script($a);
    return $s ? bin2hex(strrev(hash('sha256', $s[0], true))) : null;
}

/* ---------- Construção da transação (sem transmitir) ----------
 * Usa SOMENTE os UTXOs do endereço de origem do usuário; troco volta para o mesmo endereço
 * (mesma regra do saque do site). Retorna dados reais: taxa, vsize e valor que chega ao destino. */
function montar_saque(string $origem, string $destino, ?int $valorSats, float $feeRate): array {
    $utxos = btc_rpc('listunspent', [1, 9999999, [$origem]]);
    if (!$utxos) throw new RuntimeException('Sem saldo confirmado para sacar.');
    $inputs = []; $total = 0;
    foreach ($utxos as $u) { $total += sats($u['amount']); $inputs[] = ['txid' => $u['txid'], 'vout' => $u['vout']]; }
    $ehTotal = ($valorSats === null) || $valorSats >= $total;
    $alvo = $ehTotal ? $total : $valorSats;
    if ($alvo < 546) throw new RuntimeException('Valor abaixo do mínimo aceito pela rede.');
    $raw = btc_rpc('createrawtransaction', [$inputs, [$destino => btc_str($alvo)]]);
    $opts = ['add_inputs' => false, 'fee_rate' => sprintf('%.2f', $feeRate)];
    if ($ehTotal) $opts['subtractFeeFromOutputs'] = [0]; else $opts['changeAddress'] = $origem;
    $f = btc_rpc('fundrawtransaction', [$raw, $opts]);
    $s = btc_rpc('signrawtransactionwithwallet', [$f['hex']]);
    if (empty($s['complete'])) throw new RuntimeException('Falha ao assinar a transação.');
    $dec = btc_rpc('decoderawtransaction', [$s['hex']]);
    $recebido = 0;
    foreach ($dec['vout'] as $o) { if (($o['scriptPubKey']['address'] ?? '') === $destino) $recebido += sats($o['value']); }
    $fee = sats($f['fee']);
    if ($recebido <= 0) throw new RuntimeException('Transação montada sem saída para o destino.');
    if ($recebido + $fee > $total) throw new RuntimeException('Saldo insuficiente para o valor e a taxa.');
    return [
        'hex' => $s['hex'], 'fee_sats' => $fee, 'vsize' => (float)$dec['vsize'],
        'recebido_sats' => $recebido, 'debitado_sats' => $recebido + $fee,
        'total' => $ehTotal, 'saldo_sats' => $total, 'fee_rate' => $feeRate,
    ];
}

/* ---------- CBOR mínimo (para attestationObject / chave COSE) ---------- */
function cbor_decode(string $d, int &$o) {
    $ib = ord($d[$o++]); $mt = $ib >> 5; $ai = $ib & 31; $val = $ai;
    if ($ai === 24) { $val = ord($d[$o++]); }
    elseif ($ai === 25) { $val = unpack('n', substr($d, $o, 2))[1]; $o += 2; }
    elseif ($ai === 26) { $val = unpack('N', substr($d, $o, 4))[1]; $o += 4; }
    elseif ($ai === 27) { $val = unpack('J', substr($d, $o, 8))[1]; $o += 8; }
    elseif ($ai > 27) throw new RuntimeException('CBOR não suportado');
    switch ($mt) {
        case 0: return $val;
        case 1: return -1 - $val;
        case 2: case 3: $r = substr($d, $o, $val); $o += $val; return $r;
        case 4: $a = []; for ($i = 0; $i < $val; $i++) $a[] = cbor_decode($d, $o); return $a;
        case 5: $m = []; for ($i = 0; $i < $val; $i++) { $k = cbor_decode($d, $o); $m[$k] = cbor_decode($d, $o); } return $m;
        case 7: return $ai === 20 ? false : ($ai === 21 ? true : null);
    }
    throw new RuntimeException('CBOR inválido');
}

/* ---------- WebAuthn (ES256, attestation "none") ---------- */
function cose_ec2_para_pem(array $k): string {
    if (($k[1] ?? null) !== 2 || ($k[3] ?? null) !== -7 || ($k[-1] ?? null) !== 1) throw new RuntimeException('Chave da digital não suportada (esperado ES256).');
    $x = $k[-2] ?? ''; $y = $k[-3] ?? '';
    if (strlen($x) !== 32 || strlen($y) !== 32) throw new RuntimeException('Chave da digital inválida.');
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . "\x04" . $x . $y;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

function webauthn_cliente_ok(string $clientJson, string $tipo, string $challenge): void {
    $c = json_decode($clientJson, true);
    if (!is_array($c) || ($c['type'] ?? '') !== $tipo) throw new RuntimeException('Resposta da digital inválida (tipo).');
    if (!hash_equals($challenge, (string)($c['challenge'] ?? ''))) throw new RuntimeException('Resposta da digital inválida (desafio).');
    if (!in_array($c['origin'] ?? '', APP_ORIGENS, true)) throw new RuntimeException('Resposta da digital inválida (origem).');
}

/* Registro: devolve [credential_id(b64url), pem, signCount] */
function webauthn_registrar(string $clientB64, string $attB64, string $challenge): array {
    $clientJson = b64u_dec($clientB64);
    webauthn_cliente_ok($clientJson, 'webauthn.create', $challenge);
    $att = b64u_dec($attB64); $o = 0;
    $obj = cbor_decode($att, $o);
    $ad = $obj['authData'] ?? null;
    if (!is_string($ad) || strlen($ad) < 55) throw new RuntimeException('Cadastro da digital inválido.');
    if (substr($ad, 0, 32) !== hash('sha256', APP_RP_ID, true)) throw new RuntimeException('Cadastro da digital inválido (domínio).');
    $flags = ord($ad[32]);
    if (!($flags & 0x01) || !($flags & 0x04) || !($flags & 0x40)) throw new RuntimeException('A digital/biometria precisa ser confirmada no cadastro.');
    $cnt = unpack('N', substr($ad, 33, 4))[1];
    $len = unpack('n', substr($ad, 53, 2))[1];
    $cred = substr($ad, 55, $len);
    $off = 55 + $len;
    $key = cbor_decode($ad, $off);
    return [b64u_enc($cred), cose_ec2_para_pem($key), $cnt];
}

/* Verificação: lança exceção se inválido; devolve novo signCount */
function webauthn_verificar(array $a, string $challenge, string $pem, int $signCountAnterior): int {
    $clientJson = b64u_dec((string)($a['clientDataJSON'] ?? ''));
    $ad = b64u_dec((string)($a['authenticatorData'] ?? ''));
    $sig = b64u_dec((string)($a['signature'] ?? ''));
    if ($clientJson === '' || strlen($ad) < 37 || $sig === '') throw new RuntimeException('Confirmação da digital incompleta.');
    webauthn_cliente_ok($clientJson, 'webauthn.get', $challenge);
    if (substr($ad, 0, 32) !== hash('sha256', APP_RP_ID, true)) throw new RuntimeException('Confirmação inválida (domínio).');
    $flags = ord($ad[32]);
    if (!($flags & 0x01) || !($flags & 0x04)) throw new RuntimeException('A digital não foi confirmada.');
    $ok = openssl_verify($ad . hash('sha256', $clientJson, true), $sig, $pem, OPENSSL_ALGO_SHA256);
    if ($ok !== 1) throw new RuntimeException('Assinatura da digital não confere.');
    $cnt = unpack('N', substr($ad, 33, 4))[1];
    if ($cnt !== 0 || $signCountAnterior !== 0) {
        if ($cnt <= $signCountAnterior) throw new RuntimeException('Contador da digital inconsistente (possível clone).');
    }
    return $cnt;
}

function novo_desafio(string $sid, string $tipo, ?array $payload): string {
    $ch = b64u_enc(random_bytes(32));
    db()->prepare('INSERT INTO dbo.GN_AppChallenges (challenge, session_id, tipo, payload_json, expira_em)
                   VALUES (?,?,?,?, DATEADD(SECOND, CAST(? AS INT), SYSUTCDATETIME()))')
        ->execute([$ch, $sid, $tipo, $payload ? json_encode($payload) : null, APP_DESAFIO_TTL]);
    db()->exec("DELETE FROM dbo.GN_AppChallenges WHERE criado_em < DATEADD(HOUR,-1,SYSUTCDATETIME())");
    return $ch;
}

/* Consome o desafio (uso único). Retorna payload decodificado. */
function consumir_desafio(string $ch, string $sid, string $tipo): ?array {
    $st = db()->prepare('UPDATE dbo.GN_AppChallenges SET usado=1
        OUTPUT inserted.payload_json
        WHERE challenge=? AND session_id=? AND tipo=? AND usado=0 AND expira_em > SYSUTCDATETIME()');
    $st->execute([$ch, $sid, $tipo]);
    $row = $st->fetch();
    if (!$row) return null;
    return $row['payload_json'] ? (json_decode($row['payload_json'], true) ?: []) : [];
}
