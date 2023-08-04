
# Biconomy Smart Account (Smart Contract Wallet) Overview

Biconomy Smart Account is a smart contract wallet that builds on core concepts of Gnosis / Argent safes and implements an interface to support calls from [account abstraction](https://eips.ethereum.org/EIPS/eip-4337) Entry Point contract. We took all the good parts of existing smart contract wallets. 

These smart wallets have a single owner (1/1 Multisig) and are designed in such a way that it is

- Cheap to deploy copies of a base wallet
- Wallet addresses are counterfactual in nature (you can know the address in advance and users will have the same address across all EVM chains)
- Deployment cost can be sponsored (gasless transactions by a relayer)
- Modules can be used to extend the functionality of the smart contract wallet. Concepts like multi-sig, session keys, etc also can be implemented using the MultiSig Module, SessionKey Module & so on.

## Smart Contracts

#### BaseSmartAccount.sol (51 sloc)
Abstract contract that implements the EIP4337 IWallet interface 
defines set of methods (compatible with EIP and Biconomy SDK) that all Smart Wallets must implement

#### Proxy.sol (26 sloc)
lightweight Proxy which can be upgraded using UUPS pattern

#### SmartAccountFactory.sol (38 sloc)
Factory Contract is the one responsible for deploying smart wallets aka accounts using create2 and create
Has a method to compute counter factual address of the wallet before deploying

function deployCounterFactualAccount(address _implementation, bytes memory initializer, uint256 _index) public returns(address proxy)

salt consists of _owner and _index. _entryPoint and _handler are required to init the wallet. 

#### SmartAccount.sol (332 sloc)
Base implementation contract for a smart wallet
reference 1: https://docs.gnosis-safe.io/contracts
reference 2: https://github.com/eth-infinitism/account-abstraction/blob/master/contracts/samples/SimpleAccount.sol
notes: 
1) reverting methods are used for gas estimations
2) transactions happen via EOA signature by calling execTransaction or validateUserOp and executeCall / executeBatchCall via entry point
3) currently 1-1 multi-sig
4) ECDSA used for signature verification. contract signatures are supported using EIP1271 (not extensively tested on protocols!)

#### EntryPoint.sol (344 sloc)
EIP4337 Entry Point contract (https://blog.openzeppelin.com/eip-4337-ethereum-account-abstraction-incremental-audit/)

#### StakeManager.sol (76 sloc)
Stake Manager for wallet and paymaster deposits/stakes
https://blog.openzeppelin.com/eip-4337-ethereum-account-abstraction-incremental-audit/

#### Executor.sol (25 sloc)
helper contract to make calls and delegatecalls to dapp contracts
#### FallbackManager.sol (34 sloc)
Fallback manager manages a fallback handler to fallback to (delegate call) when a method is not found in the wallet implementation contract
#### ModuleManager.sol (75 sloc)
Gnosis Safe module manager
#### DefaultCallbackHandler.sol (50 sloc)
Manages hooks to react to receiving tokens

#### MultiSend.sol (35 sloc)
Allows to batch multiple transactions into one. Relayer -> Smart Wallet - > MultiSend -> Dapp contract / contracts

#### MultiSendCallOnly.sol (30 sloc)
MultiSend functionality but reverts if a transaction tries to do delegatecall

#### VerifyingSingletonPaymaster.sol (74 sloc)
 A paymaster uses an external service to decide whether to pay for the UserOp. The paymaster trusts an external signer to sign the transaction. The calling user must pass the UserOp to that external signer first, which performs whatever off-chain verification before signing the UserOp. Singleton Paymaster is biconomy Paymaster which can be used by all the Dapps and manages gas accounting for their corresponding paymasterId. 

 #### PaymasterHelpers.sol ()
 Library useful for decoding paymaster data and context

# How to run the project

This project demonstrates an advanced Hardhat use case, integrating other tools commonly used alongside Hardhat in the ecosystem.

#### You're going to need to place a mnemonic in a .secret file in the root. ####

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
