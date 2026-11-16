<?php
/* ============================================================
 * private/pagar_api.php - acoes da opcao "Pagar" do app. Incluido por public/app/api.php
 * (dentro do try principal, depois das funcoes auxiliares do api.php).
 *   pagar_ler        le o QR/link/endereco: moeda, destino, valor (sem cotacao)
 *   pagar_opcoes     opcoes de origem com custo, tempo e folga (cota a THORChain quando precisa)
 *   pagar_desafio    recota a origem escolhida, confere limites e pede a digital
 *   pagar_confirmar  confere a digital, monta, confere e transmite
 *   pagar_status     acompanha (confirmacoes / etapas da THORChain)
 *   pagamentos_lista ultimos pagamentos
 * ============================================================ */
declare(strict_types=1);

function pagar_usuario(string $sid): array {
    if (strlen($sid) !== 64 || !ctype_xdigit($sid)) out(['ok' => false, 'error' => 'sessão inválida'], 400);
    $st = db()->prepare('SELECT session_id, btc_address, bch_address, eth_address FROM dbo.GN_Usuarios WHERE session_id=? AND ativo=1');
    $st->execute([$sid]); $u = $st->fetch();
    if (!$u) out(['ok' => false, 'error' => 'sessão não encontrada'], 404);
    return $u;
}
/* Destino + valor exato pedido. body: destino (texto), ativo (so p/ 0x puro), valor + tipo (brl|cripto) quando o QR nao traz valor */
function pagar_alvo(array $u, array $b, array $px): array {
    $l = pagar_ler((string)($b['destino'] ?? ''));
    if ($l['ativo'] === null) {
        $esc = strtoupper((string)($b['ativo'] ?? ''));
        if (!in_array($esc, $l['escolher'], true)) return $l + ['precisa_ativo' => true];
        $l['ativo'] = $esc;
    }
    $a = $l['ativo'];
    $chk = pagar_destino_checar($u, $a, $l['endereco']);
    $l['novo_destino'] = $chk['novo'];
    if ($l['valor'] === null) {
        $txt = pagar_txt_num((string)($b['valor'] ?? ''));
        if ($txt === '' || !is_numeric($txt) || (float)$txt <= 0) return $l + ['precisa_valor' => true];
        if (($b['tipo'] ?? 'brl') === 'brl') {
            if (($px[$a] ?? 0) <= 0) throw new RuntimeException('Sem cotação de ' . $a . ' agora. Informe o valor em ' . $a . '.');
            $l['valor'] = (int)ceil((float)$txt / $px[$a] * (10 ** PAGAR_ESCALA[$a]));
        } else {
            $l['valor'] = pagar_dec_int($txt, PAGAR_ESCALA[$a]);
            if ($l['valor'] === null || $l['valor'] <= 0) throw new RuntimeException('Valor inválido.');
        }
    }
    $l['valor_txt'] = pagar_fmt($l['valor'], $a);
    $l['valor_brl'] = round(pagar_brl($l['valor'], $a, $px), 2);
    return $l;
}
/* Limites por pagamento e por 24 h (R$ do valor que o destino recebe) */
function pagar_checar_limites(string $sid, float $brl): array {
    $lim = pagar_limites($sid);
    if ($brl > $lim['por_pagamento'] + 0.005) out(['ok' => false, 'codigo' => 'limite_pagamento', 'limites' => $lim,
        'error' => 'Valor acima do seu limite por pagamento (R$ ' . number_format($lim['por_pagamento'], 2, ',', '.') . '). Você pode alterar no site, em ⚙ Configuração.'], 422);
    if ($brl > $lim['disponivel_24h'] + 0.005) out(['ok' => false, 'codigo' => 'limite_diario', 'limites' => $lim,
        'error' => 'Valor acima do que resta do seu limite de 24 h (R$ ' . number_format($lim['disponivel_24h'], 2, ',', '.') . ' de R$ ' . number_format($lim['por_dia'], 2, ',', '.') . '). Você pode alterar no site, em ⚙ Configuração.'], 422);
    return $lim;
}
// decimal do SQL Server vem como ".0000321": tira zeros finais e repoe o zero a esquerda
function pagar_dec_txt($v): ?string {
    if ($v === null) return null;
    $t = trim((string)$v);
    if (str_contains($t, '.')) $t = rtrim(rtrim($t, '0'), '.');
    if ($t === '' || $t === '-') return '0';
    if ($t[0] === '.') $t = '0' . $t; elseif (str_starts_with($t, '-.')) $t = '-0' . substr($t, 1);
    return $t;
}

