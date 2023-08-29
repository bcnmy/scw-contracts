import { ethers, network } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  getDeployerInstance,
  isContract,
} from "./utils";

async function main() {
  const provider = ethers.provider;

  if (network.name !== "hardhat" || network.name !== "local") {
    console.log("Entry Point Already Deployed Address: ");
    return;
  }

  const deployerInstance = await getDeployerInstance();
  const salt = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.ENTRY_POINT)
  );

  const EntryPoint = await ethers.getContractFactory("EntryPoint");
  const entryPointBytecode = `${EntryPoint.bytecode}`;
  const entryPointComputedAddr = await deployerInstance.addressOf(salt);

  console.log("Entry Point Computed Address: ", entryPointComputedAddr);

  const isEntryPointDeployed = await isContract(
    entryPointComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!isEntryPointDeployed) {
    await deployContract(
      DEPLOYMENT_SALTS.ENTRY_POINT,
      entryPointComputedAddr,
      salt,
      entryPointBytecode,
      deployerInstance
    );
  } else {
    console.log(
      "Entry Point is Already deployed with address ",
      entryPointComputedAddr
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
