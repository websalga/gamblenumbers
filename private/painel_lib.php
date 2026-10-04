<?php
/* ============================================================
 * painel_lib.php - Painel do usuario (/painel/): consultas SOMENTE LEITURA de UMA sessao.
 *
 *  - Toda consulta e' amarrada ao session_id recebido (parametro ligado, nunca concatenado).
 *  - Nada aqui escreve no banco (so' SELECT) e nada altera robos, saldos ou operacoes.
 *  - NAO devolve: senha_hash, config_json bruto, fingerprint, IP, user-agent, enderecos de
 *    deposito, erro_msg do log, nem qualquer dado de outras sessoes.
 *  - O codigo GN-XXXXXX e' so' para exibicao; nunca e' aceito como identificador.
 * ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/config.php';

const PAINEL_MAX_OPS    = 100;
const PAINEL_MAX_LOG    = 30;
const PAINEL_MAX_SAQUES = 20;
const PAINEL_RL_MAX     = 240;   // requisicoes por minuto por "balde" de IP
const QUEDA_CRASH_PADRAO = 23.0;

function painel_db(): PDO {
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

function painel_f($v): ?float { return $v === null ? null : (float)$v; }
function painel_i($v): ?int   { return $v === null ? null : (int)$v; }

function painel_sid_valido(string $s): bool { return (bool)preg_match('/^[0-9a-f]{64}$/i', $s); }

/* Codigo publico da sessao: mesmo calculo do site (identity.php). Sem segredo -> ''. */
function painel_codigo(string $sid): string {
    static $salt = null;
    if ($salt === null) {
        $salt = '';
        $f = __DIR__ . '/anon_config.php';
        if (is_file($f)) { $c = include $f; if (is_array($c)) $salt = (string)($c['anon_salt'] ?? ''); }
    }
    if ($salt === '') return '';
    return 'GN-' . strtoupper(substr(hash_hmac('sha256', $sid, $salt), 0, 6));
}

function painel_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) return trim(explode(',', (string)$_SERVER[$k])[0]);
    }
    return '0.0.0.0';
}

/* Limite simples por IP (baldes fixos: nunca cria mais que 4096 arquivos). true = pode seguir. */
function painel_rate_ok(string $ip, int $max = PAINEL_RL_MAX): bool {
    $f = sys_get_temp_dir() . '/gnpainel_rl_' . substr(hash('sha256', $ip), 0, 3) . '.json';
    $fh = @fopen($f, 'c+');
    if (!$fh) return true;                       // sem /tmp gravavel: nao derruba o painel
    $agora = time();
    flock($fh, LOCK_EX);
    $d = json_decode((string)stream_get_contents($fh), true);
    if (!is_array($d) || $agora - (int)($d['t'] ?? 0) >= 60) $d = ['t' => $agora, 'n' => 0];
    $d['n'] = (int)$d['n'] + 1;
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($d)); fflush($fh);
    flock($fh, LOCK_UN); fclose($fh);
    return $d['n'] <= $max;
}

function painel_mask(?string $s): ?string {
    if ($s === null || $s === '') return null;
    return strlen($s) > 14 ? substr($s, 0, 6) . '…' . substr($s, -4) : $s;
}

function painel_cfg(?string $json): array {
    if ($json === null) return [];
    $j = json_decode($json, true);
    return is_array($j) ? $j : [];
}

