#!/bin/bash

SCRIPT=$(realpath $0)
SCRIPT_PATH=$(dirname $SCRIPT)
COMPOSE_FILE_PATH=$SCRIPT_PATH/../test/bundler-integration/docker-compose.yml

echo "1. Launching geth and bundler...."
docker compose -f $COMPOSE_FILE_PATH up -d

echo "2. Running tests..."
npx hardhat test test/bundler-integration/*.ts --network local

echo "3. Stopping geth and bundler...."
docker compose -f $COMPOSE_FILE_PATH down