<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require '/usr/share/nginx/html/gamblenumbers/private/wallet_config.php';
require '/usr/share/nginx/html/gamblenumbers/private/sideshift_config.php';
require '/usr/share/nginx/html/gamblenumbers/private/config.php';

const SIDESHIFT_BASE = 'https://sideshift.ai/api/v2';
const SERVER_PUBLIC_IP_CACHE = '/usr/share/nginx/html/gamblenumbers/private/cache/server_ip.txt';

function db(): PDO {
    global $DB_SERVER, $DB_DATABASE, $DB_USER, $DB_PASSWORD, $DB_PORT;
    static $pdo = null;
    if ($pdo) return $pdo;
    $dsn = "sqlsrv:Server={$DB_SERVER},{$DB_PORT};Database={$DB_DATABASE};Encrypt=no";
    $pdo = new PDO($dsn, $DB_USER, $DB_PASSWORD, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function getServerPublicIp(): string {
    if (file_exists(SERVER_PUBLIC_IP_CACHE) && (time() - filemtime(SERVER_PUBLIC_IP_CACHE)) < 3600) {
        return trim((string)file_get_contents(SERVER_PUBLIC_IP_CACHE));
    }
    $ch = curl_init('https://api.ipify.org');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
    $ip = trim((string)curl_exec($ch));
    curl_close($ch);
    if ($ip !== '') {
        @file_put_contents(SERVER_PUBLIC_IP_CACHE, $ip);
    }
    return $ip;
}

function sideshiftRequest(string $method, string $path, array $body = null): array {
    global $SIDESHIFT_SECRET;
    $ch = curl_init(SIDESHIFT_BASE . $path);
    $headers = [
        'Content-Type: application/json',
        'x-sideshift-secret: ' . $SIDESHIFT_SECRET,
        'x-user-ip: ' . getServerPublicIp(),
    ];
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CUSTOMREQUEST => $method,
    ];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($body);
    }
    curl_setopt_array($ch, $opts);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        throw new RuntimeException("Falha na requisição SideShift: {$err}");
    }
    $data = json_decode($resp, true);
    if (isset($data['error'])) {
        throw new RuntimeException('SideShift: ' . ($data['error']['message'] ?? 'erro desconhecido'));
    }
    return $data;
}

function rpcCall(string $coin, string $method, array $params = []) {
    global $RPC_BTC_HOST, $RPC_BTC_PORT, $RPC_BTC_USER, $RPC_BTC_PASS;
    global $RPC_BCH_HOST, $RPC_BCH_PORT, $RPC_BCH_USER, $RPC_BCH_PASS;

    if ($coin === 'BTC') {
        [$host, $port, $user, $pass] = [$RPC_BTC_HOST, $RPC_BTC_PORT, $RPC_BTC_USER, $RPC_BTC_PASS];
        $url = "http://{$host}:{$port}/wallet/gamblenumbers";
    } else {
        [$host, $port, $user, $pass] = [$RPC_BCH_HOST, $RPC_BCH_PORT, $RPC_BCH_USER, $RPC_BCH_PASS];
        $url = "http://{$host}:{$port}/";
    }
    // Bitcoin Core/BCHN rejeitam valores em notacao cientifica no campo amount.
    // Formata qualquer float pequeno como string decimal simples antes de serializar.
    array_walk_recursive($params, function(&$v){
        if (is_float($v)) $v = sprintf('%.8f', $v);
    });
    $payload = json_encode(['jsonrpc' => '1.0', 'id' => 'sideshift', 'method' => $method, 'params' => $params]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Content-Type: text/plain'],
        CURLOPT_USERPWD => "{$user}:{$pass}",
        CURLOPT_TIMEOUT => 20,
    ]);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        throw new RuntimeException("Falha RPC {$coin} ({$method}): {$err}");
    }
    $data = json_decode($resp, true);
    if (isset($data['error']) && $data['error'] !== null) {
        throw new RuntimeException("Erro RPC {$coin} ({$method}): " . json_encode($data['error']));
    }
    return $data['result'];
}

