#!/usr/bin/env python3
"""gn-fee-collector: mede quanto tempo cada transação esperou na fila do node, por taxa paga.

A cada poucos segundos lê a mempool do node local (BTC ou BCH) por RPC:
  - transação nova na fila -> grava hora de entrada (campo `time` do próprio node), taxa e tamanho;
  - bloco novo -> marca as transações dele como confirmadas (saída = hora em que vimos o bloco);
  - transação que sumiu sem bloco -> marca como removida (substituída, expirada ou despejada).
Grava em dbo.GN_FeeMempoolTx e dbo.GN_FeeBlocos (SQL Server, banco bitcoin).
Configuração por variáveis de ambiente (ver /etc/gn-fee-collector/<coin>.env).
"""
import base64, json, logging, os, signal, statistics, sys, time, urllib.request
from datetime import datetime, timezone

import pytds

COIN = os.environ["GN_COIN"].upper()                    # BTC ou BCH
NODE_CONF = os.environ["GN_NODE_CONF"]                  # bitcoin.conf do node
NODE_DATADIR = os.environ.get("GN_NODE_DATADIR", "")    # para achar o .cookie
RPC_URL = os.environ.get("GN_RPC_URL", "http://127.0.0.1:8332/")
SQL_HOST = os.environ["GN_SQL_HOST"]
SQL_DB = os.environ.get("GN_SQL_DB", "bitcoin")
SQL_USER = os.environ["GN_SQL_USER"]
SQL_PASS = os.environ["GN_SQL_PASS"]
INTERVALO = float(os.environ.get("GN_INTERVALO_SEG", "5"))
RETENCAO_DIAS = int(os.environ.get("GN_RETENCAO_DIAS", "30"))
LOTE_RPC = 500

log = logging.getLogger("gn-fee-collector")
logging.getLogger("pytds").setLevel(logging.WARNING)
parar = False


def _sinal(*_):
    global parar
    parar = True


# ---------------- RPC ----------------
def credencial_rpc() -> str:
    user = pwd = None
    with open(NODE_CONF) as f:
        for linha in f:
            linha = linha.strip()
            if linha.startswith("rpcuser="):
                user = linha.split("=", 1)[1]
            elif linha.startswith("rpcpassword="):
                pwd = linha.split("=", 1)[1]
    if user and pwd:
        return f"{user}:{pwd}"
    with open(os.path.join(NODE_DATADIR, ".cookie")) as f:   # lido a cada chamada: muda quando o node reinicia
        return f.read().strip()


def rpc_lote(chamadas):
    """chamadas = [(metodo, params), ...] -> lista de resultados (None quando o node devolve erro)."""
    if not chamadas:
        return []
    corpo = json.dumps([{"jsonrpc": "1.0", "id": i, "method": m, "params": p}
                        for i, (m, p) in enumerate(chamadas)]).encode()
    req = urllib.request.Request(RPC_URL, data=corpo, headers={
        "Content-Type": "application/json",
        "Authorization": "Basic " + base64.b64encode(credencial_rpc().encode()).decode()})
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read())
    por_id = {x["id"]: x for x in resp}
    return [por_id[i]["result"] if por_id[i].get("error") is None else None for i in range(len(chamadas))]


def rpc(metodo, *params):
    r = rpc_lote([(metodo, list(params))])[0]
    if r is None:
        raise RuntimeError(f"RPC {metodo} falhou")
    return r


# ---------------- SQL ----------------
def conectar():
    return pytds.connect(server=SQL_HOST, database=SQL_DB, user=SQL_USER, password=SQL_PASS,
                         autocommit=True, login_timeout=15, timeout=120)


def utc(ts):
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)


def agora():
    return datetime.now(timezone.utc).replace(tzinfo=None).replace(microsecond=0)


def entrada_da(txid, e):
    """Linha para GN_FeeMempoolTx a partir de getmempoolentry (formatos Core e BCHN)."""
    tamanho = int(e.get("vsize") or e.get("size"))
    fee_sats = round(float(e["fees"]["base"]) * 1e8)
    return (COIN, txid, utc(e["time"]), fee_sats, tamanho,
            round(fee_sats / tamanho, 3), 1 if e.get("depends") else 0)


