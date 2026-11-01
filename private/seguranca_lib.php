<?php
/* ============================================================
 * seguranca_lib.php - verificacao em 2 etapas (TOTP, RFC 6238) do GambleNumbers.
 *
 *  - Apps compativeis: Google Authenticator, Microsoft Authenticator, Authy, etc.
 *    (SHA-1, 6 digitos, passo de 30 s; aceita 1 passo de folga para o relogio do celular).
 *  - A chave fica cifrada no banco (AES-256-GCM) com a chave de private/seguranca_config.php,
 *    que mora so' no servidor web: um vazamento do banco sozinho nao expoe as chaves.
 *  - Cada codigo vale uma vez (guarda o ultimo passo aceito); 5 erros em 15 min bloqueiam a sessao.
 *  - 8 codigos de recuperacao de uso unico, guardados so' como hash.
 *  - Saques ficam bloqueados por 24 h depois de ativar o 2FA ou trocar o endereco de saida.
 *  - Tabela: dbo.GN_2FA (ver docs/GN_2FA.sql). Liberacao manual pelo administrador: ver o mesmo arquivo.
 * ============================================================ */
declare(strict_types=1);

const SEG_TOTP_PASSO     = 30;
const SEG_TOTP_DIGITOS   = 6;
const SEG_TOTP_FOLGA     = 1;
const SEG_ESPERA_SAQUE_H = 24;
const SEG_MAX_ERROS      = 5;
const SEG_JANELA_MIN     = 15;
const SEG_EMISSOR        = 'GambleNumbers';

function seg_chave(): string {
    static $k = null;
    if ($k === null) {
        $c = include __DIR__ . '/seguranca_config.php';
        $k = base64_decode((string)($c['totp_chave'] ?? ''), true);
        if (!is_string($k) || strlen($k) !== 32) throw new RuntimeException('seguranca_config.php sem totp_chave valida');
    }
    return $k;
}
function seg_cifrar(string $claro): string {
    $iv = random_bytes(12); $tag = '';
    $ct = openssl_encrypt($claro, 'aes-256-gcm', seg_chave(), OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $ct);
}
function seg_decifrar(string $b64): string {
    $raw = base64_decode($b64, true);
    if ($raw === false || strlen($raw) < 29) throw new RuntimeException('segredo invalido');
    $pt = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', seg_chave(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    if ($pt === false) throw new RuntimeException('segredo invalido');
    return $pt;
}

function seg_base32(string $bin): string {
    $alf = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = ''; $out = '';
    foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    foreach (str_split($bits, 5) as $g) $out .= $alf[bindec(str_pad($g, 5, '0'))];
    return $out;
}
function seg_totp(string $segredo, int $passo): string {
    $h = hash_hmac('sha1', pack('J', $passo), $segredo, true);
    $o = ord($h[19]) & 0xf;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string)($n % (10 ** SEG_TOTP_DIGITOS)), SEG_TOTP_DIGITOS, '0', STR_PAD_LEFT);
}
/** Passo aceito para o codigo (dentro da folga), ou null. */
function seg_totp_passo(string $segredo, string $codigo): ?int {
    if (!preg_match('/^\d{6}$/', $codigo)) return null;
    $agora = intdiv(time(), SEG_TOTP_PASSO);
    for ($d = -SEG_TOTP_FOLGA; $d <= SEG_TOTP_FOLGA; $d++) {
        if (hash_equals(seg_totp($segredo, $agora + $d), $codigo)) return $agora + $d;
    }
    return null;
}