function painel_q(PDO $pdo, string $sql, array $params): array {
    $st = $pdo->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

/* $sel: ALL|BTC|BCH   $roboSel: ''|MANUAL|<id do robo>   $tz: fuso IANA do navegador (so' p/ "hoje").
 * Devolve null se a sessao nao existe. */
function painel_dados(PDO $pdo, string $sid, string $sel, string $roboSel, string $tz): ?array {
    $u = painel_q($pdo, "SELECT modo_real, btc_saldo_visto, bch_saldo_visto,
            CASE WHEN criado_em > DATEADD(HOUR,-24,GETUTCDATE()) THEN 1 ELSE 0 END AS nova,
            DATEDIFF_BIG(SECOND,'19700101',criado_em) AS criado_e
        FROM dbo.GN_Usuarios WHERE session_id = ?", [$sid]);
    if (!$u) return null;
    $u = $u[0];
    $real = (bool)$u['modo_real'];

    /* limites de tempo (ms) para "hoje" e "7 dias" */
    try { $zone = new DateTimeZone($tz); } catch (Throwable $e) { $zone = new DateTimeZone('America/Sao_Paulo'); }
    $hojeMs = (new DateTime('today', $zone))->getTimestamp() * 1000;
    $d7Ms   = (time() - 7 * 86400) * 1000;

    $cm  = $sel === 'ALL' ? '' : ' AND moeda = ?';
    $pm  = $sel === 'ALL' ? [] : [$sel];

    /* saldo virtual */
    $sv = painel_q($pdo, 'SELECT saldo_brl, DATEDIFF_BIG(SECOND,\'19700101\',atualizado_em) AS e FROM dbo.GN_SimSaldo WHERE session_id = ?', [$sid]);

    /* KPIs de vendas executadas */
    $kv = painel_q($pdo, "SELECT COUNT(*) AS n, SUM(pnl) AS pnl,
            SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS ganhos,
            SUM(CASE WHEN exec_time_ms >= ? THEN pnl ELSE 0 END) AS pnl_hoje,
            SUM(CASE WHEN exec_time_ms >= ? THEN pnl ELSE 0 END) AS pnl_7d
        FROM dbo.GN_SimVendas WHERE session_id = ? AND excluido = 0 AND status = 'executed'{$cm}",
        array_merge([$hojeMs, $d7Ms, $sid], $pm))[0];

    /* lotes abertos (custo do que ainda esta em carteira) */
    $kl = painel_q($pdo, "SELECT COUNT(*) AS n,
            SUM(CASE WHEN qtd > 0 THEN CAST(valor AS float) * CAST(restante AS float) / CAST(qtd AS float) ELSE 0 END) AS custo
        FROM dbo.GN_SimLotes WHERE session_id = ? AND excluido = 0 AND status = 'open'{$cm}",
        array_merge([$sid], $pm))[0];

    /* robos + estatisticas por robo + ultima decisao de cada um */
    $rows = painel_q($pdo, 'SELECT id, robo_client_id, seq, apelido, moeda, valor_operacao, retorno_desejado_pct,
            limite_perda_diaria_pct, ativo, config_json, ciclo_segundos,
            DATEDIFF_BIG(SECOND,\'19700101\',proxima_execucao) AS prox
        FROM dbo.GN_Robos WHERE session_id = ? ORDER BY seq ASC', [$sid]);

    $sv_robo = [];
    foreach (painel_q($pdo, "SELECT robo_client_id, COUNT(*) AS n, SUM(pnl) AS pnl, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS ganhos
        FROM dbo.GN_SimVendas WHERE session_id = ? AND excluido = 0 AND status = 'executed' AND robo_client_id IS NOT NULL
        GROUP BY robo_client_id", [$sid]) as $r) $sv_robo[$r['robo_client_id']] = $r;

    $lt_robo = [];
    foreach (painel_q($pdo, "SELECT robo_client_id, COUNT(*) AS n,
            SUM(CASE WHEN qtd > 0 THEN CAST(valor AS float) * CAST(restante AS float) / CAST(qtd AS float) ELSE 0 END) AS custo
        FROM dbo.GN_SimLotes WHERE session_id = ? AND excluido = 0 AND status = 'open' AND robo_client_id IS NOT NULL
        GROUP BY robo_client_id", [$sid]) as $r) $lt_robo[$r['robo_client_id']] = $r;

    $ult = [];
    foreach (painel_q($pdo, "SELECT r.robo_client_id, x.acao, x.status, x.detalhe, x.preco_avaliado,
            DATEDIFF_BIG(SECOND,'19700101',x.iniciado_em) AS e
        FROM dbo.GN_Robos r
        OUTER APPLY (SELECT TOP 1 l.acao, l.status, l.detalhe, l.preco_avaliado, l.iniciado_em
                     FROM dbo.GN_RoboExecucaoLog l WHERE l.robo_id = r.id ORDER BY l.iniciado_em DESC) x
        WHERE r.session_id = ?", [$sid]) as $r) $ult[$r['robo_client_id']] = $r;

    $robos = [];
    $ativos = 0; $totalRobos = 0;
    foreach ($rows as $r) {
        if ($sel !== 'ALL' && trim((string)$r['moeda']) !== $sel) continue;
        $cid = (string)$r['robo_client_id'];
        $cfg = painel_cfg($r['config_json']);
        $v = $sv_robo[$cid] ?? null; $l = $lt_robo[$cid] ?? null; $x = $ult[$cid] ?? null;
        $totalRobos++; if ($r['ativo']) $ativos++;
        $robos[] = [
            'id'             => $cid,
            'seq'            => (int)$r['seq'],
            'apelido'        => (string)$r['apelido'],
            'moeda'          => trim((string)$r['moeda']),
            'valor_operacao' => painel_f($r['valor_operacao']),
            'retorno_pct'    => painel_f($r['retorno_desejado_pct']),
            'limite_perda_pct' => painel_f($r['limite_perda_diaria_pct']),
            'ativo'          => (bool)$r['ativo'],
            'taxas_reais'    => array_key_exists('taxas_reais', $cfg) ? (bool)$cfg['taxas_reais'] : true,
            'queda_crash_pct'=> array_key_exists('queda_crash_pct', $cfg) ? (float)$cfg['queda_crash_pct'] : QUEDA_CRASH_PADRAO,
            'ciclo_s'        => painel_i($r['ciclo_segundos']),
            'proxima'        => painel_i($r['prox']),
            'vendas'         => ['n' => (int)($v['n'] ?? 0), 'ganhos' => (int)($v['ganhos'] ?? 0), 'pnl' => (float)($v['pnl'] ?? 0)],
            'lotes'          => ['n' => (int)($l['n'] ?? 0), 'custo' => (float)($l['custo'] ?? 0)],
            'decisao'        => $x && $x['acao'] !== null ? [
                'acao'   => (string)$x['acao'],
                'status' => (string)$x['status'],
                'texto'  => mb_substr((string)$x['detalhe'], 0, 400),
                'preco'  => painel_f($x['preco_avaliado']),
                'e'      => painel_i($x['e']),
            ] : null,
        ];
    }

    /* operacoes (compras e vendas executadas, manuais e de robo) */
    $cr = '';
    $pr = [];
    if ($roboSel === 'MANUAL') { $cr = ' AND robo_client_id IS NULL'; }
    elseif ($roboSel !== '')   { $cr = ' AND robo_client_id = ?'; $pr = [$roboSel]; }
    $n = PAINEL_MAX_OPS;
    $ops = [];
    foreach (painel_q($pdo, "SELECT TOP ({$n}) * FROM (
            SELECT 'compra' AS tipo, lote_client_id AS id, moeda, robo_client_id AS robo, moeda_exib AS exib,
                   CAST(preco AS float) AS p, CAST(qtd AS float) AS qtd, CAST(valor AS float) AS brl,
                   CAST(NULL AS float) AS pnl, CAST(NULL AS float) AS ret, status,
                   CAST(restante AS float) AS restante, time_cliente_ms / 1000 AS e
            FROM dbo.GN_SimLotes WHERE excluido = 0 AND session_id = ?{$cm}{$cr}
            UNION ALL
            SELECT 'venda', venda_client_id, moeda, robo_client_id, moeda_exib,
                   CAST(exec_price AS float), CAST(qtd AS float), CAST(valor_liquido AS float),
                   CAST(pnl AS float), CAST(retorno_pct AS float), status, CAST(NULL AS float), exec_time_ms / 1000
            FROM dbo.GN_SimVendas WHERE excluido = 0 AND status = 'executed' AND session_id = ?{$cm}{$cr}
        ) x ORDER BY e DESC", array_merge([$sid], $pm, $pr, [$sid], $pm, $pr)) as $r) {
        $ops[] = [
            'tipo' => $r['tipo'], 'id' => (string)$r['id'], 'moeda' => trim((string)$r['moeda']),
            'origem' => $r['robo'] === null ? 'manual' : 'robo', 'robo' => $r['robo'],
            'exib' => (string)$r['exib'], 'preco' => painel_f($r['p']), 'qtd' => painel_f($r['qtd']),
            'valor' => painel_f($r['brl']), 'pnl' => painel_f($r['pnl']), 'ret_pct' => painel_f($r['ret']),
            'status' => (string)$r['status'], 'restante' => painel_f($r['restante']), 'e' => (int)$r['e'],
        ];
    }

    /* atividade recente dos robos (so' acoes: compra/venda) */
    $m = PAINEL_MAX_LOG;
    $log = [];
    foreach (painel_q($pdo, "SELECT TOP ({$m}) r.robo_client_id AS robo, l.acao, l.status, l.detalhe, l.preco_avaliado,
            DATEDIFF_BIG(SECOND,'19700101',l.iniciado_em) AS e
        FROM dbo.GN_RoboExecucaoLog l JOIN dbo.GN_Robos r ON r.id = l.robo_id
        WHERE r.session_id = ? AND l.acao <> 'nenhuma' ORDER BY l.iniciado_em DESC", [$sid]) as $r) {
        $log[] = ['robo' => $r['robo'], 'acao' => (string)$r['acao'], 'status' => (string)$r['status'],
                  'texto' => mb_substr((string)$r['detalhe'], 0, 400), 'preco' => painel_f($r['preco_avaliado']), 'e' => (int)$r['e']];
    }

    /* saques (enderecos mascarados) */
    $k = PAINEL_MAX_SAQUES;
    $saques = [];
    foreach (painel_q($pdo, "SELECT TOP ({$k}) txid, moeda, valor, destino, foi_total, confirmado, confirmacoes,
            DATEDIFF_BIG(SECOND,'19700101',criado_em) AS e
        FROM dbo.GN_Saques WHERE session_id = ? ORDER BY criado_em DESC", [$sid]) as $r) {
        $saques[] = ['txid' => painel_mask((string)$r['txid']), 'moeda' => trim((string)$r['moeda']), 'valor' => painel_f($r['valor']),
                     'destino' => painel_mask((string)$r['destino']), 'total' => (bool)$r['foi_total'],
                     'confirmado' => (bool)$r['confirmado'], 'confs' => painel_i($r['confirmacoes']), 'e' => (int)$r['e']];
    }

    $nv = (int)($kv['n'] ?? 0);
    return [
        'ok' => true,
        'gerado_em' => time(),
        'sessao' => ['codigo' => painel_codigo($sid), 'nova' => (bool)$u['nova'], 'modo_real' => $real, 'criado_em' => (int)$u['criado_e']],
        'filtro' => ['moeda' => $sel, 'robo' => $roboSel],
        'kpis' => [
            'saldo_virtual'  => $sv ? painel_f($sv[0]['saldo_brl']) : null,
            'pnl_hoje'       => (float)($kv['pnl_hoje'] ?? 0),
            'pnl_7d'         => (float)($kv['pnl_7d'] ?? 0),
            'pnl_total'      => (float)($kv['pnl'] ?? 0),
            'vendas'         => $nv,
            'ganhos'         => (int)($kv['ganhos'] ?? 0),
            'taxa_acerto'    => $nv > 0 ? round(100 * (int)$kv['ganhos'] / $nv, 1) : null,
            'lotes_abertos'  => (int)($kl['n'] ?? 0),
            'custo_aberto'   => (float)($kl['custo'] ?? 0),
            'robos_total'    => $totalRobos,
            'robos_ativos'   => $ativos,
            'btc_real'       => $real ? painel_f($u['btc_saldo_visto']) : null,
            'bch_real'       => $real ? painel_f($u['bch_saldo_visto']) : null,
        ],
        'robos' => $robos,
        'operacoes' => $ops,
        'atividade' => $log,
        'saques' => $saques,
    ];
}