def inserir_varias(cur, tabela, linhas):
    """INSERT de várias linhas por comando (o SQL Server aceita até 2100 parâmetros e 1000 linhas)."""
    por_cmd = max(1, min(1000, 2000 // len(linhas[0])))
    marca = "(" + ",".join(["%s"] * len(linhas[0])) + ")"
    for i in range(0, len(linhas), por_cmd):
        lote = linhas[i:i + por_cmd]
        cur.execute(f"INSERT INTO {tabela} VALUES " + ",".join([marca] * len(lote)),
                    tuple(v for l in lote for v in l))


def gravar_novas(cur, linhas):
    if not linhas:
        return
    # via tabela temporária: evita duplicar se o coletor reiniciar no meio
    cur.execute("CREATE TABLE #n (coin char(3), txid char(64), entrada_utc datetime2(0), fee_sats bigint,"
                " tamanho_vb int, taxa_satvb decimal(12,3), tem_pais bit)")
    inserir_varias(cur, "#n", linhas)
    cur.execute("INSERT INTO dbo.GN_FeeMempoolTx (coin, txid, entrada_utc, fee_sats, tamanho_vb, taxa_satvb, tem_pais)"
                " SELECT n.coin, CONVERT(binary(32), n.txid, 2), n.entrada_utc, n.fee_sats, n.tamanho_vb, n.taxa_satvb, n.tem_pais"
                " FROM #n n WHERE NOT EXISTS (SELECT 1 FROM dbo.GN_FeeMempoolTx t"
                " WHERE t.coin = n.coin AND t.txid = CONVERT(binary(32), n.txid, 2))")
    cur.execute("DROP TABLE #n")


def marcar_saida(cur, txids, saida, motivo, altura=None):
    if not txids:
        return
    cur.execute("CREATE TABLE #s (txid char(64) PRIMARY KEY)")
    inserir_varias(cur, "#s", [(t,) for t in txids])
    cur.execute("UPDATE t SET saida_utc = %s, motivo_saida = %s, bloco_altura = %s"
                " FROM dbo.GN_FeeMempoolTx t JOIN #s s ON CONVERT(binary(32), s.txid, 2) = t.txid"
                " WHERE t.coin = %s AND t.saida_utc IS NULL", (saida, motivo, altura, COIN))
    cur.execute("DROP TABLE #s")


# ---------------- ciclo ----------------
class Coletor:
    def __init__(self):
        self.na_fila = {}          # txid -> taxa_satvb (o que está na fila agora e já foi gravado)
        self.melhor = None         # hash do último bloco processado
        self.ultima_limpeza = 0.0

    def sincronizar_fila(self, cur):
        txids = set(rpc("getrawmempool"))
        novos = [t for t in txids if t not in self.na_fila]
        linhas = []
        for i in range(0, len(novos), LOTE_RPC):
            lote = novos[i:i + LOTE_RPC]
            for t, e in zip(lote, rpc_lote([("getmempoolentry", [t]) for t in lote])):
                if e:                                  # None = saiu da fila entre as duas chamadas
                    linhas.append(entrada_da(t, e))
        gravar_novas(cur, linhas)
        for l in linhas:
            self.na_fila[l[1]] = float(l[5])
        return txids

    def processar_blocos(self, cur):
        melhor = rpc("getbestblockhash")
        if melhor == self.melhor:
            return
        if self.melhor is None:              # primeira volta: só registra o ponto de partida
            self.melhor = melhor
            return
        # percorre de trás para frente até o último bloco já processado (cobre mais de um bloco de uma vez)
        pendentes, h = [], melhor
        while h and h != self.melhor and len(pendentes) < 50:
            b = rpc("getblock", h, 1)
            pendentes.append(b)
            h = b.get("previousblockhash")
        visto = agora()
        for b in reversed(pendentes):
            txs = b["tx"][1:]                                  # sem a coinbase
            vistas = [t for t in txs if t in self.na_fila]
            taxas = sorted(self.na_fila[t] for t in vistas)
            marcar_saida(cur, vistas, visto, "confirmada", b["height"])
            for t in vistas:
                self.na_fila.pop(t, None)
            cur.execute("IF NOT EXISTS (SELECT 1 FROM dbo.GN_FeeBlocos WHERE coin=%s AND altura=%s AND hash=CONVERT(binary(32), %s, 2))"
                        " INSERT INTO dbo.GN_FeeBlocos (coin, altura, hash, hora_bloco_utc, visto_utc, qtd_tx,"
                        " qtd_tx_vistas, taxa_min_satvb, taxa_mediana_satvb, taxa_max_satvb, fila_qtd_depois)"
                        " VALUES (%s,%s,CONVERT(binary(32), %s, 2),%s,%s,%s,%s,%s,%s,%s,%s)",
                        (COIN, b["height"], b["hash"],
                         COIN, b["height"], b["hash"], utc(b["time"]), visto, len(txs), len(vistas),
                         taxas[0] if taxas else None, statistics.median(taxas) if taxas else None,
                         taxas[-1] if taxas else None, len(self.na_fila)))
            log.info("bloco %s: %d tx, %d vistas na fila", b["height"], len(txs), len(vistas))
        self.melhor = melhor

    def remover_sumidas(self, cur, txids_fila):
        sumidas = [t for t in self.na_fila if t not in txids_fila]
        if not sumidas:
            return
        # o que saiu da fila sem passar por processar_blocos (ex.: coletor parado) pode ter sido minerado:
        # o txindex dos nodes diz em que bloco entrou; nesse caso a saída é a hora do bloco
        por_bloco, removidas = {}, []
        for i in range(0, len(sumidas), LOTE_RPC):
            lote = sumidas[i:i + LOTE_RPC]
            for t, r in zip(lote, rpc_lote([("getrawtransaction", [t, True]) for t in lote])):
                if r and r.get("blockhash"):
                    por_bloco.setdefault(r["blockhash"], []).append(t)
                else:
                    removidas.append(t)
        for bh, txs in por_bloco.items():
            cab = rpc("getblockheader", bh)
            marcar_saida(cur, txs, utc(cab["time"]), "confirmada", cab["height"])
        marcar_saida(cur, removidas, agora(), "removida")
        for t in sumidas:
            self.na_fila.pop(t, None)

    def limpar(self, cur):
        if time.time() - self.ultima_limpeza < 3600:
            return
        cur.execute("DELETE FROM dbo.GN_FeeMempoolTx WHERE coin = %s AND entrada_utc < DATEADD(DAY, -%s, SYSUTCDATETIME())"
                    " AND saida_utc IS NOT NULL", (COIN, RETENCAO_DIAS))
        self.ultima_limpeza = time.time()

    def carregar_estado(self, cur):
        """Ao iniciar: o que ficou aberto no banco e não está mais na fila é tratado no primeiro ciclo."""
        cur.execute("SELECT LOWER(CONVERT(char(64), txid, 2)), taxa_satvb FROM dbo.GN_FeeMempoolTx WHERE coin = %s AND saida_utc IS NULL", (COIN,))
        for txid, taxa in cur.fetchall():
            self.na_fila[txid] = float(taxa)
        # retoma do último bloco gravado, para confirmar o que saiu da fila enquanto o coletor esteve parado
        cur.execute("SELECT TOP 1 LOWER(CONVERT(char(64), hash, 2)) FROM dbo.GN_FeeBlocos WHERE coin = %s ORDER BY altura DESC", (COIN,))
        r = cur.fetchone()
        if r:
            self.melhor = r[0]
        log.info("estado carregado: %d transações abertas, último bloco %s", len(self.na_fila), self.melhor)

    def ciclo(self, cur):
        # ordem importa: blocos antes de "sumidas", para confirmadas não virarem "removidas"
        self.processar_blocos(cur)
        txids = self.sincronizar_fila(cur)
        self.processar_blocos(cur)
        self.remover_sumidas(cur, txids)
        self.limpar(cur)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    signal.signal(signal.SIGTERM, _sinal)
    signal.signal(signal.SIGINT, _sinal)
    col, conn = Coletor(), None
    while not parar:
        try:
            if conn is None:
                conn = conectar()
                col.carregar_estado(conn.cursor())
            col.ciclo(conn.cursor())
        except Exception as e:                       # node reiniciando, SQL fora etc.: tenta de novo
            log.warning("falha no ciclo: %s", e)
            try:
                conn and conn.close()
            except Exception:
                pass
            conn = None
            col = Coletor()
            time.sleep(30)
            continue
        time.sleep(INTERVALO)


if __name__ == "__main__":
    main()
