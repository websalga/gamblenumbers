#!/usr/bin/env python3
"""GambleNumbers - historico retroativo de cotacoes (15/11/2026). Roda uma vez (pode repetir: nao duplica).

Preenche, de 5 em 5 min, desde 26/01/2026 02:00 UTC (inicio do historico de BTC/BCH) ate a primeira coleta ao vivo:
  USDT -> dbo.USDT_Snapshots   (USD: Coinbase, Bitstamp | BRL: Binance, OKX)
  USDC -> dbo.USDC_Snapshots   (USD: Bitstamp           | BRL: Binance, OKX)
  ETH  -> dbo.ETH_Snapshots    (USD: Binance ETHUSDT, Coinbase | BRL: Binance ETHBRL), origem='hist'
Kraken e Foxbit ficam de fora do historico (a API so devolve os ultimos dias).
Cada ponto usa o dolar 24 h DAQUELE MOMENTO (FX_Snapshots; comercial de reserva).
Linhas recebem id NEGATIVO (IDENTITY_INSERT) para nunca passarem na frente da coleta ao vivo em "ORDER BY id DESC".
Uso: historico_cotacoes.py USDT|USDC|ETH|todas [--ensaio]
"""
import bisect, datetime as dt, json, os, sys, time, urllib.request
from decimal import Decimal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from coletor_stable import conectar, UA

INICIO = int(dt.datetime(2026, 1, 26, 2, 0, tzinfo=dt.timezone.utc).timestamp())
P5 = 300


def http_json(url, t=20, tentativas=4):
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == tentativas - 1: raise
            print(f"  repetindo ({e}) {url[:90]}", flush=True); time.sleep(3 * (i + 1))


