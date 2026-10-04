<?php
/* ============================================================
 * painel_api.php - API do painel do usuario (/painel/). SOMENTE LEITURA.
 *   POST JSON { session_id (64 hex), moeda?: ALL|BTC|BCH, robo?: ""|MANUAL|<id>, tz?: fuso IANA }
 * Devolve so' dados da sessao informada. O session_id vai no corpo (POST), nunca na URL (nao cai em log).
 * ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/../private/painel_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function painel_out(int $code, array $d): void {
    http_response_code($code);
    echo json_encode($d, JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') painel_out(405, ['ok' => false, 'error' => 'metodo']);

/* defesa extra: so' aceita chamadas do proprio site (navegadores modernos mandam Sec-Fetch-Site) */
$sfs = (string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
if ($sfs !== '' && !in_array($sfs, ['same-origin', 'none'], true)) painel_out(403, ['ok' => false, 'error' => 'origem']);

if (!painel_rate_ok(painel_ip())) painel_out(429, ['ok' => false, 'error' => 'muitas_requisicoes']);

$raw = (string)file_get_contents('php://input', false, null, 0, 4097);
if (strlen($raw) > 4096) painel_out(413, ['ok' => false, 'error' => 'corpo_grande']);
$body = json_decode($raw, true);
if (!is_array($body)) painel_out(400, ['ok' => false, 'error' => 'json_invalido']);

$sid = trim((string)($body['session_id'] ?? ''));
if (!painel_sid_valido($sid)) painel_out(400, ['ok' => false, 'error' => 'sessao_invalida']);
$sid = strtolower($sid);

$moeda = strtoupper((string)($body['moeda'] ?? 'ALL'));
if (!in_array($moeda, ['ALL', 'BTC', 'BCH'], true)) $moeda = 'ALL';

$robo = trim((string)($body['robo'] ?? ''));
if ($robo !== '' && $robo !== 'MANUAL' && !preg_match('/^[A-Za-z0-9_-]{1,20}$/', $robo)) $robo = '';

$tz = (string)($body['tz'] ?? '');
if ($tz === '' || !in_array($tz, DateTimeZone::listIdentifiers(), true)) $tz = 'America/Sao_Paulo';

try {
    $d = painel_dados(painel_db(), $sid, $moeda, $robo, $tz);
    if ($d === null) painel_out(404, ['ok' => false, 'error' => 'sessao_nao_encontrada']);
    painel_out(200, $d);
} catch (Throwable $e) {
    error_log('[painel] ' . get_class($e) . ': ' . $e->getMessage());   // detalhe so' no log do servidor
    painel_out(500, ['ok' => false, 'error' => 'falha_consulta']);
}
