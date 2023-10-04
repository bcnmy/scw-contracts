#!/bin/bash -xe
#echo prepack for "contracts" 

npx hardhat clean 
npx hardhat compile

rm -rf artifacts-filtered types dist

mkdir -p artifacts-filtered
# openzeppelin can be used separately. same for account-abstraction (kept it for now)
cp `find  ./artifacts/contracts ./artifacts/@account-abstraction -type f | grep -v -E 'Test|dbg|gnosis|bls|IOracle'` artifacts-filtered
npx typechain --target ethers-v5 --out-dir types artifacts-filtered/**
npx tsc index.ts -d --outDir dist