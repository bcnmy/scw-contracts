import { ethers } from "hardhat";
import {
  SALT,
  FACTORY_ADDRESS,
  getDeployedAddress,
  deploy,
  deployFactory,
  encodeParam,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000, gasPrice: 70000000000 };

async function main() {
  const provider = ethers.provider;

  const UNSTAKE_DELAY_SEC = 86400; // update to very high value
  const PAYMASTER_STAKE = ethers.utils.parseEther("1"); // TODO : update to at least 1000$ Note: depends on chain!

  const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  if (!isFactoryDeployed) {
    const deployedFactory = await deployFactory(provider);
  }

  const EntryPoint = await ethers.getContractFactory("EntryPoint");
  const entryPointBytecode = `${EntryPoint.bytecode}${encodeParam(
    "uint",
    PAYMASTER_STAKE
  ).slice(2)}${encodeParam("uint32", UNSTAKE_DELAY_SEC).slice(2)}`;
  const entryPointComputedAddr = getDeployedAddress(
    entryPointBytecode,
    ethers.BigNumber.from(SALT)
  );
  console.log("Entry Point Computed Address: ", entryPointComputedAddr);

  const isEntryPointDeployed = await isContract(
    entryPointComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!isEntryPointDeployed) {
    const entryPointDeployedAddr = await deploy(
      provider,
      entryPointBytecode,
      ethers.BigNumber.from(SALT)
    );

    console.log("entryPointDeployedAddr ", entryPointDeployedAddr);
    const entryPointDeploymentStatus =
      entryPointComputedAddr === entryPointDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log("entryPointDeploymentStatus ", entryPointDeploymentStatus);

    if (!entryPointDeploymentStatus) {
      console.log("Invalid Entry Point Deployment");
    }
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
