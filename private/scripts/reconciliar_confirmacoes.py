#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reconciliar_confirmacoes.py
============================
Roda periodicamente (via systemd timer) no lxweb01 e reconcilia, direto
com os dois nodes locais (BTC e BCH) via RPC, as transacoes reais que
ainda nao foram marcadas como confirmadas no banco:

  - dbo.GN_Saques           (saques para carteira externa)
  - dbo.GN_SideshiftJobs    (swap BTC<->BCH via SideShift)

Existe porque o unico ponto que hoje atualiza esses campos e o
JavaScript da tela (terminal ambar) enquanto o usuario fica com a aba
aberta. Se a aba fecha antes do ciclo de polling terminar, a transacao
confirma na rede normalmente mas o banco nunca fica sabendo. Este
script varre os pendentes, pergunta pro node se ja confirmou, e grava
tanto a confirmacao quanto o horario REAL da primeira confirmacao
(campo blocktime devolvido pelo proprio node — nao o horario em que
este script rodou).

Nao movimenta fundos, nao chama a API da SideShift — so leitura RPC
(gettransaction/listtransactions) nos nodes locais + UPDATE no SQL Server.
Seguro de rodar repetidas vezes (idempotente) e com lock pra nunca
sobrepor duas execucoes.
"""
import datetime
import fcntl
import json
import re
import sys
import time
import urllib.request
import urllib.error

import pyodbc

BASE_DIR = "/usr/share/nginx/html/gamblenumbers"
PRIVATE_DIR = f"{BASE_DIR}/private"
LOG_FILE = f"{PRIVATE_DIR}/logs/reconciliador.log"
LOCK_FILE = f"{PRIVATE_DIR}/cache/reconciliador.lock"

RPC_TIMEOUT = 15
LISTTX_LIMIT = 200  # janela de listtransactions ao procurar o settle_txid


def log(msg: str) -> None:
    linha = f"{datetime.datetime.now(datetime.timezone.utc).isoformat()} {msg}"
    print(linha)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass


def ler_vars_php(caminho: str) -> dict:
    """Extrai $VAR = 'valor'; ou $VAR = numero; de um arquivo de config PHP.
    Evita duplicar credenciais — le sempre do mesmo lugar que o site usa."""
    texto = open(caminho, "r", encoding="utf-8").read()
    vars_ = {}
    for m in re.finditer(r"\$(\w+)\s*=\s*'((?:[^'\\]|\\.)*)'\s*;", texto):
        vars_[m.group(1)] = m.group(2).replace("\\'", "'")
    for m in re.finditer(r"\$(\w+)\s*=\s*(\d+)\s*;", texto):
        vars_.setdefault(m.group(1), int(m.group(2)))
    return vars_


CFG = ler_vars_php(f"{PRIVATE_DIR}/config.php")
WCFG = ler_vars_php(f"{PRIVATE_DIR}/wallet_config.php")

DB_SERVER = CFG["DB_SERVER"]
DB_DATABASE = CFG["DB_DATABASE"]
DB_USER = CFG["DB_USER"]
DB_PASSWORD = CFG["DB_PASSWORD"]
DB_PORT = CFG["DB_PORT"]

RPC = {
    "BTC": dict(host=WCFG["RPC_BTC_HOST"], port=WCFG["RPC_BTC_PORT"],
                user=WCFG["RPC_BTC_USER"], password=WCFG["RPC_BTC_PASS"],
                url_path="/wallet/gamblenumbers"),
    "BCH": dict(host=WCFG["RPC_BCH_HOST"], port=WCFG["RPC_BCH_PORT"],
                user=WCFG["RPC_BCH_USER"], password=WCFG["RPC_BCH_PASS"],
                url_path="/"),
}


def rpc_call(coin: str, method: str, params=None):
    cfg = RPC[coin]
    url = f"http://{cfg['host']}:{cfg['port']}{cfg['url_path']}"
    payload = json.dumps({"jsonrpc": "1.0", "id": "reconciliador",
                           "method": method, "params": params or []}).encode()
    req = urllib.request.Request(url, data=payload, method="POST",
                                  headers={"Content-Type": "text/plain"})
    import base64
    auth = base64.b64encode(f"{cfg['user']}:{cfg['password']}".encode()).decode()
    req.add_header("Authorization", f"Basic {auth}")
    with urllib.request.urlopen(req, timeout=RPC_TIMEOUT) as resp:
        data = json.loads(resp.read())
    if data.get("error"):
        raise RuntimeError(f"RPC {coin} {method}: {data['error']}")
    return data["result"]


def unix_to_dt(ts) -> "datetime.datetime | None":
    if not ts:
        return None
    return datetime.datetime.fromtimestamp(int(ts), tz=datetime.timezone.utc).replace(tzinfo=None)


def conectar_sql():
    conn_str = (
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={DB_SERVER},{DB_PORT};DATABASE={DB_DATABASE};"
        f"UID={DB_USER};PWD={DB_PASSWORD};"
        "Encrypt=no;TrustServerCertificate=yes;Connection Timeout=10"
    )
    return pyodbc.connect(conn_str, autocommit=True)


def reconciliar_saques(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT txid, moeda FROM dbo.GN_Saques
        WHERE confirmado = 0
    """)
    pendentes = cur.fetchall()
    log(f"saques: {len(pendentes)} pendente(s) para checar")
    atualizados = 0
    for txid, moeda in pendentes:
        moeda = moeda.strip().upper()
        try:
            tx = rpc_call(moeda, "gettransaction", [txid])
        except Exception as e:
            log(f"saque {txid} ({moeda}): erro RPC — {e}")
            continue
        conf = int(tx.get("confirmations") or 0)
        agora = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        if conf > 0:
            confirmado_em = unix_to_dt(tx.get("blocktime")) or agora
            cur.execute("""
                UPDATE dbo.GN_Saques
                SET confirmado = 1, confirmado_em = ?, confirmacoes = ?, atualizado_em = ?
                WHERE txid = ? AND confirmado = 0
            """, (confirmado_em, conf, agora, txid))
            if cur.rowcount:
                atualizados += 1
                log(f"saque {txid} ({moeda}): CONFIRMADO agora ({conf} confirmacoes, "
                    f"1a confirmacao real em {confirmado_em.isoformat()})")
        else:
            cur.execute("""
                UPDATE dbo.GN_Saques
                SET confirmacoes = ?, atualizado_em = ?
                WHERE txid = ?
            """, (conf, agora, txid))
    log(f"saques: {atualizados} registro(s) marcado(s) como confirmado nesta rodada")


