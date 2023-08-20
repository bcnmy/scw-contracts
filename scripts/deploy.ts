import { ethers, run } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_CHAIN_GAS_PRICES,
  DEPLOYMENT_SALTS,
  encodeParam,
  factoryStakeConfig,
  isContract,
} from "./utils";
import {
  Decoder__factory,
  Deployer,
  Deployer__factory,
  ERC20SessionValidationModule__factory,
  EcdsaOwnershipRegistryModule__factory,
  GasEstimator__factory,
  MultiSend__factory,
  MultichainECDSAValidator__factory,
  PasskeyRegistryModule__factory,
  SessionKeyManager__factory,
  SmartAccountFactory__factory,
  SmartAccount__factory,
  SmartContractOwnershipRegistryModule__factory,
} from "../typechain";
import {
  EntryPoint__factory,
  VerifyingPaymaster__factory,
} from "@account-abstraction/contracts";

const provider = ethers.provider;
let baseImpAddress = "";
let entryPointAddress =
  process.env.ENTRY_POINT_ADDRESS ||
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const smartAccountFactoryOwnerAddress =
  process.env.SMART_ACCOUNT_FACTORY_OWNER_ADDRESS_DEV || "";
const paymasterOwnerAddress = process.env.PAYMASTER_OWNER_ADDRESS_DEV || "";
const verifyingSigner = process.env.PAYMASTER_SIGNER_ADDRESS_DEV || "";
const DEPLOYER_CONTRACT_ADDRESS =
  process.env.DEPLOYER_CONTRACT_ADDRESS_DEV || "";

const contractsDeployed: Record<string, string> = {};

export async function deployGeneric(
  deployerInstance: Deployer,
  salt: string,
  bytecode: string,
  contractName: string,
  constructorArguments: any[]
): Promise<string> {
  try {
    const derivedSalt = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(salt));
    const computedAddress = await deployerInstance.addressOf(derivedSalt);

    console.log(`${contractName} Computed Address: ${computedAddress}`);

    const isDeployed = await isContract(computedAddress, provider); // true (deployed on-chain)
    if (!isDeployed) {
      await deployContract(
        salt,
        computedAddress,
        derivedSalt,
        bytecode,
        deployerInstance
      );
      try {
        await run(`verify:verify`, {
          address: computedAddress,
          constructorArguments,
        });
      } catch (err) {
        console.log(err);
      }
    } else {
      console.log(
        `${contractName} is Already deployed with address ${computedAddress}`
      );
    }

    contractsDeployed[contractName] = computedAddress;

    return computedAddress;
  } catch (err) {
    console.log(err);
    return "";
  }
}

async function deployEntryPointContract(deployerInstance: Deployer) {
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== 31337) {
    console.log("Entry Point Already Deployed Address: ", entryPointAddress);
    return;
  }

  entryPointAddress = await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.ENTRY_POINT,
    EntryPoint__factory.bytecode,
    "EntryPoint",
    []
  );
}

async function deployBaseWalletImpContract(deployerInstance: Deployer) {
  baseImpAddress = await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.WALLET_IMP,
    `${SmartAccount__factory.bytecode}${encodeParam(
      "address",
      entryPointAddress
    ).slice(2)}`,
    "SmartAccount",
    [entryPointAddress]
  );
}

async function deployWalletFactoryContract(deployerInstance: Deployer) {
  const [signer] = await ethers.getSigners();
  const chainId = (await provider.getNetwork()).chainId;
  const gasPriceConfig = DEPLOYMENT_CHAIN_GAS_PRICES[chainId];

  if (!factoryStakeConfig[chainId]) {
    throw new Error(`Paymaster stake config not found for chainId ${chainId}`);
  }
  if (!gasPriceConfig) {
    throw new Error(`Gas price config not found for chainId ${chainId}`);
  }

  if (!baseImpAddress || baseImpAddress.length === 0) {
    throw new Error("Base Imp Address not found");
  }

  const smartAccountFactoryAddress = await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.WALLET_FACTORY,
    `${SmartAccountFactory__factory.bytecode}${encodeParam(
      "address",
      baseImpAddress
    ).slice(2)}${encodeParam("address", signer.address).slice(2)}`,
    "SmartAccountFactory",
    [baseImpAddress, signer.address]
  );

  console.log("Staking Paymaster...");
  const { unstakeDelayInSec, stakeInWei } = factoryStakeConfig[chainId];
  const smartAccountFactory = SmartAccountFactory__factory.connect(
    smartAccountFactoryAddress,
    signer
  );
  let { hash, wait } = await smartAccountFactory.addStake(
    entryPointAddress,
    unstakeDelayInSec,
    {
      value: stakeInWei,
      ...gasPriceConfig,
    }
  );
  console.log("SmartAccountFactory Stake Transaction Hash: ", hash);
  await wait();

  console.log("Transferring Ownership of SmartAccountFactory...");
  ({ hash, wait } = await smartAccountFactory.transferOwnership(
    smartAccountFactoryOwnerAddress,
    {
      ...gasPriceConfig,
    }
  ));
  console.log(
    "SmartAccountFactory Transfer Ownership Transaction Hash: ",
    hash
  );
  await wait();
}

