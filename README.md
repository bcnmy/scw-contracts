
# Biconomy Smart Account (Smart Contract Wallet) Overview

Biconomy Modular Smart Account is an [EIP-4337](https://eips.ethereum.org/EIPS/eip-4337) compatible modular smart contract wallet.
Smart Account is ownerless by nature. UserOp and txns validation happens in Authorization Modules.

Smart Account is designed in such a way that it is:

- Modular => highly customizable and extandable. 
- Cheap to deploy proxy copies of an implementation (user wallets)
- Wallet addresses are counterfactual in nature (you can know the address in advance and users can have the same address across all EVM chains)
- Deployment cost can be sponsored 

# How to run the project

This project demonstrates an advanced Hardhat use case, integrating other tools commonly used alongside Hardhat in the ecosystem.

## 1. Install
```shell
> npm install
// or
> yarn install
```

## 2. Configure
Place a mnemonic in a `.secret` file in the root folder of the project.

### 3. Run

The project comes with a sample contract, a test for that contract, a sample script that deploys that contract, and an example of a task implementation, which simply lists the available accounts. It also comes with a variety of other tools, preconfigured to work with the project code.

Try running some of the following tasks:

```shell
npx hardhat test

// other
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
