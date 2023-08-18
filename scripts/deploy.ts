import { ethers, run, network } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  encodeParam,
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
      await run(`verify:verify`, {
        address: computedAddress,
        constructorArguments,
      });
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
  if (network.name !== "hardhat" && network.name !== "local") {
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
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.WALLET_FACTORY,
    `${SmartAccountFactory__factory.bytecode}${encodeParam(
      "address",
      baseImpAddress
    ).slice(2)}${encodeParam("address", smartAccountFactoryOwnerAddress).slice(
      2
    )}`,
    "SmartAccountFactory",
    [baseImpAddress, smartAccountFactoryOwnerAddress]
  );
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

async function main() {
  const deployerInstance = await getPredeployedDeployerContractInstance();
  await deployEntryPointContract(deployerInstance);
  console.log("=========================================");
  await deployBaseWalletImpContract(deployerInstance);
  console.log("=========================================");
  await deployWalletFactoryContract(deployerInstance);
  console.log("=========================================");
  await deployGasEstimatorContract(deployerInstance);
  console.log("=========================================");
  await deployDecoderContract(deployerInstance);
  console.log("=========================================");
  await deployMultiSendContract(deployerInstance);
  console.log("=========================================");
  await deployMultiSendCallOnlyContract(deployerInstance);
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
