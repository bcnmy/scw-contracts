# Changelog

This changelog only contains changes starting from past tagged [version v1.0.0](https://github.com/bcnmy/scw-contracts/releases/tag/v1.0.0).

# Version 2.0.0-launch

## Compiler settings

Solidity compiler: [0.8.17](https://github.com/ethereum/solidity/releases/tag/v0.8.17) 

Solidity optimizer: `{ enabled: true, runs: 800 }`

## Expected addresses with [Create3 Deployer](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/deployer/Deployer.sol) (default)

### Using below salts

  DECODER = "DEVX_DECODER_V0_30032023",
  GAS_ESTIMATOR = "DEVX_GAS_ESTIMATOR_V0_30032023",
  MULTI_SEND = "DEVX_MULTI_SEND_V0_30032023",
  MULTI_SEND_CALLONLY = "DEVX_MULTI_SEND_CALLONLY_V0_30032023",
  WALLET_FACTORY = "DEVX_WALLET_FACTORY_V0_30032023",
  WALLET_IMP = "DEVX_WALLET_IMP_V0_30032023",
  SINGELTON_PAYMASTER = "DEVX_SINGELTON_PAYMASTER_V0_30032023"

| Contract name                      | Address                                    | Implementation                               |
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

#### Remove batchId from execTransaction()
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](<GITHUB>)

Issue: [#](<C4_ISSUE_LINK>)

Expected behaviour:

#### Rename execTransaction() to execTransaction_S6W()
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](<GITHUB>)

Issue: [#434](https://github.com/code-423n4/2023-01-biconomy-findings/blob/main/data/0xSmartContract-G.md#g-26-optimize-names-to-save-gas)

Expected behaviour: execTransaction_S6W() is cheaper to call externally. For the compatibility, the `execTransaction()` wrapper function is introduced.

#### Add tokenGasPriceFactor in getTransactionHash 

File: [`contracts/smart-contract-wallet/SmartAccount.sol`](<GITHUB>)

Issue: [#](h<C$_ISSUE_LINK>)

Expected behaviour:

#### Add isValidSignature() method
File: [`contracts/smart-contract-wallet/SmartAccount.sol`](<GITHUB>)

According to [EIP-1271](https://eips.ethereum.org/EIPS/eip-1271):

Expected behaviour: Smart Accounts are able to confirm whether the signature is valid or not. Under normal conditions just checks that the messages has been signed by the Smart Account `owner`. If the signature verification has been granted to module (Smart Account owner is active module), passes the verification flow to the module's `isValidSignature()` method.

TODO
#### (and so forth..)


### Deployment process

### Libraries

The following libraries have been marked as production ready.

#### 

File: [`<PATH>`](<GITHUB>)

Expected behaviour:


#### 


File: [`contracts/<PATH>`](<GITHUB>)

Expected behaviour:



