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

/* --- Consultar saldo via Electrs (BTC) --- */
function btc_balance(string $address): array {
    // Validação básica de endereço BTC
    if (!preg_match('/^(bc1[a-z0-9]{6,87}|[13][a-zA-Z1-9]{25,34})$/', $address)) {
        return ['valid'=>false, 'balance'=>'0'];
    }
    $req = ['id'=>1,'method'=>'blockchain.address.get_balance','params'=>[$address]];
    $resp = electrum_query('192.168.18.111', 50001, $req);
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

        default => (function() {
            http_response_code(400);
            echo json_encode(['error'=>'ação desconhecida']);
        })()
    };
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