function pagar_publico(array $r): array {
    $mapa = ['aprovado' => 'enviando', 'enviado' => 'aguardando confirmação', 'confirmado' => 'pago', 'erro' => 'falhou', 'reembolsado' => 'devolvido'];
    $troca = $r['modo'] !== 'direto';
    return ['id' => (int)$r['pagamento_id'], 'criado_em' => $r['criado_em'], 'destino_ativo' => $r['destino_ativo'], 'destino' => mascara((string)$r['destino_endereco']),
        'destino_completo' => (string)$r['destino_endereco'], 'valor' => pagar_dec_txt($r['destino_valor']), 'valor_brl' => (float)$r['destino_valor_brl'],
        'origem_ativo' => $r['origem_ativo'], 'modo' => $r['modo'], 'pago' => pagar_dec_txt($r['pago_valor']),
        'taxa_rede' => pagar_dec_txt($r['taxa_rede']), 'custo_brl' => $r['custo_brl'] !== null ? (float)$r['custo_brl'] : null,
        'referencia' => $r['referencia'], 'status' => $r['status'], 'situacao' => $mapa[$r['status']] ?? $r['status'], 'confirmacoes' => $r['confirmacoes'] !== null ? (int)$r['confirmacoes'] : null,
        'tx_envio' => $r['tx_envio'], 'tx_envio_link' => $r['tx_envio'] ? pagar_explorer($r['origem_ativo'], (string)$r['tx_envio']) : null,
        'tx_entrega' => $r['tx_entrega'], 'tx_entrega_link' => $r['tx_entrega'] ? pagar_explorer($r['destino_ativo'], (string)$r['tx_entrega']) : null,
        'link_thor' => ($troca && $r['tx_envio']) ? 'https://thorchain.net/tx/' . strtoupper(preg_replace('/^0x/i', '', (string)$r['tx_envio'])) : null,
        'erro' => $r['status'] === 'erro' ? 'O pagamento não foi feito. Nenhum valor saiu da sua conta.' : null];
}
const PAGAR_COLS = 'pagamento_id, criado_em, destino_ativo, destino_endereco, destino_valor, destino_valor_brl, origem_ativo, modo, pago_valor, taxa_rede, custo_brl, referencia, status, confirmacoes, tx_envio, tx_entrega, swap_job_id';

