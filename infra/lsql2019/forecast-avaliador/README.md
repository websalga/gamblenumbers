# forecast-avaliador (lsql2019)

Mede continuamente o erro do motor de previsao contra a cotacao realizada.
Instalado em `/home/claude/forecast-engine/avaliar_previsoes.py` + unidades systemd
`forecast-avaliador.service/.timer` (a cada 5 min, 2 min depois do `forecast-engine.timer`).
SQL: `docs/forecast_avaliacao.sql`. Ranking: `forecast.vw_Precisao_Modelos`.

O motor completo (run_forecast.py com modelo publicado + concorrentes em sombra, modelos_previsao.py,
backtest_modelos.py) fica em `/home/claude/forecast-engine` no lsql2019, versionado com git local
(sem o `.env`). Modelos em sombra e promocao automatica: `docs/forecast_modelos_promocao.sql`.