function coinNetwork(string $coin): string {
    return $coin === 'BTC' ? 'bitcoin' : 'bitcoincash';
}

/* Transfere de um endereco ESPECIFICO da wallet compartilhada (nao a wallet
 * inteira) para outro endereco, usando so os UTXOs daquele endereco como
 * entrada, com o troco voltando garantidamente pro mesmo endereco de
 * origem -- mesmo padrao ja usado em identity.php (transferir_de_endereco),
 * pra nunca misturar fundos de usuarios diferentes nem perder troco em
 * enderecos novos que o portal nao rastreia. */
function transferirDeEnderecoOrigem(string $coin, string $enderecoOrigem, string $enderecoDestino, float $valor): array {
    $utxos = rpcCall($coin, 'listunspent', [1, 9999999, [$enderecoOrigem]]);
    if (empty($utxos)) {
        throw new RuntimeException('Sem saldo confirmado no endereço de origem');
    }

    $totalDisponivel = 0.0;
    $inputs = [];
    foreach ($utxos as $u) {
        $totalDisponivel += (float)$u['amount'];
        $inputs[] = ['txid' => $u['txid'], 'vout' => $u['vout']];
    }

    if ($valor <= 0) {
        throw new RuntimeException('Valor de transferência inválido');
    }
    if ($valor > $totalDisponivel) {
        throw new RuntimeException("Saldo insuficiente no endereço de origem: disponível {$totalDisponivel}, necessário {$valor}");
    }
    $ehTotal = abs($valor - $totalDisponivel) < 0.00000001;

    $rawtx = rpcCall($coin, 'createrawtransaction', [$inputs, [$enderecoDestino => $valor]]);

    $fundOpts = ['add_inputs' => false];
    if ($ehTotal) {
        $fundOpts['subtractFeeFromOutputs'] = [0];
    } else {
        // Troco volta pro MESMO endereço de origem (mantém a segregação por usuário).
        $fundOpts['changeAddress'] = $enderecoOrigem;
    }
    $funded = rpcCall($coin, 'fundrawtransaction', [$rawtx, $fundOpts]);

    $signed = rpcCall($coin, 'signrawtransactionwithwallet', [$funded['hex']]);
    if (empty($signed['complete'])) {
        throw new RuntimeException('Falha ao assinar a transação de saída');
    }

    $txid = rpcCall($coin, 'sendrawtransaction', [$signed['hex']]);
    return ['txid' => $txid, 'valor' => $ehTotal ? $totalDisponivel : $valor, 'total' => $ehTotal];
}

/* Busca os enderecos registrados (fixos) de BTC e BCH de uma sessao -- os
 * mesmos enderecos "principais" ja mostrados nos extratos -- garantindo que
 * troco e liquidacao do swap sempre voltem/cheguem em enderecos que o
 * usuario ja ve e rastreia no portal, nunca em enderecos novos e orfaos. */
function enderecosDaSessao(string $sessionId): array {
    $st = db()->prepare('SELECT btc_address, bch_address FROM dbo.GN_Usuarios WHERE session_id = ?');
    $st->execute([$sessionId]);
    $row = $st->fetch();
    if (!$row || empty($row['btc_address']) || empty($row['bch_address'])) {
        throw new RuntimeException('Sessão sem endereços registrados');
    }
    return ['BTC' => $row['btc_address'], 'BCH' => $row['bch_address']];
}

