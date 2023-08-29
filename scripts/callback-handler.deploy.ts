import { ethers } from "hardhat";
import {
  deployContract,
  DEPLOYMENT_SALTS,
  getDeployerInstance,
  isContract,
} from "./utils";

async function main() {
  const provider = ethers.provider;

  // const isFactoryDeployed = await isContract(FACTORY_ADDRESS, provider);
  // if (!isFactoryDeployed) {
  //   const deployedFactory = await deployFactory(provider);
  // }

  const deployerInstance = await getDeployerInstance();
  const salt = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(DEPLOYMENT_SALTS.CALLBACK_HANDLER)
  );

  const callBackHandler = await ethers.getContractFactory(
    "DefaultCallbackHandler"
  );
  const callBackHandlerBytecode = `${callBackHandler.bytecode}`;
  const callBackHandlerComputedAddr = await deployerInstance.addressOf(salt);
  console.log(
    "CallBack Handler Computed Address: ",
    callBackHandlerComputedAddr
  );

  const iscallBackHandlerDeployed = await isContract(
    callBackHandlerComputedAddr,
    provider
  ); // true (deployed on-chain)
  if (!iscallBackHandlerDeployed) {
    await deployContract(
      DEPLOYMENT_SALTS.CALLBACK_HANDLER,
      callBackHandlerComputedAddr,
      salt,
      callBackHandlerBytecode,
      deployerInstance
    );
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
