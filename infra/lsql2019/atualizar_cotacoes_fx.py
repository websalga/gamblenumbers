#!/usr/bin/env python3
"""
Migra registros novos de fx_advisor_backup.sqlite → dbo.FX_Snapshots (SQL Server).
Executado a cada 3 min pelo systemd (atualizar-cotacoes-fx.timer) no lsql2019.
Credenciais via variável de ambiente MSSQL_CONN_STR ou arquivo .env local.

Pipeline completo:
  LXBTC01: collector_fx.py → fx_advisor.sqlite
        → backup_and_copy_fx.sh (SCP) → lsql2019:/root/fx_advisor_backup.sqlite
  lsql2019: este script → dbo.FX_Snapshots (bitcoin DB)
"""
import os, sqlite3, pyodbc

SQLITE_PATH = os.environ.get("FX_SQLITE_PATH", "fx_advisor_backup.sqlite")

# Configurar via variável de ambiente MSSQL_CONN_STR ou editar localmente.
# Exemplo: export MSSQL_CONN_STR="DRIVER=...;SERVER=localhost;DATABASE=bitcoin;UID=sa;PWD=xxx;..."
SQL_SERVER_CONN_STR = os.environ.get("MSSQL_CONN_STR", (
    "DRIVER={ODBC Driver 18 for SQL Server};"
    "SERVER=localhost;"
    "DATABASE=bitcoin;"
    "UID=sa;"
    "PWD=<CONFIGURAR_VIA_ENV_MSSQL_CONN_STR>;"
    "Encrypt=yes;"
    "TrustServerCertificate=yes;"
))

def main():
    lite_conn   = sqlite3.connect(SQLITE_PATH)
    lite_cursor = lite_conn.cursor()

    ss_conn   = pyodbc.connect(SQL_SERVER_CONN_STR)
    ss_cursor = ss_conn.cursor()

    ss_cursor.execute("SELECT ISNULL(MAX(id), 0) FROM dbo.FX_Snapshots")
    ultimo_id = ss_cursor.fetchone()[0]

    lite_cursor.execute("""
        SELECT id, ts_utc, usd_brl, usd_eur, usd_gbp,
               usd_jpy, usd_cny, usd_try, usd_rub,
               source, ok, err
        FROM fx_snapshots WHERE id > ? ORDER BY id ASC
    """, (ultimo_id,))
    rows = lite_cursor.fetchall()

    if not rows:
        print(f"OK: FX_Snapshots já atualizado até o ID {ultimo_id}.")
        lite_conn.close(); ss_conn.close()
        return

    print(f"Encontrados {len(rows)} novos registros FX. Iniciando migração...")

    ss_cursor.execute("SET IDENTITY_INSERT dbo.FX_Snapshots ON")
    insert_sql = """
        INSERT INTO dbo.FX_Snapshots
            (id, ts_utc, usd_brl, usd_eur, usd_gbp,
             usd_jpy, usd_cny, usd_try, usd_rub, source, ok, err)
        VALUES
            (?, TRY_CAST(REPLACE(LEFT(?, 19), 'T', ' ') AS DATETIME),
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    chunk_size = 500
    total = 0
    for i in range(0, len(rows), chunk_size):
        chunk = [
            (r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11])
            for r in rows[i:i+chunk_size]
        ]
        ss_cursor.executemany(insert_sql, chunk)
        ss_conn.commit()
        total += len(chunk)
        print(f"Progresso FX: {total}/{len(rows)}...")

    ss_cursor.execute("SET IDENTITY_INSERT dbo.FX_Snapshots OFF")
    ss_conn.commit()
    print(f"SUCESSO: {total} registros FX migrados.")

    lite_conn.close()
    ss_conn.close()

if __name__ == "__main__":
    main()