# Cada serie devolve {ts_fechamento_epoch: Decimal(close)}; ts = abertura do candle + 5 min
def s_binance(sym, ini, fim):
    out, t = {}, ini - P5
    while t < fim:
        k = http_json(f"https://api.binance.com/api/v3/klines?symbol={sym}&interval=5m&limit=1000&startTime={t*1000}")
        if not k: break
        for c in k: out[c[0] // 1000 + P5] = Decimal(c[4])
        t = k[-1][0] // 1000 + P5; time.sleep(0.1)
    return out


def s_bitstamp(par, ini, fim):
    out, t = {}, ini - P5
    while t < fim:
        d = http_json(f"https://www.bitstamp.net/api/v2/ohlc/{par}/?step=300&limit=1000&start={t}")["data"]["ohlc"]
        if not d: break
        for c in d: out[int(c["timestamp"]) + P5] = Decimal(c["close"])
        nt = int(d[-1]["timestamp"]) + P5
        if nt <= t: break
        t = nt; time.sleep(0.25)
    return out


def s_coinbase(prod, ini, fim):
    out, t = {}, ini - P5
    iso = lambda x: dt.datetime.fromtimestamp(x, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    while t < fim:
        e = min(t + 299 * P5, fim)
        for c in http_json(f"https://api.exchange.coinbase.com/products/{prod}/candles?granularity=300&start={iso(t)}&end={iso(e)}"):
            out[int(c[0]) + P5] = Decimal(str(c[4]))
        t = e + P5; time.sleep(0.2)
    return out


def s_okx(inst, ini, fim):
    out, after = {}, (fim + P5) * 1000
    while True:
        d = http_json(f"https://www.okx.com/api/v5/market/history-candles?instId={inst}&bar=5m&limit=100&after={after}")["data"]
        if not d: break
        for c in d: out[int(c[0]) // 1000 + P5] = Decimal(c[4])
        after = int(d[-1][0])
        if after // 1000 + P5 < ini: break
        time.sleep(0.12)
    return out


PLANO = {
    "USDT": {"usd_coinbase": (s_coinbase, "USDT-USD"), "usd_bitstamp": (s_bitstamp, "usdtusd"),
             "brl_binance": (s_binance, "USDTBRL"), "brl_okx": (s_okx, "USDT-BRL")},
    "USDC": {"usd_bitstamp": (s_bitstamp, "usdcusd"),
             "brl_binance": (s_binance, "USDCBRL"), "brl_okx": (s_okx, "USDC-BRL")},
    "ETH": {"usd_binance": (s_binance, "ETHUSDT"), "usd_coinbase": (s_coinbase, "ETH-USD"),
            "brl_binance": (s_binance, "ETHBRL")},
}


def carregar_fx(cur):
    cur.execute("""SELECT ts_utc, CASE WHEN usd_brl_24h>0 THEN usd_brl_24h ELSE usd_brl END,
        CASE WHEN usd_brl_24h>0 THEN 'hist:usdt24h' ELSE 'hist:comercial' END
        FROM dbo.FX_Snapshots WHERE ok=1 AND (usd_brl_24h>0 OR usd_brl>0) ORDER BY ts_utc""")
    rows = cur.fetchall()
    ts = [int(r[0].replace(tzinfo=dt.timezone.utc).timestamp()) for r in rows]
    return ts, [(Decimal(str(r[1])), r[2]) for r in rows]


def fx_em(fx, t):
    ts, val = fx
    i = bisect.bisect_right(ts, t) - 1
    return val[i] if i >= 0 else (val[0] if val else (None, None))


def processar(moeda, cur, fx, ensaio):
    tab = f"dbo.{moeda}_Snapshots"
    filtro_vivo = "origem IS NULL" if moeda == "ETH" else "origem='coleta'"
    cur.execute(f"SELECT MIN(ts_utc) FROM {tab} WHERE {filtro_vivo}")
    r = cur.fetchone()[0]
    fim = int(r.replace(tzinfo=dt.timezone.utc).timestamp()) if r else int(time.time())
    fim = fim - fim % P5 - P5           # ultimo ponto do historico: antes da primeira coleta ao vivo
    cur.execute(f"SELECT ts_utc FROM {tab} WHERE ts_utc >= ? AND ts_utc <= ?",
                dt.datetime.fromtimestamp(INICIO, dt.timezone.utc).replace(tzinfo=None),
                dt.datetime.fromtimestamp(fim + P5, dt.timezone.utc).replace(tzinfo=None))
    ja = {int(x[0].replace(tzinfo=dt.timezone.utc).timestamp()) // P5 * P5 for x in cur.fetchall()}
    print(f"{moeda}: de {dt.datetime.fromtimestamp(INICIO, dt.timezone.utc)} ate {dt.datetime.fromtimestamp(fim, dt.timezone.utc)} UTC; ja existem {len(ja)} pontos no intervalo", flush=True)
    series = {}
    for col, (f, par) in PLANO[moeda].items():
        t0 = time.time(); series[col] = f(par, INICIO, fim)
        print(f"  {col} {par}: {len(series[col])} candles em {time.time()-t0:.0f}s", flush=True)
    linhas = []
    for t in range(INICIO, fim + 1, P5):
        if t in ja: continue
        q = {c: s[t] for c, s in series.items() if t in s}
        if not q: continue
        usd_brl, fonte = fx_em(fx, t)
        usds = [v for c, v in q.items() if c.startswith("usd_")]
        brls = [v for c, v in q.items() if c.startswith("brl_")]
        if moeda == "ETH":
            m_usd = sum(usds) / len(usds) if usds else (brls[0] / usd_brl if brls and usd_brl else None)
            m_brl = m_usd * usd_brl if (m_usd and usd_brl) else None     # mesma regra do eth_sync.py
        else:
            m_usd = sum(usds) / len(usds) if usds else None
            m_brl = sum(brls) / len(brls) if brls else None
            if m_usd is None and m_brl is not None and usd_brl: m_usd = m_brl / usd_brl
            if m_brl is None and m_usd is not None and usd_brl: m_brl = m_usd * usd_brl
        if m_usd is None: continue
        linhas.append((t, q, usd_brl, fonte, m_usd, m_brl))
    print(f"  {len(linhas)} pontos novos", flush=True)
    if not linhas: return
    for t, q, ub, fo, mu, mb in (linhas[0], linhas[len(linhas)//2], linhas[-1]):
        print(f"  amostra {dt.datetime.fromtimestamp(t, dt.timezone.utc):%Y-%m-%d %H:%M} usd={mu:.6f} brl={mb:.6f} usd_brl={ub} {dict((k, str(v)) for k, v in q.items())}", flush=True)
    if ensaio: return
    cur.execute(f"SELECT ISNULL(MIN(id),1) FROM {tab}")
    base = min(int(cur.fetchone()[0]), 1) - len(linhas) - 1
    d6 = lambda x, n=8: None if x is None else x.quantize(Decimal(1).scaleb(-n))
    dados = []
    for i, (t, q, ub, fo, mu, mb) in enumerate(linhas):
        ts = dt.datetime.fromtimestamp(t, dt.timezone.utc).replace(tzinfo=None)
        if moeda == "ETH":
            dados.append((base + i, ts, d6(q.get("usd_binance"), 6), d6(q.get("usd_coinbase"), 6), d6(q.get("brl_binance"), 6),
                          d6(ub, 6), fo, d6(mu, 6), d6(mb, 6)))
        else:
            dados.append((base + i, ts, d6(q.get("usd_coinbase")), d6(q.get("usd_bitstamp")), d6(q.get("brl_binance")),
                          d6(q.get("brl_okx")), d6(ub, 6), fo, d6(mu), d6(mb)))
    if moeda == "ETH":
        sql = """INSERT INTO dbo.ETH_Snapshots (id, ts_utc, price_usd_binance, price_usd_coinbase, price_brl_binance,
                 usd_brl, usd_brl_source, media_exchanges_usd, media_exchanges_brl, ok, origem) VALUES (?,?,?,?,?,?,?,?,?,1,'hist')"""
    else:
        sql = f"""INSERT INTO {tab} (id, ts_utc, price_usd_coinbase, price_usd_bitstamp, price_brl_binance, price_brl_okx,
                 usd_brl, usd_brl_source, media_exchanges_usd, media_exchanges_brl, ok, origem) VALUES (?,?,?,?,?,?,?,?,?,?,1,'hist')"""
    con2 = conectar(); con2.autocommit = False; c2 = con2.cursor(); c2.fast_executemany = True
    c2.execute(f"SET IDENTITY_INSERT {tab} ON")
    for k in range(0, len(dados), 2000):
        c2.executemany(sql, dados[k:k + 2000])
    c2.execute(f"SET IDENTITY_INSERT {tab} OFF")
    con2.commit(); con2.close()
    print(f"  gravados {len(dados)} pontos em {tab} (ids {dados[0][0]} a {dados[-1][0]})", flush=True)


def main():
    alvo = (sys.argv[1] if len(sys.argv) > 1 else "").upper()
    moedas = list(PLANO) if alvo == "TODAS" else [alvo]
    if not set(moedas) <= set(PLANO): sys.exit("uso: historico_cotacoes.py USDT|USDC|ETH|todas [--ensaio]")
    con = conectar(); cur = con.cursor(); fx = carregar_fx(cur)
    print(f"FX_Snapshots: {len(fx[0])} pontos desde {dt.datetime.fromtimestamp(fx[0][0], dt.timezone.utc) if fx[0] else '-'}", flush=True)
    for m in moedas: processar(m, cur, fx, "--ensaio" in sys.argv)
    con.close()


if __name__ == "__main__":
    main()
