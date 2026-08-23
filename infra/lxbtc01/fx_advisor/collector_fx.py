#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Coletor de câmbio multi-moeda — USD → BRL, EUR, GBP, JPY, CNY, TRY, RUB.
Independente dos coletores de BTC/BCH. Mesmo padrão de resiliência
(cache SQLite, retry exponencial, fallback para API secundária).

Deploy: LXBTC01 — /home/bitcoin/fx_advisor/
Serviço: fx-advisor-collector.timer (systemd, a cada 5 min)
Saída:   fx_advisor.sqlite  →  copiado via SCP para lsql2019 pelo
         backup_and_copy_fx.sh, onde atualizar_cotacoes_fx.py migra
         os registros novos para dbo.FX_Snapshots no SQL Server.
"""
import os, json, time, sqlite3, urllib.request, urllib.error
from datetime import datetime, timezone

DB_PATH           = os.environ.get("FX_ADVISOR_DB", "/home/bitcoin/fx_advisor/fx_advisor.sqlite")
CACHE_MAX_AGE_SEC = int(os.environ.get("CACHE_MAX_AGE_SEC", "21600"))  # 6 h

FX_URL_PRIMARY = "https://open.er-api.com/v6/latest/USD"
FX_URL_BACKUP  = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL,EUR,GBP,JPY,CNY,TRY,RUB"

DDL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS fx_snapshots (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_utc  TEXT NOT NULL,
    usd_brl REAL,
    usd_eur REAL,
    usd_gbp REAL,
    usd_jpy REAL,
    usd_cny REAL,
    usd_try REAL,
    usd_rub REAL,
    source  TEXT,
    ok      INTEGER NOT NULL DEFAULT 1,
    err     TEXT
);
CREATE INDEX IF NOT EXISTS ix_fx_snapshots_ts ON fx_snapshots(ts_utc);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
"""

def kv_get(conn, key, default=""):
    cur = conn.execute("SELECT v FROM kv WHERE k = ?", (key,))
    row = cur.fetchone()
    return row[0] if row else default

def kv_set(conn, key, value):
    conn.execute("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (key, value))

def cache_set(conn, key, value):
    kv_set(conn, key, f"{value}")
    kv_set(conn, key + "_epoch", str(int(time.time())))
    conn.commit()

def cache_get(conn, key, max_age_sec):
    v = kv_get(conn, key, "")
    if not v:
        return None
    try:
        epoch = int(kv_get(conn, key + "_epoch", "0") or "0")
        if epoch <= 0 or (int(time.time()) - epoch) > max_age_sec:
            return None
        return float(v)
    except Exception:
        return None

def fetch_json(url, timeout=10, retries=3, label=""):
    req = urllib.request.Request(url, headers={"User-Agent": "fx-advisor"})
    last_err = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", errors="replace"))
        except Exception as e:
            last_err = RuntimeError(f"{label} erro: {e}")
            if attempt < retries:
                time.sleep(2 ** attempt)
    raise last_err

def get_rates():
    try:
        data  = fetch_json(FX_URL_PRIMARY, label="fx_primary")
        rates = data.get("rates", {}) or {}
        return (float(rates["BRL"]), float(rates["EUR"]), float(rates["GBP"]),
                float(rates["JPY"]), float(rates["CNY"]), float(rates["TRY"]),
                float(rates["RUB"]), "open.er-api")
    except Exception:
        pass
    data  = fetch_json(FX_URL_BACKUP, label="fx_backup")
    rates = data.get("rates", {}) or {}
    return (float(rates["BRL"]), float(rates["EUR"]), float(rates["GBP"]),
            float(rates["JPY"]), float(rates.get("CNY", 0)), float(rates["TRY"]),
            float(rates["RUB"]), "frankfurter")

def main():
    ts = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(DDL)
    conn.commit()

    # Migrar colunas novas em bases SQLite pré-existentes (idempotente)
    for col in ("usd_jpy", "usd_cny", "usd_try", "usd_rub"):
        try:
            conn.execute(f"ALTER TABLE fx_snapshots ADD COLUMN {col} REAL")
            conn.commit()
        except Exception:
            pass  # coluna já existe

    try:
        brl, eur, gbp, jpy, cny, try_, rub, source = get_rates()
        for k, v in [("brl", brl), ("eur", eur), ("gbp", gbp),
                     ("jpy", jpy), ("cny", cny), ("try", try_), ("rub", rub)]:
            cache_set(conn, f"cache_{k}", v)
        kv_set(conn, "cache_source", source); conn.commit()
        ok, err = 1, None
    except Exception as e:
        brl   = cache_get(conn, "cache_brl", CACHE_MAX_AGE_SEC)
        eur   = cache_get(conn, "cache_eur", CACHE_MAX_AGE_SEC)
        gbp   = cache_get(conn, "cache_gbp", CACHE_MAX_AGE_SEC)
        jpy   = cache_get(conn, "cache_jpy", CACHE_MAX_AGE_SEC)
        cny   = cache_get(conn, "cache_cny", CACHE_MAX_AGE_SEC)
        try_  = cache_get(conn, "cache_try", CACHE_MAX_AGE_SEC)
        rub   = cache_get(conn, "cache_rub", CACHE_MAX_AGE_SEC)
        source = kv_get(conn, "cache_source", "cache")
        ok  = 1 if (brl and eur and gbp) else 0
        err = str(e) if ok == 0 else f"fonte principal falhou, usando cache: {e}"

    conn.execute(
        "INSERT INTO fx_snapshots"
        "(ts_utc, usd_brl, usd_eur, usd_gbp, usd_jpy, usd_cny, usd_try, usd_rub, source, ok, err)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (ts, brl, eur, gbp, jpy, cny, try_, rub, source, ok, err)
    )
    conn.commit()
    conn.close()

if __name__ == "__main__":
    main()
