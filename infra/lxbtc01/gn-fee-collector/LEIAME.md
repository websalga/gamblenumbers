# gn-fee-collector

**PT:** mede quanto tempo cada transação esperou na fila do node, por taxa paga, nos nodes BTC (lxbtc01) e BCH (lxbch02).
A cada 5 s lê a mempool por RPC: transação nova grava a hora de entrada (campo `time` do próprio node, que sobrevive a
reinícios), taxa e tamanho; bloco novo marca as transações dele como confirmadas; o que some sem bloco é conferido no
txindex do node (confirmada com a hora do bloco) ou marcado como removida (substituída, expirada ou despejada).
Não precisa de ZMQ nem de reiniciar o node. Grava em `dbo.GN_FeeMempoolTx` e `dbo.GN_FeeBlocos`
(ver `infra/lsql2019/2026-10-18_gn_fee_coletor.sql`). Relatório: `EXEC dbo.GN_FeeTempoPorTaxa @coin='BTC', @blocos=144`.

**EN:** measures how long each transaction waited in the node queue, by fee paid, on the BTC (lxbtc01) and BCH (lxbch02)
nodes. Every 5 s it reads the mempool over RPC: a new transaction stores its entry time (the node's own `time` field, which
survives restarts), fee and size; a new block marks its transactions as confirmed; anything that disappears without a block is
checked against the node txindex (confirmed at the block time) or marked as removed (replaced, expired or evicted).
No ZMQ and no node restart needed. Writes to `dbo.GN_FeeMempoolTx` and `dbo.GN_FeeBlocos`
(see `infra/lsql2019/2026-10-18_gn_fee_coletor.sql`). Report: `EXEC dbo.GN_FeeTempoPorTaxa @coin='BTC', @blocos=144`.

## Instalação / install
```
mkdir -p /opt/gn-fee-collector /etc/gn-fee-collector
cp gn_fee_collector.py /opt/gn-fee-collector/
cp collector.env.example /etc/gn-fee-collector/collector.env && chmod 600 /etc/gn-fee-collector/collector.env   # editar / edit
cp gn-fee-collector.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now gn-fee-collector
```
Requer / requires: Python 3 + `python-tds` (pytds). No BCH troque `After=bitcoind.service` por `After=bitcoind-bch.service`.