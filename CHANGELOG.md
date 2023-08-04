# Changelog

This changelog only contains changes starting from past tagged [version v1.0.0](https://github.com/bcnmy/scw-contracts/releases/tag/v1.0.0).

# Version 2.0.0-launch

## Compiler settings

Solidity compiler: [0.8.17](https://github.com/ethereum/solidity/releases/tag/v0.8.17) 

Solidity optimizer: `{ enabled: true, runs: 800 }`

## Expected addresses with [Create3 Deployer](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/deployer/Deployer.sol) (default)

### Addresses and salts

| Contract name                      | Address                                    | Salts                                        |
|------------------------------------|--------------------------------------------|----------------------------------------------|
| Smart Account Implementation       | 0x00006B7e42e01957dA540Dc6a8F7C30c4D816af5 | PROD_WALLET_IMP_V0_11042023_ukWhPDF          |
| Smart Account Factory              | 0x000000F9eE1842Bb72F6BBDD75E6D3d4e3e9594C | PROD_WALLET_FACTORY_V0_11042023_Wfv6UKG      |
| Gas Estimator                      | 0x984a2441A196bf03d85fce4fe8c7A211249eDaAf | PROD_GAS_ESTIMATOR_V0_30032023               |
| Decoder                            | 0x8acd02fe897e5a98f5287Be9ee95d5feE74311B0 | PROD_DECODER_V0_30032023                     |
| Multisend                          | 0x072B87Dc4C439AD75748EA73cb120e06ee000E8a | PROD_MULTI_SEND_V0_30032023                  |
| Multisend callonly                 | 0xd34C0841a14Cd53428930D4E0b76ea2406603B00 | PROD_MULTI_SEND_CALLONLY_V0_30032023         |
| Verifying Singleton Paymaster      | 0x000031DD6D9D3A133E663660b959162870D755D4 | PROD_SINGLETON_PAYMASTER_V0_11042023_80LVBle |


## Changes 

### Core contracts

#### Remove batchId from `execTransaction()`
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

Issue: [#485](https://github.com/code-423n4/2023-01-biconomy-findings/issues/485)

Expected behaviour: Smart Account is not vulnerable to replay attacks using different batchId.

#### Add `init` method
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

Issue: [#496](https://github.com/code-423n4/2023-01-biconomy-findings/issues/496)

- Removed OZ `Initializable.sol` dependency. 
- If the `owner` has been set, Smart Account can not be initialized anymore.
- `Owner` is set to `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` in the constructor.

**!Attention:** never set `owner` to `address(0)` for the Smart Account (implementation or proxy), as it allows to call `init()` and set the new owner, thus get full ownership of the Smart Account. If you want to fully renounce ownership, set `owner` to `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`. If you want to pass signature verification and ownership to a module, set the module address as an `owner`.

Expected behaviour: Smart Account implementation is not left uninitialized. Can not initialize when `owner` is not `address(0)`.

#### Remove `validateAndUpdateNonce()` method
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

Issue: [AA-161](https://github.com/eth-infinitism/account-abstraction/pull/247)

Expected behaviour: Nonces are handled by the EntryPoint, not a Wallet contract. [Details](https://docs.google.com/document/d/1MywdH_TCkyEjD3QusLZ_kUZg4ZEI00qp97mBze9JI4k/edit#).

#### Rename `execTransaction()` to `execTransaction_S6W()`
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

Issue: [#434](https://github.com/code-423n4/2023-01-biconomy-findings/blob/main/data/0xSmartContract-G.md#g-26-optimize-names-to-save-gas)

Expected behaviour: execTransaction_S6W() is cheaper to call externally. For the compatibility, the `execTransaction()` wrapper function is introduced.

#### Add `tokenGasPriceFactor` in `getTransactionHash()` 

File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

Issue: [#492](https://github.com/code-423n4/2023-01-biconomy-findings/issues/492)

Expected behaviour: Relayer can not take extra refund as tokenGasPriceFactor is signed now.

#### Add `isValidSignature()` method
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

According to [EIP-1271](https://eips.ethereum.org/EIPS/eip-1271).

Expected behaviour: Smart Accounts are able to confirm whether the signature is valid or not. Under normal conditions just checks that the messages has been signed by the Smart Account `owner`. If the signature verification has been granted to module (Smart Account owner is active module), passes the verification flow to the module's `isValidSignature()` method.

#### `_validateSignature()` method redesign
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

Expected behaviour: If this method is called for the `userOp` that will `executeCall` to one of the enabled modules, the signature validation flow is passed to the module via `IModule(_to).validateSignature`. This approach allows for the alternative signing schemes (i.e. using passkeys) to be enabled as modules.

#### Make `execTransaction_S6W()` non reentrant
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

Custom realization of `nonReentrant` modifier. 

#### Redesign of the `checkSignatures()` method
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

- `signatureSplit` is now exepcting only one signature, not several, so there's no lopping over signatures inside.
- outdated signatures kinds handling removed
- common owner vs signer check added as per [Issue #175](https://github.com/code-423n4/2023-01-biconomy-findings/issues/175)

#### `execute()` and `executeBatch()` methods renamed
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

They are now `executeCall_s1m()` and `executeBatchCall_4by()`. 
In order to avoid mixing them with the `execute()` method of executor contract and to make external call to them cheaper.
For those who are scared by suffixes, `executeCall()` and `executeBatchCall()` wrapper methods are kept.

#### `receive()` methods emits `SmartAccountReceivedNativeToken` event
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

In order to avoid empty methods and provide trackable info on native tokens incoming flow
Event signature is `SmartAccountReceivedNativeToken(msg.sender, msg.value)`. So it emits token sender and amount.

#### Using `Math.sol` implementation of `max()` method instead of the custom one
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol)

#### Using custom error messages with `revert` staeents instead of `require` statements
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol), [`contracts/smart-contract-wallet/BaseSmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/BaseSmartAccount.sol)

Makes reverts cheaper and more informative. [Details](https://blog.soliditylang.org/2021/04/21/custom-errors/).

#### `Proxy.sol` redesign
File: [`contracts/smart-contract-wallet/Proxy.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/Proxy.sol)

Redesigned `Proxy.sol` to make new Smart Account deployment cheaper.
- Implementation address is now stored in the slot, that is defined by the address of this newly deployed proxy.
- `receive()` method moved to implementation

#### `SmartAccountFactory.sol` redesign
File: [`contracts/smart-contract-wallet/SmartAccountFactory.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccountFactory.sol)

Redesigned `SmartAccountFactory.sol` to make new Smart Account deployment efficient and safe against frontrunning attacks.
- Minimal Handler is deployed along with the Smart Account Factory deployment.
- Salt now consists of `index` and `initializer` data, that is used to initialize the deployed Proxy. This data contains owner info.
- Removed `VERSION` constant 
- In order to keep the consistent user's address accross chains it is recommended to use the same factory (thus the same implementation) for all the new Proxy (Smart Account) deployments and upgrade if there's new implementation deployed.

#### Removed nonces handling from `VerifyingSingletonPaymaster.sol`
File: [`contracts/smart-contract-wallet/paymasters/verifying/singleton/VerifyingSingletonPaymaster.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/paymasters/verifying/singleton/VerifyingSingletonPaymaster.sol)

The reason for adding a nonce to the paymaster was to handle cases where the nonce was not unique: a wallet could support static nonce, and it could re-use the VerifyingPaymaster validation multiple times.
But now nonces uniqueness is validated by Entrypoint. So a paymaster no longer need to check for uniqueness by itself.

#### QA Fixed
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol), [`contracts/smart-contract-wallet/BaseSmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/BaseSmartAccount.sol), [`contracts/smart-contract-wallet/SmartAccountFactory.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccountFactory.sol), [`contracts/smart-contract-wallet/Proxy.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/Proxy.sol), [`contracts/smart-contract-wallet/paymasters/verifying/singleton/VerifyingSingletonPaymaster.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/paymasters/verifying/singleton/VerifyingSingletonPaymaster.sol)

- Solidity 0.8.17
- Using named imports
- Open todo
- Disallow setting the exact same owner as new owner
- And several others

#### Gas optimization related changes
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccount.sol), [`contracts/smart-contract-wallet/BaseSmartAccount.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/BaseSmartAccount.sol), [`contracts/smart-contract-wallet/SmartAccountFactory.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/SmartAccountFactory.sol), [`contracts/smart-contract-wallet/Proxy.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/Proxy.sol), [`contracts/smart-contract-wallet/paymasters/verifying/singleton/VerifyingSingletonPaymaster.sol`](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/paymasters/verifying/singleton/VerifyingSingletonPaymaster.sol)

- Use `!= 0` instead of `> 0` for Unsigned Integer Comparison
- Use Shift Right/Left instead of Division/Multiplication if possible
- Change increment/decrement operations to regular addition/subtraction
- Uncheck Arithmetic Operation which will never Underflow/Overflow
- Use `++var` instead of `var++` when it does not affect logic
- Do not initialize vars with default values
- Protected functions marked payable
- Low level calls implemented with assembly
- Use assembly to write `address` storage values
- Use `uint256` instead of `bool`
- And others

### Deployment process

Those steps assume that you have successfully installed dependencies and all the tests via `npx hardhat test` pass.

#### Prepare the `.env` file according to the `.env` example structure.
- Comments regarding usage of FUNDING ACCOUNT and DEPLOYER CONTRACT DEPLOYER ACCOUNT are be given below.
- You will get address for the `DEPLOYER_CONTRACT_ADDRESS_` entries after deploying your Deployer contract.

#### Deploy the Deployer Contract running `deployer-contract.deploy.ts` script from the `scripts` folder.
You can use Biconomy Deployer Contracts:
DEV: `0xD3f89753278E419c8bda1eFe1366206B3D30C44f`
PROD: `0x988C135a1049Ce61730724afD342fb7C56CD2776`
Deployed on testnets, all both dev and prod: Polygon Mumbai, Ethereum Goerli, Avalanche Fuji, Arbitrum Goerli, Optimism Goerli, BSC Testnet, ZkEVM Testnet.
Deployed on mainnets: Polygon (dev and prod). Ethereum (prod), Avalanche(prod), Arbitrum One(prod), Arbitrum Nova(prod), Optimism(prod), BSC(prod).

Steps to deploy your own Deployer Contract:
-  Gas parameters located in the bottom of the file are used to calculate the gas cost of the deployment and transfer appropriate amount from the Funding EOA to the Deployer EOA. 
- Deployer EOA, that is set up using `DEPLOYER_CONTRACT_DEPLOYER_PRIVATE_KEY` entry.
- If you want your deployer contract to have the same address accross chains (thus allowing you to deploy other contracts with the persistent address accross chains) this Deployer EOA should be a fresh EOA that had no transactions.
- You can fund your Deployr EOA manually (only IN txns allowed), or you can fund Funding EOA and Deployer EOA will be funded from it in the course of script executing.
- You can manually setup gas for deploying the Deployer contract in the tx parameters after the `console.log("Deploying Deployer Contract...");` line like this: `{maxFeePerGas: 350e9, maxPriorityFeePerGas: 100e9, nonce: 0}`.
- When your Deployer Contract is deployed, fill the appropriate .env entries.

#### Deploy the protocol contracts running `deploy.ts`
- Select the contracts you want to deploy by commenting out the contracts you do not need in the bottom of the script.
- In the `utils/index.ts` set the deployment salts in the `enum DEPLOYMENT_SALTS`.
- You can manually set gas for the deployment in the `deployContract` function of `index.ts`
- In the beginning of the `deploy.ts` set the correct `consts`. Mind the DEV/PROD suffixes. You don't need to set 'baseImpAddress'.
- Run the script with `npx hardhat run --network _network_name_ scripts/deploy.ts`. Contract addresses will be persistent accross networks.



