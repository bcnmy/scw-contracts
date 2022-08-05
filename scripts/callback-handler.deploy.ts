import { ethers } from "hardhat";
import {
  SALT,
  FACTORY_ADDRESS,
  getDeployedAddress,
  deploy,
  deployFactory,
  isContract,
} from "./utils";

const options = { gasLimit: 7000000 };

async function main() {
  const provider = ethers.provider;

  const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  if (!isFactoryDeployed) {
    const deployedFactory = await deployFactory(provider);
  }

  const callBackHandler = await ethers.getContractFactory(
    "DefaultCallbackHandler"
  );
  const callBackHandlerBytecode = `${callBackHandler.bytecode}`;
  const callBackHandlerComputedAddr = getDeployedAddress(
    callBackHandlerBytecode,
    ethers.BigNumber.from(SALT)
  );
  console.log(
    "CallBack Handler Computed Address: ",
    callBackHandlerComputedAddr
  );

  const iscallBackHandlerDeployed = await isContract(
    callBackHandlerComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!iscallBackHandlerDeployed) {
    const callBackHandlerDeployedAddr = await deploy(
      provider,
      callBackHandlerBytecode,
      ethers.BigNumber.from(SALT)
    );

    console.log("callBackHandlerDeployedAddr ", callBackHandlerDeployedAddr);
    const callBackHandlerDeploymentStatus =
      callBackHandlerComputedAddr === callBackHandlerDeployedAddr
        ? "Deployed Successfully"
        : false;

    console.log(
      "callBackHandlerDeploymentStatus ",
      callBackHandlerDeploymentStatus
    );

    if (!callBackHandlerDeploymentStatus) {
      console.log("Invalid CallBack Handler Deployment");
    }
  } else {
    console.log(
      "CallBack Handler is Already deployed with address ",
      callBackHandlerComputedAddr
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
