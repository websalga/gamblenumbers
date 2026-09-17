<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require '/usr/share/nginx/html/gamblenumbers/private/wallet_config.php';

// Tamanhos estimados (bytes) das transações envolvidas num atomic swap HTLC.
// Baseado no formato do contrato do decred/atomicswap (script P2SH).
const TAMANHO_INPUT_REDEEM_HTLC = 300;   // gastar a saída do contrato (scriptSig maior que P2PKH)
const TAMANHO_TX_CONTRATO       = 250;   // publicar o contrato (initiate/participate)
const TAMANHO_TX_REDEEM         = 300;   // resgatar o contrato

const CACHE_TTL_SEGUNDOS = 300; // 5 minutos
const CACHE_DIR = '/usr/share/nginx/html/gamblenumbers/private/cache';

function rpcCall(string $host, int $port, string $user, string $pass, string $method, array $params = []) {
    $payload = json_encode(['jsonrpc' => '1.0', 'id' => 'swapmin', 'method' => $method, 'params' => $params]);
    $ch = curl_init("http://{$host}:{$port}/");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Content-Type: text/plain'],
        CURLOPT_USERPWD => "{$user}:{$pass}",
        CURLOPT_TIMEOUT => 5,
    ]);
    $resp = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        throw new RuntimeException("Falha RPC ({$method}): {$err}");
    }
    $data = json_decode($resp, true);
    if (isset($data['error']) && $data['error'] !== null) {
        throw new RuntimeException("Erro RPC ({$method}): " . json_encode($data['error']));
    }
    return $data['result'];
}

function calcularValorMinimo(string $moeda): array {
    global $RPC_BTC_HOST, $RPC_BTC_PORT, $RPC_BTC_USER, $RPC_BTC_PASS;
    global $RPC_BCH_HOST, $RPC_BCH_PORT, $RPC_BCH_USER, $RPC_BCH_PASS;

    $moeda = strtoupper($moeda);
    if (!in_array($moeda, ['BTC', 'BCH'], true)) {
        throw new InvalidArgumentException('Moeda inválida');
    }

    if ($moeda === 'BTC') {
        [$host, $port, $user, $pass] = [$RPC_BTC_HOST, $RPC_BTC_PORT, $RPC_BTC_USER, $RPC_BTC_PASS];
    } else {
        [$host, $port, $user, $pass] = [$RPC_BCH_HOST, $RPC_BCH_PORT, $RPC_BCH_USER, $RPC_BCH_PASS];
    }

    $networkInfo = rpcCall($host, $port, $user, $pass, 'getnetworkinfo');
    $relayFeePerKb = (float)$networkInfo['relayfee']; // moeda/kB
    $relayFeePerByte = $relayFeePerKb / 1000;

    // BCHN não suporta estimatesmartfee; usa estimatefee. BTC Core usa estimatesmartfee.
    try {
        if ($moeda === 'BTC') {
            $est = rpcCall($host, $port, $user, $pass, 'estimatesmartfee', [6]);
            $feePerKb = (float)($est['feerate'] ?? $relayFeePerKb);
        } else {
            $feePerKb = (float)rpcCall($host, $port, $user, $pass, 'estimatefee');
        }
    } catch (Throwable $e) {
        $feePerKb = $relayFeePerKb; // fallback conservador
    }
    $feePerByte = $feePerKb / 1000;

    // Dust threshold do script HTLC (P2SH): 3x a relay fee vezes o tamanho do input de resgate.
    $dust = 3 * $relayFeePerByte * TAMANHO_INPUT_REDEEM_HTLC;

    // Margem para cobrir taxa do contrato + taxa do redeem, a preço de mercado atual.
    $margemTaxas = $feePerByte * (TAMANHO_TX_CONTRATO + TAMANHO_TX_REDEEM);

    $minimo = $dust + $margemTaxas;

    return [
        'moeda' => $moeda,
        'relayfee_per_kb' => $relayFeePerKb,
        'fee_estimada_per_kb' => $feePerKb,
        'dust_threshold' => round($dust, 8),
        'margem_taxas' => round($margemTaxas, 8),
        'minimo' => round($minimo, 8),
        'calculado_em' => date('c'),
    ];
}

function obterComCache(string $moeda): array {
    if (!is_dir(CACHE_DIR)) {
        @mkdir(CACHE_DIR, 0750, true);
    }
    $arquivoCache = CACHE_DIR . '/min_' . strtolower($moeda) . '.json';

    if (file_exists($arquivoCache) && (time() - filemtime($arquivoCache)) < CACHE_TTL_SEGUNDOS) {
        $cached = json_decode((string)file_get_contents($arquivoCache), true);
        if ($cached !== null) {
            $cached['origem'] = 'cache';
            return $cached;
        }
    }

    $resultado = calcularValorMinimo($moeda);
    $resultado['origem'] = 'rpc';
    @file_put_contents($arquivoCache, json_encode($resultado));
    return $resultado;
}

try {
    $moeda = $_GET['moeda'] ?? '';
    if ($moeda === '') {
        throw new InvalidArgumentException('Parâmetro "moeda" é obrigatório (BTC ou BCH)');
    }
    echo json_encode(obterComCache($moeda));
} catch (Throwable $e) {
    http_response_code(400);
    echo json_encode(['erro' => $e->getMessage()]);
}
