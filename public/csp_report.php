<?php
/*
 * Recebe os relatorios da CSP (Content-Security-Policy-Report-Only) do site principal e grava
 * um resumo em private/logs/csp.log, para ver o que a CSP bloquearia antes de liga-la de verdade.
 * Anonimato: nao grava IP, user agent nem query string; so' a pagina, a diretiva e o recurso.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }

$corpo = file_get_contents('php://input', false, null, 0, 16384);
$j = json_decode((string)$corpo, true);
if (!is_array($j)) { http_response_code(204); exit; }

// formato antigo (report-uri): {"csp-report": {...}}; Reporting API: [{"type":"csp-violation","body":{...}}]
$rels = [];
if (isset($j['csp-report']) && is_array($j['csp-report'])) $rels[] = $j['csp-report'];
elseif (array_is_list($j)) foreach ($j as $x) if (is_array($x) && isset($x['body']) && is_array($x['body'])) $rels[] = $x['body'];

$log = __DIR__ . '/../private/logs/csp.log';
if (@filesize($log) > 2 * 1024 * 1024) { http_response_code(204); exit; }   // teto de 2 MB

$sem_query = fn($u) => is_string($u) ? substr(preg_replace('/[?#].*$/', '', $u), 0, 200) : '';
foreach (array_slice($rels, 0, 10) as $r) {
    $linha = [
        'em'        => gmdate('c'),
        'pagina'    => $sem_query($r['document-uri'] ?? $r['documentURL'] ?? ''),
        'diretiva'  => substr((string)($r['effective-directive'] ?? $r['effectiveDirective'] ?? $r['violated-directive'] ?? ''), 0, 60),
        'bloqueado' => $sem_query($r['blocked-uri'] ?? $r['blockedURL'] ?? ''),
        'arquivo'   => $sem_query($r['source-file'] ?? $r['sourceFile'] ?? ''),
        'linha'     => (int)($r['line-number'] ?? $r['lineNumber'] ?? 0),
        'amostra'   => substr((string)($r['script-sample'] ?? $r['sample'] ?? ''), 0, 80),
    ];
    @file_put_contents($log, json_encode($linha, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}
http_response_code(204);
