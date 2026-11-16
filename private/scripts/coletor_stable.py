#!/usr/bin/env python3
"""GambleNumbers - coletor de cotacoes USDT e USDC (15/11/2026).

A cada 5 min (timer gn-cotacoes-stable) busca USDT e USDC em dolar (Kraken, Coinbase, Bitstamp) e em real
(Binance, OKX, Foxbit) e grava UMA linha por moeda em dbo.USDT_Snapshots / dbo.USDC_Snapshots (banco bitcoin, lsql2019).
- media_exchanges_usd = media das cotacoes em dolar (se nenhuma: media_brl / dolar 24 h)
- media_exchanges_brl = media das cotacoes diretas em real (se nenhuma: media_usd x dolar 24 h)
- usd_brl = dolar 24 h da FX_Snapshots (comercial de reserva), mesma base de BTC/BCH/ETH
Login SQL proprio (gn_cotacoes), senha em /etc/gamblenumbers/cotacoes.env (EnvironmentFile do systemd).
Uso: coletor_stable.py [--ensaio]   (--ensaio mostra e nao grava)
"""
import concurrent.futures as cf, json, os, re, sys, urllib.request
from decimal import Decimal

PRIVATE_DIR = "/usr/share/nginx/html/gamblenumbers/private"
UA = {"User-Agent": "Mozilla/5.0 (gn-cotacoes)"}


def http_json(url, t=8):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t) as r:
        return json.loads(r.read().decode("utf-8"))


def ler_vars_php(caminho):
    texto = open(caminho, "r", encoding="utf-8").read(); v = {}
    for m in re.finditer(r"\$(\w+)\s*=\s*'((?:[^'\\]|\\.)*)'\s*;", texto): v[m.group(1)] = m.group(2)
    for m in re.finditer(r"\$(\w+)\s*=\s*(\d+)\s*;", texto): v.setdefault(m.group(1), int(m.group(2)))
    return v


def conectar():
    import pyodbc
    cfg = ler_vars_php(f"{PRIVATE_DIR}/config.php")
    cs = ("DRIVER={ODBC Driver 18 for SQL Server};"
          f"SERVER={cfg['DB_SERVER']},{cfg['DB_PORT']};DATABASE={cfg['DB_DATABASE']};"
          f"UID={os.environ['GN_COT_SQL_USER']};PWD={os.environ['GN_COT_SQL_PASS']};"
          "Encrypt=yes;TrustServerCertificate=no;HostNameInCertificate=lsql2019;Connection Timeout=10")
    return pyodbc.connect(cs, autocommit=True)


def kraken(par): return list(http_json(f"https://api.kraken.com/0/public/Ticker?pair={par}")["result"].values())[0]["c"][0]
def coinbase(prod): return http_json(f"https://api.exchange.coinbase.com/products/{prod}/ticker")["price"]
def bitstamp(par): return http_json(f"https://www.bitstamp.net/api/v2/ticker/{par}/")["last"]
def binance(sym): return http_json(f"https://api.binance.com/api/v3/ticker/price?symbol={sym}")["price"]
def okx(inst): return http_json(f"https://www.okx.com/api/v5/market/ticker?instId={inst}")["data"][0]["last"]
def foxbit(m): return http_json(f"https://api.foxbit.com.br/rest/v3/markets/{m}/ticker/24hr")["data"][0]["last_trade"]["price"]

FONTES = {
    "USDT": {"usd_kraken": lambda: kraken("USDTUSD"), "usd_coinbase": lambda: coinbase("USDT-USD"),
             "usd_bitstamp": lambda: bitstamp("usdtusd"), "brl_binance": lambda: binance("USDTBRL"),
             "brl_okx": lambda: okx("USDT-BRL"), "brl_foxbit": lambda: foxbit("usdtbrl")},
    "USDC": {"usd_kraken": lambda: kraken("USDCUSD"), "usd_bitstamp": lambda: bitstamp("usdcusd"),
             "brl_binance": lambda: binance("USDCBRL"), "brl_okx": lambda: okx("USDC-BRL"),
             "brl_foxbit": lambda: foxbit("usdcbrl")},
}
COLS = ["usd_kraken", "usd_coinbase", "usd_bitstamp", "brl_binance", "brl_okx", "brl_foxbit"]


def dolar_24h(cur):
    cur.execute("""SELECT TOP 1 CASE WHEN usd_brl_24h>0 THEN usd_brl_24h ELSE usd_brl END,
        CASE WHEN usd_brl_24h>0 THEN 'usdt24h' ELSE 'comercial' END
        FROM dbo.FX_Snapshots WHERE ok=1 AND (usd_brl_24h>0 OR usd_brl>0) ORDER BY ts_utc DESC""")
    r = cur.fetchone()
    return (Decimal(str(r[0])), r[1]) if r else (None, None)


def linha(moeda, q, usd_brl, fonte_fx, err):
    """Monta a linha a gravar. q = {coluna: Decimal}. Descarta valores absurdos (lixo de API), nao o desvio de paridade."""
    for k in list(q):
        v = q[k]
        ref = Decimal(1) if k.startswith("usd_") else usd_brl
        if ref and not (ref * Decimal("0.5") < v < ref * Decimal("1.5")):
            err.append(f"{k}: {v} fora da faixa"); q.pop(k)
    usds = [q[k] for k in COLS if k.startswith("usd_") and k in q]
    brls = [q[k] for k in COLS if k.startswith("brl_") and k in q]
    m_usd = sum(usds) / len(usds) if usds else None
    m_brl = sum(brls) / len(brls) if brls else None
    if m_usd is None and m_brl is not None and usd_brl: m_usd = m_brl / usd_brl
    if m_brl is None and m_usd is not None and usd_brl: m_brl = m_usd * usd_brl
    q8 = lambda x: None if x is None else x.quantize(Decimal("0.00000001"))
    return [q8(q.get(k)) for k in COLS] + [usd_brl, fonte_fx, q8(m_usd), q8(m_brl), 1 if m_usd else 0,
                                          ("; ".join(err)[:2000] or None)]


def main():
    ensaio = "--ensaio" in sys.argv
    tarefas = {(m, k): f for m, fs in FONTES.items() for k, f in fs.items()}
    res, erros = {m: {} for m in FONTES}, {m: [] for m in FONTES}
    with cf.ThreadPoolExecutor(8) as ex:
        fut = {ex.submit(f): mk for mk, f in tarefas.items()}
        for f in cf.as_completed(fut):
            m, k = fut[f]
            try: res[m][k] = Decimal(str(f.result()))
            except Exception as e: erros[m].append(f"{k}: {str(e)[:120]}")
    con = conectar(); cur = con.cursor()
    usd_brl, fonte_fx = dolar_24h(cur)
    for m in FONTES:
        row = linha(m, res[m], usd_brl, fonte_fx, erros[m])
        print(f"{m} usd={row[8]} brl={row[9]} usd_brl={usd_brl} fontes={sum(1 for x in row[:6] if x is not None)} erros={len(erros[m])}"
              + (f" [{row[11]}]" if row[11] else ""), flush=True)
        if not ensaio:
            cur.execute(f"""INSERT INTO dbo.{m}_Snapshots (price_usd_kraken, price_usd_coinbase, price_usd_bitstamp,
                price_brl_binance, price_brl_okx, price_brl_foxbit, usd_brl, usd_brl_source, media_exchanges_usd,
                media_exchanges_brl, ok, err) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", row)
    con.close()


if __name__ == "__main__":
    main()
