# Biconomy Smart Account Contracts v1.0 contest details

- \$TBD USDT main award pot
- \$TBD USDT gas optimization award pot
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts 
- Ends 

# Biconomy Smart Account (Smart Contract Wallet) Overview

Biconomy Smart Account is a smart contract wallet that builds on core concepts of Gnosis / Argent safes and implements an interface to support calls from [account abstraction](https://eips.ethereum.org/EIPS/eip-4337) Entry Point contract. We took all the the good parts of existing smart contract wallets. 

These smart wallets have a single owner (1/1 Multisig) and are designed in such a way that it is

- Cheap to deploy copies of a base wallet
- Wallet addresses are counterfactual in nature (you can know the address in advance and users will have the same address across all EVM chains)
- Deployment cost can be sponsored (gasless transactions by a relayer)
- Modules can be used to extend the functionality of the smart contract wallet. Concepts like multi-sig, session keys, etc also can be implemented using the MultiSig Module, SessionKey Module & so on.

## Smart Contracts
All the contracts in this section are to be reviewed. Any contracts not in this list are to be ignored for this contest.

#### BaseSmartWallet.sol ()
Abstract contract that implements EIP4337 IWallet interface 

# How to run the project

This project demonstrates an advanced Hardhat use case, integrating other tools commonly used alongside Hardhat in the ecosystem.

The project comes with a sample contract, a test for that contract, a sample script that deploys that contract, and an example of a task implementation, which simply lists the available accounts. It also comes with a variety of other tools, preconfigured to work with the project code.

Try running some of the following tasks:

```shell
npx hardhat accounts
npx hardhat compile
npx hardhat clean
npx hardhat test
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

# Etherscan verification

To try out Etherscan verification, you first need to deploy a contract to an Ethereum network that's supported by Etherscan, such as Ropsten.

In this project, copy the .env.example file to a file named .env, and then edit it to fill in the details. Enter your Etherscan API key, your Ropsten node URL (eg from Alchemy), and the private key of the account which will send the deployment transaction. With a valid .env file in place, first deploy your contract:

```shell
hardhat run --network ropsten scripts/deploy.ts
```

Then, copy the deployment address and paste it in to replace `DEPLOYED_CONTRACT_ADDRESS` in this command:

```shell
npx hardhat verify --network ropsten DEPLOYED_CONTRACT_ADDRESS "Hello, Hardhat!"
```

# Performance optimizations

For faster runs of your tests and scripts, consider skipping ts-node's type checking by setting the environment variable `TS_NODE_TRANSPILE_ONLY` to `1` in hardhat's environment. For more details see [the documentation](https://hardhat.org/guides/typescript.html#performance-optimizations).
