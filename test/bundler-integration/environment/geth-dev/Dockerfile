FROM ethereum/client-go:latest
ENTRYPOINT geth \
      --http.vhosts '*,localhost,host.docker.internal' \
      --http \
      --http.api personal,eth,net,web3,debug \
      --http.corsdomain '*' \
      --http.addr "0.0.0.0" \
      --nodiscover --maxpeers 0 --mine \
      --networkid 1337 \
      --dev \
      --allow-insecure-unlock \
      --rpc.allow-unprotected-txs \
      --dev.gaslimit 200000000 \