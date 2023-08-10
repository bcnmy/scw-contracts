#!/bin/bash

SCRIPT=$(realpath $0)
SCRIPT_PATH=$(dirname $SCRIPT)
ROOT_PATH=$SCRIPT_PATH/..
ENVIONRMENT_PATH=$SCRIPT_PATH/../test/bundler-integration/environment
COMPOSE_FILE_PATH=$ENVIONRMENT_PATH/docker-compose.yml
ENTRYPOINT_DEPLOY_SCRIPT_PATH=$ENVIONRMENT_PATH/deployEntrypoint.ts

docker compose -f $COMPOSE_FILE_PATH down

echo "⚙️  1. Launching geth...."
docker compose -f $COMPOSE_FILE_PATH up geth-dev -d

echo "⚙️  2. Deploying Entrypoint..."
npx hardhat run $ENTRYPOINT_DEPLOY_SCRIPT_PATH --network local

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

echo "⚙️  5. Running tests with params --network local $@"
npx hardhat test $(find $ROOT_PATH/test/bundler-integration -type f -name "*.ts") --network local "$@"

echo "⚙️  6. Stopping geth and bundler...."
docker compose -f $COMPOSE_FILE_PATH down