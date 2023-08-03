#!/bin/bash

SCRIPT=$(realpath $0)
SCRIPT_PATH=$(dirname $SCRIPT)
COMPOSE_FILE_PATH=$SCRIPT_PATH/../test/bundler-integration/docker-compose.yml

echo "1. Launching geth...."
docker compose -f $COMPOSE_FILE_PATH up geth-dev -d

echo "2. Deploying Entrypoint..."
npx hardhat run test/bundler-integration/deployEntrypoint.ts --network local

echo "3. Starting Bundler..."
docker compose -f $COMPOSE_FILE_PATH up bundler -d

echo "r. Running tests..."
npx hardhat test test/bundler-integration/*.ts --network local

echo "3. Stopping geth and bundler...."
docker compose -f $COMPOSE_FILE_PATH down