"""
avaliar_previsoes.py — mede, contra a cotacao REALIZADA, o quanto cada ponto previsto
pelo motor errou. Chama forecast.usp_AvaliarPrevisoes (idempotente: so' acrescenta em
forecast.Coverage o que ainda nao foi avaliado). Roda a cada 5 minutos via
forecast-avaliador.timer, logo depois do forecast-engine.timer.

Uso manual:  venv/bin/python avaliar_previsoes.py            # janela padrao (2 dias)
             venv/bin/python avaliar_previsoes.py --dias 30  # backfill
O ranking dos modelos fica em forecast.vw_Precisao_Modelos / vw_Precisao_Diaria.

Uma vez por hora (minutos 10-14 UTC) tambem chama forecast.usp_AvaliarPromocao, que decide se algum
modelo em sombra assume o lugar do publicado (criterios em forecast.Config; auditoria em forecast.Promocoes).
Forcar agora: --promocao
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymssql


def _load_env(p):
    d = {}
    for line in Path(p).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        d[k] = v
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=2, help="janela de alvos a avaliar (1..90)")
    ap.add_argument("--promocao", action="store_true", help="avalia a promocao de modelos agora (por padrao, 1x por hora)")
    args = ap.parse_args()

    env = _load_env(Path(__file__).parent / ".env")
    conn = pymssql.connect(
        server=env["FORECAST_DB_SERVER"], port=int(env["FORECAST_DB_PORT"]),
        user=env["FORECAST_WRITER_USER"], password=env["FORECAST_WRITER_PASS"],
        database=env["FORECAST_DB_NAME"], autocommit=True,
    )
    try:
        cur = conn.cursor(as_dict=True)
        cur.execute("DECLARE @n INT; EXEC forecast.usp_AvaliarPrevisoes @dias = %d, @avaliadas = @n OUTPUT; SELECT @n AS n;",
                    (args.dias,))
        n = cur.fetchone()["n"]
        print(f"pontos avaliados: {n} (janela {args.dias}d)")

        if args.promocao or 10 <= datetime.now(timezone.utc).minute <= 14:
            cur.execute("EXEC forecast.usp_AvaliarPromocao")
            linhas = cur.fetchall() if cur.description else []
            promovidos = [r for r in linhas if r.get("escolhido")]
            print(f"promocao: {len(linhas)} candidatos avaliados, {len(promovidos)} elegiveis")
            for r in promovidos:
                print(f"  -> {r['ativo']} {r['horizonte_min']}min: {r['cand_modelo']} sobre {r['pub_modelo']} ({r['melhora_pct']:.2f}%)")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
