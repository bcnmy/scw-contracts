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

#### BaseSmartAccount.sol (51 sloc)
Abstract contract that implements EIP4337 IWallet interface 
defines set of methods (compatible with EIP and Biconomy SDK) that all Smart Wallets must implement

#### Proxy.sol (26 sloc)
EIP1167 Proxy

#### SmartAccountFactory.sol (38 sloc)
Constract responsible for deploying smart wallets aka accounts using create2 and create
Has a method to compute conter factual wallet of the address before deploying

function deployCounterFactualWallet(address _owner, address _entryPoint, address _handler, uint _index) public returns(address proxy)

salt consists of _owner and _index. _entryPoint and _handler are required to init the wallet. 
(contest bonus : showcase any potential front running in wallet deployment)

#### SmartAccount.sol (332 sloc)
Base implementation contract for smart wallet
reference 1 : https://docs.gnosis-safe.io/contracts
reference 2 : https://github.com/eth-infinitism/account-abstraction/blob/develop/contracts/samples/SimpleWallet.sol
notes: 
1) reverting methods are used for gas estimations
2) transactions happen via EOA signature by calling execTransaction or validateUserOp and execFromEntryPoint via entry point
3) currently 1-1 multisig
4) ECDSA used ofr signature verification. contract signatures are suppoprted using EIP1271 (not extensively tested on protocols!)

#### EntryPoint.sol (344 sloc)
EIP4337 Entry Point contract (https://blog.openzeppelin.com/eth-foundation-account-abstraction-audit/)

#### StakeManager.sol (76 sloc)
Stake Manager for wallet and paymaster deposits / stakes
https://blog.openzeppelin.com/eth-foundation-account-abstraction-audit/

#### Executor.sol (25 sloc)
helper contract to make calls and delegatecalls to dapp contracts
#### FallbackManager.sol (34 sloc)
Fallback manager manages a fallback handler to fallback to (delegate call) when a method is not found in wallet implementation contract
#### ModuleManager.sol (75 sloc)
Gnosis Safe module manager
#### DefaultCallbackHandler.sol (50 sloc)
Manages hooks to react to receiving tokens

#### MultiSend.sol (35 sloc)
Allows to batch multiple transactions into one. Relayer -> Smart Wallet - > MultiSend -> Dapp contract / contracts

#### MultiSendCallOnly.sol (30 sloc)
MultiSend functionality but reverts if a transaction tries to do delegatecall

#### VerifyingSingletonPaymaster.sol (74 sloc)
 A paymaster that uses external service to decide whether to pay for the UserOp. The paymaster trusts an external signer to sign the transaction. The calling user must pass the UserOp to that external signer first, which performs whatever off-chain verification before signing the UserOp. Singleton Paymaster is biconomy Paymaster which can be used by all the Dapps and manages gas accounting for their corresponding paymasterId. 

 #### PaymasterHelpers.sol ()
 Library useful for decoding paymaster data and context


 ## Total Number of contracts and their respective paths in scope
 #### Please exclude everything else

 contracts/smart-contract-wallet/aa-4337/core/EntryPoint.sol
 contracts/smart-contract-wallet/aa-4337/core/SenderCreator.sol
 contracts/smart-contract-wallet/aa-4337/core/StakeManager.sol
 contracts/smart-contract-wallet/aa-4337/interfaces/IAccount.sol
 contracts/smart-contract-wallet/aa-4337/interfaces/IPaymaster.sol
 contracts/smart-contract-wallet/aa-4337/interfaces/IAggregatedAccount.sol
 contracts/smart-contract-wallet/aa-4337/interfaces/IEntryPoint.sol
 contracts/smart-contract-wallet/aa-4337/utils/Exec.sol
 contracts/smart-contract-wallet/aa-4337/interfaces/IStakeManager.sol 
 contracts/smart-contract-wallet/aa-4337/interfaces/UserOperation.sol
 contracts/smart-contract-wallet/aa-4337/interfaces/IAggregator.sol
 contracts/smart-contract-wallet/BaseSmartAccount.sol
 contracts/smart-contract-wallet/common/Enum.sol
 contracts/smart-contract-wallet/Proxy.sol
 contracts/smart-contract-wallet/SmartAccount.sol
 contracts/smart-contract-wallet/common/Singleton.sol 
 contracts/smart-contract-wallet/interfaces/IERC165.sol
 contracts/smart-contract-wallet/base/ModuleManager.sol
 contracts/smart-contract-wallet/base/FallbackManager.sol
 contracts/smart-contract-wallet/common/SignatureDecoder.sol
 contracts/smart-contract-wallet/common/SecuredTokenTransfer.sol
 contracts/smart-contract-wallet/interfaces/ISignatureValidator.sol
 contracts/smart-contract-wallet/SmartAccountFactory.sol
 contracts/smart-contract-wallet/base/Executor.sol
 contracts/smart-contract-wallet/handler/DefaultCallbackHandler.sol
 contracts/smart-contract-wallet/interfaces/ERC1155TokenReceiver.sol
 contracts/smart-contract-wallet/interfaces/ERC721TokenReceiver.sol
 contracts/smart-contract-wallet/interfaces/ERC777TokensRecipient.sol
 contracts/smart-contract-wallet/interfaces/IERC1271Wallet.sol
 contracts/smart-contract-wallet/libs/LibAddress.sol
 contracts/smart-contract-wallet/libs/Math.sol
 contracts/smart-contract-wallet/libs/MultiSend.sol
 contracts/smart-contract-wallet/libs/MultiSendCallOnly.sol
 contracts/smart-contract-wallet/paymasters/BasePaymaster.sol
 contracts/smart-contract-wallet/paymasters/PaymasterHelpers.sol
 contracts/smart-contract-wallet/paymasters/verifying/singleton/VerifyingSingletonPaymaster.sol


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