switch ($action) {

case 'pagar_ler': {
    $u = pagar_usuario($sid);
    $px = pagar_precos();
    $l = pagar_alvo($u, $body, $px);
    $saldos = pagar_saldos($u); $sb = [];
    foreach ($saldos as $a => $v) $sb[$a] = ['saldo' => pagar_fmt($v, $a), 'brl' => round(pagar_brl($v, $a, $px), 2)];
    out(['ok' => true, 'lido' => $l, 'saldos' => $sb, 'limites' => pagar_limites($sid), 'precos' => $px]);
}

case 'pagar_opcoes': {
    $u = pagar_usuario($sid);
    $px = pagar_precos();
    $l = pagar_alvo($u, $body, $px);
    if (!empty($l['precisa_ativo']) || !empty($l['precisa_valor'])) out(['ok' => true, 'lido' => $l, 'opcoes' => []]);
    $lim = pagar_limites($sid);
    $ops = pagar_opcoes($u, $l['ativo'], $l['endereco'], (int)$l['valor'], $px);
    out(['ok' => true, 'lido' => $l, 'limites' => $lim, 'acima_unit' => $l['valor_brl'] > $lim['por_pagamento'] + 0.005, 'acima_dia' => $l['valor_brl'] > $lim['disponivel_24h'] + 0.005,
        'opcoes' => array_map('pagar_publico_opcao', $ops)]);
}

case 'pagar_desafio': {
    $u = pagar_usuario($sid);
    checar_saque($sid);
    $de = strtoupper((string)($body['origem'] ?? ''));
    if (!in_array($de, PAGAR_ATIVOS, true)) out(['ok' => false, 'error' => 'Escolha de qual moeda o valor vai sair.'], 422);
    if (in_array($de, ['BTC', 'BCH'], true) && !seg_no_operacional($de)) out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
    $pk = db()->prepare('SELECT credential_id FROM dbo.GN_AppPasskeys WHERE session_id=? AND revogado_em IS NULL');
    $pk->execute([$sid]); $creds = $pk->fetchAll(PDO::FETCH_COLUMN);
    if (!$creds) out(['ok' => false, 'codigo' => 'sem_passkey', 'error' => 'Cadastre a digital deste aparelho antes de pagar.'], 412);
    $px = pagar_precos();
    $l = pagar_alvo($u, $body, $px);
    if (!empty($l['precisa_ativo']) || !empty($l['precisa_valor'])) out(['ok' => false, 'error' => 'Informe a moeda e o valor do pagamento.'], 422);
    pagar_checar_limites($sid, (float)$l['valor_brl']);
    $o = pagar_opcoes($u, $l['ativo'], $l['endereco'], (int)$l['valor'], $px, $de)[0] ?? null;
    if (!$o || !$o['disponivel']) out(['ok' => false, 'error' => $o['motivo'] ?? 'Essa origem não está disponível.'], 422);
    $payload = ['de' => $de, 'para' => $l['ativo'], 'destino' => $l['endereco'], 'alvo' => (int)$l['valor'], 'alvo_brl' => (float)$l['valor_brl'],
        'referencia' => $l['referencia'], 'modo' => $o['modo'], 'in_base' => (int)$o['_in_base'], 'fee' => (int)$o['_fee'], 'rate' => (float)$o['_rate'],
        'memo' => $o['_memo'] ?? null, 'cofre' => $o['_cofre'] ?? null, 'expira' => (int)($o['expira'] ?? (time() + 900)),
        'custo_brl' => (float)$o['custo_brl'], 'folga_pct' => (float)$o['folga_pct'], 'preco_de' => (float)$px[$de]];
    $ch = novo_desafio($sid, 'pagar', $payload);
    out(['ok' => true, 'challenge' => $ch, 'allowCredentials' => array_map(fn($c) => ['type' => 'public-key', 'id' => $c], $creds),
        'rpId' => APP_RP_ID, 'expira_s' => APP_DESAFIO_TTL, 'opcao' => pagar_publico_opcao($o), 'lido' => $l]);
}

case 'pagar_confirmar': {
    $u = pagar_usuario($sid);
    $ch = (string)($body['challenge'] ?? ''); $a = is_array($body['assertion'] ?? null) ? $body['assertion'] : [];
    $p = consumir_desafio($ch, $sid, 'pagar');
    if ($p === null) out(['ok' => false, 'error' => 'Confirmação expirada. Refaça o pagamento.'], 400);
    checar_saque($sid);
    $st = db()->prepare('SELECT credential_id, public_key_pem, sign_count FROM dbo.GN_AppPasskeys WHERE session_id=? AND credential_id=? AND revogado_em IS NULL');
    $st->execute([$sid, (string)($a['id'] ?? '')]); $pk = $st->fetch();
    if (!$pk) out(['ok' => false, 'error' => 'Digital não cadastrada para esta conta.'], 403);
    try { $novoCnt = webauthn_verificar($a, $ch, $pk['public_key_pem'], (int)$pk['sign_count']); }
    catch (Throwable $e) { seg_log(db(), 'pagar_app', 'recusado', ['origem' => 'app', 'resultado' => 'recusado', 'motivo' => 'digital: ' . $e->getMessage()], $sid); out(['ok' => false, 'error' => $e->getMessage()], 403); }
    db()->prepare('UPDATE dbo.GN_AppPasskeys SET sign_count=?, ultimo_uso=SYSUTCDATETIME() WHERE credential_id=?')->execute([$novoCnt, $pk['credential_id']]);

    $de = (string)$p['de']; $para = (string)$p['para'];
    if (!in_array($de, ['BTC', 'BCH'], true)) out(['ok' => false, 'error' => 'Origem ainda não suportada. Nada foi enviado.'], 422);
    if (!seg_no_operacional($de)) out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
    pagar_destino_checar($u, $para, (string)$p['destino']);
    pagar_checar_limites($sid, (float)$p['alvo_brl']);
    $origem = (string)($de === 'BCH' ? $u['bch_address'] : $u['btc_address']);
    $LA = fn(string $etapa, array $c) => seg_log(db(), 'pagar_app', $etapa, $c + ['origem' => 'app', 'moeda' => $de, 'destino' => (string)$p['destino']], $sid);
    $fmtDe = fn(int $v) => btc_str($v);
    $alvoTxt = number_format($p['alvo'] / (10 ** PAGAR_ESCALA[$para]), PAGAR_ESCALA[$para], '.', '');

    if ($p['modo'] === 'direto') {
        if ($de !== $para) out(['ok' => false, 'error' => 'Dados do pagamento inconsistentes. Nada foi enviado.'], 409);
        $t = pagar_montar_direto($de, $origem, (string)$p['destino'], (int)$p['alvo'], (float)$p['rate']);
        if ($t['fee_sats'] > max((int)$p['fee'] * 2, (int)$p['fee'] + 2000)) out(['ok' => false, 'error' => 'A taxa de rede subiu desde a cotação. Refaça o pagamento. Nada foi enviado.'], 409);
        if (!$LA('aprovado', ['valor' => $fmtDe((int)$p['alvo']), 'taxa' => $p['rate'], 'resultado' => 'em_andamento'])) out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
        $ins = db()->prepare("INSERT INTO dbo.GN_PagamentosCripto (session_id, destino_ativo, destino_endereco, destino_valor, destino_valor_brl, referencia, origem_ativo, modo,
            pago_valor, taxa_rede, custo_brl, folga_pct, status) OUTPUT INSERTED.pagamento_id VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'aprovado')");
        $ins->execute([$sid, $para, (string)$p['destino'], $alvoTxt, sprintf('%.2f', $p['alvo_brl']), $p['referencia'], $de, 'direto',
            $fmtDe((int)$p['alvo']), $fmtDe($t['fee_sats']), sprintf('%.2f', $t['fee_sats'] / 1e8 * (float)$p['preco_de']), '0']);
        $id = (int)$ins->fetchColumn();
        try { $txid = $de === 'BCH' ? bch_rpc('sendrawtransaction', [$t['hex']]) : btc_rpc('sendrawtransaction', [$t['hex']]); }
        catch (Throwable $e) {
            db()->prepare("UPDATE dbo.GN_PagamentosCripto SET status='erro', erro=?, atualizado_em=SYSUTCDATETIME() WHERE pagamento_id=?")->execute([mb_substr($e->getMessage(), 0, 290), $id]);
            $LA('recusado', ['valor' => $fmtDe((int)$p['alvo']), 'resultado' => 'recusado', 'motivo' => 'envio: ' . $e->getMessage()]);
            out(['ok' => false, 'error' => 'A rede não aceitou o envio. Nada saiu da sua conta.'], 502);
        }
        db()->prepare("UPDATE dbo.GN_PagamentosCripto SET status='enviado', tx_envio=?, atualizado_em=SYSUTCDATETIME() WHERE pagamento_id=?")->execute([$txid, $id]);
        $LA('enviado', ['valor' => $fmtDe((int)$p['alvo']), 'txid' => $txid, 'resultado' => 'ok']);
        out(['ok' => true, 'id' => $id, 'txid' => $txid]);
    }

    // troca: THORChain entrega direto no destino; limite do memo = valor exato pedido (abaixo disso, devolve)
    if ($p['modo'] !== 'troca' || !in_array($para, ['BTC', 'BCH'], true) || $de === $para) out(['ok' => false, 'error' => 'Tipo de pagamento ainda não suportado. Nada foi enviado.'], 422);
    if ((int)$p['expira'] < time() + 60) out(['ok' => false, 'error' => 'A cotação venceu. Refaça o pagamento.'], 409);
    $mp = explode(':', (string)$p['memo']);
    $destMemo = strtolower(bch_sem_prefixo((string)($mp[2] ?? '')));
    if (count($mp) < 4 || $destMemo !== strtolower(bch_sem_prefixo((string)$p['destino'])) || memo_limite((string)$p['memo']) !== pagar_para_thor((int)$p['alvo'], $para))
        out(['ok' => false, 'error' => 'Conferência do pedido de troca falhou. Nada foi enviado.'], 409);
    if (!in_array(strtolower((string)$p['cofre']), thor_cofres($de), true)) out(['ok' => false, 'error' => 'O cofre da THORChain mudou. Refaça o pagamento.'], 409);
    $t = venda_montar($origem, (string)$p['cofre'], (int)$p['in_base'], (string)$p['memo'], (float)$p['rate'], $de);
    if (!$LA('aprovado', ['valor' => $fmtDe((int)$p['in_base']), 'taxa' => $p['rate'], 'resultado' => 'em_andamento'])) out(['ok' => false, 'codigo' => 'servico_indisponivel', 'error' => seg_resposta_indisponivel()['error']], 503);
    $insJ = db()->prepare("INSERT INTO dbo.GN_SwapJobs (session_id, direcao, provedor, from_asset, from_amount, to_asset, from_address, dest_address, expected_out, min_out, memo, vault,
        quote_expira_utc, status, origem, preco_brl, custo_brl, tx_fee_sats, repasse_saida) OUTPUT INSERTED.id
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,DATEADD(second, CAST(? AS int), '1970-01-01'),'assinando',?,?,?,?,0)");
    $insJ->execute([$sid, $de . '>' . $para, 'thorchain', $de . '.' . $de, $fmtDe((int)$p['in_base']), $para . '.' . $para, $origem, (string)$p['destino'],
        $alvoTxt, $alvoTxt, (string)$p['memo'], (string)$p['cofre'], (int)$p['expira'], 'pagar', (float)$p['preco_de'], sprintf('%.2f', $p['custo_brl']), $t['fee_sats']]);
    $job = (int)$insJ->fetchColumn();
    $ins = db()->prepare("INSERT INTO dbo.GN_PagamentosCripto (session_id, destino_ativo, destino_endereco, destino_valor, destino_valor_brl, referencia, origem_ativo, modo,
        pago_valor, taxa_rede, custo_brl, folga_pct, swap_job_id, status) OUTPUT INSERTED.pagamento_id VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'aprovado')");
    $ins->execute([$sid, $para, (string)$p['destino'], $alvoTxt, sprintf('%.2f', $p['alvo_brl']), $p['referencia'], $de, 'troca',
        $fmtDe((int)$p['in_base']), $fmtDe($t['fee_sats']), sprintf('%.2f', $p['custo_brl']), sprintf('%.4f', $p['folga_pct']), $job]);
    $id = (int)$ins->fetchColumn();
    try { $txid = $de === 'BCH' ? bch_rpc('sendrawtransaction', [$t['hex']]) : btc_rpc('sendrawtransaction', [$t['hex']]); }
    catch (Throwable $e) {
        db()->prepare("UPDATE dbo.GN_SwapJobs SET status='erro', erro=?, atualizado_em=SYSUTCDATETIME() WHERE id=?")->execute([mb_substr($e->getMessage(), 0, 1900), $job]);
        db()->prepare("UPDATE dbo.GN_PagamentosCripto SET status='erro', erro=?, atualizado_em=SYSUTCDATETIME() WHERE pagamento_id=?")->execute([mb_substr($e->getMessage(), 0, 290), $id]);
        $LA('recusado', ['valor' => $fmtDe((int)$p['in_base']), 'resultado' => 'recusado', 'motivo' => 'envio: ' . $e->getMessage()]);
        out(['ok' => false, 'error' => 'A rede não aceitou o envio. Nada saiu da sua conta.'], 502);
    }
    db()->prepare("UPDATE dbo.GN_SwapJobs SET status='deposito_enviado', tx_deposit=?, atualizado_em=SYSUTCDATETIME() WHERE id=?")->execute([$txid, $job]);
    db()->prepare("UPDATE dbo.GN_PagamentosCripto SET status='enviado', tx_envio=?, atualizado_em=SYSUTCDATETIME() WHERE pagamento_id=?")->execute([$txid, $id]);
    $LA('enviado', ['valor' => $fmtDe((int)$p['in_base']), 'txid' => $txid, 'resultado' => 'ok']);
    out(['ok' => true, 'id' => $id, 'txid' => $txid]);
}

