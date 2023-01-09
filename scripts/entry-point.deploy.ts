import { ethers } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  encodeParam,
  getDeployerInstance,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000, gasPrice: 70000000000 };

async function main() {
  const provider = ethers.provider;

  const UNSTAKE_DELAY_SEC = 86400; // update to very high value
  const PAYMASTER_STAKE = ethers.utils.parseEther("1"); // TODO : update to at least 1000$ Note: depends on chain!

  const deployerInstance = await getDeployerInstance();
  const salt = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.ENTRY_POINT)
  );


  const EntryPoint = await ethers.getContractFactory("EntryPoint");
  const entryPointBytecode = `${EntryPoint.bytecode}${encodeParam(
    "uint",
    PAYMASTER_STAKE
  ).slice(2)}${encodeParam("uint32", UNSTAKE_DELAY_SEC).slice(2)}`;
  const entryPointComputedAddr =  await deployerInstance.addressOf(salt);

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