function seg_linha(PDO $db, string $sid): ?array {
    $st = $db->prepare('SELECT * FROM dbo.GN_2FA WHERE session_id=?');
    $st->execute([$sid]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    return $r ?: null;
}
function seg_chave_erros(string $sid): string { return '2fa:' . substr(hash('sha256', $sid), 0, 32); }
function seg_erros_excedidos(PDO $db, string $sid): bool {
    $st = $db->prepare('SELECT COUNT(*) FROM dbo.GN_AppTentativas WHERE chave=? AND criado_em > DATEADD(MINUTE, CAST(? AS INT), SYSUTCDATETIME())');
    $st->execute([seg_chave_erros($sid), -SEG_JANELA_MIN]);
    return (int)$st->fetchColumn() >= SEG_MAX_ERROS;
}
function seg_registrar_erro(PDO $db, string $sid): void {
    $db->prepare('INSERT INTO dbo.GN_AppTentativas (chave) VALUES (?)')->execute([seg_chave_erros($sid)]);
}

/** Momento (UTC, timestamp) a partir do qual saques estao liberados; null = liberado. */
function seg_saque_liberado_em(?array $r): ?int {
    // a espera de 24 h so' vale para quem ativou o 2FA (o 2FA e' opcional)
    if (!$r || !$r['ativo']) return null;
    $t = 0;
    foreach (['ativado_em', 'endereco_alterado_em'] as $c) {
        if (!empty($r[$c])) $t = max($t, strtotime($r[$c] . ' UTC') + SEG_ESPERA_SAQUE_H * 3600);
    }
    return $t > time() ? $t : null;
}

function seg_status(PDO $db, string $sid): array {
    $r = seg_linha($db, $sid);
    $lib = seg_saque_liberado_em($r);
    $rec = $r && $r['recuperacao_json'] ? count(json_decode($r['recuperacao_json'], true) ?: []) : 0;
    return ['ativo' => (bool)($r['ativo'] ?? false), 'bloqueado_admin' => (bool)($r['bloqueado_admin'] ?? false),
            'saque_liberado_em' => $lib ? gmdate('c', $lib) : null, 'codigos_recuperacao' => $rec];
}

/** Gera uma chave nova (pendente ate confirmar com um codigo). Devolve o segredo base32 e o otpauth:// para o QR. */
function seg_iniciar(PDO $db, string $sid, string $rotulo): array {
    $seg = random_bytes(20);
    $cif = seg_cifrar($seg);
    $up = $db->prepare('UPDATE dbo.GN_2FA SET pendente_cifrado=?, pendente_em=SYSUTCDATETIME(), atualizado_em=SYSUTCDATETIME() WHERE session_id=?');
    $up->execute([$cif, $sid]);
    if ($up->rowCount() === 0) {
        $db->prepare('INSERT INTO dbo.GN_2FA (session_id, pendente_cifrado, pendente_em) VALUES (?, ?, SYSUTCDATETIME())')->execute([$sid, $cif]);
    }
    $b32 = seg_base32($seg);
    $uri = 'otpauth://totp/' . rawurlencode(SEG_EMISSOR . ':' . $rotulo) . '?secret=' . $b32 . '&issuer=' . rawurlencode(SEG_EMISSOR)
         . '&algorithm=SHA1&digits=' . SEG_TOTP_DIGITOS . '&period=' . SEG_TOTP_PASSO;
    return ['segredo' => $b32, 'uri' => $uri];
}

/** Confirma a chave pendente com um codigo do app. Ativa e devolve os 8 codigos de recuperacao (mostrados uma unica vez). */
function seg_confirmar(PDO $db, string $sid, string $codigo): array {
    $r = seg_linha($db, $sid);
    if (!$r || empty($r['pendente_cifrado'])) return ['ok' => false, 'erro_chave' => 'seg2fa_e_recomecar', 'error' => 'Comece a ativação de novo.'];
    if (strtotime($r['pendente_em'] . ' UTC') < time() - 900) return ['ok' => false, 'erro_chave' => 'seg2fa_e_qr_expirou', 'error' => 'O QR code expirou. Comece a ativação de novo.'];
    if (seg_erros_excedidos($db, $sid)) return ['ok' => false, 'erro_chave' => 'seg2fa_e_muitos_erros', 'error' => 'Muitos códigos errados. Aguarde 15 minutos.'];
    $passo = seg_totp_passo(seg_decifrar($r['pendente_cifrado']), trim($codigo));
    if ($passo === null) { seg_registrar_erro($db, $sid); return ['ok' => false, 'erro_chave' => 'seg2fa_e_incorreto_hora', 'error' => 'Código incorreto. Confira o horário do celular e tente o código atual.']; }
    $codigos = []; $hashes = [];
    for ($i = 0; $i < 8; $i++) {
        $c = strtoupper(bin2hex(random_bytes(5)));                    // 10 caracteres
        $codigos[] = substr($c, 0, 5) . '-' . substr($c, 5);
        $hashes[] = password_hash($c, PASSWORD_DEFAULT);
    }
    $db->prepare('UPDATE dbo.GN_2FA SET segredo_cifrado=pendente_cifrado, pendente_cifrado=NULL, pendente_em=NULL, ativo=1,
                  ativado_em=SYSUTCDATETIME(), ultimo_passo=?, recuperacao_json=?, atualizado_em=SYSUTCDATETIME() WHERE session_id=?')
       ->execute([$passo, json_encode($hashes), $sid]);
    return ['ok' => true, 'codigos_recuperacao' => $codigos, 'saque_liberado_em' => gmdate('c', time() + SEG_ESPERA_SAQUE_H * 3600)];
}

/** Confere um codigo do app (ou de recuperacao, que e' consumido). */
function seg_verificar(PDO $db, string $sid, string $codigo): bool {
    $r = seg_linha($db, $sid);
    if (!$r || !$r['ativo'] || empty($r['segredo_cifrado'])) return false;
    if (seg_erros_excedidos($db, $sid)) return false;
    $codigo = strtoupper(trim($codigo));
    $passo = seg_totp_passo(seg_decifrar($r['segredo_cifrado']), $codigo);
    if ($passo !== null) {
        // uso unico: so' aceita um passo posterior ao ultimo usado (UPDATE condicional evita corrida)
        $up = $db->prepare('UPDATE dbo.GN_2FA SET ultimo_passo=?, atualizado_em=SYSUTCDATETIME() WHERE session_id=? AND (ultimo_passo IS NULL OR ultimo_passo < ?)');
        $up->execute([$passo, $sid, $passo]);
        if ($up->rowCount() === 1) return true;
    } else {
        $limpo = str_replace('-', '', $codigo);
        $lista = json_decode((string)$r['recuperacao_json'], true) ?: [];
        foreach ($lista as $i => $h) {
            if (preg_match('/^[0-9A-F]{10}$/', $limpo) && password_verify($limpo, $h)) {
                array_splice($lista, $i, 1);
                $up = $db->prepare('UPDATE dbo.GN_2FA SET recuperacao_json=?, atualizado_em=SYSUTCDATETIME() WHERE session_id=? AND recuperacao_json=?');
                $up->execute([json_encode($lista), $sid, $r['recuperacao_json']]);
                if ($up->rowCount() === 1) return true;
            }
        }
    }
    seg_registrar_erro($db, $sid);
    return false;
}

/**
 * Exigencia para saque e encerramento com transferencia. O 2FA e' opcional: sem 2FA ativo so' vale o
 * bloqueio do administrador; com 2FA ativo, tambem a espera de 24 h e o codigo valido.
 * Devolve null se pode seguir, ou a resposta de erro (array).
 */
function seg_exigir_para_saque(PDO $db, string $sid, string $codigo): ?array {
    $r = seg_linha($db, $sid);
    if ($r && $r['bloqueado_admin']) return ['ok' => false, 'bloqueado_admin' => true, 'erro_chave' => 'seg2fa_e_bloqueado_admin', 'error' => 'Saques desta conta estão bloqueados. Fale com o suporte.'];
    if (!$r || !$r['ativo']) return null;
    $lib = seg_saque_liberado_em($r);
    if ($lib) return ['ok' => false, 'saque_liberado_em' => gmdate('c', $lib), 'erro_chave' => 'seg2fa_e_espera24', 'error' => 'Por segurança, saques ficam liberados 24 h depois de ativar a verificação em 2 etapas ou trocar o endereço de saída.'];
    if ($codigo === '') return ['ok' => false, 'precisa_codigo_2fa' => true, 'erro_chave' => 'seg2fa_e_digite', 'error' => 'Digite o código do seu app autenticador.'];
    if (seg_erros_excedidos($db, $sid)) return ['ok' => false, 'precisa_codigo_2fa' => true, 'erro_chave' => 'seg2fa_e_muitos_erros', 'error' => 'Muitos códigos errados. Aguarde 15 minutos.'];
    if (!seg_verificar($db, $sid, $codigo)) return ['ok' => false, 'precisa_codigo_2fa' => true, 'codigo_invalido' => true, 'erro_chave' => 'seg2fa_e_incorreto', 'error' => 'Código incorreto ou já usado.'];
    return null;
}

/** Exigencia para trocar senha ou endereco de saida quando o 2FA esta ativo. */
function seg_exigir_se_ativo(PDO $db, string $sid, string $codigo): ?array {
    $r = seg_linha($db, $sid);
    if (!$r || !$r['ativo']) return null;
    if ($codigo === '') return ['ok' => false, 'precisa_codigo_2fa' => true, 'erro_chave' => 'seg2fa_e_digite', 'error' => 'Digite o código do seu app autenticador.'];
    if (seg_erros_excedidos($db, $sid)) return ['ok' => false, 'precisa_codigo_2fa' => true, 'erro_chave' => 'seg2fa_e_muitos_erros', 'error' => 'Muitos códigos errados. Aguarde 15 minutos.'];
    if (!seg_verificar($db, $sid, $codigo)) return ['ok' => false, 'precisa_codigo_2fa' => true, 'codigo_invalido' => true, 'erro_chave' => 'seg2fa_e_incorreto', 'error' => 'Código incorreto ou já usado.'];
    return null;
}

function seg_marcar_endereco_alterado(PDO $db, string $sid): void {
    $up = $db->prepare('UPDATE dbo.GN_2FA SET endereco_alterado_em=SYSUTCDATETIME(), atualizado_em=SYSUTCDATETIME() WHERE session_id=?');
    $up->execute([$sid]);
    if ($up->rowCount() === 0) $db->prepare('INSERT INTO dbo.GN_2FA (session_id, endereco_alterado_em) VALUES (?, SYSUTCDATETIME())')->execute([$sid]);
}