async function deployGasEstimatorContract(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.GAS_ESTIMATOR,
    `${GasEstimator__factory.bytecode}`,
    "GasEstimator",
    []
  );
}

async function deployDecoderContract(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.DECODER,
    `${Decoder__factory.bytecode}`,
    "Decoder",
    []
  );
}

async function deployMultiSendContract(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.MULTI_SEND,
    `${MultiSend__factory.bytecode}`,
    "MultiSend",
    []
  );
}

async function deployMultiSendCallOnlyContract(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.MULTI_SEND_CALLONLY,
    `${MultiSend__factory.bytecode}`,
    "MultiSendCallOnly",
    []
  );
}

async function deployVerifySingeltonPaymaster(deployerInstance: Deployer) {
  const bytecode = `${VerifyingPaymaster__factory.bytecode}${encodeParam(
    "address",
    paymasterOwnerAddress
  ).slice(2)}${encodeParam("address", entryPointAddress).slice(2)}${encodeParam(
    "address",
    verifyingSigner
  ).slice(2)}`;

  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.SINGELTON_PAYMASTER,
    bytecode,
    "VerifyingPaymaster",
    [paymasterOwnerAddress, entryPointAddress, verifyingSigner]
  );
}

async function deployEcdsaOwnershipRegistryModule(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.ECDSA_REGISTRY_MODULE,
    `${EcdsaOwnershipRegistryModule__factory.bytecode}`,
    "EcdsaOwnershipRegistryModule",
    []
  );
}

async function deployMultichainValidatorModule(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.MULTICHAIN_VALIDATOR_MODULE,
    `${MultichainECDSAValidator__factory.bytecode}`,
    "MultichainValidatorModule",
    []
  );
}

async function deployPasskeyModule(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.PASSKEY_MODULE,
    `${PasskeyRegistryModule__factory.bytecode}`,
    "PasskeyModule",
    []
  );
}

async function deploySessionKeyManagerModule(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.SESSION_KEY_MANAGER_MODULE,
    `${SessionKeyManager__factory.bytecode}`,
    "SessionKeyManagerModule",
    []
  );
}

async function deployErc20SessionValidationModule(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.ERC20_SESSION_VALIDATION_MODULE,
    `${ERC20SessionValidationModule__factory.bytecode}`,
    "ERC20SessionValidationModule",
    []
  );
}

async function deploySmartContractOwnershipRegistryModule(
  deployerInstance: Deployer
) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.SMART_CONTRACT_OWNERSHIP_REGISTRY_MODULE,
    `${SmartContractOwnershipRegistryModule__factory.bytecode}`,
    "SmartContractOwnershipRegistryModule",
    []
  );
}

/*
 *  This function is added to support the flow with pre-deploying the deployer contract
 *  using the `deployer-contract.deploy.ts` script.
 */
async function getPredeployedDeployerContractInstance(): Promise<Deployer> {
  const code = await provider.getCode(DEPLOYER_CONTRACT_ADDRESS);
  const chainId = (await provider.getNetwork()).chainId;
  const [signer] = await ethers.getSigners();

  if (code === "0x") {
    console.log(
      `Deployer not deployed on chain ${chainId}, deploy it with deployer-contract.deploy.ts script before using this script.`
    );
    throw new Error("Deployer not deployed");
  } else {
    console.log(
      "Deploying with EOA %s through Deployer Contract %s",
      signer.address,
      DEPLOYER_CONTRACT_ADDRESS
    );
    return Deployer__factory.connect(DEPLOYER_CONTRACT_ADDRESS, signer);
  }
}

export async function mainDeploy(): Promise<Record<string, string>> {
  const deployerInstance = await getPredeployedDeployerContractInstance();
  await deployEntryPointContract(deployerInstance);
  console.log("=========================================");
  await deployBaseWalletImpContract(deployerInstance);
  console.log("=========================================");
  await deployWalletFactoryContract(deployerInstance);
  // console.log("=========================================");
  // await deployGasEstimatorContract(deployerInstance);
  // console.log("=========================================");
  // await deployDecoderContract(deployerInstance);
  // console.log("=========================================");
  // await deployMultiSendContract(deployerInstance);
  // console.log("=========================================");
  // await deployMultiSendCallOnlyContract(deployerInstance);
  console.log("=========================================");
  await deployVerifySingeltonPaymaster(deployerInstance);
  console.log("=========================================");
  await deployEcdsaOwnershipRegistryModule(deployerInstance);
  console.log("=========================================");
  await deployMultichainValidatorModule(deployerInstance);
  console.log("=========================================");
  await deployPasskeyModule(deployerInstance);
  console.log("=========================================");
  await deploySessionKeyManagerModule(deployerInstance);
  console.log("=========================================");
  await deployErc20SessionValidationModule(deployerInstance);
  console.log("=========================================");
  await deploySmartContractOwnershipRegistryModule(deployerInstance);
  console.log("=========================================");

  console.log(
    "Deployed Contracts: ",
    JSON.stringify(contractsDeployed, null, 2)
  );

  return contractsDeployed;
}

if (require.main === module) {
  mainDeploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
