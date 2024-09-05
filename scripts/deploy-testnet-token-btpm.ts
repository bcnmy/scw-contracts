import { ethers, run, network } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_CHAIN_GAS_PRICES,
  DEPLOYMENT_SALTS_DEV,
  DEPLOYMENT_SALTS_PROD,
  encodeParam,
  factoryStakeConfigDevx,
  factoryStakeConfigProd,
  isContract,
  writeDeploymentsToFile,
} from "./utils";
import {
  BTPMTestToken__factory,
  Deployer,
  Deployer__factory,
} from "../typechain";
import { formatEther, isAddress } from "ethers/lib/utils";
// import { AccountRecoveryModule__factory } from "../typechain-types";

// Deployment Configuration
const DEPLOYMENT_MODE = process.env.DEPLOYMENT_MODE! as "DEV" | "PROD";

const paymasterOwnerAddress =
  process.env[`PAYMASTER_OWNER_ADDRESS_${DEPLOYMENT_MODE}`]!;

const factoryStakeConfig = {
  DEV: factoryStakeConfigDevx,
  PROD: factoryStakeConfigProd,
}[DEPLOYMENT_MODE];

const DEPLOYER_CONTRACT_ADDRESS =
  process.env[`DEPLOYER_CONTRACT_ADDRESS_${DEPLOYMENT_MODE}`]!;
const DEPLOYMENT_SALTS =
  DEPLOYMENT_MODE === "DEV" ? DEPLOYMENT_SALTS_DEV : DEPLOYMENT_SALTS_PROD;

const provider = ethers.provider;
const contractsDeployed: Record<string, string> = {};

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

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
    } else {
      console.log(
        `${contractName} is Already deployed with address ${computedAddress}`
      );
    }

    try {
      await run("verify:verify", {
        address: computedAddress,
        constructorArguments,
      });
    } catch (err) {
      console.log(err);
    }

    contractsDeployed[contractName] = computedAddress;

    return computedAddress;
  } catch (err) {
    console.log(err);
    return "";
  }
}

async function deployBTPMTestERC20(deployerInstance: Deployer) {
  await deployGeneric(
    deployerInstance,
    DEPLOYMENT_SALTS.BTPM_TEST_TOKEN,
    `${BTPMTestToken__factory.bytecode}${encodeParam(
      "address",
      paymasterOwnerAddress
    ).slice(2)}`,
    "BTPMTestToken",
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

const verifyDeploymentConfig = () => {};

export async function mainDeploy(): Promise<Record<string, string>> {
  verifyDeploymentConfig();

  const [deployer] = await ethers.getSigners();

  const deployerBalanceBefore = await deployer.getBalance();
  console.log(
    `Deployer ${deployer.address} initial balance: ${formatEther(
      deployerBalanceBefore
    )}`
  );
  console.log("=========================================");

  const deployerInstance = await getPredeployedDeployerContractInstance();

  console.log("=========================================");
  await deployBTPMTestERC20(deployerInstance);
  await delay(5000);

  console.log("=========================================");

  console.log(
    "Deployed Contracts: ",
    JSON.stringify(contractsDeployed, null, 2)
  );

  const deployerBalanceAfter = await deployer.getBalance();
  console.log(
    `Deployer ${deployer.address} final balance: ${formatEther(
      deployerBalanceAfter
    )}`
  );
  console.log(
    `Funds used: ${formatEther(
      deployerBalanceBefore.sub(deployerBalanceAfter)
    )}`
  );

  return contractsDeployed;
}

if (require.main === module) {
  mainDeploy()
    .then((deployedContracts) => {
      writeDeploymentsToFile(deployedContracts, network.name);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
