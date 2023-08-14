# Biconomy Smart Account (Smart Contract Wallet) Overview

Biconomy Modular Smart Account is an [EIP-4337](https://eips.ethereum.org/EIPS/eip-4337) compatible modular smart contract wallet.
Smart Account is ownerless by nature. UserOp and txns validation happens in Authorization Modules.

Smart Account is designed in such a way that it is:

- Modular => highly customizable and extandable. 
- Cheap to deploy proxy copies of an implementation (user wallets)
- Wallet addresses are counterfactual in nature (you can know the address in advance and users can have the same address across all EVM chains)
- Deployment cost can be sponsored 

# How to run the project

## 1. Install
```shell
> npm install
// or
> yarn install
```
For Bundler Integration Tests also install Docker. 

## 2. Configure
Place a mnemonic in a `.secret` file in the root folder of the project.

## 3. Run
All the smart contracts are carefully tested.
There are two kinds of tests:
* Standard Hardhat environment tests which test the main contracts logic
* Bundler Integration tests which feature custom bundler-enabled environment to test that Smart Account and Modules operate properly in the wild with all the ERC-4337 limitations such as banned opcodes and storage access rules.

For Bundler integration tests you also need active Docker Environment.

```shell
# Regular Tests
npx hardhat test

# Bundler Integration Tests
# Install realpath
brew install coreutils
# Run Bundler Integration Tests
yarn bundler-test

# other
npx hardhat accounts
npx hardhat compile
npx hardhat clean
npx hardhat node
npx hardhat help
REPORT_GAS=true npx hardhat test
npx hardhat coverage
npx hardhat run scripts/deploy.ts
TS_NODE_FILES=true npx ts-node scripts/deploy.ts
npx eslint '**/*.{js,ts}'
npx eslint '**/*.{js,ts}' --fix
npx prettier '**/*.{json,sol,md}' --check
npx prettier '**/*.{json,sol,md}' --write
npx solhint 'contracts/**/*.sol'
npx solhint 'contracts/**/*.sol' --fix
```

# Performance optimizations

For faster runs of your tests and scripts, consider skipping ts-node's type checking by setting the environment variable `TS_NODE_TRANSPILE_ONLY` to `1` in hardhat's environment. For more details see [the documentation](https://hardhat.org/guides/typescript.html#performance-optimizations).
