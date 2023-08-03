#!/bin/bash

SCRIPT=$(realpath $0)
SCRIPT_PATH=$(dirname $SCRIPT)
COMPOSE_FILE_PATH=$SCRIPT_PATH/../test/bundler-integration/docker-compose.yml

docker compose -f $COMPOSE_FILE_PATH down

echo "⚙️  1. Launching geth...."
docker compose -f $COMPOSE_FILE_PATH up geth-dev -d

echo "⚙️  2. Deploying Entrypoint..."
npx hardhat run test/bundler-integration/deployEntrypoint.ts --network local

echo "⚙️  3. Launching Bundler..."
docker compose -f $COMPOSE_FILE_PATH up bundler -d

echo "⚙️  4. Waiting for Bundler to start..."
URL="http://localhost:3000"
JSON_DATA='{
  "jsonrpc": "2.0",
  "method": "web3_clientVersion",
  "params": []
}'
while true; do
  RESPONSE_CODE=$(curl --write-out '%{http_code}' --silent --output /dev/null --header "Content-Type: application/json" --request POST --data "$JSON_DATA" "$URL")
  
  if [ "$RESPONSE_CODE" -eq 200 ]; then
    echo "Received 200 OK response!"
    break
  else
    echo "Waiting for 200 OK response, got $RESPONSE_CODE. Retrying in 5 seconds..."
    sleep 5
  fi
done

echo "⚙️  5. Running tests..."
npx hardhat test test/bundler-integration/*.ts --network local

echo "⚙️  6. Stopping geth and bundler...."
docker compose -f $COMPOSE_FILE_PATH down