case 'pagar_status': {
    pagar_usuario($sid);
    $st = db()->prepare('SELECT ' . PAGAR_COLS . ' FROM dbo.GN_PagamentosCripto WHERE session_id=? AND pagamento_id=?');
    $st->execute([$sid, (int)($body['id'] ?? 0)]); $r = $st->fetch();
    if (!$r) out(['ok' => false, 'error' => 'Pagamento não encontrado nesta conta.'], 404);
    $extra = [];
    if ($r['status'] === 'enviado' && $r['tx_envio']) {
        if ($r['modo'] === 'direto') {
            try {
                $tx = $r['origem_ativo'] === 'BCH' ? bch_rpc('gettransaction', [(string)$r['tx_envio']]) : btc_rpc('gettransaction', [(string)$r['tx_envio']]);
                $cf = max(0, (int)($tx['confirmations'] ?? 0));
                db()->prepare("UPDATE dbo.GN_PagamentosCripto SET confirmacoes=?, status=CASE WHEN ? >= 1 THEN 'confirmado' ELSE status END, atualizado_em=SYSUTCDATETIME() WHERE pagamento_id=? AND status='enviado'")
                    ->execute([$cf, $cf, (int)$r['pagamento_id']]);
                $r['confirmacoes'] = $cf; if ($cf >= 1) $r['status'] = 'confirmado';
            } catch (Throwable $e) {}
        } else {
            [$s] = thor_get('/thorchain/tx/status/' . strtoupper(preg_replace('/^0x/i', '', (string)$r['tx_envio'])), 1);
            if ($s) {
                $g = $s[0]['stages'] ?? [];
                $extra['etapas'] = ['observado' => !empty($g['inbound_observed']['completed']), 'confirmado' => !empty($g['inbound_finalised']['completed']),
                    'trocado' => !empty($g['swap_finalised']['completed']), 'enviado' => !empty($g['outbound_signed']['completed'])];
                $falta = 0; $tem = false;
                if (isset($g['inbound_confirmation_counted']['remaining_confirmation_seconds']) && empty($g['inbound_confirmation_counted']['completed'])) { $falta += (int)$g['inbound_confirmation_counted']['remaining_confirmation_seconds']; $tem = true; }
                if (isset($g['outbound_delay']['remaining_delay_seconds']) && empty($g['outbound_delay']['completed'])) { $falta += (int)$g['outbound_delay']['remaining_delay_seconds']; $tem = true; }
                $extra['faltam_seg'] = $tem ? $falta : null;
                $outs = $s[0]['out_txs'] ?? [];
                if (!empty($g['outbound_signed']['completed']) && $outs && !empty($outs[0]['id'])) {
                    $refund = false; foreach ($outs as $o) if (stripos((string)($o['memo'] ?? ''), 'REFUND') !== false) $refund = true;
                    $novo = $refund ? 'reembolsado' : 'confirmado'; $txo = (string)$outs[0]['id'];
                    db()->prepare("UPDATE dbo.GN_PagamentosCripto SET status=?, tx_entrega=?, atualizado_em=SYSUTCDATETIME() WHERE pagamento_id=? AND status='enviado'")->execute([$novo, $txo, (int)$r['pagamento_id']]);
                    if ($r['swap_job_id']) db()->prepare("UPDATE dbo.GN_SwapJobs SET status=?, tx_saida=?, atualizado_em=SYSUTCDATETIME() WHERE id=? AND status='deposito_enviado'")
                        ->execute([$refund ? 'reembolsado' : 'concluido', $txo, (int)$r['swap_job_id']]);
                    $r['status'] = $novo; $r['tx_entrega'] = $txo;
                }
            }
        }
    }
    out(['ok' => true, 'pagamento' => pagar_publico($r) + $extra]);
}

case 'pagamentos_lista': {
    pagar_usuario($sid);
    $st = db()->prepare('SELECT TOP 20 ' . PAGAR_COLS . ' FROM dbo.GN_PagamentosCripto WHERE session_id=? ORDER BY pagamento_id DESC');
    $st->execute([$sid]);
    out(['ok' => true, 'pagamentos' => array_map('pagar_publico', $st->fetchAll()), 'limites' => pagar_limites($sid)]);
}

default:
    out(['ok' => false, 'error' => 'ação desconhecida'], 400);
}
