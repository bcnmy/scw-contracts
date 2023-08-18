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
  GasEstimator__factory,
  MultiSend__factory,
  SmartAccount,
  SmartAccountFactory__factory,
  SmartAccount__factory,
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
const owner = process.env.PAYMASTER_OWNER_ADDRESS_DEV || "";
const verifyingSigner = process.env.PAYMASTER_SIGNER_ADDRESS_DEV || "";
const DEPLOYER_CONTRACT_ADDRESS =
  process.env.DEPLOYER_CONTRACT_ADDRESS_DEV || "";

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
    ).slice(2)}`,
    "SmartAccountFactory",
    [baseImpAddress]
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
    owner
  ).slice(2)}${encodeParam("address", entryPointAddress).slice(2)}${encodeParam(
    "address",
    verifyingSigner
  ).slice(2)}`;

  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.SINGELTON_PAYMASTER,
    bytecode,
    "VerifyingPaymaster",
    [owner, entryPointAddress, verifyingSigner]
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
