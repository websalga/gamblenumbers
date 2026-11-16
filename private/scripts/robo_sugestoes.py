#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
robo_sugestoes.py  (GambleNumbers, 13/11/2026)
==============================================
Observa as VENDAS DOS ROBOS (dbo.GN_SimVendas) e, quando o LUCRO REALIZADO ACUMULADO de um perfil em
modo real passa do limiar, cria uma SUGESTAO em dbo.GN_RoboSugestoes: "converter R$ X do lucro em USDC".

  - So OBSERVA e grava a sugestao. NAO mexe em robos, lotes, saldos, carteiras, nem envia nada.
  - Quem decide e o dono, no app, com a digital (a tela vem depois). Este script nunca troca nada.
  - So perfis ativos em modo_real=1 e com robo ativo. Perfis de simulacao nunca geram sugestao.
  - Marca d'agua por perfil (venda_id_ate): a 1a vez grava uma linha 'base' no maior id atual, para nao
    sugerir sobre o historico. Cada sugestao consome as vendas ate o id considerado.
  - Idempotente, com lock (nunca roda duas vezes ao mesmo tempo). Argumentos: --dry (so imprime).
  - Status 'ensaio' enquanto GN_ROBO_SUG_MODO != 'pendente': a sugestao fica registrada mas nao aparece no app.