function saveJob(string $jobId, array $data): void {
    db()->prepare('INSERT INTO dbo.GN_SideshiftJobs
        (job_id, from_coin, to_coin, deposit_amount, settle_amount, settle_address, deposit_txid)
        VALUES (?,?,?,?,?,?,?)')
        ->execute([
            $jobId, $data['fromCoin'], $data['toCoin'],
            sprintf('%.8f', (float)$data['depositAmount']), sprintf('%.8f', (float)$data['settleAmount']),
            $data['settleAddress'], $data['depositTxid'],
        ]);
}

function loadJob(string $jobId): ?array {
    $st = db()->prepare('SELECT job_id, from_coin, to_coin, deposit_amount, settle_amount,
        settle_address, deposit_txid, criado_em FROM dbo.GN_SideshiftJobs WHERE job_id=?');
    $st->execute([$jobId]);
    $row = $st->fetch();
    if (!$row) return null;
    return [
        'jobId' => $row['job_id'], 'fromCoin' => $row['from_coin'], 'toCoin' => $row['to_coin'],
        'depositAmount' => $row['deposit_amount'], 'settleAmount' => $row['settle_amount'],
        'settleAddress' => $row['settle_address'], 'depositTxid' => $row['deposit_txid'],
        'createdAt' => $row['criado_em'],
    ];
}

// ---- Ações ----

function actionQuote(array $in): array {
    $fromCoin = strtoupper($in['fromCoin'] ?? '');
    $toCoin = strtoupper($in['toCoin'] ?? '');
    $amount = $in['amount'] ?? '';
    if (!in_array($fromCoin, ['BTC', 'BCH'], true) || !in_array($toCoin, ['BTC', 'BCH'], true) || $fromCoin === $toCoin) {
        throw new InvalidArgumentException('Par de moedas inválido');
    }
    $quote = sideshiftRequest('POST', '/quotes', [
        'affiliateId' => $GLOBALS['SIDESHIFT_ACCOUNT_ID'],
        'depositCoin' => $fromCoin,
        'depositNetwork' => coinNetwork($fromCoin),
        'settleCoin' => $toCoin,
        'settleNetwork' => coinNetwork($toCoin),
        'depositAmount' => (string)$amount,
    ]);
    return $quote;
}

function actionExecute(array $in): array {
    $fromCoin = strtoupper($in['fromCoin'] ?? '');
    $toCoin = strtoupper($in['toCoin'] ?? '');
    $quoteId = $in['quoteId'] ?? '';
    $amount = $in['amount'] ?? '';
    $sessionId = $in['sessionId'] ?? '';
    if (!in_array($fromCoin, ['BTC', 'BCH'], true) || !in_array($toCoin, ['BTC', 'BCH'], true) || $fromCoin === $toCoin || $quoteId === '') {
        throw new InvalidArgumentException('Parâmetros inválidos');
    }
    if (!preg_match('/^[a-f0-9]{64}$/', $sessionId)) {
        throw new InvalidArgumentException('Sessão inválida');
    }

    // Enderecos fixos/"principais" do usuario -- os mesmos ja mostrados nos
    // extratos -- nunca enderecos novos e nao rastreados.
    $enderecos = enderecosDaSessao($sessionId);
    $enderecoOrigem  = $enderecos[$fromCoin];
    $enderecoDestino = $enderecos[$toCoin];

    // Verifica saldo real do ENDEREÇO DE ORIGEM da sessão (não da wallet
    // inteira, que é compartilhada entre todos os usuários) antes de
    // qualquer coisa.
    $utxosOrigem = rpcCall($fromCoin, 'listunspent', [1, 9999999, [$enderecoOrigem]]);
    $saldoOrigem = 0.0;
    foreach ($utxosOrigem as $u) { $saldoOrigem += (float)$u['amount']; }
    if ($saldoOrigem < (float)$amount) {
        throw new RuntimeException("Saldo insuficiente em {$fromCoin}: disponível {$saldoOrigem}, necessário {$amount}");
    }

    // Endereço de liquidação: o endereço fixo do usuário para a moeda de
    // destino, o mesmo já mostrado nos extratos -- não um endereço novo.
    $settleAddress = $enderecoDestino;
    // Endereço de reembolso: o endereço fixo do próprio usuário no lado de
    // origem, caso o shift falhe.
    $refundAddress = $enderecoOrigem;

    $shift = sideshiftRequest('POST', '/shifts/fixed', [
        'affiliateId' => $GLOBALS['SIDESHIFT_ACCOUNT_ID'],
        'quoteId' => $quoteId,
        'settleAddress' => $settleAddress,
        'refundAddress' => $refundAddress,
    ]);

    // Envia o valor exato a partir do ENDEREÇO REGISTRADO do usuário (não da
    // wallet inteira) pro endereço de depósito do shift -- o troco volta
    // garantidamente pro mesmo endereço de origem.
    $envio = transferirDeEnderecoOrigem($fromCoin, $enderecoOrigem, $shift['depositAddress'], (float)$shift['depositAmount']);
    $depositTxid = $envio['txid'];

    $job = [
        'jobId' => $shift['id'],
        'fromCoin' => $fromCoin,
        'toCoin' => $toCoin,
        'depositAmount' => $shift['depositAmount'],
        'settleAmount' => $shift['settleAmount'],
        'settleAddress' => $settleAddress,
        'depositAddress' => $shift['depositAddress'],
        'depositTxid' => $depositTxid,
        'createdAt' => date('c'),
    ];
    saveJob($shift['id'], $job);
    return $job;
}

function actionStatus(array $in): array {
    $jobId = $in['jobId'] ?? '';
    if ($jobId === '') {
        throw new InvalidArgumentException('jobId é obrigatório');
    }
    $job = loadJob($jobId);
    if ($job === null) {
        throw new RuntimeException('Job não encontrado');
    }
    $shift = sideshiftRequest('GET', '/shifts/' . urlencode($jobId));

    $confirmations = null;
    try {
        $tx = rpcCall($job['fromCoin'], 'gettransaction', [$job['depositTxid']]);
        $confirmations = $tx['confirmations'] ?? null;
    } catch (Throwable $e) {
        // não crítico pro status geral
    }

    $settleTxid = null;
    $settleConfirmations = null;
    if (($shift['status'] ?? '') === 'settled') {
        try {
            $txs = rpcCall($job['toCoin'], 'listtransactions', ['*', 20, 0, true]);
            foreach ($txs as $tx) {
                if (($tx['address'] ?? '') === $job['settleAddress'] && ($tx['category'] ?? '') === 'receive') {
                    $settleTxid = $tx['txid'];
                    $settleConfirmations = $tx['confirmations'] ?? null;
                    break;
                }
            }
        } catch (Throwable $e) {
            // não crítico; o status do SideShift já confirma a liquidação
        }
    }

    return [
        'jobId' => $jobId,
        'status' => $shift['status'],
        'fromCoin' => $job['fromCoin'],
        'toCoin' => $job['toCoin'],
        'depositAmount' => $job['depositAmount'],
        'settleAmount' => $shift['settleAmount'] ?? $job['settleAmount'],
        'depositTxid' => $job['depositTxid'],
        'depositConfirmations' => $confirmations,
        'settleAddress' => $job['settleAddress'],
        'settleTxid' => $settleTxid,
        'settleConfirmations' => $settleConfirmations,
        'depositAddress' => $job['depositAddress'] ?? null,
    ];
}

// ---- Router ----

try {
    $input = json_decode((string)file_get_contents('php://input'), true) ?? [];
    $action = $input['action'] ?? ($_GET['action'] ?? '');
    switch ($action) {
        case 'quote':
            echo json_encode(actionQuote($input));
            break;
        case 'execute':
            echo json_encode(actionExecute($input));
            break;
        case 'status':
            echo json_encode(actionStatus($input + $_GET));
            break;
        default:
            throw new InvalidArgumentException('Ação desconhecida');
    }
} catch (Throwable $e) {
    http_response_code(400);
    echo json_encode(['erro' => $e->getMessage()]);
}
