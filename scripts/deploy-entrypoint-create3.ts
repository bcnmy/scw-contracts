import { Deployer, Deployer__factory } from "../typechain";
import { ethers, run } from "hardhat";
import fs from "fs";
import { deployContract, isContract } from "./utils";

const ENTRYPOINT_SALT = "BICONOMY_ENTRYPOINT_V0.6.0_DEPLOYMENT_KRtHnbp";

const ENTRYPOINT_BYTECODE = fs
  .readFileSync("scripts/bytecode/entrypoint_v0.6.0.txt")
  .toString();

const DEPLOYER_ADDRESS = process.env.DEPLOYER_CONTRACT_ADDRESS_PROD ?? "";

const provider = ethers.provider;

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

    return computedAddress;
  } catch (err) {
    console.log(err);
    return "";
  }
}

(async () => {
  const [signer] = await ethers.getSigners();

  if (ENTRYPOINT_BYTECODE.length === 0) {
    throw new Error("Entrypoint bytecode is empty");
  }

  console.log("Signer Address: ", signer.address);
  console.log(
    "Signer Balance: ",
    ethers.utils.formatEther(await signer.getBalance())
  );

  const deployerInstance = Deployer__factory.connect(DEPLOYER_ADDRESS, signer);

  if (!(await isContract(DEPLOYER_ADDRESS, provider))) {
    throw new Error("Deployer contract not deployed yet");
  }

  const entrypointAddress = await deployGeneric(
    deployerInstance,
    ENTRYPOINT_SALT,
    ENTRYPOINT_BYTECODE,
    "Entrypoint",
    []
  );

  console.log("Entrypoint Address: ", entrypointAddress);
})();
