#!/usr/bin/env python3
"""
Backfill de usd_jpy, usd_cny, usd_try, usd_rub em dbo.FX_Snapshots.

Executado UMA VEZ em 2026-08-16 para preencher o histórico desde 2026-01-26
nas linhas que já tinham usd_brl/eur/gbp mas não as 4 novas moedas.

Fontes:
  JPY / CNY / TRY : Frankfurter API (ECB historical, dias úteis) + forward-fill
  RUB             : constante = taxa mais recente já gravada no banco
                    (ECB/Frankfurter não publica RUB após sanções de 2022;
                    a partir daqui o coletor coleta RUB via open.er-api.com)

Idempotente: só atualiza linhas onde usd_jpy IS NULL.
"""
import os, json, pyodbc, urllib.request
from datetime import date, timedelta

SQL_SERVER_CONN_STR = os.environ.get("MSSQL_CONN_STR", (
    "DRIVER={ODBC Driver 18 for SQL Server};"
    "SERVER=localhost;DATABASE=bitcoin;UID=sa;"
    "PWD=<CONFIGURAR_VIA_ENV_MSSQL_CONN_STR>;"
    "Encrypt=yes;TrustServerCertificate=yes;"
))

FRANKFURTER_URL = "https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=JPY,CNY,TRY"

def fetch_frankfurter(start: str, end: str) -> dict:
    url = FRANKFURTER_URL.format(start=start, end=end)
    req = urllib.request.Request(url, headers={"User-Agent": "fx-backfill/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()).get("rates", {})

def build_daily_map(raw: dict, start: date, end: date) -> dict:
    """Forward-fill: fins de semana e feriados herdam o último valor disponível."""
    result, last = {}, {"JPY": None, "CNY": None, "TRY": None}
    cur = start
    while cur <= end:
        ds = str(cur)
        if ds in raw:
            for k in last:
                if k in raw[ds]:
                    last[k] = raw[ds][k]
        result[ds] = dict(last)
        cur += timedelta(days=1)
    return result

def main():
    conn   = pyodbc.connect(SQL_SERVER_CONN_STR)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT MIN(CAST(ts_utc AS DATE)), MAX(CAST(ts_utc AS DATE))
        FROM dbo.FX_Snapshots WHERE ok = 1 AND usd_jpy IS NULL
    """)
    row = cursor.fetchone()
    if not row or not row[0]:
        print("Nada para fazer — usd_jpy já preenchido em todas as linhas.")
        conn.close(); return

    start_date = date.fromisoformat(str(row[0]))
    end_date   = date.fromisoformat(str(row[1]))
    print(f"Range do backfill: {start_date} → {end_date}")

    cursor.execute("SELECT TOP 1 usd_rub FROM dbo.FX_Snapshots WHERE usd_rub IS NOT NULL ORDER BY ts_utc DESC")
    rub_row  = cursor.fetchone()
    rub_rate = float(rub_row[0]) if rub_row else 83.5747
    print(f"Taxa RUB constante (fallback histórico): {rub_rate}")

    print("Buscando Frankfurter (ECB historical)...")
    raw   = fetch_frankfurter(str(start_date), str(end_date))
    daily = build_daily_map(raw, start_date, end_date)
    print(f"  {len(raw)} dias úteis + forward-fill → {sum(1 for v in daily.values() if v['JPY']) } dias cobertos")

    total = 0
    for ds, rates in sorted(daily.items()):
        jpy, cny, try_ = rates.get("JPY"), rates.get("CNY"), rates.get("TRY")
        if jpy is None:
            continue
        cursor.execute("""
            UPDATE dbo.FX_Snapshots
            SET usd_jpy=?, usd_cny=?, usd_try=?, usd_rub=?
            WHERE CAST(ts_utc AS DATE)=? AND ok=1 AND usd_jpy IS NULL
        """, (jpy, cny, try_, rub_rate, ds))
        total += cursor.rowcount

    conn.commit()
    conn.close()
    print(f"CONCLUÍDO: {total} linhas atualizadas.")

if __name__ == "__main__":
    main()