"""
import datetime, fcntl, json, os, re, sys

import pyodbc

BASE_DIR = "/usr/share/nginx/html/gamblenumbers"
PRIVATE_DIR = f"{BASE_DIR}/private"
LOG_FILE = f"{PRIVATE_DIR}/logs/robo_sugestoes.log"
LOCK_FILE = f"{PRIVATE_DIR}/cache/robo_sugestoes.lock"

LIMIAR_BRL = float(os.environ.get("GN_ROBO_SUG_LIMIAR_BRL", "300"))        # lucro realizado acumulado que dispara a sugestao
PADRAO_VALIDADE_MIN = {"BTC": 240, "BCH": 60}   # validade da sugestao por moeda (minutos); cada robo pode mudar em config_json.sug_validade_min
MODO = os.environ.get("GN_ROBO_SUG_MODO", "ensaio")                        # 'ensaio' (so registra) | 'pendente' (aparece no app)


def log(msg):
    linha = f"{datetime.datetime.now(datetime.timezone.utc).isoformat()} {msg}"
    print(linha)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f: f.write(linha + "\n")
    except OSError: pass


def ler_vars_php(caminho):
    texto = open(caminho, "r", encoding="utf-8").read(); v = {}
    for m in re.finditer(r"\$(\w+)\s*=\s*'((?:[^'\\]|\\.)*)'\s*;", texto): v[m.group(1)] = m.group(2).replace("\\'", "'")
    for m in re.finditer(r"\$(\w+)\s*=\s*(\d+)\s*;", texto): v.setdefault(m.group(1), int(m.group(2)))
    return v


CFG = ler_vars_php(f"{PRIVATE_DIR}/config.php")


def conectar():
    cs = ("DRIVER={ODBC Driver 18 for SQL Server};" f"SERVER={CFG['DB_SERVER']},{CFG['DB_PORT']};DATABASE={CFG['DB_DATABASE']};"
          f"UID={CFG['DB_USER']};PWD={CFG['DB_PASSWORD']};"
          "Encrypt=yes;TrustServerCertificate=no;HostNameInCertificate=lsql2019;Connection Timeout=10")
    return pyodbc.connect(cs, autocommit=True)


def validade_minutos(cur, sid, robos):
    """Validade (min) da sugestao = a MENOR entre os robos que a geraram: parametro sug_validade_min do robo ou o padrao da moeda."""
    vals = []
    for rb in robos:
        cur.execute("SELECT moeda, config_json FROM dbo.GN_Robos WHERE session_id=? AND robo_client_id=?", sid, rb)
        r = cur.fetchone()
        if not r: vals.append(60); continue                    # robo apagado: usa o prazo curto
        v = None
        try: v = int(json.loads(r.config_json).get("sug_validade_min")) if r.config_json else None
        except Exception: v = None
        vals.append(v if v and 5 <= v <= 1440 else PADRAO_VALIDADE_MIN.get(r.moeda, 240))
    return min(vals) if vals else 60


def processar(conn, dry):
    cur = conn.cursor()
    # 1) expira o que ficou pendente alem da validade
    if not dry:
        cur.execute("UPDATE dbo.GN_RoboSugestoes SET status='expirada', decidido_em=SYSUTCDATETIME() "
                    "WHERE status IN ('pendente','ensaio') AND expira_em < SYSUTCDATETIME()")
    # 2) perfis elegiveis: ativos, modo real e com robo ativo
    cur.execute("""SELECT u.session_id FROM dbo.GN_Usuarios u
                   WHERE u.ativo=1 AND u.modo_real=1 AND EXISTS (SELECT 1 FROM dbo.GN_Robos r WHERE r.session_id=u.session_id AND r.ativo=1)""")
    perfis = [r[0] for r in cur.fetchall()]
    for sid in perfis:
        cur.execute("SELECT TOP 1 id, tipo, status, venda_id_ate FROM dbo.GN_RoboSugestoes WHERE session_id=? ORDER BY id DESC", sid)
        ult = cur.fetchone()
        cur.execute("SELECT ISNULL(MAX(id),0) FROM dbo.GN_SimVendas WHERE session_id=?", sid)
        max_id = int(cur.fetchone()[0])
        if ult is None:
            log(f"{sid[:8]}: primeira vez; marca d'agua = venda {max_id} (nao sugere sobre o historico)")
            if not dry:
                cur.execute("INSERT INTO dbo.GN_RoboSugestoes (session_id, tipo, status, venda_id_ate) VALUES (?, 'base', 'base', ?)", sid, max_id)
            continue
        if ult.status in ('pendente', 'ensaio'):
            continue                                            # ja ha uma aguardando decisao: nao empilha
        marca = int(ult.venda_id_ate)
        cur.execute("""SELECT COUNT(*), ISNULL(SUM(CAST(pnl AS float)),0), ISNULL(MAX(id),?), STRING_AGG(robo_client_id, ',')
                       FROM (SELECT DISTINCT id, pnl, robo_client_id FROM dbo.GN_SimVendas
                             WHERE session_id=? AND id>? AND robo_client_id IS NOT NULL AND status='executed' AND ISNULL(excluido,0)=0) x""", marca, sid, marca)
        n, lucro, ate, robos = cur.fetchone()
        lucro = round(float(lucro), 2)
        log(f"{sid[:8]}: {n} venda(s) de robo apos a marca {marca}, lucro realizado acumulado R$ {lucro:.2f} (limiar R$ {LIMIAR_BRL:.2f})")
        if n == 0 or lucro < LIMIAR_BRL:
            continue
        lista = sorted(set((robos or "").split(",")))
        nomes = ",".join(lista)[:200]
        val_min = validade_minutos(cur, sid, lista)
        exp = datetime.datetime.utcnow() + datetime.timedelta(minutes=val_min)
        log(f"{sid[:8]}: SUGESTAO ({MODO}) converter R$ {lucro:.2f} em USDC; robos {nomes}; vendas ate {ate}; validade {val_min} min")
        if not dry:
            cur.execute("""INSERT INTO dbo.GN_RoboSugestoes (session_id, tipo, status, lucro_brl, valor_brl, n_vendas, robos, venda_id_ate, expira_em)
                           VALUES (?, 'vender_usdc', ?, ?, ?, ?, ?, ?, ?)""", sid, MODO, lucro, lucro, int(n), nomes, int(ate), exp)


def main():
    dry = "--dry" in sys.argv
    lock = open(LOCK_FILE, "w")
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError: print("ja em execucao"); return
    try:
        conn = conectar()
        processar(conn, dry)
        conn.close()
    except Exception as e:
        log(f"ERRO: {e}"); sys.exit(1)


if __name__ == "__main__":
    main()
