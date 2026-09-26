#!/usr/bin/env python3
"""Coleta a cotacao BTC/USD do Morningstar (via Google Finance) e grava em dbo.snapshots.price_usd_morningstar.
Uso: coletar_morningstar.py            -> grava na linha de snapshot mais recente (ultimos 8 min) que ainda nao tem valor
     coletar_morningstar.py --probe    -> so le e imprime (nao grava)

Producao: lsql2019, /root/coletar_morningstar.py, coletar-morningstar.service + .timer (OnUnitActiveSec=1min).
A conexao SQL vem do atualizar_cotacoes.py (mesma da importacao dos snapshots); nenhuma credencial neste arquivo."""
import re, sys, importlib.util, urllib.request, pyodbc

def conn():
    spec = importlib.util.spec_from_file_location('atualizar_cotacoes', '/root/atualizar_cotacoes.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return pyodbc.connect(m.SQL_SERVER_CONN_STR)

def ler_morningstar():
    req = urllib.request.Request('https://www.google.com/finance/quote/BTC-USD?hl=en',
        headers={'User-Agent': 'Mozilla/5.0 (compatible; GambleNumbers/1.0)', 'Accept-Language': 'en-US,en;q=0.9'})
    h = urllib.request.urlopen(req, timeout=10).read().decode('utf-8', 'replace')
    m = re.search(r'Bitcoin / United States Dollar.*?<span[^>]*>\s*([0-9][0-9,]*\.[0-9]+)\s*</span>', h, re.S)
    if not m: raise RuntimeError('preco nao encontrado na pagina')
    v = float(m.group(1).replace(',', ''))
    if v <= 0: raise RuntimeError('preco invalido')
    return v

if __name__ == '__main__':
    v = ler_morningstar()
    c = conn(); cur = c.cursor()
    if '--probe' in sys.argv:
        cur.execute("SELECT TOP 1 id, ts_utc, price_usd_binance, price_usd_kraken, price_usd_coinbase, media_exchanges_usd, SYSUTCDATETIME() FROM dbo.snapshots WHERE ok=1 ORDER BY ts_utc DESC")
        print(v, [str(x) for x in cur.fetchone()])
    else:
        cur.execute("""
SET NOCOUNT ON;
DECLARE @id BIGINT = (SELECT TOP 1 id FROM dbo.snapshots WHERE ok=1 AND price_usd_morningstar IS NULL
                      AND ts_utc >= DATEADD(MINUTE,-8,SYSUTCDATETIME()) ORDER BY ts_utc DESC);
IF @id IS NOT NULL
BEGIN
  BEGIN TRAN;
  UPDATE dbo.snapshots SET price_usd_morningstar = ?,
         price_brl_morningstar = CASE WHEN usd_brl IS NOT NULL THEN CAST(? * usd_brl AS DECIMAL(19,6))
                                      WHEN media_exchanges_usd > 0 THEN CAST(? * media_exchanges_brl / media_exchanges_usd AS DECIMAL(19,6)) END
   WHERE id = @id;
  -- A Media passa a ser a media das 4 cotacoes (Binance, Kraken, Coinbase e Morningstar). Guarda a media de 3 (auditoria/reversao e
  -- garantia de que cada linha e' convertida uma unica vez) e aplica o fator (3 + Morningstar/Media3)/4 a todas as moedas da linha.
  INSERT INTO dbo.snapshots_media3 (id, media_exchanges_usd, media_exchanges_brl, media_exchanges_eur, media_exchanges_gbp)
  SELECT id, media_exchanges_usd, media_exchanges_brl, media_exchanges_eur, media_exchanges_gbp FROM dbo.snapshots
   WHERE id=@id AND media_exchanges_brl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.snapshots_media3 m WHERE m.id=@id);
  IF @@ROWCOUNT > 0
    UPDATE s SET
      media_exchanges_usd = CAST(media_exchanges_usd * f.k AS DECIMAL(19,6)), media_exchanges_brl = CAST(media_exchanges_brl * f.k AS DECIMAL(19,6)),
      media_exchanges_eur = CAST(media_exchanges_eur * f.k AS DECIMAL(19,6)), media_exchanges_gbp = CAST(media_exchanges_gbp * f.k AS DECIMAL(19,6))
    FROM dbo.snapshots s CROSS APPLY (SELECT (3.0 + CASE WHEN s.media_exchanges_usd > 0 AND s.price_usd_morningstar IS NOT NULL THEN s.price_usd_morningstar / s.media_exchanges_usd
                                                        WHEN s.media_exchanges_brl > 0 AND s.price_brl_morningstar IS NOT NULL THEN s.price_brl_morningstar / s.media_exchanges_brl END) / 4.0 AS k) f
    WHERE s.id=@id AND f.k IS NOT NULL;
  COMMIT;
END
SELECT @id;""", v, v, v)
        r = cur.fetchone(); print('linha', r[0] if r else None)
        print('gravado', v); c.commit()
