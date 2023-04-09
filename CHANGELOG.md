# Changelog

This changelog only contains changes starting from past tagged version v1.0.0

# Version 2.0.0-launch

## Compiler settings

Solidity compiler: [0.8.17](https://github.com/ethereum/solidity/releases/tag/v0.8.17) 

Solidity optimizer: `{ enabled: true, runs: 800 }`

## Expected addresses with [Create3 Deployer](https://github.com/bcnmy/scw-contracts/blob/master/contracts/smart-contract-wallet/deployer/Deployer.sol) (default)

### using below salts

  DECODER = "DEVX_DECODER_V0_30032023",
  ENTRY_POINT = "DEVX_ENTRY_POINT_V0_30032023",
  GAS_ESTIMATOR = "DEVX_GAS_ESTIMATOR_V0_30032023",
  MULTI_SEND = "DEVX_MULTI_SEND_V0_30032023",
  MULTI_SEND_CALLONLY = "DEVX_MULTI_SEND_CALLONLY_V0_30032023",
  WALLET_FACTORY = "DEVX_WALLET_FACTORY_V0_30032023",
  WALLET_IMP = "DEVX_WALLET_IMP_V0_30032023",
  SINGELTON_PAYMASTER = "DEVX_SINGELTON_PAYMASTER_V0_30032023"

| Contract name                      | Address                                    | Implementation                       |
|------------------------------------|--------------------------------------------|---------------------------------     |
| Smart Account Implementation-------| 0x263eD676d58b598E03BDDA82d7a268d6Acbd4824 | PROD_WALLET_IMP_V0_30032023          |
| Smart Account Factory              | 0x9eFE4ECe49221225db2Ef214be171578c39f13a4 | PROD_WALLET_FACTORY_V0_30032023      |
| Gas Estimator                      | 0x984a2441A196bf03d85fce4fe8c7A211249eDaAf | PROD_GAS_ESTIMATOR_V0_30032023       |
| Decoder                            | 0x8acd02fe897e5a98f5287Be9ee95d5feE74311B0 | PROD_DECODER_V0_30032023             |
| Multisend                          | 0x072B87Dc4C439AD75748EA73cb120e06ee000E8a | PROD_MULTI_SEND_V0_30032023          |
| Multisend callonly                 | 0xd34C0841a14Cd53428930D4E0b76ea2406603B00 | PROD_MULTI_SEND_CALLONLY_V0_30032023 |
| Verifying Singleton Paymaster      | 0x18b76535346A58715e7e0aC7C599A2B3f0294D28 | PROD_SINGELTON_PAYMASTER_V0_30032023 |


## Changes 

### Core contracts

File: [`contracts/smart-contract-wallet/SmartAccount.sol`](<GITHUB>)

#### Remove batchId from execTransaction()
Issue: [#](<C4_ISSUE_LINK>)

Expected behaviour:

File: [`contracts/smart-contract-wallet/SmartAccount.sol`](<GITHUB>)

#### Add tokenGasPriceFactor in getTransactionHash 
Issue: [#](h<C$_ISSUE_LINK>)

Expected behaviour:

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