def encontrar_settle_tx(to_coin: str, settle_address: str):
    """Espelha a mesma logica que ja existe em sideshift_api.php::actionStatus:
    procura nas ultimas transacoes do node uma entrada 'receive' pro
    endereco de liquidacao do usuario."""
    try:
        txs = rpc_call(to_coin, "listtransactions", ["*", LISTTX_LIMIT, 0, True])
    except Exception as e:
        log(f"settle lookup {to_coin}/{settle_address}: erro RPC listtransactions — {e}")
        return None
    for tx in txs:
        if tx.get("address") == settle_address and tx.get("category") == "receive":
            return tx
    return None


def reconciliar_swaps(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT job_id, from_coin, to_coin, deposit_txid, settle_address,
               deposit_confirmado, settle_confirmado
        FROM dbo.GN_SideshiftJobs
        WHERE deposit_confirmado = 0 OR settle_confirmado = 0
    """)
    pendentes = cur.fetchall()
    log(f"swaps: {len(pendentes)} pendente(s) para checar")
    atualizados = 0
    agora = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

    for job_id, from_coin, to_coin, deposit_txid, settle_address, dep_conf_flag, set_conf_flag in pendentes:
        from_coin = from_coin.strip().upper()
        to_coin = to_coin.strip().upper()
        mudou = False

        # --- lado do deposito (nosso envio pro endereco da SideShift) ---
        if not dep_conf_flag:
            try:
                tx = rpc_call(from_coin, "gettransaction", [deposit_txid])
                conf = int(tx.get("confirmations") or 0)
                if conf > 0:
                    dep_em = unix_to_dt(tx.get("blocktime")) or agora
                    cur.execute("""
                        UPDATE dbo.GN_SideshiftJobs
                        SET deposit_confirmado = 1, deposit_confirmado_em = ?,
                            deposit_confirmacoes = ?
                        WHERE job_id = ?
                    """, (dep_em, conf, job_id))
                    mudou = True
                    log(f"swap {job_id}: deposito CONFIRMADO ({conf} confirmacoes, "
                        f"1a confirmacao real em {dep_em.isoformat()})")
                else:
                    cur.execute("""
                        UPDATE dbo.GN_SideshiftJobs SET deposit_confirmacoes = ? WHERE job_id = ?
                    """, (conf, job_id))
            except Exception as e:
                log(f"swap {job_id}: erro RPC deposito ({from_coin}) — {e}")

        # --- lado da liquidacao (SideShift paga no nosso endereco na outra moeda) ---
        if not set_conf_flag:
            achou = encontrar_settle_tx(to_coin, settle_address)
            if achou:
                settle_txid = achou.get("txid")
                try:
                    tx2 = rpc_call(to_coin, "gettransaction", [settle_txid])
                    conf2 = int(tx2.get("confirmations") or 0)
                except Exception as e:
                    log(f"swap {job_id}: erro RPC settle ({to_coin}) — {e}")
                    conf2 = int(achou.get("confirmations") or 0)
                    tx2 = achou
                cur.execute("""
                    UPDATE dbo.GN_SideshiftJobs
                    SET settle_txid_real = ?, settle_confirmacoes = ?
                    WHERE job_id = ?
                """, (settle_txid, conf2, job_id))
                if conf2 > 0:
                    set_em = unix_to_dt(tx2.get("blocktime")) or agora
                    cur.execute("""
                        UPDATE dbo.GN_SideshiftJobs
                        SET settle_confirmado = 1, settle_confirmado_em = ?
                        WHERE job_id = ?
                    """, (set_em, job_id))
                    mudou = True
                    log(f"swap {job_id}: liquidacao CONFIRMADA ({conf2} confirmacoes, "
                        f"1a confirmacao real em {set_em.isoformat()})")

        # --- status resumido + carimbo de checagem ---
        cur.execute("SELECT deposit_confirmado, settle_confirmado FROM dbo.GN_SideshiftJobs WHERE job_id = ?", (job_id,))
        dep_final, set_final = cur.fetchone()
        status = "liquidado" if set_final else ("deposito_confirmado" if dep_final else "pendente")
        cur.execute("""
            UPDATE dbo.GN_SideshiftJobs SET status_reconciliado = ?, atualizado_em = ? WHERE job_id = ?
        """, (status, agora, job_id))

        if mudou:
            atualizados += 1

    log(f"swaps: {atualizados} job(s) com alguma confirmacao nova nesta rodada")


def main():
    lock_fh = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("execucao anterior ainda rodando — pulando esta rodada")
        return 0

    inicio = time.time()
    log("=== inicio da reconciliacao ===")
    try:
        conn = conectar_sql()
    except Exception as e:
        log(f"falha ao conectar no SQL Server: {e}")
        return 1
    try:
        reconciliar_saques(conn)
        reconciliar_swaps(conn)
    except Exception as e:
        log(f"erro inesperado: {e}")
        return 1
    finally:
        conn.close()
    log(f"=== fim da reconciliacao ({time.time()-inicio:.1f}s) ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
